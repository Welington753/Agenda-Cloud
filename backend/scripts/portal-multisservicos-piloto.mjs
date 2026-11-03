// Regras puras da publicação de PlatformPortal1793318400000 e
// AppointmentServiceSnapshots1793404800000 no piloto
// (aplicar-portal-multisservicos-piloto.mjs e
// conferir-restauracao-portal-multisservicos.mjs). Sem banco, rede nem
// terminal: testadas em portal-multisservicos-piloto.spec.ts.
//
// Duas ETAPAS, cada uma uma operação completa (preparar, restauração
// conferida, aplicar), na ordem e nunca juntas:
//
//   portal          before-platform-portal  ->  after-platform-portal
//   multisservicos  after-platform-portal   ->  after-appointment-snapshots
//
// `after-platform-portal` é o estado INTERMEDIÁRIO: a API e o web publicados
// continuam os anteriores e funcionam nele (ensaiado). Cada etapa aplica só a
// sua migration, numa transação própria; uma migration já aplicada nunca é
// repetida (a etapa recusa qualquer estado que não seja o seu "antes").
//
// O modo, o desvio do ensaio, a comparação de servidores, a classificação de
// falhas e a leitura do registro vêm de equipe-piloto.mjs, como em
// TeamAccess, TeamManagerAccess e CommercialAccess.
import { Parada } from "./entrada-oculta.mjs";
import { VALIDADE_DO_BACKUP_CONFERIDO_MS } from "./equipe-piloto.mjs";

export {
  PREFIXO_DO_ENSAIO,
  VALIDADE_DO_BACKUP_CONFERIDO_MS,
  classificarFalha,
  codigoDeErroConhecido,
  compararServidores,
  conferirModo,
  destinoDoModo,
  lerRegistros,
} from "./equipe-piloto.mjs";

export const MIGRATION_PORTAL = "PlatformPortal1793318400000";
export const MIGRATION_NOMES_CONGELADOS = "AppointmentServiceSnapshots1793404800000";

export const ESTADO_ANTES = "before-platform-portal";
export const ESTADO_INTERMEDIARIO = "after-platform-portal";
export const ESTADO_FINAL = "after-appointment-snapshots";
/** Estados na ordem; a fase `conferir` identifica um deles. */
export const ESTADOS = [ESTADO_ANTES, ESTADO_INTERMEDIARIO, ESTADO_FINAL];

/** Registro da fase `conferir`, comum às duas etapas. */
export const OPERACAO_CONFERIR = "migrations_portal_multisservicos";

const etapa = ({ nome, migration, posteriores, antes, depois, prefixo, colunasNovas, tabelasNovas }) =>
  Object.freeze({
    nome,
    migration,
    // Migrations do mesmo commit que ficam para a etapa seguinte: conferidas
    // pelo nome e NÃO carregadas na aplicação desta (operacao-piloto.mjs).
    posteriores,
    frase: `APLICAR ${migration}`,
    operacao: `migration_${migration}`,
    esperadoAntes: antes,
    esperadoDepois: depois,
    prefixoDasPastas: prefixo,
    aplicacao: `agenda-cloud-migration-${nome}`,
    // Colunas novas em tabelas existentes: as colunas antigas são comparadas
    // à parte e a nova precisa nascer NULL em todas as linhas.
    colunasNovas,
    // Tabelas novas: precisam nascer vazias (nenhum preço, contrato ou "sem
    // vencimento" gravado pela migration).
    tabelasNovas,
  });

export const ETAPAS = Object.freeze({
  portal: etapa({
    nome: "portal",
    migration: MIGRATION_PORTAL,
    posteriores: [MIGRATION_NOMES_CONGELADOS],
    antes: ESTADO_ANTES,
    depois: ESTADO_INTERMEDIARIO,
    prefixo: "portal-",
    colunasNovas: { tenant_access_periods: ["amount_source"] },
    tabelasNovas: ["plan_prices", "tenant_contract_prices", "tenant_no_expiry_grants"],
  }),
  multisservicos: etapa({
    nome: "multisservicos",
    migration: MIGRATION_NOMES_CONGELADOS,
    posteriores: [],
    antes: ESTADO_INTERMEDIARIO,
    depois: ESTADO_FINAL,
    prefixo: "multisservicos-",
    colunasNovas: { appointment_items: ["service_name_snapshot"] },
    tabelasNovas: [],
  }),
});

