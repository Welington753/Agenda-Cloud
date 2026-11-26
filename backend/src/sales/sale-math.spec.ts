// Vetores do arredondamento por item (docs/plans/vendas-v1.md, seção 4). A
// tabela fica em sale-math-vectors.json, lida também pelo web
// (src/lib/vendas/calculo.test.ts): os dois projetos conferem os MESMOS casos.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAX_SALE_TOTAL_CENTS, MAX_UNIT_PRICE_CENTS, totalAceito, totalDaLinha, totalDaVenda } from './sale-math.js';
import { MAX_MOVEMENT_MILLI } from '../stock/stock-quantity.js';

interface Vetores {
  lines: { unitPriceCents: number; quantityMilli: number; lineTotalCents: number; case: string }[];
  sales: { items: { unitPriceCents: number; quantityMilli: number }[]; totalCents: number; case: string }[];
  outOfRange: { unitPriceCents: number; quantityMilli: number }[];
}

const VETORES = JSON.parse(readFileSync(new URL('./sale-math-vectors.json', import.meta.url), 'utf8')) as Vetores;

describe('totalDaLinha', () => {
  it('a tabela cobre os casos do plano, inclusive os tetos', () => {
    expect(VETORES.lines.some((v) => v.unitPriceCents === MAX_UNIT_PRICE_CENTS && v.quantityMilli === MAX_MOVEMENT_MILLI)).toBe(true);
    expect(VETORES.lines.some((v) => v.unitPriceCents === 1 && v.quantityMilli === 1)).toBe(true);
    expect(VETORES.lines.some((v) => v.unitPriceCents === 1 && v.quantityMilli === 500)).toBe(true);
  });

  it.each(VETORES.lines.map((v) => [v.unitPriceCents, v.quantityMilli, v.lineTotalCents, v.case] as const))(
    '%i centavos × %i milésimos = %i (%s)',
    (preco, quantidade, linha) => {
      expect(totalDaLinha(preco, quantidade)).toBe(linha);
    },
  );

  it('confere a fórmula do banco em BigInt nos vetores', () => {
    for (const v of VETORES.lines) {
      expect(BigInt(v.lineTotalCents)).toBe((BigInt(v.unitPriceCents) * BigInt(v.quantityMilli) + 500n) / 1000n);
    }
  });

  it.each(VETORES.outOfRange.map((v) => [v.unitPriceCents, v.quantityMilli] as const))(
    'recusa preço %s ou quantidade %s fora do limite',
    (preco, quantidade) => {
      expect(() => totalDaLinha(preco, quantidade)).toThrow(RangeError);
    },
  );
});

describe('totalDaVenda', () => {
  it.each(VETORES.sales.map((v) => [v.case, v.items, v.totalCents] as const))('%s', (_caso, itens, total) => {
    expect(totalDaVenda(itens)).toBe(total);
  });

  it('total aceito: pelo menos 1 centavo e no máximo o teto da venda', () => {
    expect(totalAceito(0)).toBe(false);
    expect(totalAceito(1)).toBe(true);
    expect(totalAceito(MAX_SALE_TOTAL_CENTS)).toBe(true);
    expect(totalAceito(MAX_SALE_TOTAL_CENTS + 1)).toBe(false);
  });
});
