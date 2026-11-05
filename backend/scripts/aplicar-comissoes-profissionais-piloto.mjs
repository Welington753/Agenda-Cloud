// Publicação de ProfessionalCommissions1793491200000 no banco do piloto, em
// fases executadas à mão (ver docs/runbooks/publicacao-comissoes-profissionais-piloto.md).
// Não é rota nem parte do deploy. A URL direta é digitada oculta e nunca vem
// de variável, arquivo ou argumento. Mesmo procedimento do portal
// (aplicar-portal-multisservicos-piloto.mjs), com as peças comuns de
// operacao-piloto.mjs, numa etapa só (comissoes-profissionais-piloto.mjs).
//
//   --fase=preparar   só leitura: destino, TLS, o estado "antes", levantamento
//                     (planos, estabelecimentos que passam a apurar, regras e
//                     apurações) e backup (pg_dump -Fc no mesmo snapshot das
//                     contagens e md5 por tabela).
//   --fase=aplicar    exige um backup da fase `preparar` com a restauração
//                     conferida (conferir-restauracao-comissoes-profissionais.mjs)
//                     do mesmo destino, modo e commit. Repete destino, TLS,
//                     estado e levantamento, faz um backup novo, pede a frase,
//                     aplica SÓ ProfessionalCommissions e confere o estado
//                     "depois" e o catálogo (só a linha nova).
//   --fase=conferir   só leitura: identifica o estado (antes, depois ou
//                     divergente), sessões da migration ativas, o levantamento
//                     e o que uma reversão faria.
//
// Ambiente (o lançador abrir-comissoes-profissionais-piloto.ps1 define):
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
  APLICACAO_DA_MIGRATION,
  CODIGOS_DE_DESFECHO,
  ESPERADO_ANTES,
  ESPERADO_DEPOIS,
  ESTADOS,
  FRASE,
  MIGRATION,
  OPERACAO,
  PREFIXO_DAS_PASTAS,
  avaliarBackupConferido,
  classificarFalha,
  codigoDeErroConhecido,
  compararServidores,
  conferirModo as conferirModoDeExecucao,
  contagensEsperadasDepois,
  decidirAplicacao,
  desfechoDoErro,
  destinoDoModo,
  execucaoPendente,
  identificarEstado,
  lerRegistros,
} from "./comissoes-profissionais-piloto.mjs";

const MODO = (process.env.AGENDA_OPS_MODO ?? "").trim();
const ENDPOINT_PILOTO = (process.env.PILOT_ENDPOINT_ID ?? "").trim();
const ENDPOINT_PROIBIDO = (process.env.PRODUCTION_ENDPOINT_ID ?? "").trim();
const PG_BIN = process.env.PG_BIN ?? "C:/Program Files/PostgreSQL/18/bin";
const PASTA = process.env.AGENDA_OPS_DIR ?? path.join(homedir(), "AgendaCloud-operacoes");
const REGISTRO = path.join(PASTA, "operacoes.jsonl");
const APLICACAO_DE_LEITURA = "agenda-cloud-conferencia-comissoes";

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
// Até onde a fase `aplicar` chegou, para o desfecho de um erro que escape:
// "iniciada" (a migration pode ter entrado) ou "aplicada" (COMMIT confirmado).
let execucaoDaMigration = null;
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
    const schema = await import("../dist-scripts/lib/comissoes-profissionais-schema.js");
    await import("../dist-migrations/database/migrations-data-source.js");
    return { checkPilotDatabase: conferencia.checkPilotDatabase, ...schema };
  } catch {
    return parar("ERR_BUILD_AUSENTE");
  }
}

/** Uma das duas conferências (a mesma do `npm run pilot:check-database`),
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

/** As duas conferências e o estado identificado. */
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

/** Levantamento só-leitura (comissoes-profissionais-schema.ts). Só ids,
 * códigos e contagens. */
async function levantarImpacto(destino, schema) {
  const client = await conectar(destino, { aplicacao: APLICACAO_DE_LEITURA, log });
  try {
    log("--- Planos, estabelecimentos que passam a apurar, regras e apurações (só leitura; nada é alterado)");
    const impacto = await schema.lerImpactoComissoes(client);
    for (const linha of schema.descreverImpactoComissoes(impacto)) log(linha);
    return impacto;
  } finally {
    await encerrar(client);
  }
}