const APLICACOES = Object.values(ETAPAS).map((e) => e.aplicacao);
export const APLICACOES_DAS_MIGRATIONS = APLICACOES;

export function escolherEtapa(nome) {
  if (!Object.hasOwn(ETAPAS, nome ?? "")) throw new Parada("ERR_ETAPA_INVALIDA");
  return ETAPAS[nome];
}

/**
 * Motivos para recusar um backup como base da fase `aplicar` de uma etapa
 * (lista vazia: aceito). Backup e conferência da restauração do mesmo
 * destino, modo e commit desta execução, desta etapa e do estado "antes"
 * dela, com o ensaio da migration feito na cópia, e de até 24 h.
 */
export function avaliarBackupConferido(etapaEscolhida, { manifesto, conferencia, sha256DoDump, sha256DoManifesto, commit, endpoint, modo, agora }) {
  const motivos = [];
  if (conferencia.manifestoSha256 !== sha256DoManifesto) motivos.push("manifesto alterado depois da conferência");
  if (manifesto.operacao !== etapaEscolhida.operacao) motivos.push("outra operação");
  if (manifesto.esperado !== etapaEscolhida.esperadoAntes) motivos.push(`backup fora do estado ${etapaEscolhida.esperadoAntes}`);
  if (manifesto.modo !== modo) motivos.push(`backup do modo ${manifesto.modo ?? "desconhecido"}`);
  if (manifesto.endpoint !== endpoint) motivos.push("outro endpoint");
  if (manifesto.commit !== commit) motivos.push("backup de outro commit");
  if (sha256DoDump !== manifesto.backup?.sha256) motivos.push("dump alterado");
  if (conferencia.resultado !== "restauracao_e_ensaio_ok") motivos.push("conferência sem sucesso");
  if (conferencia.ensaioMigration !== "ok") motivos.push("migration não ensaiada na cópia");
  if (conferencia.sha256 !== manifesto.backup?.sha256) motivos.push("conferência de outro dump");
  if (conferencia.commit !== commit) motivos.push("restauração conferida com outro commit");
  if (conferencia.operacao !== etapaEscolhida.operacao) motivos.push("conferência de outra operação");
  const idade = agora - Date.parse(manifesto.pontoDeRecuperacao);
  if (!(idade >= 0 && idade <= VALIDADE_DO_BACKUP_CONFERIDO_MS)) motivos.push("mais de 24 h");
  return motivos;
}

const RESOLVE_A_EXECUCAO = new Set(["nao_aplicada", "aplicada", "aplicada_e_conferida", "aplicada_conferencia_posterior_falhou"]);
const OPERACOES_DAS_ETAPAS = new Set(Object.values(ETAPAS).map((e) => e.operacao));

/**
 * Execução anterior da fase `aplicar` de QUALQUER das duas etapas cujo
 * desfecho não é conhecido. Bloqueia as duas: a etapa seguinte depende do
 * resultado da anterior. Só deixa de bloquear quando uma fase `conferir`
 * posterior identificou um dos três estados, sem sessão de migration ativa.
 */
export function execucaoPendente(registros, { endpoint, modo }) {
  let pendente = null;
  for (const r of registros) {
    if (r?.endpoint !== endpoint || r.modo !== modo) continue;
    if (OPERACOES_DAS_ETAPAS.has(r.operacao) && r.fase === "aplicar") {
      if (r.resultado === "migration_iniciada") {
        pendente = { operacao: r.operacao, execucao: r.execucao, iniciadaEm: r.iniciadaEm };
      } else if (pendente && r.execucao === pendente.execucao && r.operacao === pendente.operacao && RESOLVE_A_EXECUCAO.has(r.resultado)) {
        pendente = null;
      }
    } else if (r.operacao === OPERACAO_CONFERIR && r.fase === "conferir" && pendente && ESTADOS.includes(r.estado) && r.sessoesDaMigration === 0) {
      pendente = null;
    }
  }
  return pendente;
}

