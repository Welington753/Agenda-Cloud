// Provisionamento operacional: atribui MASTER_OWNER a UMA conta existente do
// piloto (ver docs/plans/administracao-real-e-financeiro.md, "Entrada e
// provisionamento"). Não é migration nem rota da aplicação: é executado à mão,
// uma vez, por quem tem a URL direta do piloto (ver
// docs/runbooks/continuidade-promocao-master-owner.md).
//
// Uso (terminal interativo, na pasta backend, depois de `npm ci`; a URL
// direta é digitada oculta e nunca vem de variável ou arquivo):
//   PILOT_ENDPOINT_ID=<ep-... do piloto> PRODUCTION_ENDPOINT_ID=<ep-... proibido> \
//     node scripts/promover-master-owner.mjs
// Os Endpoint IDs ficam fora do Git, como nos demais scripts do piloto.
// Opcionais: PG_BIN (pasta do pg_dump.exe) e AGENDA_OPS_DIR (backup e registro,
// fora do repositório).
//
// Etapas: confere destino/TLS pela URL -> leitura somente -> backup
// (pg_dump -Fc no mesmo snapshot das contagens) -> confirmação digitada ->
// transação com FOR UPDATE e UPDATE só de platform_role -> conferência após
// o commit -> registro em operacoes.jsonl. Nada de URL, senha ou hash é
// impresso ou gravado.
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { rootCertificates } from "node:tls";
import { homedir, userInfo } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// `pg` do próprio backend (backend/node_modules).
const require = createRequire(import.meta.url);
const { Client } = require("pg");

const EMAIL = "wwluiz90@gmail.com";
const PAPEL_NOVO = "MASTER_OWNER";
const ENDPOINT_PILOTO = (process.env.PILOT_ENDPOINT_ID ?? "").trim();
const ENDPOINT_PROIBIDO = (process.env.PRODUCTION_ENDPOINT_ID ?? "").trim();
const BANCO = "neondb";
const ALGORITMO_CREDENCIAL = "argon2id"; // backend/src/auth/password-hasher.ts
const PG_BIN = process.env.PG_BIN ?? "C:/Program Files/PostgreSQL/18/bin";
const PASTA = process.env.AGENDA_OPS_DIR ?? path.join(homedir(), "AgendaCloud-operacoes");
const REGISTRO = path.join(PASTA, "operacoes.jsonl");

const inicio = new Date();
const carimbo = inicio.toISOString().replace(/[:.]/g, "-");
const pastaExecucao = path.join(PASTA, `master-owner-${carimbo}`);

const log = (linha) => console.log(linha);
class Parada extends Error {}
// Só depois das pré-condições (IDs, pg_dump, pasta fora do repositório).
let podeRegistrar = false;
const parar = (codigo) => {
  throw new Parada(codigo);
};

function lerOculto(rotulo) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) return reject(new Parada("ERR_TERMINAL_NAO_INTERATIVO"));
    process.stdout.write(rotulo);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let valor = "";
    const aoReceber = (dados) => {
      for (const ch of dados) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", aoReceber);
          process.stdout.write("\n");
          return resolve(valor);
        }
        if (ch === "\u0003") {
          stdin.setRawMode(false);
          process.stdout.write("\n");
          return reject(new Parada("CANCELADO"));
        }
        if (ch === "\u0008" || ch === "\u007f") valor = valor.slice(0, -1);
        else valor += ch;
      }
    };
    stdin.on("data", aoReceber);
  });
}

function lerVisivel(rotulo) {
  return new Promise((resolve) => {
    process.stdout.write(rotulo);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    process.stdin.once("data", (dados) => {
      process.stdin.pause();
      resolve(String(dados).replace(/[\r\n]+$/, ""));
    });
  });
}

