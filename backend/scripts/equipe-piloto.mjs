// Regras puras da publicação de um lote de migrations no piloto
// (aplicar-equipe-piloto.mjs e conferir-restauracao-equipe.mjs). Sem banco,
// rede nem terminal: testadas em equipe-piloto.spec.ts.
//
// Lotes (`--lote`, sem padrão nos scripts): `equipe` (TeamAccess, já
// aplicada no piloto) e `acesso-recebimentos` (StaffLogin e
// AppointmentPayments, juntas numa transação). Cada lote tem operação, frase,
// estados esperados, pastas e application_name próprios: um backup, uma
// conferência ou uma execução incerta de um lote nunca vale para o outro.
//
// Modo `piloto` × `ensaio`: o lançador define AGENDA_OPS_MODO. O ensaio roda o
// MESMO procedimento contra um PostgreSQL descartável que imita o piloto (host
// fictício `ep-ensaio-*.neon.tech` com certificado de uma CA descartável,
// conexão desviada para o loopback). O piloto recusa qualquer resto do ensaio
// (CA extra, desvio de endereço, opções do Node), e um backup ou ensaio de um
// modo nunca vale para o outro.
import { Parada } from "./entrada-oculta.mjs";

export const PREFIXO_DO_ENSAIO = "ep-ensaio-";
export const VALIDADE_DO_BACKUP_CONFERIDO_MS = 24 * 60 * 60 * 1000;

function descreverLote({ nome, rotulo, migrations, esperadoAntes, esperadoDepois, publicacao, schema, tabelasAlteradas, jaAplicado }) {
  return Object.freeze({
    nome,
    rotulo,
    migrations: Object.freeze([...migrations]),
    frase: `APLICAR ${migrations.join(" ")}`,
    operacao: `migration_${migrations.join("_")}`,
    esperadoAntes,
    esperadoDepois,
    prefixoDasPastas: `${nome}-`,
    aplicacaoDaMigration: `agenda-cloud-migration-${nome}`,
    aplicacaoDaConferencia: `agenda-cloud-conferencia-${nome}`,
    aplicacaoDoBackup: `agenda-cloud-backup-${nome}`,
    aplicacaoDaRestauracao: `agenda-cloud-restauracao-${nome}`,
    // Módulo compilado em dist-scripts/lib e o export com o contrato
    // PublicacaoDoLote (lib/publicacao-lote.ts).
    schema,
    publicacao,
    // Tabelas que ganham colunas: o conteúdo das colunas ANTIGAS é comparado à
    // parte; o md5 da linha inteira muda de propósito.
    tabelasAlteradas: Object.freeze([...tabelasAlteradas]),
    jaAplicado,
  });
}

export const LOTES = Object.freeze({
  equipe: descreverLote({
    nome: "equipe",
    rotulo: "TeamAccess",
    migrations: ["TeamAccess1792886400000"],
    esperadoAntes: "before-team-access",
    esperadoDepois: "after-team-access",
    schema: "equipe-acessos-schema.js",
    publicacao: "PUBLICACAO_EQUIPE",
    tabelasAlteradas: ["tenants", "memberships", "invites"],
    jaAplicado: "ERR_TEAMACCESS_JA_APLICADA",
  }),
  "acesso-recebimentos": descreverLote({
    nome: "acesso-recebimentos",
    rotulo: "StaffLogin + AppointmentPayments",
    migrations: ["StaffLogin1792972800000", "AppointmentPayments1793059200000"],
    esperadoAntes: "before-staff-payments",
    esperadoDepois: "after-staff-payments",
    schema: "acesso-recebimentos-schema.js",
    publicacao: "PUBLICACAO_ACESSO_RECEBIMENTOS",
    tabelasAlteradas: ["users"],
    jaAplicado: "ERR_LOTE_JA_APLICADO",
  }),
});

/** Lote pelo nome exato de `--lote`; qualquer outro valor para. */
export function escolherLote(nome) {
  if (typeof nome !== "string" || !Object.hasOwn(LOTES, nome)) parar("ERR_LOTE_INVALIDO");
  return LOTES[nome];
}

// Nomes da publicação de TeamAccess, mantidos para quem já os usa.
export const MIGRATION = LOTES.equipe.migrations[0];
export const FRASE = LOTES.equipe.frase;
export const OPERACAO = LOTES.equipe.operacao;
export const ESPERADO_ANTES = LOTES.equipe.esperadoAntes;
export const ESPERADO_DEPOIS = LOTES.equipe.esperadoDepois;
export const PREFIXO_DAS_PASTAS = LOTES.equipe.prefixoDasPastas;
export const APLICACAO_DA_MIGRATION = LOTES.equipe.aplicacaoDaMigration;
export const TABELAS_ALTERADAS = [...LOTES.equipe.tabelasAlteradas];

