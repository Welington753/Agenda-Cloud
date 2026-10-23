// Publicação de AccountsAdministration1792800000000 no banco do piloto, em
// fases executadas à mão (ver docs/runbooks/publicacao-contas-piloto.md).
// Não é rota nem parte do deploy. A URL direta é digitada oculta e nunca vem de
// variável, arquivo ou argumento.
//
//   --fase=preparar  só leitura: destino, TLS, conferência
//                    `before-accounts-administration` e backup (pg_dump -Fc no
//                    mesmo snapshot das contagens e md5 por tabela).
//   --fase=aplicar   exige um backup da fase `preparar` com a restauração
//                    conferida (conferir-restauracao-piloto.mjs). Repete destino,
//                    TLS e `before`, faz um backup novo, pede a frase, aplica SÓ
//                    a migration pendente esperada e roda `after`.
//   --fase=conferir  só leitura: `--esperado=before` ou `--esperado=after`
//                    (padrão). Em `after`, mostra também o que uma reversão
//                    apagaria.
//
// Ambiente (o lançador abrir-contas-piloto.ps1 define): PILOT_ENDPOINT_ID,
// PRODUCTION_ENDPOINT_ID, PG_BIN e AGENDA_OPS_DIR (fora do repositório).
// Antes, `npm run build:migrations-runtime` e
// `npm run build:guarded-migration-scripts` (o lançador faz).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { rootCertificates } from "node:tls";
import { homedir, userInfo } from "node:os";
import path from "node:path";
import { MOTIVOS, Parada, conferirConfirmacao, lerConfirmacao, lerOculto } from "./entrada-oculta.mjs";
import {
  BANCO_PILOTO,
  FORMATO_ENDPOINT_ID,
  RAIZ_DO_REPOSITORIO,
  ambienteLibpq,
  aplicarSomenteAPendente,
  clienteConferido,
  compararFotografias,
  conectar,
  conferirDestino,
  encerrar,
  encerrarTodas,
  errosDeConexao,
  fotografar,
  parar,
  pastaForaDoRepositorio,
  registrar,
  rodar,
  sha256DoArquivo,
} from "./operacao-piloto.mjs";

const MIGRATION = "AccountsAdministration1792800000000";
const FRASE = `APLICAR ${MIGRATION}`;
const VALIDADE_DO_BACKUP_CONFERIDO_MS = 24 * 60 * 60 * 1000;
const ENDPOINT_PILOTO = (process.env.PILOT_ENDPOINT_ID ?? "").trim();
const ENDPOINT_PROIBIDO = (process.env.PRODUCTION_ENDPOINT_ID ?? "").trim();
const PG_BIN = process.env.PG_BIN ?? "C:/Program Files/PostgreSQL/18/bin";
const PASTA = process.env.AGENDA_OPS_DIR ?? path.join(homedir(), "AgendaCloud-operacoes");
const REGISTRO = path.join(PASTA, "operacoes.jsonl");

const argumentos = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [chave, ...valor] = a.replace(/^--/, "").split("=");
    return [chave, valor.join("=")];
  }),
);
const FASE = argumentos.fase;
const ESPERADO = argumentos.esperado ?? "after";

const inicio = new Date();
const carimbo = inicio.toISOString().replace(/[:.]/g, "-");
const log = (linha) => console.log(linha);
let podeRegistrar = false;
let base = {};

function commitAtual() {
  const git = (args) => execFileSync("git", args, { cwd: RAIZ_DO_REPOSITORIO, encoding: "utf8" }).trim();
  const sha = git(["rev-parse", "HEAD"]);
  // Só o backend importa para a migration; a raiz pode ter alterações locais.
  const sujo = git(["status", "--porcelain", "--", "backend"]) !== "";
  return { sha, sujo };
}

async function carregarConferencia() {
  try {
    const conferencia = await import("../dist-scripts/lib/pilot-database-check.js");
    const schema = await import("../dist-scripts/lib/contas-administracao-schema.js");
    await import("../dist-migrations/database/migrations-data-source.js");
    return { checkPilotDatabase: conferencia.checkPilotDatabase, ...schema };
  } catch {
    return parar("ERR_BUILD_AUSENTE");
  }
}

