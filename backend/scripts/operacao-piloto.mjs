// Peças comuns dos procedimentos operacionais do piloto
// (aplicar-contas-piloto.mjs e conferir-restauracao-piloto.mjs). Vêm do
// provisionamento MASTER_OWNER, já executado no piloto real: destino conferido
// pela URL antes da rede, TLS conferido no socket do cliente (no Neon o TLS
// termina no proxy, então `pg_stat_ssl` não serve de prova), toda conexão com
// listener de `error` e encerrada em qualquer falha, e backup `pg_dump -Fc` no
// mesmo snapshot das contagens.
//
// Nada aqui imprime ou grava URL, senha ou conteúdo de linhas. A fotografia
// guarda só contagens e um md5 por tabela.
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { TLSSocket, checkServerIdentity } from "node:tls";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Parada, classificarEntrada } from "./entrada-oculta.mjs";

// `pg` do próprio backend (backend/node_modules).
const require = createRequire(import.meta.url);
const { Client } = require("pg");

export const BANCO_PILOTO = "neondb";
export const FORMATO_ENDPOINT_ID = /^ep-[a-z0-9]+(-[a-z0-9]+)*$/;
export const RAIZ_DO_REPOSITORIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export const parar = (codigo) => {
  throw new Parada(codigo);
};

/** Pasta de operações (backup com hashes de senha) nunca dentro do repositório. */
export function pastaForaDoRepositorio(pasta, raiz = RAIZ_DO_REPOSITORIO) {
  const relativo = path.relative(raiz, path.resolve(pasta));
  return relativo.startsWith("..") || path.isAbsolute(relativo);
}

/**
 * Destino conferido só pela URL, antes de qualquer rede. Mesmas regras da
 * promoção: endpoint do piloto em `*.neon.tech`, banco `neondb`, sem pooler,
 * sem o endpoint proibido em nenhuma parte da URL e sem TLS afrouxado.
 */
