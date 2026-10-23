// Conferência de um backup do piloto, SEM conexão com o piloto (ver
// docs/runbooks/publicacao-contas-piloto.md). Tudo acontece num PostgreSQL
// descartável criado aqui, só em 127.0.0.1, com TLS verificado (certificado
// gerado na hora) e senha aleatória:
//
//   1. sha256 do dump igual ao do manifesto;
//   2. pg_restore completo, numa transação, parando no primeiro erro;
//   3. contagem e md5 de cada tabela iguais aos do manifesto (mesmo snapshot
//      do pg_dump);
//   4. se o backup é do estado `before-accounts-administration`: ensaio da
//      migration na cópia, com o mesmo código da fase aplicar (só a pendente),
//      conferência `after` e nenhuma linha antiga perdida ou alterada fora das
//      tabelas que ganham colunas;
//   5. grava `restauracao-conferida.json` na pasta do backup.
//
// O servidor e a pasta temporária (que contém os dados restaurados) são
// apagados no fim, com sucesso ou falha. O dump fica onde estava.
//
// Uso, na pasta backend, depois dos dois builds (o lançador faz):
//   node scripts/conferir-restauracao-piloto.mjs [--pasta=<nome em AGENDA_OPS_DIR>]
// Sem --pasta, usa o backup `contas-*` mais recente.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { homedir, tmpdir, userInfo } from "node:os";
import path from "node:path";
import { Parada } from "./entrada-oculta.mjs";
import {
  ambienteLibpq,
  aplicarSomenteAPendente,
  compararFotografias,
  conectar,
  encerrar,
  encerrarTodas,
  fotografar,
  parar,
  pastaForaDoRepositorio,
  registrar,
  rodar,
  sha256DoArquivo,
} from "./operacao-piloto.mjs";

const PG_BIN = process.env.PG_BIN ?? "C:/Program Files/PostgreSQL/18/bin";
const OPENSSL = process.env.OPENSSL ?? "C:/Program Files/Git/usr/bin/openssl.exe";
const PASTA = process.env.AGENDA_OPS_DIR ?? path.join(homedir(), "AgendaCloud-operacoes");
const REGISTRO = path.join(PASTA, "operacoes.jsonl");
// Tabelas que a migration altera de propósito (colunas novas com padrão).
const ALTERADAS_PELA_MIGRATION = ["invites", "sessions", "audit_logs"];

const log = (linha) => console.log(linha);
const argumento = process.argv.slice(2).find((a) => a.startsWith("--pasta="))?.slice("--pasta=".length);
const bin = (nome) => path.join(PG_BIN, `${nome}.exe`);

function portaLivre() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

const PREFIXO_TEMP = "agenda-cloud-restauracao-";

