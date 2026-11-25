// Vetores do arredondamento por item (docs/plans/vendas-v1.md, seção 4). O
// web (src/lib/vendas/calculo.ts, PR 4) usa a MESMA tabela.
import { describe, expect, it } from 'vitest';
import { MAX_SALE_TOTAL_CENTS, MAX_UNIT_PRICE_CENTS, totalAceito, totalDaLinha, totalDaVenda } from './sale-math.js';
import { MAX_MOVEMENT_MILLI } from '../stock/stock-quantity.js';

const VETORES_DA_LINHA: readonly [preco: number, quantidade: number, linha: number, caso: string][] = [
  [1, 1, 0, '0,001 KG a R$ 0,01: menos de meio centavo'],
  [1, 500, 1, 'meio centavo exato sobe'],
  [1, 499, 0, 'logo abaixo de meio centavo desce'],
  [3, 500, 2, '1,5 centavo sobe para 2'],
  [1999, 1000, 1999, '1 UN a R$ 19,99'],
  [1999, 3000, 5997, '3 UN a R$ 19,99'],
  [4590, 1250, 5738, '1,250 KG a R$ 45,90 (5737,5 sobe)'],
  [4590, 333, 1528, '0,333 KG a R$ 45,90 (1528,47 desce)'],
  [MAX_UNIT_PRICE_CENTS, MAX_MOVEMENT_MILLI, 100_000_000_000_000, 'teto de preço × teto de quantidade (1e17 no meio da conta)'],
  [MAX_UNIT_PRICE_CENTS - 1, MAX_MOVEMENT_MILLI - 1, 99_999_998_900_000, 'perto do teto, sem perder precisão'],
];

describe('totalDaLinha', () => {
  it.each(VETORES_DA_LINHA)('%i centavos × %i milésimos = %i (%s)', (preco, quantidade, linha) => {
    expect(totalDaLinha(preco, quantidade)).toBe(linha);
  });

  it('confere a fórmula do banco em BigInt nos vetores', () => {
    for (const [preco, quantidade, linha] of VETORES_DA_LINHA) {
      expect(BigInt(linha)).toBe((BigInt(preco) * BigInt(quantidade) + 500n) / 1000n);
    }
  });

  it.each([
    [0, 1000],
    [MAX_UNIT_PRICE_CENTS + 1, 1000],
    [1.5, 1000],
    [100, 0],
    [100, MAX_MOVEMENT_MILLI + 1],
    [100, 1.5],
  ])('recusa preço %s ou quantidade %s fora do limite', (preco, quantidade) => {
    expect(() => totalDaLinha(preco, quantidade)).toThrow(RangeError);
  });
});

describe('totalDaVenda', () => {
  it('soma as linhas já arredondadas, sem novo arredondamento', () => {
    // 0,5 + 0,5 centavo: cada linha sobe para 1; o total é 2, não round(1,0) = 1.
    expect(totalDaVenda([{ unitPriceCents: 1, quantityMilli: 500 }, { unitPriceCents: 1, quantityMilli: 500 }])).toBe(2);
    expect(totalDaVenda([{ unitPriceCents: 1999, quantityMilli: 2000 }, { unitPriceCents: 4590, quantityMilli: 1250 }])).toBe(3998 + 5738);
  });

  it('total aceito: pelo menos 1 centavo e no máximo o teto da venda', () => {
    expect(totalAceito(0)).toBe(false);
    expect(totalAceito(1)).toBe(true);
    expect(totalAceito(MAX_SALE_TOTAL_CENTS)).toBe(true);
    expect(totalAceito(MAX_SALE_TOTAL_CENTS + 1)).toBe(false);
  });
});
