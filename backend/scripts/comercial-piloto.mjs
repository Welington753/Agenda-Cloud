// Regras puras da publicação de CommercialAccess1793232000000 no piloto
// (aplicar-comercial-piloto.mjs e conferir-restauracao-comercial.mjs). Sem
// banco, rede nem terminal: testadas em comercial-piloto.spec.ts.
//
// Mesmo procedimento de TeamAccess e TeamManagerAccess: o modo, o desvio do
// ensaio, a comparação de servidores, a classificação de falhas e a leitura
// do registro vêm de equipe-piloto.mjs. Só muda o que é DESTA operação: o
// nome, a frase, os estados esperados, as pastas, a avaliação do backup e
// das execuções pendentes (que filtram por operação) e a parada por exceção
// de recurso desligada.
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
  identificarEstado,
  lerRegistros,
} from "./equipe-piloto.mjs";

export const MIGRATION = "CommercialAccess1793232000000";
export const FRASE = `APLICAR ${MIGRATION}`;
export const OPERACAO = `migration_${MIGRATION}`;
export const ESPERADO_ANTES = "before-commercial-access";
export const ESPERADO_DEPOIS = "after-commercial-access";
export const PREFIXO_DAS_PASTAS = "comercial-";
export const APLICACAO_DA_MIGRATION = "agenda-cloud-migration-comercial";
// Tabelas que ganham coluna ou têm colunas reescritas: o conteúdo das colunas
// que a migration NÃO toca é comparado à parte.
//   tenants: ganha `access_legacy_since`;
//   plans:   `name`, `short_description` e `updated_at` mudam nos três planos.
export const COLUNAS_ALTERADAS = {
  tenants: [],
  plans: ["name", "short_description", "updated_at"],
};
// Tabelas que só ganham linhas com prefixo próprio: as linhas antigas são
// comparadas à parte; as novas, contadas.
export const LINHAS_ACRESCENTADAS = {
  plan_features: "pf_ca_",
  tenant_feature_overrides: "tfo_ca_",
};
// Tabela nova: precisa nascer vazia (nenhum período criado na migration).
export const TABELA_NOVA = "tenant_access_periods";

/**
 * Motivos para recusar um backup como base da fase `aplicar` (lista vazia:
 * aceito). Mesma regra de TeamAccess: backup e conferência da restauração do
 * mesmo destino, modo e commit desta execução, do estado `before`, com o
 * ensaio da migration feito na cópia, e de até 24 h.
 */
export function avaliarBackupConferido({ manifesto, conferencia, sha256DoDump, sha256DoManifesto, commit, endpoint, modo, agora }) {
  const motivos = [];
  if (conferencia.manifestoSha256 !== sha256DoManifesto) motivos.push("manifesto alterado depois da conferência");
  if (manifesto.operacao !== OPERACAO) motivos.push("outra operação");
  if (manifesto.esperado !== ESPERADO_ANTES) motivos.push("backup fora do estado before");
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
 * Execução anterior da fase `aplicar` DESTA operação cujo desfecho não é
 * conhecido (mesma regra de TeamAccess). Só deixa de bloquear quando uma fase
 * `conferir` posterior identificou o estado, sem sessão da migration ativa.
 */
export function execucaoPendente(registros, { endpoint, modo }) {
  let pendente = null;
  for (const r of registros) {
    if (r?.operacao !== OPERACAO || r.endpoint !== endpoint || r.modo !== modo) continue;
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

/** Exceção de recurso desligada: antes deste lote nenhum código a lia; com a
 * API nova ela passa a retirar o recurso. Cada caso é decidido por uma
 * pessoa; o procedimento lista os ids e para antes do backup, sem ligar,
 * apagar nem ignorar nada. Recurso existente que ficaria negado por outro
 * motivo também para. */
export function conferirExcecoes(impacto) {
  if (impacto.excecoesDesligadas > 0) throw new Parada("ERR_EXCECOES_DE_RECURSO_DESLIGADAS");
  if (impacto.recursosNegados > 0) throw new Parada("ERR_RECURSO_EXISTENTE_SERIA_NEGADO");
}
