// Regras de tela das exceções por serviço diante de uma regra geral nova,
// na edição individual e na aplicação em massa. Manter é o padrão; remover só
// com escolha e confirmação explícitas, depois de ver quais exceções saem.
// "Substituir a regra geral" sozinho nunca remove exceção. O servidor confere
// tudo de novo e recusa (409) se as exceções mudaram desde a leitura. Ver
// docs/plans/comissoes-aplicacao-em-massa.md.
import { rotuloDaRegra, type RegraDeComissao, type RegrasDoProfissional } from "@/lib/api/comissoes-api";
import type { EscolhaDeExcecoes, PreviaEmMassa } from "@/lib/api/comissoes-em-massa-api";

export interface ExcecaoListada {
  serviceId: string;
  nome: string;
  /** "15%", "Sem comissão" ou "R$ 5,00 fixo". */
  regra: string;
}

const listar = (itens: readonly { service: { id: string; name: string }; rule: RegraDeComissao | null }[]): ExcecaoListada[] =>
  itens.flatMap((s) => (s.rule === null ? [] : [{ serviceId: s.service.id, nome: s.service.name, regra: rotuloDaRegra(s.rule) }]));

/** As exceções gravadas do profissional (inclusive "Sem comissão" e as de
 * serviços que ele não atende mais), na ordem da tela. */
export function excecoesDoProfissional(regras: Pick<RegrasDoProfissional, "services">): ExcecaoListada[] {
  return listar(regras.services);
}

/** "Barba (15%), Corte (Sem comissão)". */
export function descreverExcecoes(excecoes: readonly ExcecaoListada[]): string {
  return excecoes.map((e) => `${e.nome} (${e.regra})`).join(", ");
}

/** "1 exceção" ou "3 exceções". */
export function quantasExcecoes(n: number): string {
  return n === 1 ? "1 exceção" : `${n} exceções`;
}

export const ROTULO_ESCOLHA_EXCECOES: Record<EscolhaDeExcecoes, { titulo: string; descricao: string }> = {
  KEEP: {
    titulo: "Manter exceções por serviço",
    descricao: "As exceções continuam valendo no lugar da regra geral nos serviços em que existem.",
  },
  REMOVE: {
    titulo: "Remover exceções por serviço",
    descricao: "Apaga as exceções para que a regra geral valha em todos os serviços. Comissões já apuradas não mudam.",
  },
};

/** Lembrete fixo: trocar a regra geral não mexe nas exceções. */
export const AVISO_SUBSTITUIR_NAO_REMOVE =
  "Trocar ou substituir a regra geral sozinho não remove exceções por serviço: para isso, escolha “Remover exceções por serviço”.";

export function textoConfirmacaoRemocaoIndividual(nomeDoProfissional: string, n: number): string {
  return `Entendo que ${n === 1 ? "a exceção por serviço" : `as ${n} exceções por serviço`} de ${nomeDoProfissional} ${
    n === 1 ? "será removida" : "serão removidas"
  } e que a regra geral passará a valer em todos os serviços.`;
}

export function textoConfirmacaoRemocaoEmMassa(excecoes: number, profissionais: number): string {
  const quem = profissionais === 1 ? "de 1 profissional" : `de ${profissionais} profissionais`;
  return `Entendo que ${excecoes === 1 ? "1 exceção por serviço" : `${excecoes} exceções por serviço`} ${quem} ${
    excecoes === 1 ? "será removida" : "serão removidas"
  } e que a regra geral passará a valer em todos os serviços deles.`;
}

/** Profissionais da prévia que perdem exceções, com a lista de cada um. */
export function remocoesDaPrevia(previa: Pick<PreviaEmMassa, "professionals">) {
  return previa.professionals
    .filter((p) => p.exceptions.removed && p.exceptions.services.length > 0)
    .map((p) => ({ id: p.professional.id, nome: p.professional.name, excecoes: listar(p.exceptions.services) }));
}

/** Linha de exceções de um profissional na prévia ou no resultado. Vazio sem
 * exceções. */
export function rotuloDasExcecoesNaPrevia(
  excecoes: PreviaEmMassa["professionals"][number]["exceptions"],
  aplicado: boolean,
): string {
  const n = excecoes.services.length;
  if (n === 0) return "";
  const lista = descreverExcecoes(listar(excecoes.services));
  if (excecoes.removed) {
    const verbo = aplicado ? (n === 1 ? "removida" : "removidas") : n === 1 ? "será removida" : "serão removidas";
    return `${quantasExcecoes(n)} ${verbo}: ${lista}`;
  }
  return `${quantasExcecoes(n)} ${n === 1 ? "mantida" : "mantidas"}: ${lista}`;
}

/** 409 da edição individual: as exceções mudaram desde a leitura. */
export const MENSAGEM_EXCECOES_DESATUALIZADAS =
  "As exceções por serviço deste profissional mudaram. A lista foi atualizada: confira e confirme de novo antes de remover.";
