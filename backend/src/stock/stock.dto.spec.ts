import { describe, expect, it } from 'vitest';
import { createCountSchema, createMovementSchema, createProductSchema, reverseMovementSchema, updateProductSchema } from './stock.dto.js';

const chave = 'chave_de_teste_0001';

describe('corpos do estoque (zod estrito)', () => {
  const produto = {
    requestKey: chave,
    name: ' Pomada modeladora ',
    categoryId: 'cat_1',
    purpose: 'VENDA',
    unit: 'UN',
    minQuantityMilli: 2000,
  };

  it('produto: normaliza textos e aceita saldo inicial inteiro na unidade', () => {
    const r = createProductSchema.parse({ ...produto, description: '  ', initialQuantityMilli: 5000 });
    expect(r.name).toBe('Pomada modeladora');
    expect(r.description).toBeNull();
    expect(r.subcategoryId).toBeNull();
    expect(r.initialQuantityMilli).toBe(5000);
  });

  it('produto: recusa casas que a unidade não aceita, campo a mais e saldo no corpo', () => {
    expect(createProductSchema.safeParse({ ...produto, initialQuantityMilli: 1500 }).success).toBe(false);
    expect(createProductSchema.safeParse({ ...produto, minQuantityMilli: 500 }).success).toBe(false);
    expect(createProductSchema.safeParse({ ...produto, unit: 'KG', minQuantityMilli: 500 }).success).toBe(true);
    expect(createProductSchema.safeParse({ ...produto, tenantId: 'x' }).success).toBe(false);
    const { requestKey: _r, ...edicao } = produto;
    const base = { ...edicao, expectedUpdatedAt: '2026-11-18T10:00:00.000Z' };
    expect(updateProductSchema.safeParse(base).success).toBe(true);
    expect(updateProductSchema.safeParse({ ...base, balanceMilli: 9000 }).success).toBe(false);
    expect(updateProductSchema.safeParse({ ...base, unit: 'XX' }).success).toBe(false);
  });

  it('movimentação: quantidade positiva e inteira em milésimos, motivo obrigatório na perda', () => {
    const base = { requestKey: chave, productId: 'p1', kind: 'ENTRADA_COMPRA', quantityMilli: 3000, expectedUnit: 'UN' };
    expect(createMovementSchema.safeParse(base).success).toBe(true);
    expect(createMovementSchema.safeParse({ ...base, quantityMilli: 0 }).success).toBe(false);
    expect(createMovementSchema.safeParse({ ...base, quantityMilli: -1000 }).success).toBe(false);
    expect(createMovementSchema.safeParse({ ...base, quantityMilli: 1.5 }).success).toBe(false);
    expect(createMovementSchema.safeParse({ ...base, quantityMilli: 1500 }).success).toBe(false);
    expect(createMovementSchema.safeParse({ ...base, expectedUnit: 'KG', quantityMilli: 1500 }).success).toBe(true);
    expect(createMovementSchema.safeParse({ ...base, kind: 'SAIDA_PERDA' }).success).toBe(false);
    // Perda: motivo ausente, vazio ou curto é recusado; 3 letras bastam.
    for (const reason of [undefined, null, '', '   ', 'ab', ' a  ']) {
      expect(createMovementSchema.safeParse({ ...base, kind: 'SAIDA_PERDA', reason }).success, String(reason)).toBe(false);
    }
    expect(createMovementSchema.safeParse({ ...base, kind: 'SAIDA_PERDA', reason: 'Quebrou' }).success).toBe(true);
    expect(createMovementSchema.safeParse({ ...base, kind: 'SAIDA_PERDA', reason: ' abc ' }).data?.reason).toBe('abc');
    // Ajuste, estorno e saldo inicial não entram por aqui.
    for (const kind of ['AJUSTE_CONFERENCIA', 'ESTORNO', 'SALDO_INICIAL']) {
      expect(createMovementSchema.safeParse({ ...base, kind, reason: 'Motivo' }).success, kind).toBe(false);
    }
  });

  it('estorno: motivo obrigatório, com pelo menos 3 letras', () => {
    for (const reason of [undefined, null, '', '   ', 'ab']) {
      expect(reverseMovementSchema.safeParse({ requestKey: chave, reason }).success, String(reason)).toBe(false);
    }
    expect(reverseMovementSchema.safeParse({ requestKey: chave, reason: ' Lançado errado ' }).data?.reason).toBe('Lançado errado');
  });

  it('conferência: motivo chega normalizado ao serviço (vazio vira null), que decide se é obrigatório', () => {
    const item = { productId: 'p1', expectedBalanceVersion: 0, expectedUnit: 'UN', countedMilli: 0 };
    expect(createCountSchema.parse({ requestKey: chave, items: [item] }).note).toBeNull();
    expect(createCountSchema.parse({ requestKey: chave, note: '   ', items: [item] }).note).toBeNull();
    expect(createCountSchema.parse({ requestKey: chave, note: '  Fechamento   do mês ', items: [item] }).note).toBe('Fechamento do mês');
  });

  it('conferência: 1 a 200 itens, sem produto repetido, casas pela unidade esperada', () => {
    const item = { productId: 'p1', expectedBalanceVersion: 0, expectedUnit: 'UN', countedMilli: 0 };
    expect(createCountSchema.safeParse({ requestKey: chave, items: [item] }).success).toBe(true);
    expect(createCountSchema.safeParse({ requestKey: chave, items: [] }).success).toBe(false);
    expect(createCountSchema.safeParse({ requestKey: chave, items: [item, item] }).success).toBe(false);
    expect(createCountSchema.safeParse({ requestKey: chave, items: [{ ...item, countedMilli: 500 }] }).success).toBe(false);
    const muitos = Array.from({ length: 201 }, (_, i) => ({ ...item, productId: `p${i}` }));
    expect(createCountSchema.safeParse({ requestKey: chave, items: muitos }).success).toBe(false);
  });
});
