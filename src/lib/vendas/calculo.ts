// Conta da venda na tela (docs/plans/vendas-v1.md, seção 4), a mesma de
// backend/src/sales/sale-math.ts e com os MESMOS vetores
// (backend/src/sales/sale-math-vectors.json, conferidos em calculo.test.ts).
//
// É só uma prévia: a tela nunca envia linha nem total. O servidor recalcula,
// e o valor que vale é o da venda confirmada que ele devolve.
//
// Linha: floor((preço em centavos × quantidade em milésimos + 500) / 1000),
// metade para cima, só com inteiros. O produto máximo (1e8 × 1e9 = 1e17)
// passa do inteiro exato do JavaScript, por isso a conta é em BigInt.

/** Teto do preço unitário (MAX_UNIT_PRICE_CENTS da API): R$ 1.000.000,00. */
export const MAIOR_PRECO_UNITARIO_CENTAVOS = 100_000_000;
/** Teto do total da venda (MAX_SALE_TOTAL_CENTS da API). */
export const MAIOR_TOTAL_CENTAVOS = 10_000_000_000;
/** Teto da quantidade de uma linha (o mesmo de uma movimentação do estoque). */
export const MAIOR_QUANTIDADE_MILLI = 1_000_000_000;
/** Itens por venda (MAX_SALE_ITEMS da API). */
export const MAXIMO_DE_ITENS = 50;

/** Total da linha em centavos, ou `null` fora dos limites (a tela mostra o
 * erro do campo em vez de um valor inventado). */
export function totalDaLinha(precoCentavos: number, quantidadeMilli: number): number | null {
  if (!Number.isSafeInteger(precoCentavos) || precoCentavos < 1 || precoCentavos > MAIOR_PRECO_UNITARIO_CENTAVOS) return null;
  if (!Number.isSafeInteger(quantidadeMilli) || quantidadeMilli < 1 || quantidadeMilli > MAIOR_QUANTIDADE_MILLI) return null;
  return Number((BigInt(precoCentavos) * BigInt(quantidadeMilli) + BigInt(500)) / BigInt(1000));
}

/** Soma das linhas já arredondadas, ou `null` se alguma linha não fecha. */
export function totalDaVenda(itens: readonly { precoCentavos: number; quantidadeMilli: number }[]): number | null {
  let soma = 0;
  for (const item of itens) {
    const linha = totalDaLinha(item.precoCentavos, item.quantidadeMilli);
    if (linha === null) return null;
    soma += linha;
  }
  return soma;
}

/** O total que a API aceita: pelo menos 1 centavo e no máximo o teto. */
export function totalAceito(totalCentavos: number): boolean {
  return totalCentavos >= 1 && totalCentavos <= MAIOR_TOTAL_CENTAVOS;
}
