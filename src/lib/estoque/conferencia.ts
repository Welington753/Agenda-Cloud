// Regras da conferência na tela: o rascunho da contagem, a revisão das
// diferenças e o que muda depois de um 409 `CONFERENCIA_DESATUALIZADA`.
//
// Cada item guarda a unidade e a versão do saldo que a pessoa viu quando
// contou. A API recusa a confirmação se qualquer um dos dois mudou; aqui a
// tela já marca, ao reabrir ou depois da recusa:
// - unidade diferente, produto arquivado ou sumido: "recontar" (o valor
//   contado é apagado; uma contagem em UN não vale para CX);
// - só a versão do saldo mudou: "revisar" (o valor contado fica, a diferença
//   é recalculada sobre o saldo novo e a pessoa confere de novo).
// Nenhum item marcado é enviado.
import { lerQuantidade, MAIOR_SALDO_MILLI, type UnidadeEstoque } from "./quantidade";

export interface ProdutoContavel {
  id: string;
  name: string;
  unit: UnidadeEstoque;
  balanceMilli: number;
  balanceVersion: number;
  archived: boolean;
}

export type SituacaoDoItem = "ok" | "revisar" | "recontar";

export interface ItemDoRascunho {
  productId: string;
  nome: string;
  unit: UnidadeEstoque;
  balanceMilli: number;
  balanceVersion: number;
  contado: string;
  situacao: SituacaoDoItem;
}

export interface Rascunho {
  versao: 1;
  userId: string;
  tenantId: string;
  iniciadoEm: string;
  itens: ItemDoRascunho[];
}

export function novoRascunho(userId: string, tenantId: string, produtos: readonly ProdutoContavel[], agora = new Date()): Rascunho {
  return {
    versao: 1,
    userId,
    tenantId,
    iniciadoEm: agora.toISOString(),
    itens: produtos
      .filter((p) => !p.archived)
      .map((p) => ({
        productId: p.id,
        nome: p.name,
        unit: p.unit,
        balanceMilli: p.balanceMilli,
        balanceVersion: p.balanceVersion,
        contado: "",
        situacao: "ok" as const,
      })),
  };
}

export function anotarContagem(rascunho: Rascunho, productId: string, contado: string): Rascunho {
  return {
    ...rascunho,
    itens: rascunho.itens.map((i) => (i.productId === productId ? { ...i, contado, situacao: i.situacao === "recontar" && contado.trim() ? "ok" : i.situacao } : i)),
  };
}

/** A pessoa conferiu de novo o item marcado "revisar". */
export function confirmarRevisao(rascunho: Rascunho, productId: string): Rascunho {
  return { ...rascunho, itens: rascunho.itens.map((i) => (i.productId === productId && i.situacao === "revisar" ? { ...i, situacao: "ok" } : i)) };
}

export interface EstadoAtual {
  productId: string;
  balanceMilli: number;
  balanceVersion: number;
  unit: UnidadeEstoque;
  archived: boolean;
}

/** Compara com o estado atual (ao reabrir, ou com os itens do 409). Itens
 * que não aparecem em `atuais` só mudam com `completo` (lista inteira dos
 * produtos: quem sumiu deve ser recontado). */
export function reconciliar(rascunho: Rascunho, atuais: readonly EstadoAtual[], completo = false): Rascunho {
  const porId = new Map(atuais.map((a) => [a.productId, a]));
  return {
    ...rascunho,
    itens: rascunho.itens.map((item) => {
      const atual = porId.get(item.productId);
      if (!atual) return completo ? { ...item, contado: "", situacao: "recontar" } : item;
      if (atual.archived || atual.unit !== item.unit) {
        return { ...item, unit: atual.unit, balanceMilli: atual.balanceMilli, balanceVersion: atual.balanceVersion, contado: "", situacao: "recontar" };
      }
      if (atual.balanceVersion !== item.balanceVersion) {
        return { ...item, balanceMilli: atual.balanceMilli, balanceVersion: atual.balanceVersion, situacao: "revisar" };
      }
      return item;
    }),
  };
}

export interface LinhaDaRevisao {
  productId: string;
  nome: string;
  unit: UnidadeEstoque;
  esperadoMilli: number;
  contadoMilli: number;
  diferencaMilli: number;
}

export type Revisao =
  | { ok: true; linhas: LinhaDaRevisao[]; envio: { productId: string; expectedBalanceVersion: number; expectedUnit: UnidadeEstoque; countedMilli: number }[] }
  | { ok: false; erros: Record<string, string> };

/** Itens contados, com a diferença. Item sem valor fica de fora; valor
 * inválido ou item marcado impede a revisão. */
export function revisar(rascunho: Rascunho): Revisao {
  const erros: Record<string, string> = {};
  const linhas: LinhaDaRevisao[] = [];
  const envio: Extract<Revisao, { ok: true }>["envio"] = [];
  for (const item of rascunho.itens) {
    if (item.situacao === "recontar") {
      if (item.contado.trim()) erros[item.productId] = "Conte de novo: o produto mudou.";
      continue;
    }
    if (!item.contado.trim()) continue;
    if (item.situacao === "revisar") {
      erros[item.productId] = "O saldo mudou desde a contagem. Confira de novo.";
      continue;
    }
    const lido = lerQuantidade(item.contado, item.unit, { permitirZero: true, maximoMilli: MAIOR_SALDO_MILLI });
    if (!lido.ok) {
      erros[item.productId] = lido.erro;
      continue;
    }
    linhas.push({
      productId: item.productId,
      nome: item.nome,
      unit: item.unit,
      esperadoMilli: item.balanceMilli,
      contadoMilli: lido.milli,
      diferencaMilli: lido.milli - item.balanceMilli,
    });
    envio.push({ productId: item.productId, expectedBalanceVersion: item.balanceVersion, expectedUnit: item.unit, countedMilli: lido.milli });
  }
  if (Object.keys(erros).length) return { ok: false, erros };
  if (envio.length === 0) return { ok: false, erros: { geral: "Informe a quantidade encontrada de pelo menos um produto." } };
  if (envio.length > 200) return { ok: false, erros: { geral: "Confira no máximo 200 produtos por vez." } };
  return { ok: true, linhas, envio };
}

export function itensMarcados(rascunho: Rascunho): number {
  return rascunho.itens.filter((i) => i.situacao !== "ok").length;
}