/** Destino conferido só pela URL, antes de qualquer rede. */
function conferirDestino(bruta) {
  let url;
  try {
    url = new URL(bruta.trim());
  } catch {
    parar("ERR_URL_INVALIDA");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) parar("ERR_SCHEME");
  if (bruta.includes(ENDPOINT_PROIBIDO)) parar("ERR_ENDPOINT_PROIBIDO");
  const host = url.hostname.toLowerCase();
  if (host.includes("-pooler")) parar("ERR_POOLER");
  if (!host.startsWith(`${ENDPOINT_PILOTO}.`)) parar("ERR_ENDPOINT_DIFERENTE_DO_PILOTO");
  if (!host.endsWith(".neon.tech")) parar("ERR_HOST_NAO_NEON");
  if (decodeURIComponent(url.pathname.replace(/^\//, "")) !== BANCO) parar("ERR_BANCO_DIFERENTE_DE_NEONDB");
  const sslmode = (url.searchParams.get("sslmode") ?? "").toLowerCase();
  if (["disable", "allow", "prefer", "no-verify"].includes(sslmode)) parar("ERR_TLS_AFROUXADO");
  if (url.searchParams.has("uselibpqcompat")) parar("ERR_TLS_AFROUXADO");
  if (!url.username || !url.password) parar("ERR_URL_SEM_CREDENCIAL");
  return {
    host,
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: BANCO,
    channelBinding: url.searchParams.get("channel_binding") === "require",
  };
}

async function conectar(destino) {
  // TLS sempre verificado (cadeia e hostname), independente do sslmode da URL.
  const client = new Client({
    host: destino.host,
    port: destino.port,
    user: destino.user,
    password: destino.password,
    database: destino.database,
    enableChannelBinding: destino.channelBinding,
    ssl: { rejectUnauthorized: true, servername: destino.host },
    application_name: "agenda-cloud-provisionamento-master-owner",
    connectionTimeoutMillis: 60_000,
  });
  await client.connect();
  const [{ ssl, banco }] = (
    await client.query(
      "SELECT s.ssl, current_database() AS banco FROM pg_stat_ssl s WHERE s.pid = pg_backend_pid()",
    )
  ).rows;
  if (ssl !== true) parar("ERR_CONEXAO_SEM_TLS");
  if (banco !== BANCO) parar("ERR_BANCO_DIFERENTE_DE_NEONDB");
  return client;
}

const CONTA_SQL = `SELECT u.id, u.email::text AS email, u.status::text AS status,
    u.platform_role::text AS "platformRole",
    COALESCE(array_to_json(u.platform_permissions), '[]'::json) AS "platformPermissions",
    (SELECT count(*)::int FROM credentials c WHERE c.user_id = u.id AND c.algorithm = $2) AS "credenciaisReais",
    (SELECT max(c.updated_at) FROM credentials c WHERE c.user_id = u.id) AS "credencialAtualizadaEm",
    (SELECT count(*)::int FROM memberships m WHERE m.user_id = u.id) AS vinculos,
    (SELECT count(*)::int FROM sessions s WHERE s.user_id = u.id) AS sessoes,
    to_jsonb(u) - 'platform_role' AS "demaisCampos"
  FROM users u WHERE u.email = $1`;

async function lerConta(client) {
  const { rows } = await client.query(CONTA_SQL, [EMAIL, ALGORITMO_CREDENCIAL]);
  return rows;
}

function conferirConta(rows) {
  log(`CONTAS_COM_O_EMAIL: ${rows.length}`);
  if (rows.length !== 1) parar("ERR_CONTA_NAO_UNICA");
  const conta = rows[0];
  log(`USER_ID: ${conta.id}`);
  log(`EMAIL: ${conta.email}`);
  log(`STATUS: ${conta.status}`);
  log(`PAPEL_ATUAL: ${conta.platformRole ?? "nenhum"}`);
  log(`PERMISSOES_PLATAFORMA: ${JSON.stringify(conta.platformPermissions)}`);
  log(`CREDENCIAL_REAL_${ALGORITMO_CREDENCIAL.toUpperCase()}: ${conta.credenciaisReais === 1}`);
  log(`VINCULOS: ${conta.vinculos}  SESSOES: ${conta.sessoes}`);
  if (conta.status !== "ACTIVE") parar("ERR_CONTA_INATIVA");
  if (conta.credenciaisReais !== 1) parar("ERR_SEM_CREDENCIAL_REAL");
  return conta;
}

function rodarPgDump(destino, snapshot, arquivo, raizes) {
  return new Promise((resolve, reject) => {
    const filho = spawn(
      path.join(PG_BIN, "pg_dump.exe"),
      ["-Fc", "--no-password", `--snapshot=${snapshot}`, "-f", arquivo],
      {
        env: {
          SystemRoot: process.env.SystemRoot,
          PGHOST: destino.host,
          PGPORT: String(destino.port),
          PGUSER: destino.user,
          PGPASSWORD: destino.password,
          PGDATABASE: destino.database,
          PGSSLMODE: "verify-full",
          PGSSLROOTCERT: raizes,
          PGSSLSNI: "1",
          PGCHANNELBINDING: destino.channelBinding ? "require" : "prefer",
          PGAPPNAME: "agenda-cloud-backup-master-owner",
        },
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    let erro = "";
    filho.stderr.on("data", (d) => (erro += d));
    filho.on("error", reject);
    filho.on("close", (codigo) =>
      codigo === 0 ? resolve() : reject(new Error(`pg_dump saiu com ${codigo}: ${erro.slice(0, 400)}`)),
    );
  });
}

function registrar(entrada) {
  appendFileSync(REGISTRO, `${JSON.stringify(entrada)}\n`, "utf8");
}

async function principal() {
  log("Provisionamento MASTER_OWNER no piloto Agenda-Cloud");
  log(`ALVO_EMAIL: ${EMAIL}`);
  const ENDPOINT_ID = /^ep-[a-z0-9]+(-[a-z0-9]+)*$/;
  if (!ENDPOINT_ID.test(ENDPOINT_PILOTO) || !ENDPOINT_ID.test(ENDPOINT_PROIBIDO)) parar("ERR_ENDPOINT_IDS_AUSENTES");
  if (ENDPOINT_PILOTO === ENDPOINT_PROIBIDO) parar("ERR_PILOTO_IGUAL_AO_PROIBIDO");
  if (!existsSync(path.join(PG_BIN, "pg_dump.exe"))) parar("ERR_PG_DUMP_AUSENTE");
  // Backup e registro nunca dentro do repositório.
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const relativo = path.relative(repo, path.resolve(PASTA));
  if (!relativo.startsWith("..") && !path.isAbsolute(relativo)) parar("ERR_PASTA_DE_OPERACOES_DENTRO_DO_REPOSITORIO");
  podeRegistrar = true;
  const destino = conferirDestino(await lerOculto("URL direta do piloto (oculta): "));
  log("DESTINO_ENDPOINT_PILOTO: true");
  log("DIFERENTE_DO_PROIBIDO: true");
  log(`BANCO: ${BANCO}`);

  mkdirSync(PASTA, { recursive: true });
  const base = {
    operacao: "atribuir_platform_role",
    iniciadaEm: inicio.toISOString(),
    endpoint: ENDPOINT_PILOTO,
    banco: BANCO,
    email: EMAIL,
    papelNovo: PAPEL_NOVO,
    operador: `conta Windows local '${userInfo().username}' via script; sem ator autenticado na aplicação`,
  };

  // 1) Leitura somente + snapshot exportado para o backup.
  const leitor = await conectar(destino);
  log("TLS_VERIFICADO: true");
  let conta;
  let manifesto;
  try {
    await leitor.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    conta = conferirConta(await lerConta(leitor));
    if (conta.platformRole === PAPEL_NOVO) {
      await leitor.query("ROLLBACK");
      registrar({ ...base, userId: conta.id, papelAnterior: conta.platformRole, resultado: "sem_alteracao_ja_era_master_owner", concluidaEm: new Date().toISOString() });
      log("RESULTADO: sem alteração (já é MASTER_OWNER)");
      return;
    }
    const [{ snapshot }] = (await leitor.query("SELECT pg_export_snapshot() AS snapshot")).rows;
    const tabelas = (
      await leitor.query(
        "SELECT c.relname AS tabela FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r','p') ORDER BY 1",
      )
    ).rows.map((r) => r.tabela);
    const contagens = {};
    for (const t of tabelas) {
      const ident = `"${t.replaceAll('"', '""')}"`;
      contagens[t] = (await leitor.query(`SELECT count(*)::int AS n FROM public.${ident}`)).rows[0].n;
    }
    const [{ masterOwners }] = (
      await leitor.query("SELECT count(*)::int AS \"masterOwners\" FROM users WHERE platform_role = 'MASTER_OWNER'")
    ).rows;
    const [{ versao }] = (await leitor.query("SELECT current_setting('server_version') AS versao")).rows;
    manifesto = { ...base, pontoDeRecuperacao: new Date().toISOString(), servidor: versao, contagens, masterOwnersAntes: masterOwners, contaAntes: { ...conta, credencialAtualizadaEm: conta.credencialAtualizadaEm } };

    // 2) Backup completo no MESMO snapshot das contagens.
    mkdirSync(pastaExecucao, { recursive: true });
    const raizes = path.join(pastaExecucao, "raizes-tls-node.pem");
    writeFileSync(raizes, rootCertificates.join("\n"));
    const dump = path.join(pastaExecucao, "piloto-neondb.dump");
    log("BACKUP: executando pg_dump -Fc ...");
    await rodarPgDump(destino, snapshot, dump, raizes);
    const tamanho = statSync(dump).size;
    if (tamanho === 0) parar("ERR_BACKUP_VAZIO");
    const sha256 = createHash("sha256").update(readFileSync(dump)).digest("hex");
    manifesto.backup = { arquivo: path.basename(dump), bytes: tamanho, sha256 };
    writeFileSync(path.join(pastaExecucao, "manifesto.json"), JSON.stringify(manifesto, null, 2));
    log(`BACKUP_OK: ${tamanho} bytes sha256=${sha256.slice(0, 16)}...`);
    await leitor.query("COMMIT");
  } finally {
    await leitor.end().catch(() => {});
  }

  // 3) Confirmação explícita.
  const frase = `PROMOVER ${EMAIL}`;
  const resposta = await lerVisivel(`Para gravar, digite exatamente "${frase}": `);
  if (resposta !== frase) {
    registrar({ ...base, userId: conta.id, papelAnterior: conta.platformRole, resultado: "abortado_sem_confirmacao", backup: manifesto.backup, concluidaEm: new Date().toISOString() });
    log("RESULTADO: abortado, nada gravado");
    return;
  }

  // 4) Escrita: trava, reconfere e altera só platform_role.
  const escritor = await conectar(destino);
  let commitEm;
  try {
    await escritor.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    await escritor.query("SET LOCAL lock_timeout = '5s'");
    await escritor.query("SET LOCAL statement_timeout = '15s'");
    const travada = (
      await escritor.query(
        "SELECT id, email::text AS email, status::text AS status, platform_role::text AS \"platformRole\" FROM users WHERE id = $1 FOR UPDATE",
        [conta.id],
      )
    ).rows;
    const atual = await lerConta(escritor);
    if (
      travada.length !== 1 ||
      atual.length !== 1 ||
      atual[0].id !== conta.id ||
      travada[0].status !== "ACTIVE" ||
      (travada[0].platformRole ?? null) !== (conta.platformRole ?? null) ||
      atual[0].credenciaisReais !== 1
    ) {
      await escritor.query("ROLLBACK");
      parar("ERR_CONTA_MUDOU_DESDE_A_LEITURA");
    }
    const r = await escritor.query(
      "UPDATE users SET platform_role = 'MASTER_OWNER' WHERE id = $1 AND platform_role IS NOT DISTINCT FROM $2::platform_role",
      [conta.id, conta.platformRole ?? null],
    );
    if (r.rowCount !== 1) {
      await escritor.query("ROLLBACK");
      parar("ERR_UPDATE_NAO_AFETOU_UMA_LINHA");
    }
    await escritor.query("COMMIT");
    commitEm = new Date().toISOString();
    log("COMMIT: ok");
  } catch (erro) {
    await escritor.query("ROLLBACK").catch(() => {});
    throw erro;
  } finally {
    await escritor.end().catch(() => {});
  }

  // 5) Conferência após o commit, em nova conexão somente leitura.
  const conferente = await conectar(destino);
  try {
    await conferente.query("BEGIN READ ONLY");
    const [depois] = await lerConta(conferente);
    const [{ masterOwners }] = (
      await conferente.query("SELECT count(*)::int AS \"masterOwners\" FROM users WHERE platform_role = 'MASTER_OWNER'")
    ).rows;
    const [{ usuarios }] = (await conferente.query("SELECT count(*)::int AS usuarios FROM users")).rows;
    await conferente.query("ROLLBACK");
    const checagens = {
      papelFinal: depois.platformRole === PAPEL_NOVO,
      ativa: depois.status === "ACTIVE",
      demaisCamposIguais: JSON.stringify(depois.demaisCampos) === JSON.stringify(conta.demaisCampos),
      permissoesIguais: JSON.stringify(depois.platformPermissions) === JSON.stringify(conta.platformPermissions),
      credencialIntacta:
        depois.credenciaisReais === 1 &&
        String(depois.credencialAtualizadaEm) === String(conta.credencialAtualizadaEm),
      vinculosIguais: depois.vinculos === conta.vinculos,
      masterOwnersMaisUm: masterOwners === manifesto.masterOwnersAntes + 1,
      totalUsuariosIgual: usuarios === manifesto.contagens.users,
    };
    for (const [k, v] of Object.entries(checagens)) log(`CONFERE_${k}: ${v}`);
    log(`SESSOES_DA_CONTA: ${conta.sessoes} -> ${depois.sessoes} (login/expiração podem mudar; o script não as toca)`);
    const ok = Object.values(checagens).every(Boolean);
    registrar({
      ...base,
      userId: conta.id,
      papelAnterior: conta.platformRole ?? null,
      papelFinal: depois.platformRole,
      commitEm,
      backup: { pasta: path.basename(pastaExecucao), ...manifesto.backup },
      checagens,
      resultado: ok ? "alterado_e_conferido" : "alterado_com_divergencia_na_conferencia",
      concluidaEm: new Date().toISOString(),
    });
    log(`RESULTADO: ${ok ? "MASTER_OWNER atribuído e conferido" : "gravado, mas a conferência divergiu — investigar"}`);
    if (!ok) process.exitCode = 2;
  } finally {
    await conferente.end().catch(() => {});
  }
}

principal().catch((erro) => {
  const codigo = erro instanceof Parada ? erro.message : "ERR_INESPERADO";
  log(`ERRO: ${codigo}`);
  if (!(erro instanceof Parada)) {
    // Mensagem do driver sem a URL; pg nunca inclui a senha nas mensagens.
    log(`DETALHE: ${String(erro?.message ?? erro).slice(0, 300)}`);
  }
  if (podeRegistrar) try {
    mkdirSync(PASTA, { recursive: true });
    registrar({ operacao: "atribuir_platform_role", iniciadaEm: inicio.toISOString(), email: EMAIL, resultado: "falhou", codigo, concluidaEm: new Date().toISOString() });
  } catch {
    // O erro original é o que importa.
  }
  process.exitCode = 1;
});