const parar = (codigo) => {
  throw new Parada(codigo);
};

const ENDERECOS_DE_LOOPBACK = new Set(["127.0.0.1", "::1"]);

/**
 * Confere o modo antes de qualquer entrada ou rede. Devolve `null` no piloto
 * ou `{ endereco, caArquivo }` no ensaio.
 */
export function conferirModo({ modo, env, execArgv, endpointPiloto }) {
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === "0") parar("ERR_TLS_AFROUXADO");
  if (modo === "piloto") {
    if (env.AGENDA_ENSAIO_CA || env.AGENDA_ENSAIO_ENDERECO) parar("ERR_AJUSTE_DE_ENSAIO_NO_PILOTO");
    if (env.NODE_EXTRA_CA_CERTS || env.NODE_USE_SYSTEM_CA) parar("ERR_CA_EXTRA_NO_PILOTO");
    if ((env.NODE_OPTIONS ?? "").trim() !== "" || execArgv.length > 0) parar("ERR_OPCOES_DO_NODE_NO_PILOTO");
    if (endpointPiloto.startsWith(PREFIXO_DO_ENSAIO)) parar("ERR_ENDPOINT_DE_ENSAIO_NO_PILOTO");
    return null;
  }
  if (modo === "ensaio") {
    if (!endpointPiloto.startsWith(PREFIXO_DO_ENSAIO)) parar("ERR_ENSAIO_SEM_ENDPOINT_DE_ENSAIO");
    const endereco = (env.AGENDA_ENSAIO_ENDERECO ?? "").trim();
    if (!ENDERECOS_DE_LOOPBACK.has(endereco)) parar("ERR_ENSAIO_FORA_DO_LOOPBACK");
    const caArquivo = (env.AGENDA_ENSAIO_CA ?? "").trim();
    if (!caArquivo) parar("ERR_ENSAIO_SEM_CA");
    return { endereco, caArquivo };
  }
  return parar("ERR_MODO_INVALIDO");
}

/** No ensaio, a conexão vai ao loopback e confia só na CA descartável; o nome
 * conferido no certificado continua sendo o host da URL. */
export function destinoDoModo(destino, ensaio, caPem) {
  if (!ensaio) return destino;
  return { ...destino, host: ensaio.endereco, ca: caPem };
}

/**
 * Motivos para recusar um backup como base da fase `aplicar` (lista vazia:
 * aceito). O backup e a conferência da restauração precisam ser do mesmo
 * destino, modo e commit desta execução, do estado `before`, com o ensaio da
 * migration feito na cópia, e de até 24 h.
 */
export function avaliarBackupConferido({ manifesto, conferencia, sha256DoDump, sha256DoManifesto, commit, endpoint, modo, agora, lote = LOTES.equipe }) {
  const motivos = [];
  if (conferencia.manifestoSha256 !== sha256DoManifesto) motivos.push("manifesto alterado depois da conferência");
  if (manifesto.operacao !== lote.operacao) motivos.push("outra operação");
  if (manifesto.esperado !== lote.esperadoAntes) motivos.push("backup fora do estado before");
  if (manifesto.modo !== modo) motivos.push(`backup do modo ${manifesto.modo ?? "desconhecido"}`);
  if (manifesto.endpoint !== endpoint) motivos.push("outro endpoint");
  if (manifesto.commit !== commit) motivos.push("backup de outro commit");
  if (sha256DoDump !== manifesto.backup?.sha256) motivos.push("dump alterado");
  if (conferencia.resultado !== "restauracao_e_ensaio_ok") motivos.push("conferência sem sucesso");
  if (conferencia.ensaioMigration !== "ok") motivos.push("migration não ensaiada na cópia");
  if (conferencia.sha256 !== manifesto.backup?.sha256) motivos.push("conferência de outro dump");
  if (conferencia.commit !== commit) motivos.push("restauração conferida com outro commit");
  const idade = agora - Date.parse(manifesto.pontoDeRecuperacao);
  if (!(idade >= 0 && idade <= VALIDADE_DO_BACKUP_CONFERIDO_MS)) motivos.push("mais de 24 h");
  return motivos;
}

/**
 * O backup novo da fase `aplicar` precisa vir do MESMO servidor do backup
 * conferido: mesma raiz da cadeia TLS (um ensaio usa a CA descartável; o
 * Neon, uma raiz pública), mesma versão e mesmo histórico de migrations.
 */