/** Para o servidor e apaga a pasta, sem esperar (Ctrl+C e sobras). */
function descartarJa(pasta) {
  if (existsSync(path.join(pasta, "dados", "postmaster.pid"))) {
    spawnSync(bin("pg_ctl"), ["-D", path.join(pasta, "dados"), "-m", "immediate", "-w", "stop"], { stdio: "ignore", windowsHide: true });
  }
  rmSync(pasta, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}

/** Uma execução interrompida (janela fechada) pode ter deixado o servidor e
 * a cópia restaurada; são removidos antes de começar. */
function limparSobras() {
  const sobras = readdirSync(tmpdir()).filter((n) => n.startsWith(PREFIXO_TEMP));
  for (const nome of sobras) descartarJa(path.join(tmpdir(), nome));
  log(`SOBRAS_REMOVIDAS: ${sobras.length}`);
}

async function exigir(executavel, args, env, codigoErro, opcoes) {
  const { codigo, stderr } = await rodar(executavel, args, env, opcoes);
  if (codigo !== 0) {
    log(`DETALHE: ${path.basename(executavel)} saiu com ${codigo}: ${stderr.slice(0, 600)}`);
    parar(codigoErro);
  }
  return stderr;
}

function escolherPasta() {
  if (argumento) return path.isAbsolute(argumento) ? argumento : path.join(PASTA, argumento);
  const candidatas = existsSync(PASTA)
    ? readdirSync(PASTA)
        .filter((n) => /^contas-(preparar|aplicar)-/.test(n) && existsSync(path.join(PASTA, n, "manifesto.json")))
        .sort((a, b) => a.replace(/^contas-\w+-/, "").localeCompare(b.replace(/^contas-\w+-/, "")))
    : [];
  if (candidatas.length === 0) parar("ERR_NENHUM_BACKUP_ENCONTRADO");
  return path.join(PASTA, candidatas.at(-1));
}

async function principal() {
  log("Conferência de backup do piloto em PostgreSQL descartável local (sem conexão com o piloto)");
  for (const nome of ["initdb", "pg_ctl", "pg_restore"]) if (!existsSync(bin(nome))) parar("ERR_BINARIO_POSTGRES_AUSENTE");
  if (!existsSync(OPENSSL)) parar("ERR_OPENSSL_AUSENTE");
  if (!pastaForaDoRepositorio(PASTA)) parar("ERR_PASTA_DE_OPERACOES_DENTRO_DO_REPOSITORIO");
  let schema;
  try {
    schema = await import("../dist-scripts/lib/contas-administracao-schema.js");
    await import("../dist-migrations/database/migrations-data-source.js");
  } catch {
    parar("ERR_BUILD_AUSENTE");
  }

  const pastaBackup = escolherPasta();
  log(`BACKUP: ${path.basename(pastaBackup)}`);
  const manifesto = JSON.parse(readFileSync(path.join(pastaBackup, "manifesto.json"), "utf8"));
  const dump = path.join(pastaBackup, manifesto.backup.arquivo);
  const sha256 = sha256DoArquivo(dump);
  if (sha256 !== manifesto.backup.sha256) parar("ERR_SHA256_DIFERENTE_DO_MANIFESTO");
  log(`SHA256_CONFERE: true (${sha256.slice(0, 16)}...)`);
  log(`PONTO_DE_RECUPERACAO: ${manifesto.pontoDeRecuperacao}  SERVIDOR_ORIGEM: ${manifesto.servidor}`);

  limparSobras();
  const temp = mkdtempSync(path.join(tmpdir(), PREFIXO_TEMP));
  const dados = path.join(temp, "dados");
  process.once("SIGINT", () => {
    log("CANCELADO: removendo o servidor descartável e a cópia restaurada");
    descartarJa(temp);
    process.exit(130);
  });
  let servidorNoAr = false;
  const resultado = { sha256 };
  try {
    // Servidor descartável: só 127.0.0.1, só hostssl, scram-sha-256.
    const senha = randomBytes(24).toString("base64url");
    writeFileSync(path.join(temp, "senha.txt"), senha);
    const crt = path.join(temp, "servidor.crt").replaceAll("\\", "/");
    const key = path.join(temp, "servidor.key").replaceAll("\\", "/");
    await exigir(
      OPENSSL,
      ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost", "-keyout", key, "-out", crt],
      {},
      "ERR_CERTIFICADO_LOCAL",
    );
    await exigir(
      bin("initdb"),
      ["-D", dados, "-U", "postgres", "-A", "scram-sha-256", `--pwfile=${path.join(temp, "senha.txt")}`, "-E", "UTF8", "--no-locale", "--no-instructions"],
      {},
      "ERR_INITDB",
    );
    rmSync(path.join(temp, "senha.txt"));
    const porta = await portaLivre();
    appendFileSync(
      path.join(dados, "postgresql.conf"),
      `\nlisten_addresses = '127.0.0.1'\nport = ${porta}\nssl = on\nssl_cert_file = '${crt}'\nssl_key_file = '${key}'\nmax_connections = 10\n`,
    );
    writeFileSync(path.join(dados, "pg_hba.conf"), "hostssl all postgres 127.0.0.1/32 scram-sha-256\n");
    await exigir(bin("pg_ctl"), ["-D", dados, "-l", path.join(temp, "servidor.log"), "-w", "-t", "60", "start"], {}, "ERR_SERVIDOR_LOCAL", {
      semSaida: true,
    });
    servidorNoAr = true;
    const local = (database) => ({
      host: "127.0.0.1",
      servidorTls: "localhost",
      port: porta,
      user: "postgres",
      password: senha,
      database,
      ca: readFileSync(crt, "utf8"),
    });
    const admin = await conectar(local("postgres"), { aplicacao: "agenda-cloud-restauracao", log });
    const [{ versaoLocal }] = (await admin.query("SELECT current_setting('server_version') AS \"versaoLocal\"")).rows;
    await admin.query("CREATE DATABASE neondb TEMPLATE template0 ENCODING 'UTF8'");
    await encerrar(admin);
    log(`SERVIDOR_DESCARTAVEL: PostgreSQL ${versaoLocal} em 127.0.0.1, TLS verificado`);

    const destino = local("neondb");
    log("RESTAURACAO: executando pg_restore ...");
    await exigir(
      bin("pg_restore"),
      ["-d", "neondb", "--no-owner", "--no-privileges", "--exit-on-error", "--single-transaction", dump],
      ambienteLibpq(destino, crt, "agenda-cloud-restauracao"),
      "ERR_PG_RESTORE",
    );
    log("RESTAURACAO: ok");

    // Igual ao snapshot do backup?
    let restaurado;
    const leitor = await conectar(destino, { aplicacao: "agenda-cloud-restauracao", log });
    try {
      await leitor.query("BEGIN TRANSACTION READ ONLY");
      restaurado = await fotografar(leitor);
      await leitor.query("ROLLBACK");
    } finally {
      await encerrar(leitor);
    }
    const igual = compararFotografias(manifesto, restaurado);
    log(`TABELAS: ${Object.keys(restaurado.contagens).length} (manifesto: ${Object.keys(manifesto.contagens).length})`);
    log(`CONTAGENS_IGUAIS: ${igual.contagensDiferentes.length === 0 && igual.ausentes.length === 0 && igual.sobrando.length === 0}`);
    log(`CONTEUDO_IGUAL_MD5: ${igual.somasDiferentes.length === 0}`);
    if (!igual.iguais) {
      log(`DIVERGENCIAS: contagem=${igual.contagensDiferentes.join(",") || "-"} md5=${igual.somasDiferentes.join(",") || "-"} ausentes=${igual.ausentes.join(",") || "-"} sobrando=${igual.sobrando.join(",") || "-"}`);
      parar("ERR_RESTAURACAO_DIFERENTE_DO_MANIFESTO");
    }
    Object.assign(resultado, { tabelas: Object.keys(restaurado.contagens).length, versaoLocal, contagensIguais: true, conteudoIgualMd5: true });

    // Ensaio da migration na cópia restaurada.
    if (manifesto.esperado === "before-accounts-administration") {
      const conferente = await conectar(destino, { aplicacao: "agenda-cloud-restauracao", log });
      let falhasAntes;
      try {
        falhasAntes = schema.falhasAntesDeContas(await schema.lerEstadoContas(conferente));
      } finally {
        await encerrar(conferente);
      }
      log(`ENSAIO_BEFORE: ${falhasAntes.length === 0 ? "ok" : falhasAntes.join(",")}`);
      if (falhasAntes.length) parar("ERR_ENSAIO_ESTADO_ANTES");
      await aplicarSomenteAPendente(destino, {
        esperadasAntes: [...schema.MIGRATIONS_ATE_WEB_PUSH],
        pendente: schema.MIGRATION_CONTAS,
        aplicacao: "agenda-cloud-restauracao",
        log,
      });
      const depois = await conectar(destino, { aplicacao: "agenda-cloud-restauracao", log });
      let falhasDepois;
      let aposMigration;
      try {
        falhasDepois = schema.falhasDepoisDeContas(await schema.lerEstadoContas(depois));
        await depois.query("BEGIN TRANSACTION READ ONLY");
        aposMigration = await fotografar(depois);
        await depois.query("ROLLBACK");
      } finally {
        await encerrar(depois);
      }
      log(`ENSAIO_AFTER: ${falhasDepois.length === 0 ? "ok" : falhasDepois.join(",")}`);
      if (falhasDepois.length) parar("ERR_ENSAIO_ESTADO_DEPOIS");
      const preservado = compararFotografias(restaurado, aposMigration, {
        ignorarSomas: ALTERADAS_PELA_MIGRATION,
        ignorarTabelas: ["typeorm_migrations"],
        novasPermitidas: ["password_resets"],
      });
      const historico = aposMigration.contagens.typeorm_migrations === restaurado.contagens.typeorm_migrations + 1;
      log(`ENSAIO_DADOS_PRESERVADOS: ${preservado.iguais}`);
      log(`ENSAIO_HISTORICO_MAIS_UMA: ${historico}`);
      if (!preservado.iguais || !historico) {
        log(`DIVERGENCIAS: contagem=${preservado.contagensDiferentes.join(",") || "-"} md5=${preservado.somasDiferentes.join(",") || "-"}`);
        parar("ERR_ENSAIO_ALTEROU_DADOS");
      }
      resultado.ensaioMigration = "ok";
    } else {
      log(`ENSAIO_MIGRATION: não se aplica (backup do estado ${manifesto.esperado ?? "desconhecido"})`);
      resultado.ensaioMigration = "nao_se_aplica";
    }
    resultado.resultado = "restauracao_e_ensaio_ok";
  } finally {
    await encerrarTodas();
    if (servidorNoAr) await rodar(bin("pg_ctl"), ["-D", dados, "-m", "fast", "-w", "stop"], {}, { semSaida: true }).catch(() => {});
    rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
    log(`DESCARTAVEL_APAGADO: ${!existsSync(temp)}`);
  }

  const conferencia = { ...resultado, backup: path.basename(pastaBackup), concluidaEm: new Date().toISOString() };
  writeFileSync(path.join(pastaBackup, "restauracao-conferida.json"), JSON.stringify(conferencia, null, 2));
  mkdirSync(PASTA, { recursive: true });
  registrar(REGISTRO, {
    operacao: "conferir_restauracao",
    operador: `conta Windows local '${userInfo().username}'`,
    ...conferencia,
  });
  log("RESULTADO: restauração conferida" + (resultado.ensaioMigration === "ok" ? " e migration ensaiada na cópia" : ""));
}

principal()
  .catch((erro) => {
    const codigo = erro instanceof Parada ? erro.message : "ERR_INESPERADO";
    log(`ERRO: ${codigo}`);
    if (!(erro instanceof Parada)) log(`DETALHE: ${erro?.code ? `${erro.code} ` : ""}${String(erro?.message ?? erro).slice(0, 400)}`);
    try {
      registrar(REGISTRO, { operacao: "conferir_restauracao", resultado: "falhou", codigo, concluidaEm: new Date().toISOString() });
    } catch {
      // O erro original é o que importa.
    }
    process.exitCode = 1;
  })
  .finally(() => encerrarTodas());
