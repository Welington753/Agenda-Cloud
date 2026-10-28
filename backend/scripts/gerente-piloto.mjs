// Regras puras da publicação de TeamManagerAccess1793145600000 no piloto
// (aplicar-gerente-piloto.mjs e conferir-restauracao-gerente.mjs). Sem banco,
// rede nem terminal: testadas em gerente-piloto.spec.ts.
//
// Mesmo procedimento de TeamAccess (equipe-piloto.mjs): o modo, o desvio do
// ensaio, a comparação de servidores, a classificação de falhas e a leitura
// do registro são os mesmos e vêm de lá. Só muda o que é DESTA operação: o
// nome, a frase, os estados esperados, as pastas e a avaliação do backup e
// das execuções pendentes (que filtram por operação).
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

export const MIGRATION = "TeamManagerAccess1793145600000";
export const FRASE = `APLICAR ${MIGRATION}`;
export const OPERACAO = `migration_${MIGRATION}`;
export const ESPERADO_ANTES = "before-team-manager";
export const ESPERADO_DEPOIS = "after-team-manager";
export const PREFIXO_DAS_PASTAS = "gerente-";
export const APLICACAO_DA_MIGRATION = "agenda-cloud-migration-gerente";
// Única tabela que ganha coluna: o conteúdo das colunas ANTIGAS é comparado à
// parte. `users` ganha só constraint e gatilho, então o md5 dela não muda.
export const TABELAS_ALTERADAS = ["memberships"];

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

/** O levantamento antes da aplicação precisa estar livre de colisões: com
 * colisão a migration pararia no começo; o procedimento para antes, sem
 * backup novo nem frase. */
export function conferirColisoes(impacto) {
  if (impacto.colisoesCruzadas > 0) throw new Parada("ERR_COLISAO_DE_LOGIN");
}