export function compararServidores(conferido, novo) {
  const motivos = [];
  const raiz = (m) => m.tls?.cadeia?.at(-1) ?? "?";
  if (raiz(conferido) !== raiz(novo)) motivos.push("certificado de outra cadeia");
  if (conferido.servidor !== novo.servidor) motivos.push("outra versão do servidor");
  if (JSON.stringify(conferido.migrations) !== JSON.stringify(novo.migrations)) motivos.push("outro histórico de migrations");
  return motivos;
}

/** Nome fixo para as falhas de rede e TLS antes de qualquer leitura: recusa do
 * certificado pelo Node (CA desconhecida, nome errado, expirado) ou banco
 * inalcançável. */
export function codigoDeErroConhecido(erro) {
  const codigo = typeof erro?.code === "string" ? erro.code : "";
  if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS|HOSTNAME/.test(codigo)) return "ERR_CERTIFICADO_NAO_CONFIAVEL";
  if (["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT", "ECONNRESET", "EHOSTUNREACH"].includes(codigo)) return "ERR_SEM_CONEXAO";
  return null;
}

// SQLSTATE de conexão perdida ou servidor encerrando: a sessão acabou e o
// cliente não sabe se o COMMIT chegou.
const SQLSTATE_DE_CONEXAO = /^(08...|57P0[1-5])$/;

/**
 * Classifica uma falha da fase `aplicar`:
 * - `nada_aplicado`: falhou antes de a migration começar (nenhum DDL enviado);
 * - `recusada_pelo_banco`: o servidor respondeu com erro numa sessão viva
 *   (ex.: lock_timeout); a transação foi abortada e não pode ter sido gravada;
 * - `incerto`: conexão perdida (ou qualquer outra coisa) depois do início. O
 *   COMMIT pode ter sido gravado: nunca concluir que nada foi aplicado.
 */
export function classificarFalha(erro, { iniciou }) {
  if (!iniciou) return "nada_aplicado";
  const codigo = typeof erro?.code === "string" ? erro.code : "";
  if (!(erro instanceof Parada) && /^[0-9A-Z]{5}$/.test(codigo) && !SQLSTATE_DE_CONEXAO.test(codigo)) {
    return "recusada_pelo_banco";
  }
  return "incerto";
}

const RESOLVE_A_EXECUCAO = new Set(["nao_aplicada", "aplicada", "aplicada_e_conferida", "aplicada_conferencia_posterior_falhou"]);

/**
 * Execução anterior da fase `aplicar` cujo desfecho não é conhecido: começou a
 * migration (`migration_iniciada`) e terminou incerta ou sem registro final
 * (janela fechada, máquina desligada). Só deixa de bloquear quando uma fase
 * `conferir` posterior identificou o estado, sem sessão da migration ativa.
 */
export function execucaoPendente(registros, { endpoint, modo, lote = LOTES.equipe }) {
  let pendente = null;
  for (const r of registros) {
    if (r?.operacao !== lote.operacao || r.endpoint !== endpoint || r.modo !== modo) continue;
    if (r.fase === "aplicar" && r.resultado === "migration_iniciada") {
      pendente = { execucao: r.execucao, iniciadaEm: r.iniciadaEm };
    } else if (r.fase === "aplicar" && pendente && r.execucao === pendente.execucao && RESOLVE_A_EXECUCAO.has(r.resultado)) {
      pendente = null;
    } else if (r.fase === "conferir" && pendente && ["before", "after"].includes(r.estado) && r.sessoesDaMigration === 0) {
      pendente = null;
    }
  }
  return pendente;
}

/** Linhas de `operacoes.jsonl`; linha quebrada (gravação interrompida) é
 * ignorada, nunca interpretada. */
export function lerRegistros(texto) {
  const registros = [];
  for (const linha of texto.split("\n")) {
    if (!linha.trim()) continue;
    try {
      registros.push(JSON.parse(linha));
    } catch {
      // ignorada
    }
  }
  return registros;
}

// Única falha de conferência que descreve o schema; qualquer outro código
// (conexão, TLS, credencial) significa que o estado não foi lido.
const FALHA_DE_SCHEMA = "ERR_POST_MIGRATION_BASELINE_MISMATCH";

/** Estado identificado pela fase `conferir` a partir das duas conferências;
 * `nao_identificado` quando alguma delas não chegou a ler o banco. */
export function identificarEstado({ before, after, codigos = [] }) {
  if (codigos.some((c) => c !== undefined && c !== FALHA_DE_SCHEMA)) return "nao_identificado";
  if (before && !after) return "before";
  if (after && !before) return "after";
  return "divergente";
}
