// Publicação de PlatformPortal1793318400000 e
// AppointmentServiceSnapshots1793404800000 no banco do piloto, em fases
// executadas à mão (ver docs/runbooks/publicacao-portal-multisservicos-piloto.md).
// Não é rota nem parte do deploy. A URL direta é digitada oculta e nunca vem
// de variável, arquivo ou argumento. Mesmo procedimento de CommercialAccess
// (aplicar-comercial-piloto.mjs), com as peças comuns de operacao-piloto.mjs,
// em duas ETAPAS (portal-multisservicos-piloto.mjs), uma migration por vez.
//
//   --fase=preparar --etapa=E  só leitura: destino, TLS, o estado "antes" da
//                              etapa, levantamento (registros comerciais,
//                              reservas, recebimentos, contas com papel
//                              global) e backup (pg_dump -Fc no mesmo
//                              snapshot das contagens e md5 por tabela).
//   --fase=aplicar --etapa=E   exige um backup da fase `preparar` DESTA etapa
//                              com a restauração conferida
//                              (conferir-restauracao-portal-multisservicos.mjs)
//                              do mesmo destino, modo e commit. Repete
//                              destino, TLS, estado e levantamento, faz um
//                              backup novo, pede a frase, aplica SÓ a
//                              migration da etapa e confere o estado "depois".
//   --fase=conferir            só leitura: identifica o estado (antes,
//                              intermediário, final ou divergente), sessões de
//                              migration ativas, o levantamento e o que uma
//                              reversão apagaria.
//
// Ambiente (o lançador abrir-portal-multisservicos-piloto.ps1 define):
// AGENDA_OPS_MODO (piloto|ensaio), PILOT_ENDPOINT_ID, PRODUCTION_ENDPOINT_ID,
// PG_BIN e AGENDA_OPS_DIR (fora do repositório); no ensaio, também
// AGENDA_ENSAIO_CA e AGENDA_ENSAIO_ENDERECO (ver equipe-piloto.mjs).
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
  conferirTransporte,
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
import {
  APLICACOES_DAS_MIGRATIONS,
  ESTADOS,
  ESTADO_FINAL,
  ESTADO_INTERMEDIARIO,
  MIGRATION_NOMES_CONGELADOS,
  MIGRATION_PORTAL,
  OPERACAO_CONFERIR,
  avaliarBackupConferido,
  classificarFalha,
  codigoDeErroConhecido,
  compararServidores,
  conferirContas,
  conferirModo as conferirModoDeExecucao,
  decidirAplicacao,
  destinoDoModo,
  escolherEtapa,
  execucaoPendente,
  identificarEstado,
  lerRegistros,
} from "./portal-multisservicos-piloto.mjs";

const MODO = (process.env.AGENDA_OPS_MODO ?? "").trim();
const ENDPOINT_PILOTO = (process.env.PILOT_ENDPOINT_ID ?? "").trim();
const ENDPOINT_PROIBIDO = (process.env.PRODUCTION_ENDPOINT_ID ?? "").trim();
const PG_BIN = process.env.PG_BIN ?? "C:/Program Files/PostgreSQL/18/bin";
const PASTA = process.env.AGENDA_OPS_DIR ?? path.join(homedir(), "AgendaCloud-operacoes");
const REGISTRO = path.join(PASTA, "operacoes.jsonl");
const APLICACAO_DE_LEITURA = "agenda-cloud-conferencia-portal-multisservicos";

const argumentos = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [chave, ...valor] = a.replace(/^--/, "").split("=");
    return [chave, valor.join("=")];
  }),
);
const FASE = argumentos.fase;

const inicio = new Date();
const carimbo = inicio.toISOString().replace(/[:.]/g, "-");
const log = (linha) => console.log(linha);
let podeRegistrar = false;
let base = {};
let ensaio = null;

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
    const schema = await import("../dist-scripts/lib/portal-multisservicos-schema.js");
    await import("../dist-migrations/database/migrations-data-source.js");
    return { checkPilotDatabase: conferencia.checkPilotDatabase, ...schema };
  } catch {
    return parar("ERR_BUILD_AUSENTE");
  }
}

/** Uma das três conferências (a mesma do `npm run pilot:check-database`),
 * com o TLS do socket conferido. */
