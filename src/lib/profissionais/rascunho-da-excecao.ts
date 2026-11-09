// Rascunho do editor da exceção de um serviço (comissões do profissional).
// Sem alteração pendente, o editor mostra sempre o valor gravado, inclusive
// depois de uma operação concluída (remoção das exceções pela regra geral,
// gravação do próprio editor). Quando o valor gravado muda por fora com uma
// alteração ainda não salva (releitura depois de um 409, remoção feita no
// cartão da regra geral), o rascunho continua na tela, com aviso: nada é
// descartado sem o dono pedir.
import { pontosBaseParaCampo, type RegraDeComissao } from "@/lib/api/comissoes-api";
import { centavosParaCampo } from "@/lib/servicos/dinheiro";

export type EscolhaDaExcecao = "USAR_GERAL" | RegraDeComissao["kind"];

export interface CamposDaExcecao {
  escolha: EscolhaDaExcecao;
  valor: string;
}

export interface RascunhoDaExcecao {
  /** O valor gravado quando a edição começou. */
  base: RegraDeComissao | null;
  campos: CamposDaExcecao;
}

export interface EstadoDoEditor {
  campos: CamposDaExcecao;
  /** Há alteração ainda não salva. */
  alterado: boolean;
  /** O valor gravado mudou desde o começo da edição e difere do rascunho. */
  mudouPorFora: boolean;
}

export function camposDaRegra(regra: RegraDeComissao | null): CamposDaExcecao {
  if (regra === null) return { escolha: "USAR_GERAL", valor: "" };
  if (regra.kind === "PERCENTAGE") return { escolha: regra.kind, valor: pontosBaseParaCampo(regra.value ?? 0) };
  if (regra.kind === "FIXED") return { escolha: regra.kind, valor: centavosParaCampo(regra.value) };
  return { escolha: "NONE", valor: "" };
}

const comValor = (e: EscolhaDaExcecao) => e === "PERCENTAGE" || e === "FIXED";

/** O valor digitado só conta nas escolhas que têm valor. */
export function mesmosCampos(a: CamposDaExcecao, b: CamposDaExcecao): boolean {
  return a.escolha === b.escolha && (!comValor(a.escolha) || a.valor.trim() === b.valor.trim());
}

const mesmaRegra = (a: RegraDeComissao | null, b: RegraDeComissao | null) =>
  a === null || b === null ? a === b : a.kind === b.kind && a.value === b.value;

const pendente = (r: RascunhoDaExcecao | null): r is RascunhoDaExcecao =>
  r !== null && !mesmosCampos(r.campos, camposDaRegra(r.base));

export function estadoDoEditor(gravada: RegraDeComissao | null, rascunho: RascunhoDaExcecao | null): EstadoDoEditor {
  if (!pendente(rascunho)) return { campos: camposDaRegra(gravada), alterado: false, mudouPorFora: false };
  return {
    campos: rascunho.campos,
    alterado: true,
    mudouPorFora: !mesmaRegra(rascunho.base, gravada) && !mesmosCampos(rascunho.campos, camposDaRegra(gravada)),
  };
}

/** Rascunho depois de uma edição: a base continua a do começo da edição. */
export function editar(
  gravada: RegraDeComissao | null,
  rascunho: RascunhoDaExcecao | null,
  campos: CamposDaExcecao,
): RascunhoDaExcecao {
  return { base: pendente(rascunho) ? rascunho.base : gravada, campos };
}