/** Backup no mesmo snapshot da fotografia (contagens e md5 por tabela). */
async function fazerBackup(destino, pastaExecucao, extras) {
  const aplicacao = "agenda-cloud-backup-comissoes";
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

/** Backup mais recente da fase `preparar` cuja restauração foi conferida. */
function backupConferido(commit) {
  const pastas = existsSync(PASTA)
    ? readdirSync(PASTA)
        .filter((n) => n.startsWith(`${PREFIXO_DAS_PASTAS}preparar-`))
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
      motivos = avaliarBackupConferido({
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

/** Só leitura: sessões da migration ainda ativas. É a primeira conexão da
 * fase `conferir`: se ela falhar, nenhum estado é concluído. */
async function contarSessoesDaMigration(destino) {
  const client = await conectar(destino, { aplicacao: APLICACAO_DE_LEITURA, log });
  try {
    const [{ sessoes }] = (
      await client.query(
        "SELECT count(*)::int AS sessoes FROM pg_stat_activity WHERE application_name = $1 AND pid <> pg_backend_pid()",
        [APLICACAO_DA_MIGRATION],
      )
    ).rows;
    log(`SESSOES_DA_MIGRATION_ATIVAS: ${sessoes}`);
    return sessoes;
  } finally {
    await encerrar(client);
  }
}

/** Só leitura: o que um `migration:revert` faria. */
async function avaliarReversao(destino, schema) {
  const client = await conectar(destino, { aplicacao: APLICACAO_DE_LEITURA, log });
  try {
    log("--- O que migration:revert faria (só leitura):");
    for (const [k, v] of Object.entries(await schema.lerEfeitoDaReversao(client))) log(`REVERSAO_AFETARIA_${k}: ${v}`);
    log("REVERSAO_NOTA: não use revert; com apuração por item ele recusa, e forçá-lo apagaria histórico (seção Recuperação do runbook).");
  } finally {
    await encerrar(client);
  }
}

/** Depois do COMMIT: o catálogo, os planos, os preços e as exceções iguais
 * aos do backup desta fase, com `plan_features` sem a linha nova. */
async function conferirCatalogo(destino, schema, manifesto) {
  const client = await conectar(destino, { aplicacao: APLICACAO_DE_LEITURA, log });
  try {
    const alteradas = schema.catalogoAlterado(manifesto.somas, await schema.lerSomasDoCatalogo(client));
    log(
      `CATALOGO_PRESERVADO: ${alteradas.length === 0 ? "sim" : `NÃO (${alteradas.join(",")})`} (${schema.TABELAS_DO_CATALOGO.join(",")}; plan_features sem ${schema.LINHA_DO_CATALOGO.id})`,
    );
    return alteradas.length === 0;
  } finally {
    await encerrar(client);
  }
}

const ROTULO = {
  [ESPERADO_ANTES]: `antes (14 migrations; ${MIGRATION} NÃO aplicada; não publique a API nova)`,
  [ESPERADO_DEPOIS]: `depois (15 migrations; ${MIGRATION} aplicada e conferida; a API nova pode ser publicada)`,
};

async function faseConferir(destino, schema) {
  const sessoes = await contarSessoesDaMigration(destino);
  const estado = await identificar(destino, schema);
  log(`ESTADO: ${estado}`);
  if (estado === "nao_identificado") parar("ERR_CONFERENCIA_SEM_LEITURA");
  if (estado === ESPERADO_DEPOIS) await avaliarReversao(destino, schema);
  await levantarImpacto(destino, schema);
  registrar(REGISTRO, { ...base, estado, sessoesDaMigration: sessoes, concluidaEm: new Date().toISOString() });
  if (sessoes > 0) {
    log("RESULTADO: há uma sessão da migration ainda ativa no banco; espere alguns minutos e rode conferir de novo");
  } else if (ROTULO[estado]) {
    log(`RESULTADO: estado ${ROTULO[estado]}`);
  } else {
    log("RESULTADO: estado divergente (nenhum dos dois); não aplique nem publique; investigar");
  }
  desfecho(estado === "divergente" || sessoes > 0 ? "conferencia_sem_estado_valido" : "estado_identificado");
}

async function faseAplicar(destino, schema, manifesto, pastaExecucao) {
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
    desfecho("abortado_sem_gravacao");
    return;
  }

  // Registrado ANTES do primeiro comando: se a janela fechar no meio, a
  // próxima fase `aplicar` encontra a execução sem desfecho e para.
  registrar(REGISTRO, { ...base, resultado: "migration_iniciada", backup: { pasta: path.basename(pastaExecucao), ...manifesto.backup } });
  let iniciou = false;
  execucaoDaMigration = "iniciada";
  try {
    await aplicarSomenteAPendente(destino, {
      esperadasAntes: [...schema.MIGRATIONS_ATE_NOMES_CONGELADOS],
      pendente: MIGRATION,
      aplicacao: APLICACAO_DA_MIGRATION,
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
      execucaoDaMigration = null;
      return parar(erro instanceof Parada ? erro.message : "ERR_MIGRATION_NAO_INICIADA");
    }
    if (tipo === "recusada_pelo_banco") {
      // O servidor recusou um comando numa sessão viva: a transação abortou.
      // Ainda assim confere em vez de supor.
      const intacto = await conferirEsperado(destino, ESPERADO_ANTES, schema.checkPilotDatabase).catch(() => false);
      if (intacto) {
        log(`ESTADO_APOS_FALHA: ${ESPERADO_ANTES} intacto; o banco recusou e desfez a transação (nada aplicado)`);
        registrar(REGISTRO, { ...base, resultado: "nao_aplicada", motivo: erro?.code ?? null, concluidaEm: new Date().toISOString() });
        execucaoDaMigration = null;
        return parar("ERR_MIGRATION_FALHOU");
      }
    }
    log("ESTADO_APOS_FALHA: INCERTO; a conexão caiu ou o estado não foi confirmado depois do início da migration");
    log("NAO_REPITA: não rode aplicar de novo; rode a fase conferir para saber se a migration entrou");
    registrar(REGISTRO, { ...base, resultado: "resultado_incerto", codigoDriver: erro?.code ?? null, concluidaEm: new Date().toISOString() });
    return parar("ERR_RESULTADO_INCERTO");
  }

  // Daqui em diante a migration ESTÁ gravada (COMMIT confirmado pelo banco).
  execucaoDaMigration = "aplicada";
  const aplicadaEm = new Date().toISOString();
  registrar(REGISTRO, { ...base, resultado: "aplicada", aplicadaEm });
  log("COMMIT: ok");
  log(`MIGRATION_APLICADA: ${MIGRATION} em ${aplicadaEm}`);
  let depoisOk = false;
  try {
    const estadoOk = await conferirEsperado(destino, ESPERADO_DEPOIS, schema.checkPilotDatabase);
    const catalogoOk = await conferirCatalogo(destino, schema, manifesto);
    depoisOk = estadoOk && catalogoOk;
    // Informativo: a API atual continua no ar e pode gravar durante a operação.
    const leitor = await conectar(destino, { aplicacao: APLICACAO_DE_LEITURA, log });
    try {
      await leitor.query("BEGIN TRANSACTION READ ONLY");
      const comparacao = compararFotografias(
        { ...manifesto, contagens: contagensEsperadasDepois(manifesto.contagens) },
        await fotografar(leitor),
        { ignorarSomas: Object.keys(manifesto.contagens), ignorarTabelas: ["typeorm_migrations"] },
      );
      await leitor.query("ROLLBACK");
      log(
        `CONTAGENS_DESDE_O_BACKUP: ${comparacao.iguais ? "iguais (com a linha nova do catálogo)" : `mudaram em ${comparacao.contagensDiferentes.join(",") || "-"} (uso normal do piloto durante a operação, não é perda)`}`,
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
    log(`ESTADO: ${ESPERADO_DEPOIS}`);
    log(`RESULTADO: ${MIGRATION} aplicada e conferida; estado ${ROTULO[ESPERADO_DEPOIS]}`);
    log("PROXIMO_PASSO: publicar a API e depois o web do mesmo commit (runbook); a API atual continua no ar e não apura comissões");
    desfecho("aplicada_e_conferida");
  } else {
    log(`RESULTADO: ${MIGRATION} FOI APLICADA (COMMIT confirmado), mas a conferência posterior falhou`);
    log("NAO_REPITA: não rode aplicar de novo; rode a fase conferir antes de qualquer outro passo");
    desfecho("aplicada_conferencia_falhou");
  }
}

/** Linha `DESFECHO` e código de saída (ver CODIGOS_DE_DESFECHO). */
function desfecho(nome) {
  log(`DESFECHO: ${nome}`);
  process.exitCode = CODIGOS_DE_DESFECHO[nome];
}

async function principal() {
  log(`Publicação de ${MIGRATION} no piloto Agenda-Cloud`);
  if (!["preparar", "aplicar", "conferir"].includes(FASE)) parar("ERR_FASE_INVALIDA");
  if (!FORMATO_ENDPOINT_ID.test(ENDPOINT_PILOTO) || !FORMATO_ENDPOINT_ID.test(ENDPOINT_PROIBIDO)) parar("ERR_ENDPOINT_IDS_AUSENTES");
  if (ENDPOINT_PILOTO === ENDPOINT_PROIBIDO) parar("ERR_PILOTO_IGUAL_AO_PROIBIDO");
  ensaio = conferirModoDeExecucao({ modo: MODO, env: process.env, execArgv: process.execArgv, endpointPiloto: ENDPOINT_PILOTO });
  if (ensaio && !existsSync(ensaio.caArquivo)) parar("ERR_ENSAIO_SEM_CA");
  log(`MODO: ${MODO === "ensaio" ? "ENSAIO (PostgreSQL descartável local; nada é feito no piloto)" : "PILOTO (Neon real)"}`);
  log(`FASE: ${FASE}`);
  if (FASE !== "conferir") log(`MIGRATION: ${MIGRATION} (${ESPERADO_ANTES} -> ${ESPERADO_DEPOIS})`);
  if (FASE !== "conferir" && !existsSync(path.join(PG_BIN, "pg_dump.exe"))) parar("ERR_PG_DUMP_AUSENTE");
  if (!pastaForaDoRepositorio(PASTA)) parar("ERR_PASTA_DE_OPERACOES_DENTRO_DO_REPOSITORIO");
  log(`PASTA_DE_OPERACOES: ${PASTA}`);
  const { sha, sujo } = commitAtual();
  log(`COMMIT: ${sha}${sujo ? " (backend com alterações locais)" : ""}`);
  if (sujo && FASE !== "conferir") parar("ERR_BACKEND_COM_ALTERACOES_LOCAIS");
  const schema = await carregarConferencia();
  if (schema.MIGRATION_COMISSOES !== MIGRATION) parar("ERR_BUILD_DESATUALIZADO");
  podeRegistrar = true;
  mkdirSync(PASTA, { recursive: true });
  base = {
    operacao: OPERACAO,
    fase: FASE,
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
      log(`EXECUCAO_SEM_DESFECHO: ${pendente.execucao} (iniciada em ${pendente.iniciadaEm})`);
      parar("ERR_RESULTADO_ANTERIOR_INCERTO");
    }
    conferido = backupConferido(sha);
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

  // Primeiro o "antes" (caminho normal, uma conferência); só se ele falhar,
  // as duas, para dizer por quê.
  const antes = await conferirComCodigo(destino, ESPERADO_ANTES, schema.checkPilotDatabase);
  if (!antes.success) {
    const decisao = decidirAplicacao(await identificar(destino, schema));
    parar(decisao === "aplicar" ? "ERR_ESTADO_ANTES_DIVERGENTE" : decisao);
  }
  await levantarImpacto(destino, schema);

  const pastaExecucao = path.join(PASTA, `${PREFIXO_DAS_PASTAS}${FASE}-${carimbo}`);
  const manifesto = await fazerBackup(destino, pastaExecucao, {
    esperado: ESPERADO_ANTES,
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
    desfecho("preparado_sem_gravacao");
    log(`PROXIMO_PASSO: fase restauracao, pasta ${path.basename(pastaExecucao)}`);
    return;
  }
  await faseAplicar(destino, schema, manifesto, pastaExecucao);
}

principal()
  .catch((erro) => {
    const codigo = erro instanceof Parada ? erro.message : (codigoDeErroConhecido(erro) ?? "ERR_INESPERADO");
    log(`ERRO: ${codigo}`);
    if (MOTIVOS[codigo]) log(`MOTIVO: ${MOTIVOS[codigo]}`);
    if (!(erro instanceof Parada)) log(`DETALHE: ${erro?.code ? `${erro.code} ` : ""}${String(erro?.message ?? erro).slice(0, 300)}`);
    for (const e of errosDeConexao) log(`ORIGEM: conexão encerrada antes (${e?.code ?? "sem código"})`);
    // Um erro que escape depois do início da migration (por exemplo, disco
    // cheio ao registrar) não vira "nada gravado".
    const nome = desfechoDoErro(codigo, execucaoDaMigration);
    if (nome === "resultado_incerto" && codigo !== "ERR_RESULTADO_INCERTO") {
      log("NAO_REPITA: não rode aplicar de novo; rode a fase conferir para saber se a migration entrou");
    } else if (nome === "aplicada_conferencia_falhou") {
      log("NAO_REPITA: a migration FOI APLICADA (COMMIT confirmado); rode a fase conferir antes de qualquer outro passo");
    }
    desfecho(nome);
    if (podeRegistrar) {
      try {
        registrar(REGISTRO, { ...base, resultado: "falhou", codigo, codigoDriver: erro?.code ?? null, concluidaEm: new Date().toISOString() });
      } catch {
        // O erro original é o que importa.
      }
    }
  })
  .finally(async () => {
    await encerrarTodas();
    process.stdin.pause();
  });