async function conferirComCodigo(destino, esperado, checkPilotDatabase) {
  log(`--- PILOT_EXPECT=${esperado}`);
  const resultado = await checkPilotDatabase({
    env: {
      PILOT_EXPECT: esperado,
      PILOT_DIRECT_URL: destino.url,
      PILOT_ENDPOINT_ID: ENDPOINT_PILOTO,
      PRODUCTION_ENDPOINT_ID: ENDPOINT_PROIBIDO,
    },
    createClient: async () => clienteConferido(destino, { aplicacao: APLICACAO_DE_LEITURA, log }),
    log,
  });
  log(`RESULT: ${resultado.success ? "SUCCESS" : "FAILURE"}${resultado.code ? ` (${resultado.code})` : ""}`);
  return resultado;
}

const conferirEsperado = async (destino, esperado, checkPilotDatabase) =>
  (await conferirComCodigo(destino, esperado, checkPilotDatabase)).success;

/** As três conferências e o estado identificado. */
async function identificar(destino, schema) {
  const resultados = {};
  const codigos = [];
  for (const esperado of ESTADOS) {
    const r = await conferirComCodigo(destino, esperado, schema.checkPilotDatabase);
    resultados[esperado] = r.success;
    codigos.push(r.code);
  }
  return identificarEstado({ resultados, codigos });
}

/** Levantamento só-leitura (portal-multisservicos-schema.ts). Só ids,
 * papéis, situações e contagens. */
async function levantarImpacto(destino, schema) {
  const client = await conectar(destino, { aplicacao: APLICACAO_DE_LEITURA, log });
  try {
    log("--- Registros comerciais, reservas, recebimentos e contas com papel global (só leitura; nada é alterado)");
    const impacto = await schema.lerImpactoPortalMultisservicos(client);
    for (const linha of schema.descreverImpactoPortalMultisservicos(impacto)) log(linha);
    return impacto;
  } finally {
    await encerrar(client);
  }
}

