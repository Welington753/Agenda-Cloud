// Backup agendado do piloto (lote O1, docs/plans/backup-e-monitoramento.md).
// Roda sem terminal, num runner do repositório PRIVADO de operação, nunca
// neste repositório público. Reaproveita as peças de operacao-piloto.mjs:
// destino conferido pela URL antes da rede, TLS conferido no socket,
// fotografia (contagem e md5 por tabela) no mesmo snapshot do `pg_dump -Fc`.
//
// Ordem de uma execução (executarBackup):
//   1. check-in `in_progress` no monitor de cron;
//   2. papel do banco conferido como somente leitura;
//   3. snapshot REPEATABLE READ READ ONLY, fotografia e `pg_dump --snapshot`;
//   4. restauração num PostgreSQL descartável (loopback) e fotografia igual;
//   5. dump e manifesto criptografados com age, só com a chave PÚBLICA;
//   6. envio ao B2 com retenção (Object Lock) e conferência do objeto enviado:
//      tamanho, sha256, modo e data de retenção, e o download do dump;
//   7. `resumo.json` enviado por último: sem ele, a pasta é um backup
//      incompleto;
//   8. check-in `ok` só depois de tudo. Qualquer falha manda `error` e sai
//      com código diferente de zero.
//
// Nada aqui imprime URL, senha, chave, nome de tabela ou conteúdo de linha.
// O manifesto completo (contagens e md5 por tabela) só sai criptografado.
import { spawn } from "node:child_process";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { rootCertificates } from "node:tls";
import path from "node:path";
import {
  FORMATO_ENDPOINT_ID,
  compararFotografias,
  conectar,
  conferirDestino,
  encerrar,
  fotografar,
  parar,
  pastaForaDoRepositorio,
  sha256DoArquivo,
} from "./operacao-piloto.mjs";

export const REPOSITORIO_DE_OPERACAO = "Welington753/agenda-cloud-operacao";
export const REPOSITORIO_PUBLICO = "Welington753/Agenda-Cloud";
export const PAPEL_DE_BACKUP = "agenda_backup";
export const APLICACAO = "agenda-cloud-backup-agendado";
export const RETENCAO_DIARIA_DIAS = 35;
export const RETENCAO_MENSAL_MESES = 13;
export const ARQUIVOS = { dump: "piloto-neondb.dump.age", manifesto: "manifesto.json.age", resumo: "resumo.json" };
const CABECALHO_AGE = "age-encryption.org/v1\n";
// Destinatário age (bech32): `age1` + 58 caracteres do alfabeto bech32.
const DESTINATARIO_AGE = /^age1[02-9ac-hj-np-z]{58}$/;
const ENDPOINT_B2 = /^https:\/\/s3\.([a-z]{2}-[a-z]+-\d{3})\.backblazeb2\.com$/;
const BUCKET = /^[a-z0-9][a-z0-9-]{4,48}[a-z0-9]$/;
const SHA_DE_COMMIT = /^[0-9a-f]{40}$/;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

const obrigatorio = (env, nome) => {
  const valor = (env[nome] ?? "").trim();
  if (!valor) parar(`ERR_VARIAVEL_AUSENTE_${nome}`);
  return valor;
};

/**
 * Banco PostgreSQL só em 127.0.0.1 (o descartável do runner, ou o do ensaio),
 * com `sslmode=verify-full` e a CA do arquivo indicado. O certificado do
 * descartável é emitido para `localhost`.
 */
