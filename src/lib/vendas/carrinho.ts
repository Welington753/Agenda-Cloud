// Carrinho da nova venda: regras puras, sem React (componente só desenha).
//
// - Uma linha por produto, até 50. Cada linha guarda o preço sugerido que a
//   tela mostrou: ele vai no pedido (`expectedSuggestedPriceCents`) para o
//   servidor recusar se mudou enquanto a tela estava aberta.
// - Preço diferente do sugerido, ou produto sem preço sugerido, só para quem
//   pode alterar o preço. Sem essa permissão o campo nem é editável: o preço
//   é o sugerido.
// - Os totais são prévia (lib/vendas/calculo.ts). O que vale é a venda
//   confirmada que o servidor devolve.
// - Cliente: nulo (balcão) ou o ID escolhido por toque num resultado da busca
//   limitada. O texto digitado nunca escolhe ninguém (ver cliente.ts).
import type { CorpoDaVenda, ProdutoParaVenda } from "@/lib/api/vendas-api";
import { lerQuantidade, type UnidadeEstoque } from "@/lib/estoque/quantidade";
import { centavosParaCampo, precoParaCentavos } from "@/lib/servicos/dinheiro";
import {
  MAIOR_PRECO_UNITARIO_CENTAVOS,
  MAIOR_QUANTIDADE_MILLI,
  MAIOR_TOTAL_CENTAVOS,
  MAXIMO_DE_ITENS,
  totalDaLinha,
} from "./calculo";

export interface LinhaDoCarrinho {
  productId: string;
  nome: string;
  unidade: UnidadeEstoque;
  /** Preço sugerido que a tela mostrou (`null`: sem preço sugerido). */
  sugeridoCentavos: number | null;
  /** Texto do campo de quantidade, na unidade do produto. */
  quantidade: string;
  /** Texto do campo de preço unitário. Sem permissão, fica no sugerido. */
  preco: string;
  /** Recusa do servidor ligada a esta linha (saldo, unidade, preço). */
  aviso: string | null;
}

export interface LinhaAvaliada extends LinhaDoCarrinho {
  quantidadeMilli: number | null;
  precoCentavos: number | null;
  totalCentavos: number | null;
  /** O preço aplicado difere do sugerido (ou não havia sugerido). */
  precoAlterado: boolean;
  erro: string | null;
}

export interface CarrinhoAvaliado {
  linhas: LinhaAvaliada[];
  /** Prévia do total, ou `null` enquanto alguma linha não fecha. */
  totalCentavos: number | null;
  /** O que impede confirmar (a tela mostra junto do botão). */
  problema: string | null;
}

export function novaLinha(produto: Pick<ProdutoParaVenda, "id" | "name" | "unit" | "salePriceCents">): LinhaDoCarrinho {
  return {
    productId: produto.id,
    nome: produto.name,
    unidade: produto.unit,
    sugeridoCentavos: produto.salePriceCents,
    quantidade: "1",
    preco: centavosParaCampo(produto.salePriceCents),
    aviso: null,
  };
}

/** Acrescenta o produto (uma linha por produto, até o máximo). Produto já no
 * carrinho não duplica: a tela leva a pessoa à linha existente. */
export function adicionarProduto(
  linhas: readonly LinhaDoCarrinho[],
  produto: Pick<ProdutoParaVenda, "id" | "name" | "unit" | "salePriceCents">,
): { linhas: LinhaDoCarrinho[]; resultado: "adicionado" | "ja-no-carrinho" | "limite" } {
  if (linhas.some((l) => l.productId === produto.id)) return { linhas: [...linhas], resultado: "ja-no-carrinho" };
  if (linhas.length >= MAXIMO_DE_ITENS) return { linhas: [...linhas], resultado: "limite" };
  return { linhas: [...linhas, novaLinha(produto)], resultado: "adicionado" };
}

export function alterarLinha(
  linhas: readonly LinhaDoCarrinho[],
  productId: string,
  mudanca: Partial<Pick<LinhaDoCarrinho, "quantidade" | "preco">>,
): LinhaDoCarrinho[] {
  return linhas.map((l) => (l.productId === productId ? { ...l, ...mudanca, aviso: null } : l));
}

export function removerLinha(linhas: readonly LinhaDoCarrinho[], productId: string): LinhaDoCarrinho[] {
  return linhas.filter((l) => l.productId !== productId);
}

function lerPreco(linha: LinhaDoCarrinho, podeAlterarPreco: boolean): { centavos: number | null; erro: string | null } {
  if (!podeAlterarPreco) {
    if (linha.sugeridoCentavos === null) {
      return { centavos: null, erro: "Produto sem preço sugerido: só quem pode alterar o preço vende este produto." };
    }
    return { centavos: linha.sugeridoCentavos, erro: null };
  }
  const lido = precoParaCentavos(linha.preco);
  if (!lido.ok) return { centavos: null, erro: lido.erro };
  if (lido.centavos === null) return { centavos: null, erro: "Informe o preço unitário." };
  if (lido.centavos < 1) return { centavos: null, erro: "O preço precisa ser maior que zero." };
  if (lido.centavos > MAIOR_PRECO_UNITARIO_CENTAVOS) return { centavos: null, erro: "Preço acima do máximo aceito." };
  return { centavos: lido.centavos, erro: null };
}

