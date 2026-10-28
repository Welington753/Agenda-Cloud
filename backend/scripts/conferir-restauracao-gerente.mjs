// Conferência de um backup da publicação de TeamManagerAccess1793145600000,
// SEM conexão com o piloto (ver docs/runbooks/publicacao-gerente-piloto.md).
// Mesmo procedimento de conferir-restauracao-equipe.mjs: tudo acontece num
// PostgreSQL descartável criado aqui, só em 127.0.0.1, com TLS verificado
// (certificado gerado na hora) e senha aleatória.
//
//   1. o backup é desta operação, do estado `before-team-manager` e do MESMO
//      commit desta pasta (o ensaio usa a migration compilada que a fase
//      `aplicar` vai usar); sha256 do dump igual ao do manifesto;
//   2. pg_restore completo, numa transação, parando no primeiro erro;
//   3. contagem e md5 de cada tabela iguais aos do manifesto;
//   4. `before-team-manager` e levantamento das vagas e colisões na cópia;
//   5. TeamManagerAccess aplicada na cópia pelo mesmo código da fase
//      `aplicar` (só a pendente), `after-team-manager`, e nada antigo
//      perdido: todas as tabelas, inclusive `users` (só ganha constraint e
//      gatilho), com md5 igual; em memberships, o md5 das colunas antigas
//      igual; nenhum vínculo confirmado nem ajuste com valor novo; o
//      levantamento igual ao de antes;
//   6. grava `restauracao-conferida.json` (com o commit) na pasta do backup.
//
// O servidor e a pasta temporária são apagados no fim, com sucesso ou falha.
//
// Uso, na pasta backend, depois dos dois builds (o lançador faz):
//   node scripts/conferir-restauracao-gerente.mjs [--pasta=<nome em AGENDA_OPS_DIR>]
// Sem --pasta, usa o backup `gerente-*` mais recente.
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir, userInfo } from "node:os";
import path from "node:path";
import { Parada } from "./entrada-oculta.mjs";
import {
  RAIZ_DO_REPOSITORIO,
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
import { ESPERADO_ANTES, MIGRATION, OPERACAO, PREFIXO_DAS_PASTAS, TABELAS_ALTERADAS } from "./gerente-piloto.mjs";

const PG_BIN = process.env.PG_BIN ?? "C:/Program Files/PostgreSQL/18/bin";
const OPENSSL = process.env.OPENSSL ?? "C:/Program Files/Git/usr/bin/openssl.exe";
const PASTA = process.env.AGENDA_OPS_DIR ?? path.join(homedir(), "AgendaCloud-operacoes");
const REGISTRO = path.join(PASTA, "operacoes.jsonl");
const PREFIXO_TEMP = "agenda-cloud-restauracao-gerente-";

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

/** Para o servidor e apaga a pasta, sem esperar (Ctrl+C e sobras). */
function descartarJa(pasta) {
  if (existsSync(path.join(pasta, "dados", "postmaster.pid"))) {
    spawnSync(bin("pg_ctl"), ["-D", path.join(pasta, "dados"), "-m", "immediate", "-w", "stop"], { stdio: "ignore", windowsHide: true });
  }
  rmSync(pasta, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}

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
  const padrao = new RegExp(`^${PREFIXO_DAS_PASTAS}(preparar|aplicar)-`);
  const candidatas = existsSync(PASTA)
    ? readdirSync(PASTA)
        .filter((n) => padrao.test(n) && existsSync(path.join(PASTA, n, "manifesto.json")))
        .sort((a, b) => a.replace(padrao, "").localeCompare(b.replace(padrao, "")))
    : [];
  if (candidatas.length === 0) parar("ERR_NENHUM_BACKUP_ENCONTRADO");
  return path.join(PASTA, candidatas.at(-1));
}

function commitAtual() {
  const git = (args) => execFileSync("git", args, { cwd: RAIZ_DO_REPOSITORIO, encoding: "utf8" }).trim();
  return { sha: git(["rev-parse", "HEAD"]), sujo: git(["status", "--porcelain", "--", "backend"]) !== "" };
}

/** Colunas atuais de uma tabela de `public`, na ordem. */
async function colunasDe(client, tabela) {
  const { rows } = await client.query(
    "SELECT column_name AS nome FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position",
    [tabela],
  );
  return rows.map((r) => r.nome);
}

/** md5 do conteúdo de `colunas` (as que existiam antes da migration), no
 * formato fixo de `fotografar`. */
async function somaDasColunas(client, tabela, colunas) {
  const lista = colunas.map((c) => `"${c.replaceAll('"', '""')}"`).join(", ");
  await client.query("BEGIN TRANSACTION READ ONLY");
  try {
    await client.query("SET LOCAL TimeZone = 'UTC'");
    await client.query("SET LOCAL DateStyle = 'ISO, YMD'");
    await client.query("SET LOCAL IntervalStyle = 'postgres'");
    await client.query("SET LOCAL extra_float_digits = 1");
    const [{ soma }] = (
      await client.query(
        `SELECT coalesce(md5(string_agg(x::text, E'\\n' ORDER BY x::text COLLATE "C")), '') AS soma FROM (SELECT ${lista} FROM public."${tabela}") x`,
      )
    ).rows;
    return soma;
  } finally {
    await client.query("ROLLBACK");
  }
}

async function principal() {
  log(`Conferência de backup da publicação de ${MIGRATION} em PostgreSQL descartável local (sem conexão com o piloto)`);
  for (const nome of ["initdb", "pg_ctl", "pg_restore"]) if (!existsSync(bin(nome))) parar("ERR_BINARIO_POSTGRES_AUSENTE");
  if (!existsSync(OPENSSL)) parar("ERR_OPENSSL_AUSENTE");
  if (!pastaForaDoRepositorio(PASTA)) parar("ERR_PASTA_DE_OPERACOES_DENTRO_DO_REPOSITORIO");
  log(`PASTA_DE_OPERACOES: ${PASTA}`);
  const { sha, sujo } = commitAtual();
  log(`COMMIT: ${sha}${sujo ? " (backend com alterações locais)" : ""}`);
  if (sujo) parar("ERR_BACKEND_COM_ALTERACOES_LOCAIS");
  let schema;
  try {
    schema = await import("../dist-scripts/lib/gerente-acessos-schema.js");
    await import("../dist-migrations/database/migrations-data-source.js");
  } catch {
    parar("ERR_BUILD_AUSENTE");
  }
  if (schema.MIGRATION_GERENTE !== MIGRATION) parar("ERR_BUILD_DESATUALIZADO");

  const pastaBackup = escolherPasta();
  log(`BACKUP: ${path.basename(pastaBackup)}`);
  let manifesto;
  let manifestoSha256;
  try {
    manifestoSha256 = sha256DoArquivo(path.join(pastaBackup, "manifesto.json"));
    manifesto = JSON.parse(readFileSync(path.join(pastaBackup, "manifesto.json"), "utf8"));
  } catch {
    parar("ERR_MANIFESTO_ILEGIVEL");
  }
  log(`MODO_DO_BACKUP: ${manifesto.modo === "ensaio" ? "ENSAIO" : manifesto.modo === "piloto" ? "PILOTO" : "desconhecido"}`);
  if (manifesto.operacao !== OPERACAO) parar("ERR_BACKUP_DE_OUTRA_OPERACAO");
  if (manifesto.commit !== sha) parar("ERR_BACKUP_DE_OUTRO_COMMIT");
  const dump = path.join(pastaBackup, path.basename(String(manifesto.backup?.arquivo ?? "")));
  if (!existsSync(dump)) parar("ERR_DUMP_AUSENTE");
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
    const admin = await conectar(local("postgres"), { aplicacao: "agenda-cloud-restauracao-gerente", log });
    const [{ versaoLocal }] = (await admin.query("SELECT current_setting('server_version') AS \"versaoLocal\"")).rows;
    await admin.query("CREATE DATABASE neondb TEMPLATE template0 ENCODING 'UTF8'");
    await encerrar(admin);
    log(`SERVIDOR_DESCARTAVEL: PostgreSQL ${versaoLocal} em 127.0.0.1, TLS verificado`);

    const destino = local("neondb");
    log("RESTAURACAO: executando pg_restore ...");
    await exigir(
      bin("pg_restore"),
      ["-d", "neondb", "--no-owner", "--no-privileges", "--exit-on-error", "--single-transaction", dump],
      ambienteLibpq(destino, crt, "agenda-cloud-restauracao-gerente"),
      "ERR_PG_RESTORE",
    );
    log("RESTAURACAO: ok");

    let restaurado;
    const leitor = await conectar(destino, { aplicacao: "agenda-cloud-restauracao-gerente", log });
    try {
      await leitor.query("BEGIN TRANSACTION READ ONLY");
      restaurado = await fotografar(leitor);
      await leitor.query("ROLLBACK");
    } finally {
      await encerrar(leitor);
    }
    const igual = compararFotografias(manifesto, restaurado);
    log(`TABELAS: ${Object.keys(restaurado.contagens).length} (manifesto: ${Object.keys(manifesto.contagens).length})`);
    log(`LINHAS_RESTAURADAS: ${Object.values(restaurado.contagens).reduce((a, b) => a + b, 0)}`);
    log(`CONTAGENS_IGUAIS: ${igual.contagensDiferentes.length === 0 && igual.ausentes.length === 0 && igual.sobrando.length === 0}`);
    log(`CONTEUDO_IGUAL_MD5: ${igual.somasDiferentes.length === 0}`);
    if (!igual.iguais) {
      log(`DIVERGENCIAS: contagem=${igual.contagensDiferentes.join(",") || "-"} md5=${igual.somasDiferentes.join(",") || "-"} ausentes=${igual.ausentes.join(",") || "-"} sobrando=${igual.sobrando.join(",") || "-"}`);
      parar("ERR_RESTAURACAO_DIFERENTE_DO_MANIFESTO");
    }
    Object.assign(resultado, { tabelas: Object.keys(restaurado.contagens).length, versaoLocal, contagensIguais: true, conteudoIgualMd5: true });

    if (manifesto.esperado !== ESPERADO_ANTES) {
      log(`ENSAIO_MIGRATION: não se aplica (backup do estado ${manifesto.esperado ?? "desconhecido"})`);
      resultado.ensaioMigration = "nao_se_aplica";
    } else {
      // Antes: conferência, levantamento e o conteúdo das colunas antigas.
      const antes = await conectar(destino, { aplicacao: "agenda-cloud-restauracao-gerente", log });
      let falhasAntes;
      let limiteAntes;
      const colunasAntigas = {};
      const somasAntigas = {};
      try {
        falhasAntes = schema.falhasAntesDeGerente(await schema.lerEstadoGerente(antes));
        limiteAntes = await schema.lerImpactoDoGerente(antes);
        for (const tabela of TABELAS_ALTERADAS) {
          colunasAntigas[tabela] = await colunasDe(antes, tabela);
          somasAntigas[tabela] = await somaDasColunas(antes, tabela, colunasAntigas[tabela]);
        }
      } finally {
        await encerrar(antes);
      }
      log(`ENSAIO_BEFORE: ${falhasAntes.length === 0 ? "ok" : falhasAntes.join(",")}`);
      if (falhasAntes.length) parar("ERR_ENSAIO_ESTADO_ANTES");
      for (const linha of schema.descreverImpactoDoGerente(limiteAntes)) log(`ANTES_${linha}`);

      await aplicarSomenteAPendente(destino, {
        esperadasAntes: [...schema.MIGRATIONS_ATE_PAGAMENTOS],
        pendente: MIGRATION,
        aplicacao: "agenda-cloud-restauracao-gerente",
        log,
      });

      const depois = await conectar(destino, { aplicacao: "agenda-cloud-restauracao-gerente", log });
      let falhasDepois;
      let aposMigration;
      let limiteDepois;
      let novas;
      const somasDepois = {};
      try {
        falhasDepois = schema.falhasDepoisDeGerente(await schema.lerEstadoGerente(depois));
        limiteDepois = await schema.lerImpactoDoGerente(depois);
        novas = await schema.lerNovosDadosDoGerente(depois);
        for (const tabela of TABELAS_ALTERADAS) somasDepois[tabela] = await somaDasColunas(depois, tabela, colunasAntigas[tabela]);
        await depois.query("BEGIN TRANSACTION READ ONLY");
        aposMigration = await fotografar(depois);
        await depois.query("ROLLBACK");
      } finally {
        await encerrar(depois);
      }
      log(`ENSAIO_AFTER: ${falhasDepois.length === 0 ? "ok" : falhasDepois.join(",")}`);
      if (falhasDepois.length) parar("ERR_ENSAIO_ESTADO_DEPOIS");

      const preservado = compararFotografias(restaurado, aposMigration, {
        ignorarSomas: TABELAS_ALTERADAS,
        ignorarTabelas: ["typeorm_migrations"],
      });
      const colunasAntigasIguais = TABELAS_ALTERADAS.every((t) => somasAntigas[t] === somasDepois[t]);
      const historico = aposMigration.contagens.typeorm_migrations === restaurado.contagens.typeorm_migrations + 1;
      const colunasNovasVazias = novas.vinculosConfirmados === 0 && novas.ajustesComValoresNovos === 0;
      const limiteIgual = JSON.stringify(limiteAntes) === JSON.stringify(limiteDepois);
      log(`ENSAIO_DADOS_PRESERVADOS: ${preservado.iguais}`);
      log(`ENSAIO_COLUNAS_ANTIGAS_IGUAIS: ${colunasAntigasIguais} (${TABELAS_ALTERADAS.join(",")})`);
      log(`ENSAIO_USERS_IGUAL: ${!preservado.somasDiferentes.includes("users") && !preservado.contagensDiferentes.includes("users")}`);
      log(`ENSAIO_VINCULOS: ${aposMigration.contagens.memberships} (antes: ${restaurado.contagens.memberships})`);
      log(`ENSAIO_NADA_CONFIRMADO_NEM_CONCEDIDO: ${colunasNovasVazias} (confirmados=${novas.vinculosConfirmados} ajustesNovos=${novas.ajustesComValoresNovos})`);
      log(`ENSAIO_LEVANTAMENTO_IGUAL: ${limiteIgual}`);
      log(`ENSAIO_HISTORICO_MAIS_UMA: ${historico}`);
      if (!preservado.iguais || !colunasAntigasIguais || !historico || !colunasNovasVazias || !limiteIgual) {
        log(`DIVERGENCIAS: contagem=${preservado.contagensDiferentes.join(",") || "-"} md5=${preservado.somasDiferentes.join(",") || "-"} ausentes=${preservado.ausentes.join(",") || "-"} novas=${preservado.sobrando.join(",") || "-"}`);
        parar("ERR_ENSAIO_ALTEROU_DADOS");
      }
      Object.assign(resultado, {
        ensaioMigration: "ok",
        vinculos: aposMigration.contagens.memberships,
        gerentesAtivos: limiteDepois.gerentesAtivos,
        vagasAcimaDoLimite: limiteDepois.acimaDepois,
        passamAcimaDoLimite: limiteDepois.passamAcima,
      });
    }
    resultado.resultado = "restauracao_e_ensaio_ok";
  } finally {
    await encerrarTodas();
    if (servidorNoAr) await rodar(bin("pg_ctl"), ["-D", dados, "-m", "fast", "-w", "stop"], {}, { semSaida: true }).catch(() => {});
    rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
    log(`DESCARTAVEL_APAGADO: ${!existsSync(temp)}`);
  }

  const conferencia = {
    ...resultado,
    operacao: OPERACAO,
    modoDoBackup: manifesto.modo ?? null,
    manifestoSha256,
    commit: sha,
    backup: path.basename(pastaBackup),
    concluidaEm: new Date().toISOString(),
  };
  writeFileSync(path.join(pastaBackup, "restauracao-conferida.json"), JSON.stringify(conferencia, null, 2));
  mkdirSync(PASTA, { recursive: true });
  registrar(REGISTRO, {
    ...conferencia,
    operacao: "conferir_restauracao_gerente",
    operador: `conta Windows local '${userInfo().username}'`,
  });
  log("RESULTADO: restauração conferida" + (resultado.ensaioMigration === "ok" ? ` e ${MIGRATION} ensaiada na cópia` : ""));
}

principal()
  .catch((erro) => {
    const codigo = erro instanceof Parada ? erro.message : "ERR_INESPERADO";
    log(`ERRO: ${codigo}`);
    if (!(erro instanceof Parada)) log(`DETALHE: ${erro?.code ? `${erro.code} ` : ""}${String(erro?.message ?? erro).slice(0, 400)}`);
    try {
      registrar(REGISTRO, { operacao: "conferir_restauracao_gerente", resultado: "falhou", codigo, concluidaEm: new Date().toISOString() });
    } catch {
      // O erro original é o que importa.
    }
    process.exitCode = 1;
  })
  .finally(() => encerrarTodas());