export function conferirLoopback(bruta, caArquivo, codigo) {
  let url;
  try {
    url = new URL(bruta.trim());
  } catch {
    parar(`${codigo}_URL_INVALIDA`);
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) parar(`${codigo}_URL_INVALIDA`);
  if (!LOOPBACK.has(url.hostname.toLowerCase())) parar(`${codigo}_FORA_DO_LOOPBACK`);
  if ((url.searchParams.get("sslmode") ?? "").toLowerCase() !== "verify-full") parar(`${codigo}_SEM_VERIFY_FULL`);
  if (!url.username || !url.password) parar(`${codigo}_SEM_CREDENCIAL`);
  if (!caArquivo || !existsSync(caArquivo)) parar(`${codigo}_SEM_CA`);
  return {
    host: "127.0.0.1",
    servidorTls: "localhost",
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.replace(/^\//, "")) || "postgres",
    channelBinding: false,
    ca: readFileSync(caArquivo, "utf8"),
    caArquivo,
  };
}

/** Destino da recuperação: qualquer servidor com TLS verificado, sem pooler. */
export function destinoDaRecuperacao(bruta, caArquivo) {
  let url;
  try {
    url = new URL((bruta ?? "").trim());
  } catch {
    parar("ERR_RECUPERACAO_URL_INVALIDA");
  }
  if (["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) return conferirLoopback(bruta, caArquivo, "ERR_RECUPERACAO");
  if (!["postgres:", "postgresql:"].includes(url.protocol)) parar("ERR_RECUPERACAO_URL_INVALIDA");
  if (url.hostname.includes("-pooler")) parar("ERR_POOLER");
  if (!url.username || !url.password) parar("ERR_RECUPERACAO_SEM_CREDENCIAL");
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!database) parar("ERR_RECUPERACAO_SEM_BANCO");
  return {
    host: url.hostname,
    servidorTls: url.hostname,
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database,
    channelBinding: url.searchParams.get("channel_binding") === "require",
    ...(caArquivo ? { ca: readFileSync(caArquivo, "utf8"), caArquivo } : {}),
  };
}

function conferirArmazenamento(env, modo) {
  const endpoint = obrigatorio(env, "B2_ENDPOINT").replace(/\/+$/, "");
  let regiao;
  if (modo === "piloto") {
    const achado = ENDPOINT_B2.exec(endpoint);
    if (!achado) parar("ERR_ENDPOINT_B2_INESPERADO");
    regiao = achado[1];
  } else {
    let url;
    try {
      url = new URL(endpoint);
    } catch {
      parar("ERR_ENDPOINT_B2_INESPERADO");
    }
    if (url.protocol !== "http:" || !LOOPBACK.has(url.hostname)) parar("ERR_ENSAIO_ARMAZENAMENTO_FORA_DO_LOOPBACK");
    regiao = "us-west-004";
  }
  const bucket = obrigatorio(env, "B2_BUCKET");
  if (!BUCKET.test(bucket)) parar("ERR_BUCKET_INVALIDO");
  return { endpoint, regiao, bucket, chaveId: obrigatorio(env, "B2_KEY_ID"), chaveSecreta: obrigatorio(env, "B2_APP_KEY") };
}

function conferirCron(env, modo) {
  const bruta = obrigatorio(env, "SENTRY_CRON_URL");
  let url;
  try {
    url = new URL(bruta);
  } catch {
    parar("ERR_CRON_URL_INVALIDA");
  }
  if (url.search) parar("ERR_CRON_URL_INVALIDA");
  if (modo === "piloto") {
    if (url.protocol !== "https:" || !url.hostname.endsWith(".sentry.io") || !/\/api\/\d+\/cron\/[a-z0-9-]+\/[0-9a-f]+\/?$/.test(url.pathname)) {
      parar("ERR_CRON_URL_INESPERADA");
    }
  } else if (url.protocol !== "http:" || !LOOPBACK.has(url.hostname)) {
    parar("ERR_ENSAIO_CRON_FORA_DO_LOOPBACK");
  }
  return url.toString();
}

/**
 * Lê e confere toda a configuração antes de qualquer rede. Modo `piloto` só
 * no repositório privado de operação, dentro do GitHub Actions, com o papel
 * `agenda_backup` no endpoint do piloto. Modo `ensaio` (CI público e testes)
 * só com destinos em 127.0.0.1: nunca alcança Neon, B2 nem Sentry.
 */
export function lerConfiguracao(env) {
  for (const valor of Object.values(env)) {
    if (typeof valor === "string" && valor.toUpperCase().includes("AGE-SECRET-KEY-")) parar("ERR_CHAVE_PRIVADA_NO_AMBIENTE");
  }
  const modo = obrigatorio(env, "BACKUP_MODO");
  if (!["piloto", "ensaio"].includes(modo)) parar("ERR_MODO_INVALIDO");

  let origem;
  if (modo === "piloto") {
    if (env.GITHUB_ACTIONS !== "true") parar("ERR_PILOTO_FORA_DO_GITHUB_ACTIONS");
    if (env.GITHUB_REPOSITORY === REPOSITORIO_PUBLICO) parar("ERR_REPOSITORIO_PUBLICO");
    if (env.GITHUB_REPOSITORY !== REPOSITORIO_DE_OPERACAO) parar("ERR_REPOSITORIO_INESPERADO");
    obrigatorio(env, "GITHUB_TOKEN");
    const endpointPiloto = obrigatorio(env, "PILOT_ENDPOINT_ID");
    const endpointProibido = obrigatorio(env, "PRODUCTION_ENDPOINT_ID");
    if (!FORMATO_ENDPOINT_ID.test(endpointPiloto) || !FORMATO_ENDPOINT_ID.test(endpointProibido)) parar("ERR_ENDPOINT_ID_INVALIDO");
    if (endpointPiloto === endpointProibido) parar("ERR_ENDPOINT_ID_INVALIDO");
    origem = conferirDestino(obrigatorio(env, "PILOTO_BACKUP_URL"), { endpointPiloto, endpointProibido });
    if (origem.user !== PAPEL_DE_BACKUP) parar("ERR_PAPEL_DIFERENTE_DE_AGENDA_BACKUP");
  } else {
    origem = conferirLoopback(obrigatorio(env, "PILOTO_BACKUP_URL"), env.BACKUP_ORIGEM_CA, "ERR_ENSAIO_ORIGEM");
  }

  const restauracao = conferirLoopback(obrigatorio(env, "RESTAURACAO_URL"), env.RESTAURACAO_CA, "ERR_RESTAURACAO");
  const destinatario = obrigatorio(env, "AGE_RECIPIENT");
  if (!DESTINATARIO_AGE.test(destinatario)) parar("ERR_DESTINATARIO_AGE_INVALIDO");
  const commit = obrigatorio(env, "BACKUP_CODIGO_SHA");
  if (!SHA_DE_COMMIT.test(commit)) parar("ERR_SHA_DO_CODIGO_INVALIDO");
  const pastaTemporaria = env.BACKUP_PASTA_TEMP || env.RUNNER_TEMP || "";
  if (!pastaTemporaria || !existsSync(pastaTemporaria)) parar("ERR_PASTA_TEMPORARIA_AUSENTE");
  if (!pastaForaDoRepositorio(pastaTemporaria)) parar("ERR_PASTA_TEMPORARIA_DENTRO_DO_REPOSITORIO");
  const pgBin = obrigatorio(env, "PG_BIN");
  const binario = (pasta, nome) => path.join(pasta, process.platform === "win32" ? `${nome}.exe` : nome);

  return {
    modo,
    repositorio: env.GITHUB_REPOSITORY ?? "",
    apiDoGitHub: env.GITHUB_API_URL || "https://api.github.com",
    tokenDoGitHub: env.GITHUB_TOKEN ?? "",
    execucao: env.GITHUB_RUN_ID || randomBytes(4).toString("hex"),
    origem,
    restauracao,
    armazenamento: conferirArmazenamento(env, modo),
    cron: conferirCron(env, modo),
    destinatario,
    commit,
    pastaTemporaria,
    binarios: {
      pgDump: binario(pgBin, "pg_dump"),
      pgRestore: binario(pgBin, "pg_restore"),
      age: obrigatorio(env, "AGE_BIN"),
    },
  };
}

/** Segredos da configuração, para tirar de qualquer detalhe de erro. */
export function segredosDa(config) {
  return [
    config.origem.password,
    config.origem.url,
    config.origem.host,
    config.restauracao.password,
    config.armazenamento.chaveSecreta,
    config.armazenamento.chaveId,
    config.cron,
    config.tokenDoGitHub,
  ].filter((s) => typeof s === "string" && s.length >= 4);
}

/** Corta e tira do texto cada segredo (inteiro e codificado em URL). */
export function limparDetalhe(texto, segredos, limite = 400) {
  let limpo = String(texto ?? "");
  for (const s of segredos) {
    for (const forma of new Set([s, encodeURIComponent(s)])) limpo = limpo.split(forma).join("[omitido]");
  }
  limpo = limpo.replace(/postgres(?:ql)?:\/\/\S+/gi, "[url omitida]");
  return limpo.slice(0, limite);
}

/**
 * Segunda trava do modo piloto, além do `if` do workflow: a API do GitHub
 * precisa dizer que o repositório em execução é o de operação e é privado.
 */
export async function conferirRepositorioPrivado(config, buscar = fetch) {
  const resposta = await buscar(`${config.apiDoGitHub}/repos/${config.repositorio}`, {
    headers: { Authorization: `Bearer ${config.tokenDoGitHub}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
  }).catch(() => parar("ERR_VISIBILIDADE_NAO_CONFERIDA"));
  if (!resposta.ok) parar("ERR_VISIBILIDADE_NAO_CONFERIDA");
  const repo = await resposta.json().catch(() => ({}));
  if (repo.full_name !== REPOSITORIO_DE_OPERACAO) parar("ERR_REPOSITORIO_INESPERADO");
  if (repo.private !== true || repo.visibility !== "private") parar("ERR_REPOSITORIO_NAO_PRIVADO");
}

/** Lê o que o papel conectado pode fazer no banco. */
export async function lerEstadoDoPapel(client) {
  const [linha] = (
    await client.query(`
      SELECT r.rolsuper AS superusuario, r.rolcreaterole AS "criaPapel", r.rolcreatedb AS "criaBanco",
             r.rolreplication AS replicacao, r.rolbypassrls AS "ignoraRls",
             has_database_privilege(current_database(), 'CREATE') AS "criaNoBanco",
             has_schema_privilege('public', 'CREATE') AS "criaNoSchema",
             (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = 'public' AND pg_has_role(current_user, c.relowner, 'USAGE')) AS "donoDeObjetos",
             (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
                 AND (has_table_privilege(c.oid, 'INSERT') OR has_table_privilege(c.oid, 'UPDATE')
                   OR has_table_privilege(c.oid, 'DELETE') OR has_table_privilege(c.oid, 'TRUNCATE'))) AS "tabelasComEscrita",
             (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND NOT has_table_privilege(c.oid, 'SELECT')) AS "tabelasSemLeitura",
             (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = 'public' AND c.relkind = 'S' AND NOT has_table_privilege(c.oid, 'SELECT')) AS "sequenciasSemLeitura"
        FROM pg_roles r WHERE r.rolname = current_user`)
  ).rows;
  return linha;
}

/** Códigos do que impede o papel de ser tratado como somente leitura. */
export function avaliarPapelSomenteLeitura(estado) {
  const falhas = [];
  if (!estado) return ["ERR_PAPEL_NAO_ENCONTRADO"];
  if (estado.superusuario) falhas.push("ERR_PAPEL_SUPERUSUARIO");
  if (estado.criaPapel || estado.criaBanco || estado.replicacao || estado.ignoraRls) falhas.push("ERR_PAPEL_COM_ATRIBUTO_DE_ADMINISTRACAO");
  if (estado.criaNoBanco || estado.criaNoSchema) falhas.push("ERR_PAPEL_PODE_CRIAR_OBJETOS");
  if (estado.donoDeObjetos > 0) falhas.push("ERR_PAPEL_DONO_DE_OBJETOS");
  if (estado.tabelasComEscrita > 0) falhas.push("ERR_PAPEL_PODE_ESCREVER");
  if (estado.tabelasSemLeitura > 0 || estado.sequenciasSemLeitura > 0) falhas.push("ERR_PAPEL_NAO_LE_TUDO");
  return falhas;
}

/**
 * Onde o backup fica e até quando é imutável. O do dia 1 (UTC) é o mensal,
 * guardado 13 meses; os outros, 35 dias. Um dia a mais de margem no mensal.
 */
export function planoDoObjeto(agora, execucao) {
  const iso = agora.toISOString();
  const [dia, hora] = [iso.slice(0, 10), iso.slice(11, 19).replaceAll(":", "")];
  const mensal = agora.getUTCDate() === 1;
  const retencaoAte = mensal
    ? new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth() + RETENCAO_MENSAL_MESES, agora.getUTCDate() + 1, agora.getUTCHours(), agora.getUTCMinutes()))
    : new Date(agora.getTime() + RETENCAO_DIARIA_DIAS * 86_400_000);
  const tipo = mensal ? "mensal" : "diario";
  return { tipo, prefixo: `piloto/${tipo}/${dia.replaceAll("-", "/")}/${hora}Z-${execucao}/`, retencaoAte };
}

// ---------- S3 do B2 (assinatura AWS SigV4, sem SDK) ----------

const sha256Hex = (dado) => createHash("sha256").update(dado).digest("hex");
const hmac = (chave, texto) => createHmac("sha256", chave).update(texto, "utf8").digest();
const rfc3986 = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
export const HASH_VAZIO = sha256Hex("");

/**
 * Assina uma requisição com AWS Signature Version 4 (o B2 aceita no endpoint
 * S3). `url` já com o caminho codificado. Devolve os cabeçalhos a enviar.
 */
export function assinarS3({ metodo, url, cabecalhos = {}, hashDoCorpo, chaveId, chaveSecreta, regiao, servico = "s3", agora }) {
  const u = new URL(url);
  const amzData = agora.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const data = amzData.slice(0, 8);
  const todos = {};
  for (const [nome, valor] of Object.entries(cabecalhos)) todos[nome.toLowerCase()] = String(valor).trim().replace(/\s+/g, " ");
  todos.host = u.host;
  todos["x-amz-date"] = amzData;
  const nomes = Object.keys(todos).sort();
  const consulta = [...u.searchParams.entries()]
    .map(([k, v]) => [rfc3986(k), rfc3986(v)])
    .sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : 1) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const assinados = nomes.join(";");
  const canonica = [metodo, u.pathname, consulta, nomes.map((n) => `${n}:${todos[n]}\n`).join(""), assinados, hashDoCorpo].join("\n");
  const escopo = `${data}/${regiao}/${servico}/aws4_request`;
  const aAssinar = ["AWS4-HMAC-SHA256", amzData, escopo, sha256Hex(canonica)].join("\n");
  const chave = hmac(hmac(hmac(hmac(`AWS4${chaveSecreta}`, data), regiao), servico), "aws4_request");
  const assinatura = createHmac("sha256", chave).update(aAssinar, "utf8").digest("hex");
  return { ...todos, authorization: `AWS4-HMAC-SHA256 Credential=${chaveId}/${escopo}, SignedHeaders=${assinados}, Signature=${assinatura}` };
}

export function clienteS3({ endpoint, regiao, bucket, chaveId, chaveSecreta }, { buscar = fetch, agora = () => new Date() } = {}) {
  const urlDe = (chave) => `${endpoint}/${rfc3986(bucket)}/${chave.split("/").map(rfc3986).join("/")}`;
  const pedir = async (metodo, chave, { corpo, cabecalhos = {} } = {}) => {
    const hashDoCorpo = corpo ? sha256Hex(corpo) : HASH_VAZIO;
    const url = urlDe(chave);
    const assinados = assinarS3({
      metodo,
      url,
      cabecalhos: { ...cabecalhos, "x-amz-content-sha256": hashDoCorpo },
      hashDoCorpo,
      chaveId,
      chaveSecreta,
      regiao,
      agora: agora(),
    });
    delete assinados.host;
    return buscar(url, { method: metodo, headers: assinados, body: corpo });
  };
  return {
    /** Grava com retenção COMPLIANCE até `retencaoAte` e o sha256 em metadado. */
    async enviar(chave, corpo, { retencaoAte, tipo = "application/octet-stream" }) {
      const resposta = await pedir("PUT", chave, {
        corpo,
        cabecalhos: {
          "content-type": tipo,
          "content-md5": createHash("md5").update(corpo).digest("base64"),
          "x-amz-meta-sha256": sha256Hex(corpo),
          "x-amz-object-lock-mode": "COMPLIANCE",
          "x-amz-object-lock-retain-until-date": retencaoAte.toISOString(),
        },
      });
      return { status: resposta.status, ok: resposta.ok };
    },
    async conferir(chave) {
      const resposta = await pedir("HEAD", chave);
      return { status: resposta.status, cabecalhos: Object.fromEntries(resposta.headers.entries()) };
    },
    async baixar(chave) {
      const resposta = await pedir("GET", chave);
      return { status: resposta.status, corpo: resposta.ok ? Buffer.from(await resposta.arrayBuffer()) : null };
    },
  };
}

/** Confere o HEAD do objeto enviado contra o arquivo local e a retenção pedida. */
export function conferirObjetoEnviado({ status, cabecalhos }, { bytes, sha256, retencaoAte }) {
  if (status !== 200) return ["ERR_OBJETO_NAO_ENCONTRADO_APOS_ENVIO"];
  const falhas = [];
  if (Number(cabecalhos["content-length"]) !== bytes) falhas.push("ERR_OBJETO_TAMANHO_DIFERENTE");
  if (cabecalhos["x-amz-meta-sha256"] !== sha256) falhas.push("ERR_OBJETO_SHA256_DIFERENTE");
  if ((cabecalhos["x-amz-object-lock-mode"] ?? "").toUpperCase() !== "COMPLIANCE") falhas.push("ERR_OBJETO_SEM_RETENCAO_COMPLIANCE");
  const ate = Date.parse(cabecalhos["x-amz-object-lock-retain-until-date"] ?? "");
  // O B2 pode arredondar a data; aceita até 1 min a menos.
  if (!Number.isFinite(ate) || ate < retencaoAte.getTime() - 60_000) falhas.push("ERR_OBJETO_RETENCAO_MENOR_QUE_A_PEDIDA");
  return falhas;
}

// ---------- processos, cron e restauração ----------

/** Executa sem shell; devolve código, stdout e stderr (cortados). */
export function executar(executavel, args, env = {}) {
  return new Promise((resolve, reject) => {
    const filho = spawn(executavel, args, {
      env: { SystemRoot: process.env.SystemRoot, ...env },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    filho.stdout.on("data", (d) => (stdout = (stdout + d).slice(0, 65_536)));
    filho.stderr.on("data", (d) => (stderr = (stderr + d).slice(0, 65_536)));
    filho.on("error", reject);
    filho.on("close", (codigo) => resolve({ codigo, stdout, stderr }));
  });
}

/** Versão maior de `pg_dump --version` / `pg_restore --version`. */
export function versaoMaior(saida) {
  const achado = /\(PostgreSQL\)\s+(\d+)/.exec(saida ?? "");
  return achado ? Number(achado[1]) : null;
}

/** Check-in do monitor de cron do Sentry (GET com `status`). Nunca lança. */
export async function sinalizarCron(url, status, { buscar = fetch, duracaoMs } = {}) {
  const alvo = new URL(url);
  alvo.searchParams.set("status", status);
  if (duracaoMs !== undefined) alvo.searchParams.set("duration", String(Math.round(duracaoMs)));
  try {
    const resposta = await buscar(alvo.toString(), { method: "GET" });
    return resposta.ok;
  } catch {
    return false;
  }
}

const ident = (nome) => `"${nome.replaceAll('"', '""')}"`;

/**
 * Restaura `dump` no banco `nomeDoBanco` de `servidor` e compara a fotografia
 * com a esperada. Com `criarBanco`, cria o banco antes e o apaga depois (o
 * descartável do job); sem, exige o banco existente com `public` vazio (a
 * recuperação de emergência).
 */
export async function restaurarEConferir({ dump, servidor, nomeDoBanco, esperado, pgRestore, criarBanco, executarProcesso = executar, log, segredos = [], aposRestaurar }) {
  const admin = { ...servidor, database: criarBanco ? servidor.database : nomeDoBanco };
  const destino = { ...servidor, database: nomeDoBanco };
  if (criarBanco) {
    const c = await conectar(admin, { aplicacao: APLICACAO, log });
    try {
      await c.query(`CREATE DATABASE ${ident(nomeDoBanco)} TEMPLATE template0 ENCODING 'UTF8'`);
    } finally {
      await encerrar(c);
    }
  } else {
    const c = await conectar(destino, { aplicacao: APLICACAO, log });
    try {
      const [{ n }] = (await c.query("SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace WHERE s.nspname = 'public'")).rows;
      if (n > 0) parar("ERR_BANCO_DE_DESTINO_NAO_ESTA_VAZIO");
    } finally {
      await encerrar(c);
    }
  }
  try {
    const caArquivo = servidor.caArquivo;
    const { codigo, stderr } = await executarProcesso(
      pgRestore,
      ["-d", nomeDoBanco, "--no-owner", "--no-privileges", "--exit-on-error", "--single-transaction", dump],
      {
        PGHOST: servidor.servidorTls,
        ...(servidor.host !== servidor.servidorTls ? { PGHOSTADDR: servidor.host } : {}),
        PGPORT: String(servidor.port),
        PGUSER: servidor.user,
        PGPASSWORD: servidor.password,
        PGSSLMODE: "verify-full",
        PGSSLROOTCERT: caArquivo,
        PGAPPNAME: APLICACAO,
      },
    );
    if (codigo !== 0) {
      log(`DETALHE: pg_restore saiu com ${codigo}: ${limparDetalhe(stderr, segredos)}`);
      parar("ERR_PG_RESTORE");
    }
    if (aposRestaurar) await aposRestaurar(destino);
    const leitor = await conectar(destino, { aplicacao: APLICACAO, log });
    let restaurado;
    try {
      await leitor.query("BEGIN TRANSACTION READ ONLY");
      restaurado = await fotografar(leitor);
      await leitor.query("ROLLBACK");
    } finally {
      await encerrar(leitor);
    }
    const igual = compararFotografias(esperado, restaurado);
    log(`RESTAURACAO_TABELAS: ${Object.keys(restaurado.contagens).length}`);
    log(`RESTAURACAO_IGUAL: ${igual.iguais}`);
    if (!igual.iguais) {
      // Só quantas divergem: nome de tabela não vai para o log.
      log(`DIVERGENCIAS: contagem=${igual.contagensDiferentes.length} md5=${igual.somasDiferentes.length} ausentes=${igual.ausentes.length} sobrando=${igual.sobrando.length}`);
      parar("ERR_RESTAURACAO_DIFERENTE_DO_SNAPSHOT");
    }
    return { tabelas: Object.keys(restaurado.contagens).length };
  } finally {
    if (criarBanco) {
      const c = await conectar(admin, { aplicacao: APLICACAO, log }).catch(() => null);
      if (c) {
        await c.query(`DROP DATABASE IF EXISTS ${ident(nomeDoBanco)} WITH (FORCE)`).catch(() => {});
        await encerrar(c);
      }
    }
  }
}

async function exigirProcesso(executarProcesso, executavel, args, env, codigo, segredos, log) {
  let resultado;
  try {
    resultado = await executarProcesso(executavel, args, env);
  } catch (erro) {
    log(`DETALHE: ${path.basename(executavel)} não iniciou: ${limparDetalhe(erro?.code ?? erro?.message, segredos)}`);
    parar(codigo);
  }
  if (resultado.codigo !== 0) {
    log(`DETALHE: ${path.basename(executavel)} saiu com ${resultado.codigo}: ${limparDetalhe(resultado.stderr, segredos)}`);
    parar(codigo);
  }
  return resultado;
}

async function criptografar(config, deps, entrada, saida, segredos) {
  await exigirProcesso(deps.executarProcesso, config.binarios.age, ["-r", config.destinatario, "-o", saida, entrada], {}, "ERR_CRIPTOGRAFIA", segredos, deps.log);
  if (!existsSync(saida)) parar("ERR_CRIPTOGRAFIA_SEM_ARQUIVO");
  const conteudo = readFileSync(saida);
  if (!conteudo.subarray(0, CABECALHO_AGE.length).equals(Buffer.from(CABECALHO_AGE))) parar("ERR_CRIPTOGRAFIA_FORMATO_INESPERADO");
  if (conteudo.length <= statSync(entrada).size) parar("ERR_CRIPTOGRAFIA_FORMATO_INESPERADO");
  // O texto claro não pode aparecer no arquivo cifrado (age que só copiou).
  const amostra = readFileSync(entrada).subarray(0, 64);
  if (amostra.length >= 16 && conteudo.includes(amostra)) parar("ERR_CRIPTOGRAFIA_FORMATO_INESPERADO");
  return { bytes: conteudo.length, sha256: sha256Hex(conteudo), conteudo };
}

/**
 * Uma execução completa. `deps` existe para os testes trocarem processos e
 * rede (falhas simuladas); em produção, só os padrões.
 */
export async function executarBackup(config, deps = {}) {
  const d = {
    executarProcesso: executar,
    buscar: fetch,
    agora: () => new Date(),
    log: (linha) => console.log(linha),
    aoExportarSnapshot: async () => {},
    aposRestaurar: undefined,
    ...deps,
  };
  const log = d.log;
  const segredos = segredosDa(config);
  const inicio = d.agora();
  const duracoes = {};
  const etapa = async (nome, fn) => {
    const t0 = performance.now();
    try {
      return await fn();
    } finally {
      duracoes[nome] = Math.round(performance.now() - t0);
    }
  };
  let temp;
  const clientes = new Set();

  if (!(await sinalizarCron(config.cron, "in_progress", { buscar: d.buscar }))) log("AVISO: check-in in_progress do cron não confirmado");
  try {
    if (config.modo === "piloto") await etapa("visibilidade", () => conferirRepositorioPrivado(config, d.buscar));
    log(`MODO: ${config.modo}`);
    temp = mkdtempSync(path.join(config.pastaTemporaria, "agenda-cloud-backup-"));
    const raizes = config.origem.caArquivo ?? path.join(temp, "raizes-tls-node.pem");
    if (!config.origem.caArquivo) writeFileSync(raizes, rootCertificates.join("\n"));

    const versoes = await etapa("versoes", async () => {
      const dump = await exigirProcesso(d.executarProcesso, config.binarios.pgDump, ["--version"], {}, "ERR_PG_DUMP_AUSENTE", segredos, log);
      const restore = await exigirProcesso(d.executarProcesso, config.binarios.pgRestore, ["--version"], {}, "ERR_PG_RESTORE_AUSENTE", segredos, log);
      const age = await exigirProcesso(d.executarProcesso, config.binarios.age, ["--version"], {}, "ERR_AGE_AUSENTE", segredos, log);
      return { pgDump: versaoMaior(dump.stdout), pgRestore: versaoMaior(restore.stdout), age: age.stdout.trim().slice(0, 40) };
    });

    // 1. Snapshot, fotografia e dump.
    const dump = path.join(temp, "piloto-neondb.dump");
    const capturado = await etapa("dump", async () => {
      const leitor = await conectar(config.origem, { aplicacao: APLICACAO, log });
      clientes.add(leitor);
      try {
        const falhas = avaliarPapelSomenteLeitura(await lerEstadoDoPapel(leitor));
        if (falhas.length) {
          log(`PAPEL: ${falhas.join(",")}`);
          parar("ERR_PAPEL_NAO_E_SOMENTE_LEITURA");
        }
        log("PAPEL: somente leitura");
        await leitor.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        const [{ snapshot }] = (await leitor.query("SELECT pg_export_snapshot() AS snapshot")).rows;
        await d.aoExportarSnapshot();
        const pontoDeRecuperacao = d.agora();
        const fotografia = await fotografar(leitor);
        const [{ versao, numero }] = (
          await leitor.query("SELECT current_setting('server_version') AS versao, current_setting('server_version_num')::int AS numero")
        ).rows;
        const servidorMaior = Math.floor(numero / 10_000);
        if (!versoes.pgDump || versoes.pgDump < servidorMaior) parar("ERR_PG_DUMP_MAIS_ANTIGO_QUE_O_SERVIDOR");
        if (!versoes.pgRestore || versoes.pgRestore < versoes.pgDump) parar("ERR_PG_RESTORE_MAIS_ANTIGO_QUE_O_PG_DUMP");
        const migrations = (await leitor.query("SELECT name FROM typeorm_migrations ORDER BY id")).rows.map((r) => r.name);
        log("DUMP: executando pg_dump -Fc ...");
        await exigirProcesso(
          d.executarProcesso,
          config.binarios.pgDump,
          ["-Fc", "--no-password", `--snapshot=${snapshot}`, "-f", dump],
          {
            PGHOST: config.origem.servidorTls,
            ...(config.origem.host !== config.origem.servidorTls ? { PGHOSTADDR: config.origem.host } : {}),
            PGPORT: String(config.origem.port),
            PGUSER: config.origem.user,
            PGPASSWORD: config.origem.password,
            PGDATABASE: config.origem.database,
            PGSSLMODE: "verify-full",
            PGSSLROOTCERT: raizes,
            PGCHANNELBINDING: config.origem.channelBinding ? "require" : "prefer",
            PGAPPNAME: APLICACAO,
          },
          "ERR_PG_DUMP",
          segredos,
          log,
        );
        await leitor.query("COMMIT");
        if (!existsSync(dump) || statSync(dump).size === 0) parar("ERR_DUMP_VAZIO");
        return { pontoDeRecuperacao, fotografia, servidor: versao, migrations };
      } finally {
        clientes.delete(leitor);
        await encerrar(leitor);
      }
    });
    const dumpBytes = statSync(dump).size;
    const dumpSha256 = sha256DoArquivo(dump);
    log(`DUMP_OK: ${dumpBytes} bytes`);

    // 2. Restauração no descartável.
    const restaurado = await etapa("restauracao", () =>
      restaurarEConferir({
        dump,
        servidor: config.restauracao,
        nomeDoBanco: `conferencia_${randomBytes(6).toString("hex")}`,
        esperado: capturado.fotografia,
        pgRestore: config.binarios.pgRestore,
        criarBanco: true,
        executarProcesso: d.executarProcesso,
        log,
        segredos,
        aposRestaurar: d.aposRestaurar,
      }),
    );

    // 3. Criptografia (dump e manifesto completo).
    const plano = planoDoObjeto(capturado.pontoDeRecuperacao, config.execucao);
    const manifesto = {
      formato: "agenda-cloud-backup/1",
      pontoDeRecuperacao: capturado.pontoDeRecuperacao.toISOString(),
      servidor: capturado.servidor,
      migrations: capturado.migrations,
      pgDump: versoes.pgDump,
      commit: config.commit,
      dump: { arquivo: "piloto-neondb.dump", bytes: dumpBytes, sha256: dumpSha256 },
      ...capturado.fotografia,
    };
    const manifestoClaro = path.join(temp, "manifesto.json");
    writeFileSync(manifestoClaro, JSON.stringify(manifesto, null, 2));
    const cifrados = await etapa("criptografia", async () => ({
      dump: await criptografar(config, d, dump, path.join(temp, ARQUIVOS.dump), segredos),
      manifesto: await criptografar(config, d, manifestoClaro, path.join(temp, ARQUIVOS.manifesto), segredos),
    }));
    rmSync(dump, { force: true });
    rmSync(manifestoClaro, { force: true });
    log(`CRIPTOGRAFIA_OK: dump=${cifrados.dump.bytes} bytes manifesto=${cifrados.manifesto.bytes} bytes`);

    // 4. Envio e conferência do que ficou no armazenamento.
    const s3 = clienteS3(config.armazenamento, { buscar: d.buscar, agora: d.agora });
    const enviarConferido = async (nome, { conteudo, bytes, sha256 }, tipo) => {
      const chave = `${plano.prefixo}${nome}`;
      const envio = await s3.enviar(chave, conteudo, { retencaoAte: plano.retencaoAte, tipo }).catch(() => ({ ok: false, status: "rede" }));
      if (!envio.ok) {
        log(`DETALHE: envio de ${nome} respondeu ${envio.status}`);
        parar("ERR_ENVIO");
      }
      const head = await s3.conferir(chave).catch(() => ({ status: "rede", cabecalhos: {} }));
      const falhas = conferirObjetoEnviado(head, { bytes, sha256, retencaoAte: plano.retencaoAte });
      if (falhas.length) {
        log(`OBJETO ${nome}: ${falhas.join(",")}`);
        parar("ERR_OBJETO_ENVIADO_NAO_CONFERE");
      }
      return { chave, bytes, sha256 };
    };
    const enviados = await etapa("envio", async () => {
      const objetos = {
        dump: await enviarConferido(ARQUIVOS.dump, cifrados.dump),
        manifesto: await enviarConferido(ARQUIVOS.manifesto, cifrados.manifesto),
      };
      const baixado = await s3.baixar(objetos.dump.chave).catch(() => ({ status: "rede", corpo: null }));
      if (!baixado.corpo || sha256Hex(baixado.corpo) !== cifrados.dump.sha256) parar("ERR_DOWNLOAD_DIFERENTE_DO_ENVIADO");
      return objetos;
    });

    const resumo = {
      formato: "agenda-cloud-backup-resumo/1",
      completo: true,
      tipo: plano.tipo,
      pontoDeRecuperacao: manifesto.pontoDeRecuperacao,
      retencaoAte: plano.retencaoAte.toISOString(),
      commit: config.commit,
      execucao: config.execucao,
      pgDump: versoes.pgDump,
      servidor: capturado.servidor,
      tabelas: restaurado.tabelas,
      dumpClaroBytes: dumpBytes,
      objetos: enviados,
      duracoesMs: duracoes,
    };
    const corpoResumo = Buffer.from(JSON.stringify(resumo, null, 2));
    // Resumo por último: ele marca a pasta como backup completo.
    await enviarConferido(ARQUIVOS.resumo, { conteudo: corpoResumo, bytes: corpoResumo.length, sha256: sha256Hex(corpoResumo) }, "application/json");

    const totalMs = d.agora().getTime() - inicio.getTime();
    resumo.duracoesMs.total = totalMs;
    if (!(await sinalizarCron(config.cron, "ok", { buscar: d.buscar, duracaoMs: totalMs }))) parar("ERR_CHECKIN_OK_NAO_CONFIRMADO");
    log(`OBJETOS: ${plano.tipo} retencaoAte=${resumo.retencaoAte}`);
    log(`DURACOES_MS: ${JSON.stringify(duracoes)}`);
    log("RESULTADO: backup_ok");
    return resumo;
  } catch (erro) {
    await sinalizarCron(config.cron, "error", { buscar: d.buscar });
    throw erro;
  } finally {
    for (const c of clientes) await encerrar(c);
    if (temp) rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