/** `before-accounts-administration` / `after-accounts-administration`, a mesma
 * conferência do `npm run pilot:check-database`, com o TLS do socket conferido. */
async function conferirModo(destino, modo, checkPilotDatabase) {
  log(`--- PILOT_EXPECT=${modo}`);
  const resultado = await checkPilotDatabase({
    env: {
      PILOT_EXPECT: modo,
      PILOT_DIRECT_URL: destino.url,
      PILOT_ENDPOINT_ID: ENDPOINT_PILOTO,
      PRODUCTION_ENDPOINT_ID: ENDPOINT_PROIBIDO,
    },
    createClient: async () => clienteConferido(destino, { aplicacao: "agenda-cloud-conferencia-contas", log }),
    log,
  });
  log(`RESULT: ${resultado.success ? "SUCCESS" : "FAILURE"}${resultado.code ? ` (${resultado.code})` : ""}`);
  return resultado.success;
}

/** Backup no mesmo snapshot da fotografia (contagens e md5 por tabela). */
async function fazerBackup(destino, pastaExecucao, extras) {
  const leitor = await conectar(destino, { aplicacao: "agenda-cloud-backup-contas", log });
  try {
    await leitor.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const [{ snapshot }] = (await leitor.query("SELECT pg_export_snapshot() AS snapshot")).rows;
    const fotografia = await fotografar(leitor);
    const [{ versao }] = (await leitor.query("SELECT current_setting('server_version') AS versao")).rows;
    const migrations = (await leitor.query("SELECT name FROM typeorm_migrations ORDER BY id")).rows.map((r) => r.name);
    mkdirSync(pastaExecucao, { recursive: true });
    const raizes = path.join(pastaExecucao, "raizes-tls-node.pem");
    writeFileSync(raizes, rootCertificates.join("\n"));
    const dump = path.join(pastaExecucao, "piloto-neondb.dump");
    log("BACKUP: executando pg_dump -Fc ...");
    const { codigo, stderr } = await rodar(
      path.join(PG_BIN, "pg_dump.exe"),
      ["-Fc", "--no-password", `--snapshot=${snapshot}`, "-f", dump],
      ambienteLibpq(destino, raizes, "agenda-cloud-backup-contas"),
    );
    if (codigo !== 0) {
      log(`DETALHE: pg_dump saiu com ${codigo}: ${stderr.slice(0, 400)}`);
      parar("ERR_BACKUP_FALHOU");
    }
    const bytes = statSync(dump).size;
    if (bytes === 0) parar("ERR_BACKUP_VAZIO");
    const sha256 = sha256DoArquivo(dump);
    const manifesto = {
      ...base,
      ...extras,
      pontoDeRecuperacao: new Date().toISOString(),
      servidor: versao,
      migrations,
      ...fotografia,
      backup: { arquivo: path.basename(dump), bytes, sha256 },
    };
    writeFileSync(path.join(pastaExecucao, "manifesto.json"), JSON.stringify(manifesto, null, 2));
    await leitor.query("COMMIT");
    log(`BACKUP_OK: ${bytes} bytes sha256=${sha256.slice(0, 16)}... tabelas=${Object.keys(fotografia.contagens).length}`);
    log(`PASTA_DO_BACKUP: ${pastaExecucao}`);
    return manifesto;
  } finally {
    await encerrar(leitor);
  }
}

