import { describe, expect, it } from 'vitest';
import {
  impressaoDaConferencia,
  impressaoDaMovimentacao,
  impressaoDoEstorno,
  impressaoDoProduto,
} from './stock-request-fingerprint.js';

const movimento = { kind: 'SAIDA_VENDA', productId: 'p1', quantityMilli: 2000, expectedUnit: 'UN', reason: 'Cliente  levou ' };

describe('impressão digital dos envios do estoque', () => {
  it('é estável e normaliza espaços e vazio', () => {
    const a = impressaoDaMovimentacao(movimento);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(impressaoDaMovimentacao({ ...movimento, reason: 'Cliente levou' })).toBe(a);
    expect(impressaoDaMovimentacao({ ...movimento, reason: '   ' })).toBe(impressaoDaMovimentacao({ ...movimento, reason: null }));
  });

  it.each([
    ['produto', { productId: 'p2' }],
    ['quantidade', { quantityMilli: 3000 }],
    ['tipo', { kind: 'SAIDA_CONSUMO' }],
    ['unidade esperada', { expectedUnit: 'CX' }],
    ['motivo', { reason: 'Outro motivo' }],
  ])('muda quando muda %s', (_nome, mudanca) => {
    expect(impressaoDaMovimentacao({ ...movimento, ...mudanca })).not.toBe(impressaoDaMovimentacao(movimento));
  });

  it('conferência: a ordem dos itens não importa; contagem, versão ou unidade diferente importam', () => {
    const itens = [
      { productId: 'b', expectedBalanceVersion: 2, expectedUnit: 'UN', countedMilli: 4000 },
      { productId: 'a', expectedBalanceVersion: 0, expectedUnit: 'KG', countedMilli: 1500 },
    ];
    const base = impressaoDaConferencia({ note: null, items: itens });
    expect(impressaoDaConferencia({ note: '', items: [...itens].reverse() })).toBe(base);
    expect(impressaoDaConferencia({ note: null, items: [{ ...itens[0], countedMilli: 5000 }, itens[1]] })).not.toBe(base);
    expect(impressaoDaConferencia({ note: null, items: [{ ...itens[0], expectedUnit: 'CX' }, itens[1]] })).not.toBe(base);
    expect(impressaoDaConferencia({ note: null, items: [{ ...itens[0], expectedBalanceVersion: 3 }, itens[1]] })).not.toBe(base);
    expect(impressaoDaConferencia({ note: null, items: [itens[0]] })).not.toBe(base);
  });

  it('produto e estorno têm operações próprias (mesmos dados, impressões diferentes)', () => {
    const produto = {
      name: 'Pomada',
      categoryId: 'c1',
      subcategoryId: null,
      purpose: 'VENDA',
      unit: 'UN',
      minQuantityMilli: 0,
      initialQuantityMilli: null,
    };
    expect(impressaoDoProduto(produto)).toBe(impressaoDoProduto({ ...produto, initialQuantityMilli: 0, description: ' ' }));
    expect(impressaoDoProduto({ ...produto, initialQuantityMilli: 1000 })).not.toBe(impressaoDoProduto(produto));
    expect(impressaoDoEstorno({ movementId: 'm1', reason: 'Lançado errado' })).not.toBe(
      impressaoDoEstorno({ movementId: 'm2', reason: 'Lançado errado' }),
    );
  });
});
