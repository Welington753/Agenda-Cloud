// Valores de uma venda, calculados só no servidor (docs/plans/vendas-v1.md,
// seção 4). A tela mostra a mesma conta (src/lib/vendas/calculo.ts, PR 4,
// com os mesmos vetores de sale-math.spec.ts), mas nunca manda total nem
// linha: o servidor recalcula e o banco confere de novo
// (`ck_sale_items_line` e o gatilho diferido `ck_sales_consistency`).
//
// Linha: `floor((preço unitário em centavos × quantidade em milésimos + 500)
// / 1000)`, metade para cima, só com inteiros. Total: soma das linhas, sem
// novo arredondamento. O produto máximo (100.000.000 × 1.000.000.000 = 1e17)
// passa do inteiro exato do JavaScript (2^53), por isso a conta é em BigInt;
// a linha máxima (1e14) volta a caber em `number`.
import { MAX_SALE_TOTAL_CENTS, MAX_UNIT_PRICE_CENTS } from '../migrations/1794614400000-SalesModule.js';
import { MAX_MOVEMENT_MILLI, MILLI } from '../stock/stock-quantity.js';

export { MAX_SALE_TOTAL_CENTS, MAX_UNIT_PRICE_CENTS };

/** Itens por venda (seção 4). */
export const MAX_SALE_ITEMS = 50;

const MIL = BigInt(MILLI);
const MEIO = MIL / 2n;

/** Total da linha em centavos. Recusa entrada fora dos limites do banco. */
export function totalDaLinha(unitPriceCents: number, quantityMilli: number): number {
  if (!Number.isSafeInteger(unitPriceCents) || unitPriceCents < 1 || unitPriceCents > MAX_UNIT_PRICE_CENTS) {
    throw new RangeError('Preço unitário fora do limite.');
  }
  if (!Number.isSafeInteger(quantityMilli) || quantityMilli < 1 || quantityMilli > MAX_MOVEMENT_MILLI) {
    throw new RangeError('Quantidade fora do limite.');
  }
  return Number((BigInt(unitPriceCents) * BigInt(quantityMilli) + MEIO) / MIL);
}

/** Total da venda: soma das linhas já arredondadas. */
export function totalDaVenda(itens: readonly { unitPriceCents: number; quantityMilli: number }[]): number {
  return itens.reduce((soma, i) => soma + totalDaLinha(i.unitPriceCents, i.quantityMilli), 0);
}

/** Total que o banco aceita (`ck_sales_total`): pelo menos 1 centavo e no
 * máximo o teto da venda. Linhas de 0 centavo existem (0,001 KG a R$ 0,01),
 * mas a venda inteira não pode ser zero. */
export function totalAceito(totalCents: number): boolean {
  return totalCents >= 1 && totalCents <= MAX_SALE_TOTAL_CENTS;
}