/** Backup mais recente da fase `preparar` cuja restauração foi conferida. */
function backupConferido(commit) {
  const pastas = existsSync(PASTA)
    ? readdirSync(PASTA)
        .filter((n) => n.startsWith("contas-preparar-"))
        .sort()
        .reverse()
    : [];
  for (const nome of pastas) {
    const pasta = path.join(PASTA, nome);
    const arqConferencia = path.join(pasta, "restauracao-conferida.json");
    if (!existsSync(arqConferencia)) continue;
    const manifesto = JSON.parse(readFileSync(path.join(pasta, "manifesto.json"), "utf8"));
    const conferencia = JSON.parse(readFileSync(arqConferencia, "utf8"));
    const motivos = [];
    if (conferencia.resultado !== "restauracao_e_ensaio_ok") motivos.push("conferência sem sucesso");
    if (conferencia.sha256 !== manifesto.backup?.sha256) motivos.push("sha256 diferente");
    if (sha256DoArquivo(path.join(pasta, manifesto.backup.arquivo)) !== manifesto.backup.sha256) motivos.push("dump alterado");
    if (manifesto.endpoint !== ENDPOINT_PILOTO) motivos.push("outro endpoint");
    if (manifesto.commit !== commit) motivos.push("outro commit");
    if (Date.now() - Date.parse(manifesto.pontoDeRecuperacao) > VALIDADE_DO_BACKUP_CONFERIDO_MS) motivos.push("mais de 24 h");
    log(`BACKUP_CONFERIDO: ${nome} ${motivos.length === 0 ? "ok" : `recusado (${motivos.join(", ")})`}`);
    if (motivos.length === 0) return { nome, manifesto };
    return null;
  }
  log("BACKUP_CONFERIDO: nenhum");
  return null;
}

/** Só leitura: o que `migration:revert` apagaria se fosse executado agora. */
async function avaliarReversao(destino) {
  const client = await conectar(destino, { aplicacao: "agenda-cloud-conferencia-contas", log });
  try {
    await client.query("BEGIN TRANSACTION READ ONLY");
    const [r] = (
      await client.query(`SELECT
        (SELECT count(*)::int FROM invites) AS convites,
        (SELECT count(*)::int FROM invites WHERE status = 'PENDING') AS "convitesPendentes",
        (SELECT count(*)::int FROM invites WHERE status = 'ACCEPTED') AS "convitesAceitos",
        (SELECT count(*)::int FROM password_resets) AS redefinicoes,
        (SELECT count(*)::int FROM audit_logs WHERE target_user_id IS NOT NULL) AS "historicoComAlvo",
        (SELECT count(*)::int FROM audit_logs WHERE action::text = ANY($1)) AS "historicoAcoesNovas",
        (SELECT count(*)::int FROM sessions WHERE reauthenticated_at IS NOT NULL) AS "sessoesReautenticadas"`,
      [
        [
          "USER_UPDATED",
          "USER_BLOCKED",
          "USER_REACTIVATED",
          "INVITE_RESENT",
          "INVITE_REVOKED",
          "INVITE_ACCEPTED",
          "MEMBERSHIP_REMOVED",
          "PASSWORD_RESET_REQUESTED",
          "PASSWORD_RESET_COMPLETED",
          "PLATFORM_ACCESS_CHANGED",
        ],
      ])
    ).rows;
    await client.query("ROLLBACK");
    log("--- O que migration:revert apagaria ou deixaria órfão (só leitura):");
    for (const [k, v] of Object.entries(r)) log(`REVERSAO_AFETARIA_${k}: ${v}`);
    log(
      "REVERSAO_NOTA: revert remove colunas e a tabela password_resets; contas, vínculos e o histórico em si continuam, mas os valores novos do enum ficam e a API nova deixa de funcionar.",
    );
  } finally {
    await encerrar(client);
  }
}