/** Backup no mesmo snapshot da fotografia (contagens e md5 por tabela). */
async function fazerBackup(destino, etapa, pastaExecucao, extras) {
  const aplicacao = `agenda-cloud-backup-${etapa.nome}`;
  const leitor = await conectar(destino, { aplicacao, log });
  try {
    const { protocolo, cadeia } = conferirTransporte(leitor.connection?.stream, destino.servidorTls);
    await leitor.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const [{ snapshot }] = (await leitor.query("SELECT pg_export_snapshot() AS snapshot")).rows;
    const fotografia = await fotografar(leitor);
    const [{ versao }] = (await leitor.query("SELECT current_setting('server_version') AS versao")).rows;
    const migrations = (await leitor.query("SELECT name FROM typeorm_migrations ORDER BY id")).rows.map((r) => r.name);
    mkdirSync(pastaExecucao, { recursive: true });
    // Piloto: as raízes públicas do Node, as mesmas que aceitaram o socket.
    // Ensaio: só a CA descartável.
    const raizes = ensaio ? ensaio.caArquivo : path.join(pastaExecucao, "raizes-tls-node.pem");
    if (!ensaio) writeFileSync(raizes, rootCertificates.join("\n"));
    const dump = path.join(pastaExecucao, "piloto-neondb.dump");
    log("BACKUP: executando pg_dump -Fc ...");
    const { codigo, stderr } = await rodar(
      path.join(PG_BIN, "pg_dump.exe"),
      ["-Fc", "--no-password", `--snapshot=${snapshot}`, "-f", dump],
      ambienteLibpq(destino, raizes, aplicacao),
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
      tls: { protocolo, cadeia },
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

/** Backup mais recente da fase `preparar` desta etapa cuja restauração foi
 * conferida. */
function backupConferido(etapa, commit) {
  const pastas = existsSync(PASTA)
    ? readdirSync(PASTA)
        .filter((n) => n.startsWith(`${etapa.prefixoDasPastas}preparar-`))
        .sort()
        .reverse()
    : [];
  for (const nome of pastas) {
    const pasta = path.join(PASTA, nome);
    const arqConferencia = path.join(pasta, "restauracao-conferida.json");
    if (!existsSync(arqConferencia)) continue;
    let motivos;
    let conferido = null;
    try {
      const manifesto = JSON.parse(readFileSync(path.join(pasta, "manifesto.json"), "utf8"));
      const conferencia = JSON.parse(readFileSync(arqConferencia, "utf8"));
      const dump = path.join(pasta, path.basename(String(manifesto.backup?.arquivo ?? "")));
      conferido = { nome, manifesto };
      motivos = avaliarBackupConferido(etapa, {
        manifesto,
        conferencia,
        sha256DoDump: existsSync(dump) ? sha256DoArquivo(dump) : "ausente",
        sha256DoManifesto: sha256DoArquivo(path.join(pasta, "manifesto.json")),
        commit,
        endpoint: ENDPOINT_PILOTO,
        modo: MODO,
        agora: Date.now(),
      });
    } catch {
      motivos = ["manifesto ou conferência ilegível"];
    }
    log(`BACKUP_CONFERIDO: ${nome} ${motivos.length === 0 ? "ok" : `recusado (${motivos.join(", ")})`}`);
    return motivos.length === 0 ? conferido : null;
  }
  log("BACKUP_CONFERIDO: nenhum");
  return null;
}

function registrosAnteriores() {
  return existsSync(REGISTRO) ? lerRegistros(readFileSync(REGISTRO, "utf8")) : [];
}

/** Só leitura: sessões de qualquer das duas migrations ainda ativas. É a
 * primeira conexão da fase `conferir`: se ela falhar, nenhum estado é
 * concluído. */
async function contarSessoesDasMigrations(destino) {
  const client = await conectar(destino, { aplicacao: APLICACAO_DE_LEITURA, log });
  try {
    const [{ sessoes }] = (
      await client.query(
        "SELECT count(*)::int AS sessoes FROM pg_stat_activity WHERE application_name = ANY($1) AND pid <> pg_backend_pid()",
        [APLICACOES_DAS_MIGRATIONS],
      )
    ).rows;
    log(`SESSOES_DAS_MIGRATIONS_ATIVAS: ${sessoes}`);
    return sessoes;
  } finally {
    await encerrar(client);
  }
}

/** Só leitura: o que um `migration:revert` apagaria. */
async function avaliarReversao(destino, schema) {
  const client = await conectar(destino, { aplicacao: APLICACAO_DE_LEITURA, log });
  try {
    log("--- O que migration:revert apagaria (só leitura):");
    for (const [k, v] of Object.entries(await schema.lerEfeitoDaReversao(client))) log(`REVERSAO_AFETARIA_${k}: ${v}`);
    log("REVERSAO_NOTA: não use revert; ver a seção Recuperação do runbook.");
  } finally {
    await encerrar(client);
  }
}

const ROTULO = {
  [ESTADOS[0]]: `antes (12 migrations; ${MIGRATION_PORTAL} e ${MIGRATION_NOMES_CONGELADOS} NÃO aplicadas)`,
  [ESTADO_INTERMEDIARIO]: `INTERMEDIÁRIO (13 migrations; ${MIGRATION_PORTAL} aplicada, ${MIGRATION_NOMES_CONGELADOS} pendente; não publique a API nova)`,
  [ESTADO_FINAL]: "final (14 migrations; as duas aplicadas e conferidas; a API nova pode ser publicada)",
};

async function faseConferir(destino, schema) {
  const sessoes = await contarSessoesDasMigrations(destino);
  const estado = await identificar(destino, schema);
  log(`ESTADO: ${estado}`);
  if (estado === "nao_identificado") parar("ERR_CONFERENCIA_SEM_LEITURA");
  if (estado === ESTADO_INTERMEDIARIO || estado === ESTADO_FINAL) await avaliarReversao(destino, schema);
  await levantarImpacto(destino, schema);
  registrar(REGISTRO, { ...base, estado, sessoesDaMigration: sessoes, concluidaEm: new Date().toISOString() });
  if (sessoes > 0) {
    log("RESULTADO: há uma sessão de migration ainda ativa no banco; espere alguns minutos e rode conferir de novo");
  } else if (ROTULO[estado]) {
    log(`RESULTADO: estado ${ROTULO[estado]}`);
  } else {
    log("RESULTADO: estado divergente (nenhum dos três); não aplique nem publique; investigar");
  }
  if (estado === "divergente" || sessoes > 0) process.exitCode = 1;
}

async function faseAplicar(destino, etapa, schema, manifesto, pastaExecucao) {
  let motivo = null;
  try {
    motivo = conferirConfirmacao(await lerConfirmacao(`Para aplicar, digite exatamente "${etapa.frase}": `), etapa.frase);
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

  // Registrado ANTES do primeiro comando: se a janela fechar no meio, a
  // próxima fase `aplicar` (de qualquer etapa) encontra a execução sem
  // desfecho e para.
  registrar(REGISTRO, { ...base, resultado: "migration_iniciada", backup: { pasta: path.basename(pastaExecucao), ...manifesto.backup } });
  let iniciou = false;
  const esperadasAntes = etapa.nome === "portal" ? schema.MIGRATIONS_ATE_COMERCIAL : schema.MIGRATIONS_ATE_PORTAL;
  try {
    await aplicarSomenteAPendente(destino, {
      esperadasAntes: [...esperadasAntes],
      pendente: etapa.migration,
      posteriores: etapa.posteriores,
      aplicacao: etapa.aplicacao,
      log,
      aoIniciar: () => {
        iniciou = true;
      },
    });
  } catch (erro) {
    const tipo = classificarFalha(erro, { iniciou });
    log(`ERRO_NA_MIGRATION: ${erro instanceof Parada ? erro.message : `${erro?.code ?? ""} ${String(erro?.message ?? erro).slice(0, 300)}`}`);
    for (const e of errosDeConexao) log(`ORIGEM: conexão encerrada (${e?.code ?? "sem código"})`);
    if (tipo === "nada_aplicado") {
      log("ESTADO_APOS_FALHA: a migration não começou; nada foi enviado ao banco");
      registrar(REGISTRO, { ...base, resultado: "nao_aplicada", motivo: "falha_antes_de_iniciar", concluidaEm: new Date().toISOString() });
      return parar(erro instanceof Parada ? erro.message : "ERR_MIGRATION_NAO_INICIADA");
    }
    if (tipo === "recusada_pelo_banco") {
      // O servidor recusou um comando numa sessão viva: a transação abortou.
      // Ainda assim confere em vez de supor.
      const intacto = await conferirEsperado(destino, etapa.esperadoAntes, schema.checkPilotDatabase).catch(() => false);
      if (intacto) {
        log(`ESTADO_APOS_FALHA: ${etapa.esperadoAntes} intacto; o banco recusou e desfez a transação (nada aplicado)`);
        registrar(REGISTRO, { ...base, resultado: "nao_aplicada", motivo: erro?.code ?? null, concluidaEm: new Date().toISOString() });
        return parar("ERR_MIGRATION_FALHOU");
      }
    }
    log("ESTADO_APOS_FALHA: INCERTO; a conexão caiu ou o estado não foi confirmado depois do início da migration");
    log("NAO_REPITA: não rode aplicar de novo; rode a fase conferir para saber se a migration entrou");
    registrar(REGISTRO, { ...base, resultado: "resultado_incerto", codigoDriver: erro?.code ?? null, concluidaEm: new Date().toISOString() });
    return parar("ERR_RESULTADO_INCERTO");
  }

  // Daqui em diante a migration ESTÁ gravada (COMMIT confirmado pelo banco).
  const aplicadaEm = new Date().toISOString();
  registrar(REGISTRO, { ...base, resultado: "aplicada", aplicadaEm });
  log("COMMIT: ok");
  log(`MIGRATION_APLICADA: ${etapa.migration} em ${aplicadaEm}`);
  let depoisOk = false;
  try {
    depoisOk = await conferirEsperado(destino, etapa.esperadoDepois, schema.checkPilotDatabase);
    // Informativo: a API atual continua no ar e pode gravar durante a operação.
    const leitor = await conectar(destino, { aplicacao: APLICACAO_DE_LEITURA, log });
    try {
      await leitor.query("BEGIN TRANSACTION READ ONLY");
      const comparacao = compararFotografias(manifesto, await fotografar(leitor), {
        ignorarSomas: Object.keys(manifesto.contagens),
        ignorarTabelas: ["typeorm_migrations"],
        novasPermitidas: etapa.tabelasNovas,
      });
      await leitor.query("ROLLBACK");
      log(
        `CONTAGENS_DESDE_O_BACKUP: ${comparacao.iguais ? "iguais" : `mudaram em ${comparacao.contagensDiferentes.join(",") || "-"} (uso normal do piloto durante a operação, não é perda)`}`,
      );
      if (comparacao.ausentes.length || comparacao.sobrando.length) {
        log(`TABELAS_INESPERADAS: ausentes=${comparacao.ausentes.join(",") || "-"} novas=${comparacao.sobrando.join(",") || "-"}`);
      }
    } finally {
      await encerrar(leitor);
    }
    await levantarImpacto(destino, schema);
  } catch (erro) {
    log(`CONFERENCIA_POSTERIOR_ERRO: ${erro instanceof Parada ? erro.message : `${erro?.code ?? ""} ${String(erro?.message ?? erro).slice(0, 200)}`}`);
    depoisOk = false;
  }
  registrar(REGISTRO, {
    ...base,
    resultado: depoisOk ? "aplicada_e_conferida" : "aplicada_conferencia_posterior_falhou",
    aplicadaEm,
    backup: { pasta: path.basename(pastaExecucao), ...manifesto.backup },
    concluidaEm: new Date().toISOString(),
  });
  if (depoisOk) {
    log(`ESTADO: ${etapa.esperadoDepois}`);
    log(`RESULTADO: ${etapa.migration} aplicada e conferida; estado ${ROTULO[etapa.esperadoDepois]}`);
    if (etapa.esperadoDepois === ESTADO_INTERMEDIARIO) log("PROXIMO_PASSO: etapa multisservicos (preparar, restauracao, aplicar); a API e o web atuais continuam no ar");
  } else {
    log(`RESULTADO: ${etapa.migration} FOI APLICADA (COMMIT confirmado), mas a conferência posterior falhou`);
    log("NAO_REPITA: não rode aplicar de novo; rode a fase conferir antes de qualquer outro passo");
    process.exitCode = 2;
  }
}

async function principal() {
  log("Publicação de PlatformPortal1793318400000 e AppointmentServiceSnapshots1793404800000 no piloto Agenda-Cloud");
  if (!["preparar", "aplicar", "conferir"].includes(FASE)) parar("ERR_FASE_INVALIDA");
  const etapa = FASE === "conferir" ? null : escolherEtapa(argumentos.etapa);
  if (!FORMATO_ENDPOINT_ID.test(ENDPOINT_PILOTO) || !FORMATO_ENDPOINT_ID.test(ENDPOINT_PROIBIDO)) parar("ERR_ENDPOINT_IDS_AUSENTES");
  if (ENDPOINT_PILOTO === ENDPOINT_PROIBIDO) parar("ERR_PILOTO_IGUAL_AO_PROIBIDO");
  ensaio = conferirModoDeExecucao({ modo: MODO, env: process.env, execArgv: process.execArgv, endpointPiloto: ENDPOINT_PILOTO });
  if (ensaio && !existsSync(ensaio.caArquivo)) parar("ERR_ENSAIO_SEM_CA");
  log(`MODO: ${MODO === "ensaio" ? "ENSAIO (PostgreSQL descartável local; nada é feito no piloto)" : "PILOTO (Neon real)"}`);
  log(`FASE: ${FASE}`);
  if (etapa) log(`ETAPA: ${etapa.nome} (${etapa.migration}: ${etapa.esperadoAntes} -> ${etapa.esperadoDepois})`);
  if (FASE !== "conferir" && !existsSync(path.join(PG_BIN, "pg_dump.exe"))) parar("ERR_PG_DUMP_AUSENTE");
  if (!pastaForaDoRepositorio(PASTA)) parar("ERR_PASTA_DE_OPERACOES_DENTRO_DO_REPOSITORIO");
  log(`PASTA_DE_OPERACOES: ${PASTA}`);
  const { sha, sujo } = commitAtual();
  log(`COMMIT: ${sha}${sujo ? " (backend com alterações locais)" : ""}`);
  if (sujo && FASE !== "conferir") parar("ERR_BACKEND_COM_ALTERACOES_LOCAIS");
  const schema = await carregarConferencia();
  if (schema.MIGRATION_PORTAL !== MIGRATION_PORTAL || schema.MIGRATION_NOMES_CONGELADOS !== MIGRATION_NOMES_CONGELADOS) {
    parar("ERR_BUILD_DESATUALIZADO");
  }
  podeRegistrar = true;
  mkdirSync(PASTA, { recursive: true });
  base = {
    operacao: etapa ? etapa.operacao : OPERACAO_CONFERIR,
    fase: FASE,
    ...(etapa ? { etapa: etapa.nome } : {}),
    modo: MODO,
    execucao: carimbo,
    iniciadaEm: inicio.toISOString(),
    endpoint: ENDPOINT_PILOTO,
    banco: BANCO_PILOTO,
    commit: sha,
    operador: `conta Windows local '${userInfo().username}' via script; sem ator autenticado na aplicação`,
  };

  let conferido = null;
  if (FASE === "aplicar") {
    const pendente = execucaoPendente(registrosAnteriores(), { endpoint: ENDPOINT_PILOTO, modo: MODO });
    if (pendente) {
      log(`EXECUCAO_SEM_DESFECHO: ${pendente.operacao} ${pendente.execucao} (iniciada em ${pendente.iniciadaEm})`);
      parar("ERR_RESULTADO_ANTERIOR_INCERTO");
    }
    conferido = backupConferido(etapa, sha);
    if (!conferido) parar("ERR_SEM_BACKUP_COM_RESTAURACAO_CONFERIDA");
  }

  const destino = destinoDoModo(
    conferirDestino(await lerOculto("URL direta do piloto (oculta): "), {
      endpointPiloto: ENDPOINT_PILOTO,
      endpointProibido: ENDPOINT_PROIBIDO,
    }),
    ensaio,
    ensaio ? readFileSync(ensaio.caArquivo, "utf8") : undefined,
  );
  log("DESTINO_ENDPOINT_PILOTO: true");
  log("DIFERENTE_DO_PROIBIDO: true");
  log(`BANCO: ${BANCO_PILOTO}`);

  if (FASE === "conferir") return faseConferir(destino, schema);

  // Primeiro o "antes" da etapa (caminho normal, uma conferência); só se ele
  // falhar, as três, para dizer por quê.
  const antes = await conferirComCodigo(destino, etapa.esperadoAntes, schema.checkPilotDatabase);
  if (!antes.success) {
    const decisao = decidirAplicacao(etapa, await identificar(destino, schema));
    parar(decisao === "aplicar" ? "ERR_ESTADO_ANTES_DIVERGENTE" : decisao);
  }
  conferirContas(etapa, await levantarImpacto(destino, schema));

  const pastaExecucao = path.join(PASTA, `${etapa.prefixoDasPastas}${FASE}-${carimbo}`);
  const manifesto = await fazerBackup(destino, etapa, pastaExecucao, {
    esperado: etapa.esperadoAntes,
    ...(conferido ? { backupConferido: conferido.nome } : {}),
  });
  if (conferido) {
    const motivos = compararServidores(conferido.manifesto, manifesto);
    log(`MESMO_SERVIDOR_DO_BACKUP_CONFERIDO: ${motivos.length === 0 ? "sim" : `não (${motivos.join(", ")})`}`);
    if (motivos.length) parar("ERR_BACKUP_CONFERIDO_DE_OUTRO_SERVIDOR");
  }

  if (FASE === "preparar") {
    registrar(REGISTRO, { ...base, resultado: "backup_feito", backup: { pasta: path.basename(pastaExecucao), ...manifesto.backup }, concluidaEm: new Date().toISOString() });
    log("RESULTADO: preparado, nada gravado no banco");
    log(`PROXIMO_PASSO: fase restauracao da etapa ${etapa.nome}, pasta ${path.basename(pastaExecucao)}`);
    return;
  }
  await faseAplicar(destino, etapa, schema, manifesto, pastaExecucao);
}

principal()
  .catch((erro) => {
    const codigo = erro instanceof Parada ? erro.message : (codigoDeErroConhecido(erro) ?? "ERR_INESPERADO");
    log(`ERRO: ${codigo}`);
    if (MOTIVOS[codigo]) log(`MOTIVO: ${MOTIVOS[codigo]}`);
    if (!(erro instanceof Parada)) log(`DETALHE: ${erro?.code ? `${erro.code} ` : ""}${String(erro?.message ?? erro).slice(0, 300)}`);
    for (const e of errosDeConexao) log(`ORIGEM: conexão encerrada antes (${e?.code ?? "sem código"})`);
    if (podeRegistrar) {
      try {
        registrar(REGISTRO, { ...base, resultado: "falhou", codigo, codigoDriver: erro?.code ?? null, concluidaEm: new Date().toISOString() });
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
