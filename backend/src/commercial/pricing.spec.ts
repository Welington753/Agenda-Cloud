import { describe, expect, it } from 'vitest';
import { amountSource, cyclePricing } from './pricing.js';

describe('preço da assinatura', () => {
  it('sugere o contratado em vigor, depois o catálogo, e sem nenhum fica pendente (nunca zero)', () => {
    expect(cyclePricing('MONTHLY', 4990, 3990)).toMatchObject({ suggestedCents: 3990, source: 'CONTRACT' });
    expect(cyclePricing('MONTHLY', 4990, null)).toMatchObject({ suggestedCents: 4990, source: 'CATALOG' });
    expect(cyclePricing('QUARTERLY', null, null)).toEqual({
      cycle: 'QUARTERLY',
      catalogCents: null,
      contractCents: null,
      suggestedCents: null,
      source: 'PENDING',
    });
    // Contrato específico vale mesmo sem preço no catálogo.
    expect(cyclePricing('MONTHLY', null, 2500)).toMatchObject({ suggestedCents: 2500, source: 'CONTRACT' });
  });

  it('origem do valor registrado: contrato, catálogo ou ajuste só daquele pagamento', () => {
    const comContrato = cyclePricing('MONTHLY', 4990, 3990);
    expect(amountSource(3990, comContrato)).toBe('CONTRACT');
    // Igual ao catálogo, mas o cliente tem contrato específico: é ajuste.
    expect(amountSource(4990, comContrato)).toBe('ADJUSTED');
    const soCatalogo = cyclePricing('MONTHLY', 4990, null);
    expect(amountSource(4990, soCatalogo)).toBe('CATALOG');
    expect(amountSource(4500, soCatalogo)).toBe('ADJUSTED');
    expect(amountSource(4500, cyclePricing('MONTHLY', null, null))).toBe('ADJUSTED');
  });
});