async function principal() {
  log(`Publicação de ${MIGRATION} no piloto Agenda-Cloud`);
  if (!["preparar", "aplicar", "conferir"].includes(FASE)) parar("ERR_FASE_INVALIDA");
  if (FASE === "conferir" && !["before", "after"].includes(ESPERADO)) parar("ERR_ESPERADO_INVALIDO");
  log(`FASE: ${FASE}${FASE === "conferir" ? ` (${ESPERADO})` : ""}`);
  if (!FORMATO_ENDPOINT_ID.test(ENDPOINT_PILOTO) || !FORMATO_ENDPOINT_ID.test(ENDPOINT_PROIBIDO)) parar("ERR_ENDPOINT_IDS_AUSENTES");
  if (ENDPOINT_PILOTO === ENDPOINT_PROIBIDO) parar("ERR_PILOTO_IGUAL_AO_PROIBIDO");
  if (FASE !== "conferir" && !existsSync(path.join(PG_BIN, "pg_dump.exe"))) parar("ERR_PG_DUMP_AUSENTE");
  if (!pastaForaDoRepositorio(PASTA)) parar("ERR_PASTA_DE_OPERACOES_DENTRO_DO_REPOSITORIO");
  const { sha, sujo } = commitAtual();
  log(`COMMIT: ${sha}${sujo ? " (backend com alterações locais)" : ""}`);
  if (sujo && FASE !== "conferir") parar("ERR_BACKEND_COM_ALTERACOES_LOCAIS");
  const { checkPilotDatabase, MIGRATIONS_ATE_WEB_PUSH, MIGRATION_CONTAS } = await carregarConferencia();
  if (MIGRATION_CONTAS !== MIGRATION) parar("ERR_BUILD_DESATUALIZADO");
  podeRegistrar = true;
  mkdirSync(PASTA, { recursive: true });
  base = {
    operacao: `migration_${MIGRATION}`,
    fase: FASE,
    iniciadaEm: inicio.toISOString(),
    endpoint: ENDPOINT_PILOTO,
    banco: BANCO_PILOTO,
    commit: sha,
    operador: `conta Windows local '${userInfo().username}' via script; sem ator autenticado na aplicação`,
  };

  let conferido = null;
  if (FASE === "aplicar") {
    conferido = backupConferido(sha);
    if (!conferido) parar("ERR_SEM_BACKUP_COM_RESTAURACAO_CONFERIDA");
  }

  const destino = conferirDestino(await lerOculto("URL direta do piloto (oculta): "), {
    endpointPiloto: ENDPOINT_PILOTO,
    endpointProibido: ENDPOINT_PROIBIDO,
  });
  log("DESTINO_ENDPOINT_PILOTO: true");
  log("DIFERENTE_DO_PROIBIDO: true");
  log(`BANCO: ${BANCO_PILOTO}`);

  if (FASE === "conferir") {
    const modo = `${ESPERADO}-accounts-administration`;
    const ok = await conferirModo(destino, modo, checkPilotDatabase);
    if (ok && ESPERADO === "after") await avaliarReversao(destino);
    registrar(REGISTRO, { ...base, esperado: modo, resultado: ok ? "conferido" : "divergente", concluidaEm: new Date().toISOString() });
    log(`RESULTADO: ${ok ? `estado ${modo} confirmado` : "estado diferente do esperado — nada foi alterado"}`);
    if (!ok) process.exitCode = 1;
    return;
  }

  if (!(await conferirModo(destino, "before-accounts-administration", checkPilotDatabase))) {
    parar("ERR_ESTADO_ANTES_DIVERGENTE");
  }

  const pastaExecucao = path.join(PASTA, `contas-${FASE}-${carimbo}`);
  const manifesto = await fazerBackup(destino, pastaExecucao, {
    esperado: "before-accounts-administration",
    ...(conferido ? { backupConferido: conferido.nome } : {}),
  });

  if (FASE === "preparar") {
    registrar(REGISTRO, { ...base, resultado: "backup_feito", backup: { pasta: path.basename(pastaExecucao), ...manifesto.backup }, concluidaEm: new Date().toISOString() });
    log("RESULTADO: preparado, nada gravado no piloto");
    log(`PROXIMO_PASSO: conferir a restauração (fase restauracao do lançador) da pasta ${path.basename(pastaExecucao)}`);
    return;
  }

  // Fase aplicar: frase exata, lida em modo raw.
  let motivo = null;
  try {
    motivo = conferirConfirmacao(await lerConfirmacao(`Para aplicar, digite exatamente "${FRASE}": `), FRASE);
  } catch (erro) {
    if (!(erro instanceof Parada && erro.message === "ERR_CONFIRMACAO_MAIS_DE_UMA_LINHA")) throw erro;
    motivo = erro.message;
  }
  if (motivo) {
    registrar(REGISTRO, { ...base, resultado: "abortado_sem_confirmacao", motivo, backup: manifesto.backup, concluidaEm: new Date().toISOString() });
    log(`MOTIVO: ${MOTIVOS[motivo]}`);
    log("RESULTADO: abortado, nada gravado");
    return;
  }

  let aplicadaEm;
  try {
    await aplicarSomenteAPendente(destino, {
      esperadasAntes: [...MIGRATIONS_ATE_WEB_PUSH],
      pendente: MIGRATION,
      aplicacao: "agenda-cloud-migration-contas",
      log,
    });
    aplicadaEm = new Date().toISOString();
    log("COMMIT: ok");
  } catch (erro) {
    // A migration roda numa transação: numa falha, o esperado é o estado
    // anterior intacto. Confere em vez de supor.
    log(`ERRO_NA_MIGRATION: ${erro instanceof Parada ? erro.message : `${erro?.code ?? ""} ${String(erro?.message ?? erro).slice(0, 300)}`}`);
    const intacto = await conferirModo(destino, "before-accounts-administration", checkPilotDatabase).catch(() => false);
    log(`ESTADO_APOS_FALHA: ${intacto ? "before intacto (nada aplicado)" : "NÃO confirmado — rode a fase conferir com before e com after"}`);
    registrar(REGISTRO, { ...base, resultado: "migration_falhou", estadoAnteriorIntacto: intacto, backup: manifesto.backup, concluidaEm: new Date().toISOString() });
    parar("ERR_MIGRATION_FALHOU");
  }

  const depoisOk = await conferirModo(destino, "after-accounts-administration", checkPilotDatabase);
  // Informativo: a API atual continua no ar e pode gravar durante a operação.
  const leitor = await conectar(destino, { aplicacao: "agenda-cloud-conferencia-contas", log });
  let comparacao;
  try {
    await leitor.query("BEGIN TRANSACTION READ ONLY");
    comparacao = compararFotografias(manifesto, await fotografar(leitor), {
      ignorarSomas: Object.keys(manifesto.contagens),
      ignorarTabelas: ["typeorm_migrations"],
      novasPermitidas: ["password_resets"],
    });
    await leitor.query("ROLLBACK");
  } finally {
    await encerrar(leitor);
  }
  log(`CONTAGENS_DESDE_O_BACKUP: ${comparacao.iguais ? "iguais" : `mudaram em ${comparacao.contagensDiferentes.join(",") || "-"} (uso normal do piloto durante a operação)`}`);
  if (comparacao.ausentes.length || comparacao.sobrando.length) log(`TABELAS_INESPERADAS: ausentes=${comparacao.ausentes.join(",") || "-"} novas=${comparacao.sobrando.join(",") || "-"}`);
  registrar(REGISTRO, {
    ...base,
    resultado: depoisOk ? "aplicada_e_conferida" : "aplicada_com_divergencia_na_conferencia",
    aplicadaEm,
    backup: { pasta: path.basename(pastaExecucao), ...manifesto.backup },
    concluidaEm: new Date().toISOString(),
  });
  log(`RESULTADO: ${depoisOk ? `${MIGRATION} aplicada e conferida` : "aplicada, mas a conferência after divergiu — investigar antes de publicar"}`);
  if (!depoisOk) process.exitCode = 2;
}

principal()
  .catch((erro) => {
    const codigo = erro instanceof Parada ? erro.message : "ERR_INESPERADO";
    log(`ERRO: ${codigo}`);
    if (MOTIVOS[codigo]) log(`MOTIVO: ${MOTIVOS[codigo]}`);
    if (!(erro instanceof Parada)) log(`DETALHE: ${erro?.code ? `${erro.code} ` : ""}${String(erro?.message ?? erro).slice(0, 300)}`);
    for (const e of errosDeConexao) log(`ORIGEM: conexão encerrada antes (${e?.code ?? "sem código"})`);
    if (podeRegistrar) {
      try {
        registrar(REGISTRO, { ...base, resultado: "falhou", codigo, codigoDriver: erro?.code ?? null, conexoesEncerradas: errosDeConexao.map((e) => e?.code ?? null), concluidaEm: new Date().toISOString() });
      } catch {
        // O erro original é o que importa.
      }
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await encerrarTodas();
    process.stdin.pause();
  });