// Única falha de conferência que descreve o schema; qualquer outro código
// (conexão, TLS, credencial) significa que o estado não foi lido.
const FALHA_DE_SCHEMA = "ERR_POST_MIGRATION_BASELINE_MISMATCH";

/**
 * Estado a partir das três conferências (`{ [estado]: sucesso }` e os
 * códigos). Exatamente uma precisa passar; com duas ou nenhuma, `divergente`.
 * `nao_identificado` quando alguma não chegou a ler o banco.
 */
export function identificarEstado({ resultados, codigos = [] }) {
  if (codigos.some((c) => c !== undefined && c !== FALHA_DE_SCHEMA)) return "nao_identificado";
  const passaram = ESTADOS.filter((e) => resultados[e] === true);
  return passaram.length === 1 ? passaram[0] : "divergente";
}

/** O que a fase `aplicar` de uma etapa faz em cada estado identificado. */
export function decidirAplicacao(etapaEscolhida, estado) {
  if (estado === etapaEscolhida.esperadoAntes) return "aplicar";
  const posicao = ESTADOS.indexOf(estado);
  if (posicao >= ESTADOS.indexOf(etapaEscolhida.esperadoDepois)) return "ERR_ETAPA_JA_APLICADA";
  if (posicao >= 0) return "ERR_ETAPA_ANTERIOR_PENDENTE";
  if (estado === "nao_identificado") return "ERR_CONFERENCIA_SEM_LEITURA";
  return "ERR_ESTADO_ANTES_DIVERGENTE";
}

/**
 * Sem nenhum MASTER_OWNER ativo, a API nova deixa o portal sem ninguém que
 * entre (MASTER_ADMIN e MASTER_SUPPORT perdem o acesso). A etapa do portal
 * para antes do backup; promover alguém é decisão do dono, fora daqui (o
 * procedimento nunca altera papel).
 */
export function conferirContas(etapaEscolhida, impacto) {
  if (etapaEscolhida.nome === "portal" && impacto.proprietariosAtivos === 0) throw new Parada("ERR_SEM_PROPRIETARIO_ATIVO");
}

/**
 * Desfecho da execução: uma linha fixa (`DESFECHO`) e o código de saída. O
 * código, sozinho, não comprova aplicação: a prova é o `ESTADO` conferido
 * (no fim da fase ou na fase `conferir`) e o registro em operacoes.jsonl.
 *   0  a fase terminou como esperado (preparado; aplicada e conferida; estado identificado)
 *   1  parou ou abortou SEM gravar nada (inclui a recusa do banco com o estado antes intacto)
 *   2  a migration FOI aplicada (COMMIT confirmado), mas a conferência posterior falhou
 *   3  resultado INCERTO: não repita; rode conferir
 */
export const CODIGOS_DE_DESFECHO = Object.freeze({
  preparado_sem_gravacao: 0,
  aplicada_e_conferida: 0,
  estado_identificado: 0,
  abortado_sem_gravacao: 1,
  parado_sem_gravacao: 1,
  conferencia_sem_estado_valido: 1,
  aplicada_conferencia_falhou: 2,
  resultado_incerto: 3,
});

/**
 * Desfecho de um erro que chegou ao fim do script. `execucao` diz até onde a
 * fase `aplicar` chegou: null (a migration não começou ou comprovadamente não
 * entrou), "iniciada" (pode ter entrado) ou "aplicada" (COMMIT confirmado).
 * Um erro depois do início nunca vira "nada gravado".
 */
export function desfechoDoErro(codigo, execucao) {
  if (codigo === "ERR_RESULTADO_INCERTO" || execucao === "iniciada") return "resultado_incerto";
  if (execucao === "aplicada") return "aplicada_conferencia_falhou";
  return "parado_sem_gravacao";
}
