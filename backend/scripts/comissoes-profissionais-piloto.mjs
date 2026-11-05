// Regras puras da publicação de ProfessionalCommissions1793491200000 no piloto
// (aplicar-comissoes-profissionais-piloto.mjs e
// conferir-restauracao-comissoes-profissionais.mjs). Sem banco, rede nem
// terminal: testadas em comissoes-profissionais-piloto.spec.ts.
//
// Uma migration, uma operação (preparar, restauração conferida, aplicar):
//
//   before-professional-commissions  ->  after-professional-commissions
//
// O modo, o desvio do ensaio, a comparação de servidores, a classificação de
// falhas e a leitura do registro vêm de equipe-piloto.mjs, como em
// TeamAccess, TeamManagerAccess, CommercialAccess e no portal.
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

export const MIGRATION = "ProfessionalCommissions1793491200000";
export const FRASE = `APLICAR ${MIGRATION}`;
export const OPERACAO = `migration_${MIGRATION}`;
export const ESPERADO_ANTES = "before-professional-commissions";
export const ESPERADO_DEPOIS = "after-professional-commissions";
/** Estados na ordem; a fase `conferir` identifica um deles. */
export const ESTADOS = [ESPERADO_ANTES, ESPERADO_DEPOIS];
export const PREFIXO_DAS_PASTAS = "comissoes-";
export const APLICACAO_DA_MIGRATION = "agenda-cloud-migration-comissoes";

// O que muda de propósito. Tudo o mais precisa continuar igual, linha a linha.
/** Coluna nova em tabela existente: as colunas antigas são comparadas à parte
 * e a nova precisa nascer NULL em todas as linhas. */
export const COLUNAS_NOVAS = Object.freeze({ commission_entries: ["appointment_item_id"] });
/** Linhas novas em tabela existente, por id: o resto da tabela continua com o
 * mesmo md5 e a contagem sobe exatamente essa quantidade. */
export const LINHAS_NOVAS = Object.freeze({ plan_features: ["pf_pc_equipe_comissoes"] });

/**
 * Motivos para recusar um backup como base da fase `aplicar` (lista vazia:
 * aceito). Backup e conferência da restauração do mesmo destino, modo e
 * commit desta execução, do estado "antes", com o ensaio da migration feito na
 * cópia, e de até 24 h.
 */
export function avaliarBackupConferido({ manifesto, conferencia, sha256DoDump, sha256DoManifesto, commit, endpoint, modo, agora }) {
  const motivos = [];
  if (conferencia.manifestoSha256 !== sha256DoManifesto) motivos.push("manifesto alterado depois da conferência");
  if (manifesto.operacao !== OPERACAO) motivos.push("outra operação");
  if (manifesto.esperado !== ESPERADO_ANTES) motivos.push(`backup fora do estado ${ESPERADO_ANTES}`);
  if (manifesto.modo !== modo) motivos.push(`backup do modo ${manifesto.modo ?? "desconhecido"}`);
  if (manifesto.endpoint !== endpoint) motivos.push("outro endpoint");
  if (manifesto.commit !== commit) motivos.push("backup de outro commit");
  if (sha256DoDump !== manifesto.backup?.sha256) motivos.push("dump alterado");
  if (conferencia.resultado !== "restauracao_e_ensaio_ok") motivos.push("conferência sem sucesso");
  if (conferencia.ensaioMigration !== "ok") motivos.push("migration não ensaiada na cópia");
  if (conferencia.sha256 !== manifesto.backup?.sha256) motivos.push("conferência de outro dump");
  if (conferencia.commit !== commit) motivos.push("restauração conferida com outro commit");
  if (conferencia.operacao !== OPERACAO) motivos.push("conferência de outra operação");
  const idade = agora - Date.parse(manifesto.pontoDeRecuperacao);
  if (!(idade >= 0 && idade <= VALIDADE_DO_BACKUP_CONFERIDO_MS)) motivos.push("mais de 24 h");
  return motivos;
}

const RESOLVE_A_EXECUCAO = new Set(["nao_aplicada", "aplicada", "aplicada_e_conferida", "aplicada_conferencia_posterior_falhou"]);

/**
 * Execução anterior da fase `aplicar` cujo desfecho não é conhecido: começou a
 * migration (`migration_iniciada`) e terminou incerta ou sem registro final
 * (janela fechada, máquina desligada). Só deixa de bloquear quando uma fase
 * `conferir` posterior identificou um dos dois estados, sem sessão da
 * migration ativa.
 */
export function execucaoPendente(registros, { endpoint, modo }) {
  let pendente = null;
  for (const r of registros) {
    if (r?.operacao !== OPERACAO || r.endpoint !== endpoint || r.modo !== modo) continue;
    if (r.fase === "aplicar" && r.resultado === "migration_iniciada") {
      pendente = { execucao: r.execucao, iniciadaEm: r.iniciadaEm };
    } else if (r.fase === "aplicar" && pendente && r.execucao === pendente.execucao && RESOLVE_A_EXECUCAO.has(r.resultado)) {
      pendente = null;
    } else if (r.fase === "conferir" && pendente && ESTADOS.includes(r.estado) && r.sessoesDaMigration === 0) {
      pendente = null;
    }
  }
  return pendente;
}

// Única falha de conferência que descreve o schema; qualquer outro código
// (conexão, TLS, credencial) significa que o estado não foi lido.
const FALHA_DE_SCHEMA = "ERR_POST_MIGRATION_BASELINE_MISMATCH";

/**
 * Estado a partir das duas conferências (`{ [estado]: sucesso }` e os
 * códigos). Exatamente uma precisa passar; com as duas ou nenhuma,
 * `divergente`. `nao_identificado` quando alguma não chegou a ler o banco.
 */
export function identificarEstado({ resultados, codigos = [] }) {
  if (codigos.some((c) => c !== undefined && c !== FALHA_DE_SCHEMA)) return "nao_identificado";
  const passaram = ESTADOS.filter((e) => resultados[e] === true);
  return passaram.length === 1 ? passaram[0] : "divergente";
}

/** O que a fase `preparar`/`aplicar` faz em cada estado identificado. */
export function decidirAplicacao(estado) {
  if (estado === ESPERADO_ANTES) return "aplicar";
  if (estado === ESPERADO_DEPOIS) return "ERR_MIGRATION_JA_APLICADA";
  if (estado === "nao_identificado") return "ERR_CONFERENCIA_SEM_LEITURA";
  return "ERR_ESTADO_ANTES_DIVERGENTE";
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

/**
 * Contagens esperadas logo depois da migration, a partir das do backup: só
 * as linhas novas entram (a API no ar pode mudar outras, o que é informado à
 * parte e não é perda).
 */
export function contagensEsperadasDepois(contagens) {
  const esperadas = { ...contagens };
  for (const [tabela, ids] of Object.entries(LINHAS_NOVAS)) esperadas[tabela] = (esperadas[tabela] ?? 0) + ids.length;
  return esperadas;
}