export function avaliarCarrinho(linhas: readonly LinhaDoCarrinho[], podeAlterarPreco: boolean): CarrinhoAvaliado {
  let soma: number | null = 0;
  const avaliadas = linhas.map((l): LinhaAvaliada => {
    const q = lerQuantidade(l.quantidade, l.unidade, { maximoMilli: MAIOR_QUANTIDADE_MILLI });
    const p = lerPreco(l, podeAlterarPreco);
    const quantidadeMilli = q.ok ? q.milli : null;
    const total = quantidadeMilli !== null && p.centavos !== null ? totalDaLinha(p.centavos, quantidadeMilli) : null;
    if (total === null) soma = null;
    else if (soma !== null) soma += total;
    return {
      ...l,
      quantidadeMilli,
      precoCentavos: p.centavos,
      totalCentavos: total,
      precoAlterado: p.centavos !== null && p.centavos !== l.sugeridoCentavos,
      erro: q.ok ? p.erro : q.erro,
    };
  });
  let problema: string | null = null;
  if (avaliadas.length === 0) problema = "Escolha pelo menos um produto.";
  else if (avaliadas.some((l) => l.erro)) problema = "Confira as linhas marcadas.";
  else if (soma !== null && soma < 1) problema = "O total da venda precisa ser de pelo menos R$ 0,01.";
  else if (soma !== null && soma > MAIOR_TOTAL_CENTAVOS) problema = "Total acima do máximo aceito numa venda.";
  return { linhas: avaliadas, totalCentavos: soma, problema };
}

/** Corpo do `POST sales`, ou `null` enquanto o carrinho não fecha. Nunca leva
 * total nem linha: o servidor calcula. */
export function corpoDaVenda(
  avaliado: CarrinhoAvaliado,
  consumerId: string | null,
  requestKey: string,
): CorpoDaVenda | null {
  if (avaliado.problema) return null;
  return {
    requestKey,
    consumerId,
    items: avaliado.linhas.map((l) => ({
      productId: l.productId,
      quantityMilli: l.quantidadeMilli!,
      expectedUnit: l.unidade,
      expectedSuggestedPriceCents: l.sugeridoCentavos,
      unitPriceCents: l.precoCentavos!,
    })),
  };
}

/**
 * Aplica ao carrinho uma recusa do servidor que cita produtos. Nada foi
 * gravado; a pessoa confere e confirma de novo.
 *
 * - `PRECO_ALTERADO`: o sugerido passa ao atual. Quem não pode alterar o
 *   preço passa a vender pelo novo; quem pode, mantém o que digitou, mas vê o
 *   aviso.
 * - `UNIDADE_ALTERADA`: a unidade passa à atual e a quantidade é conferida de
 *   novo.
 * - `SALDO_INSUFICIENTE`: só o aviso (com o saldo apenas quando o servidor o
 *   mandou, isto é, para quem vê o estoque).
 */
export function aplicarRecusa(
  linhas: readonly LinhaDoCarrinho[],
  codigo: string | null,
  produtos: readonly { productId: string; unit?: UnidadeEstoque; salePriceCents?: number | null; balanceMilli?: number }[],
  formatarSaldo: (milli: number, unidade: UnidadeEstoque) => string,
): LinhaDoCarrinho[] {
  return linhas.map((l) => {
    const p = produtos.find((x) => x.productId === l.productId);
    if (!p) return l;
    if (codigo === "PRECO_ALTERADO" && p.salePriceCents !== undefined) {
      const novo = p.salePriceCents;
      const digitouOutro = precoParaCentavos(l.preco);
      const manteve = digitouOutro.ok && digitouOutro.centavos === l.sugeridoCentavos;
      return {
        ...l,
        sugeridoCentavos: novo,
        preco: manteve ? centavosParaCampo(novo) : l.preco,
        aviso: novo === null ? "Este produto ficou sem preço sugerido." : `O preço sugerido mudou para ${formatarCentavos(novo)}.`,
      };
    }
    if (codigo === "UNIDADE_ALTERADA" && p.unit) {
      return { ...l, unidade: p.unit, aviso: `A unidade deste produto mudou para ${p.unit}. Confira a quantidade.` };
    }
    if (codigo === "SALDO_INSUFICIENTE") {
      return {
        ...l,
        aviso:
          p.balanceMilli === undefined
            ? "Quantidade acima do disponível."
            : `Quantidade acima do disponível (saldo: ${formatarSaldo(p.balanceMilli, l.unidade)}).`,
      };
    }
    return l;
  });
}

function formatarCentavos(centavos: number): string {
  return (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Produtos citados num 409 (`UNIDADE_ALTERADA`, `PRECO_ALTERADO`,
 * `SALDO_INSUFICIENTE`), já validados. */
export function produtosDaRecusa(dados: unknown): { productId: string; unit?: UnidadeEstoque; salePriceCents?: number | null; name?: string; balanceMilli?: number }[] {
  if (!ehObjeto(dados) || !Array.isArray(dados.products)) return [];
  return dados.products.filter(
    (p): p is { productId: string } =>
      ehObjeto(p) &&
      typeof p.productId === "string" &&
      (p.unit === undefined || UNIDADES_DA_RECUSA.includes(p.unit)) &&
      (p.salePriceCents === undefined || p.salePriceCents === null || Number.isSafeInteger(p.salePriceCents)) &&
      (p.name === undefined || typeof p.name === "string") &&
      (p.balanceMilli === undefined || Number.isSafeInteger(p.balanceMilli)),
  );
}

const ehObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const UNIDADES_DA_RECUSA: readonly unknown[] = ["UN", "CX", "PCT", "FR", "G", "ML", "KG", "L"];