export function conferirDestino(bruta, { endpointPiloto, endpointProibido }) {
  const problema = classificarEntrada(bruta);
  if (problema) parar(problema);
  let url;
  try {
    url = new URL(bruta.trim());
  } catch {
    parar("ERR_URL_INVALIDA");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) parar("ERR_SCHEME");
  if (bruta.includes(endpointProibido)) parar("ERR_ENDPOINT_PROIBIDO");
  const host = url.hostname.toLowerCase();
  if (host.includes("-pooler")) parar("ERR_POOLER");
  if (!host.startsWith(`${endpointPiloto}.`)) parar("ERR_ENDPOINT_DIFERENTE_DO_PILOTO");
  if (!host.endsWith(".neon.tech")) parar("ERR_HOST_NAO_NEON");
  if (decodeURIComponent(url.pathname.replace(/^\//, "")) !== BANCO_PILOTO) parar("ERR_BANCO_DIFERENTE_DE_NEONDB");
  const sslmode = (url.searchParams.get("sslmode") ?? "").toLowerCase();
  if (["disable", "allow", "prefer", "no-verify"].includes(sslmode)) parar("ERR_TLS_AFROUXADO");
  if (url.searchParams.has("uselibpqcompat")) parar("ERR_TLS_AFROUXADO");
  const ssl = (url.searchParams.get("ssl") ?? "").toLowerCase();
  if (["0", "false"].includes(ssl)) parar("ERR_TLS_AFROUXADO");
  if (!url.username || !url.password) parar("ERR_URL_SEM_CREDENCIAL");
  return {
    url: bruta.trim(),
    host,
    servidorTls: host,
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: BANCO_PILOTO,
    channelBinding: url.searchParams.get("channel_binding") === "require",
  };
}

/** TLS conferido no socket do próprio cliente: cifrado, cadeia aceita pelo
 * Node, TLS 1.2+ e certificado com o nome esperado. */
export function conferirTransporte(socket, servidorTls) {
  if (!(socket instanceof TLSSocket) || socket.encrypted !== true) parar("ERR_CONEXAO_SEM_TLS");
  if (socket.authorized !== true) parar("ERR_CERTIFICADO_NAO_CONFIAVEL");
  const protocolo = socket.getProtocol();
  if (!["TLSv1.2", "TLSv1.3"].includes(protocolo)) parar("ERR_TLS_PROTOCOLO_FRACO");
  const certificado = socket.getPeerCertificate(true);
  if (!certificado?.subject) parar("ERR_CERTIFICADO_AUSENTE");
  if (checkServerIdentity(servidorTls, certificado) !== undefined) parar("ERR_HOSTNAME_DO_CERTIFICADO");
  const cadeia = [];
  for (let c = certificado; c?.subject && cadeia.length < 6; c = c.issuerCertificate === c ? null : c.issuerCertificate) {
    cadeia.push(c.subject.CN ?? c.subject.O ?? "?");
  }
  return { protocolo, cadeia, validoAte: certificado.valid_to };
}

function opcoesTls(destino) {
  return { rejectUnauthorized: true, servername: destino.servidorTls, ...(destino.ca ? { ca: destino.ca } : {}) };
}

// Todo pg.Client aberto fica aqui até ser encerrado, para que nenhuma falha
// (inclusive no meio de `conectar`) deixe uma conexão abandonada.
export const conexoesAbertas = new Set();
// Erros que o pg.Client emite fora de uma consulta (ex.: 57P01). A próxima
// operação nesse cliente falha e o procedimento termina, nunca continua.
export const errosDeConexao = [];

export async function encerrar(client) {
  if (!conexoesAbertas.delete(client)) return;
  await client.end().catch(() => {});
}

export async function encerrarTodas() {
  await Promise.allSettled([...conexoesAbertas].map(encerrar));
}

export async function conectar(destino, { aplicacao, log }) {
  const client = new Client({
    host: destino.host,
    port: destino.port,
    user: destino.user,
    password: destino.password,
    database: destino.database,
    enableChannelBinding: destino.channelBinding === true,
    ssl: opcoesTls(destino),
    application_name: aplicacao,
    connectionTimeoutMillis: 60_000,
  });
  client.on("error", (erro) => {
    errosDeConexao.push(erro);
    log(`CONEXAO_ENCERRADA: ${erro?.code ?? "sem código"} ${String(erro?.message ?? erro).slice(0, 200)}`);
  });
  conexoesAbertas.add(client);
  try {
    await client.connect();
    const tls = conferirTransporte(client.connection?.stream, destino.servidorTls);
    const [{ banco }] = (await client.query("SELECT current_database() AS banco")).rows;
    if (banco !== destino.database) parar("ERR_BANCO_DIFERENTE_DO_ESPERADO");
    log(`TLS_CLIENTE: ${tls.protocolo} hostname=ok cadeia=${tls.cadeia.join(" <- ")} validoAte=${tls.validoAte}`);
    return client;
  } catch (erro) {
    await encerrar(client);
    throw erro;
  }
}

/**
 * Cliente no formato que `checkPilotDatabase` (dist-scripts) espera, mas que
 * conecta por `conectar`: o TLS fica conferido no socket também nas
 * conferências before/after.
 */
export function clienteConferido(destino, opcoes) {
  let client;
  return {
    async connect() {
      client = await conectar(destino, opcoes);
    },
    query: (sql, params) => client.query(sql, params),
    async end() {
      if (client) await encerrar(client);
    },
  };
}

/**
 * Contagem e md5 de cada tabela de `public`, na transação já aberta pelo
 * chamador (o mesmo snapshot do backup). Formato de data e número fixado para
 * que a restauração em outro servidor dê o mesmo md5.
 */
export async function fotografar(client) {
  await client.query("SET LOCAL TimeZone = 'UTC'");
  await client.query("SET LOCAL DateStyle = 'ISO, YMD'");
  await client.query("SET LOCAL IntervalStyle = 'postgres'");
  await client.query("SET LOCAL extra_float_digits = 1");
  const tabelas = (
    await client.query(
      "SELECT c.relname AS tabela FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r','p') ORDER BY 1",
    )
  ).rows.map((r) => r.tabela);
  const contagens = {};
  const somas = {};
  for (const t of tabelas) {
    const ident = `"${t.replaceAll('"', '""')}"`;
    const [linha] = (
      await client.query(
        `SELECT count(*)::int AS n, coalesce(md5(string_agg(x::text, E'\\n' ORDER BY x::text COLLATE "C")), '') AS soma FROM public.${ident} x`,
      )
    ).rows;
    contagens[t] = linha.n;
    somas[t] = linha.soma;
  }
  return { contagens, somas };
}

/** Compara duas fotografias. `ignorarSomas` lista tabelas cujo conteúdo muda
 * de propósito (colunas novas da migration). */
export function compararFotografias(antes, depois, { ignorarSomas = [], ignorarTabelas = [], novasPermitidas = [] } = {}) {
  const contagensDiferentes = [];
  const somasDiferentes = [];
  const ausentes = [];
  for (const [tabela, n] of Object.entries(antes.contagens)) {
    if (ignorarTabelas.includes(tabela)) continue;
    if (!(tabela in depois.contagens)) ausentes.push(tabela);
    else if (depois.contagens[tabela] !== n) contagensDiferentes.push(tabela);
    else if (!ignorarSomas.includes(tabela) && depois.somas[tabela] !== antes.somas[tabela]) somasDiferentes.push(tabela);
  }
  const sobrando = Object.keys(depois.contagens).filter((t) => !(t in antes.contagens) && !novasPermitidas.includes(t));
  return {
    iguais: contagensDiferentes.length + somasDiferentes.length + ausentes.length + sobrando.length === 0,
    contagensDiferentes,
    somasDiferentes,
    ausentes,
    sobrando,
  };
}

/**
 * Só as migrations pendentes esperadas: o histórico precisa ser EXATAMENTE
 * `esperadasAntes` e as migrations compiladas, exatamente essas mais as
 * pendentes, na ordem. `pendente` (uma) ou `pendentes` (lista). Devolve o
 * código do problema ou null.
 */
export function conferirPendentes({ executadas, carregadas, esperadasAntes, pendente, pendentes = [pendente] }) {
  const igual = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  if (pendentes.length === 0 || pendentes.some((p) => typeof p !== "string" || p === "")) return "ERR_PENDENTES_INVALIDAS";
  if (!igual(executadas, esperadasAntes)) return "ERR_HISTORICO_DE_MIGRATIONS_INESPERADO";
  if (!igual(carregadas, [...esperadasAntes, ...pendentes])) return "ERR_MIGRATIONS_COMPILADAS_INESPERADAS";
  return null;
}

/**
 * Aplica, com o runtime compilado (`dist-migrations`, o mesmo do
 * `migration:run:compiled`), somente as migrations pendentes esperadas, todas
 * numa única transação (todas ou nenhuma). Pool de uma conexão: o `lock_timeout` vale para a sessão que roda
 * a migration, e o TLS dela é conferido no socket. `aoIniciar`, opcional, é
 * chamado logo antes do primeiro comando da migration: uma falha antes dele
 * garante que nada foi enviado.
 */
export async function aplicarSomenteAPendente(destino, { esperadasAntes, pendente, pendentes = [pendente], aplicacao, log, aoIniciar = () => {} }) {
  const { DataSource } = await import("typeorm");
  const { buildMigrationsDataSourceOptions } = await import("../dist-migrations/database/migrations-data-source.js");
  const ds = new DataSource({
    ...buildMigrationsDataSourceOptions(""),
    url: undefined,
    host: destino.host,
    port: destino.port,
    username: destino.user,
    password: destino.password,
    database: destino.database,
    ssl: opcoesTls(destino),
    applicationName: aplicacao,
    extra: { max: 1, idleTimeoutMillis: 0, connectionTimeoutMillis: 60_000, enableChannelBinding: destino.channelBinding === true },
  });
  await ds.initialize();
  try {
    let pid;
    {
      const [cliente, liberar] = await ds.driver.obtainMasterConnection();
      try {
        const tls = conferirTransporte(cliente.connection?.stream, destino.servidorTls);
        log(`TLS_MIGRATION: ${tls.protocolo} hostname=ok`);
        const [{ banco }] = (await cliente.query("SELECT current_database() AS banco")).rows;
        if (banco !== destino.database) parar("ERR_BANCO_DIFERENTE_DO_ESPERADO");
        await cliente.query("SET lock_timeout = '10s'");
        await cliente.query("SET statement_timeout = '120s'");
        pid = (await cliente.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
        const executadas = (await cliente.query("SELECT name FROM typeorm_migrations ORDER BY id")).rows.map((r) => r.name);
        const carregadas = ds.migrations.map((m) => m.name ?? m.constructor.name);
        log(`MIGRATIONS_NO_HISTORICO: ${executadas.length}`);
        log(`MIGRATIONS_COMPILADAS: ${carregadas.length}`);
        const problema = conferirPendentes({ executadas, carregadas, esperadasAntes, pendentes });
        if (problema) parar(problema);
        log(`${pendentes.length === 1 ? "PENDENTE" : "PENDENTES"}: ${pendentes.join(",")}`);
      } finally {
        liberar();
      }
    }
    aoIniciar();
    const aplicadas = await ds.runMigrations({ transaction: "all" });
    const nomes = aplicadas.map((m) => m.name);
    log(`APLICADAS: ${nomes.join(",") || "nenhuma"}`);
    const [cliente, liberar] = await ds.driver.obtainMasterConnection();
    try {
      const [{ mesmo, lockTimeout }] = (
        await cliente.query("SELECT pg_backend_pid() = $1 AS mesmo, current_setting('lock_timeout') AS \"lockTimeout\"", [pid])
      ).rows;
      log(`SESSAO_DA_MIGRATION: mesma=${mesmo} lock_timeout=${lockTimeout}`);
    } finally {
      liberar();
    }
    if (nomes.length !== pendentes.length || nomes.some((n, i) => n !== pendentes[i])) parar("ERR_APLICADAS_DIFERENTES_DA_PENDENTE");
    return nomes;
  } finally {
    await ds.destroy().catch(() => {});
  }
}

/** Executa um binário do PostgreSQL sem shell. Devolve o código e o stderr
 * (que o chamador corta antes de mostrar). `semSaida` é para o `pg_ctl
 * start`: o servidor herdaria o pipe de stderr e o mantém aberto, então nada é
 * ligado a pipe e a espera é pelo fim do processo (a saída vai para o `-l`). */
export function rodar(executavel, args, env, { semSaida = false } = {}) {
  return new Promise((resolve, reject) => {
    const filho = spawn(executavel, args, {
      env: { SystemRoot: process.env.SystemRoot, ...env },
      stdio: semSaida ? "ignore" : ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
    let erro = "";
    filho.stderr?.on("data", (d) => (erro += d));
    filho.on("error", reject);
    filho.on(semSaida ? "exit" : "close", (codigo) => resolve({ codigo, stderr: erro }));
  });
}

/** Variáveis do libpq para os binários (`pg_dump`, `pg_restore`), sempre com
 * `verify-full`. */
export function ambienteLibpq(destino, raizes, aplicacao) {
  return {
    PGHOST: destino.servidorTls,
    ...(destino.host !== destino.servidorTls ? { PGHOSTADDR: destino.host } : {}),
    PGPORT: String(destino.port),
    PGUSER: destino.user,
    PGPASSWORD: destino.password,
    PGDATABASE: destino.database,
    PGSSLMODE: "verify-full",
    PGSSLROOTCERT: raizes,
    PGSSLSNI: "1",
    PGCHANNELBINDING: destino.channelBinding ? "require" : "prefer",
    PGAPPNAME: aplicacao,
  };
}

export function sha256DoArquivo(arquivo) {
  return createHash("sha256").update(readFileSync(arquivo)).digest("hex");
}

export function registrar(arquivo, entrada) {
  appendFileSync(arquivo, `${JSON.stringify(entrada)}\n`, "utf8");
}
