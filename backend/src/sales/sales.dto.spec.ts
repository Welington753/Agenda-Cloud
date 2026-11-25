// Corpo das rotas de vendas e impressão digital do pedido.
import { describe, expect, it } from 'vitest';
import {
  cancelSaleSchema,
  createSaleSchema,
  recordSalePaymentSchema,
  saleConsumerSearchSchema,
  saleListQuerySchema,
} from './sales.dto.js';
import { impressaoDaVenda, mesmoMotivo, mesmoRecebimento } from './sale-request-fingerprint.js';
import { MAX_SALE_ITEMS, MAX_UNIT_PRICE_CENTS } from './sale-math.js';

const CHAVE = 'chave-de-teste-0001';
const item = (extra: Record<string, unknown> = {}) => ({
  productId: 'prod_1',
  quantityMilli: 2000,
  expectedUnit: 'UN',
  expectedSuggestedPriceCents: 1500,
  unitPriceCents: 1500,
  ...extra,
});
const venda = (extra: Record<string, unknown> = {}) => ({ requestKey: CHAVE, consumerId: null, items: [item()], ...extra });

describe('createSaleSchema', () => {
  it('aceita venda de balcão e venda com cliente por id', () => {
    expect(createSaleSchema.safeParse(venda()).success).toBe(true);
    expect(createSaleSchema.safeParse(venda({ consumerId: 'cons_1' })).success).toBe(true);
    expect(createSaleSchema.safeParse(venda({ items: [item({ expectedSuggestedPriceCents: null })] })).success).toBe(true);
  });

  it.each([
    ['total vindo da tela', venda({ totalCents: 3000 })],
    ['linha vinda da tela', venda({ items: [item({ lineTotalCents: 3000 })] })],
    ['autor no corpo', venda({ recordedByUserId: 'u' })],
    ['estabelecimento no corpo', venda({ tenantId: 't' })],
    ['cliente pelo nome', venda({ consumerName: 'Ana' })],
    ['sem itens', venda({ items: [] })],
    ['acima de 50 itens', venda({ items: Array.from({ length: MAX_SALE_ITEMS + 1 }, (_, i) => item({ productId: `p${i}` })) })],
    ['produto repetido', venda({ items: [item(), item({ quantityMilli: 1000 })] })],
    ['quantidade com vírgula', venda({ items: [item({ quantityMilli: 1.5 })] })],
    ['casas que a unidade não aceita', venda({ items: [item({ quantityMilli: 1500 })] })],
    ['preço zero (ausência de preço não é zero)', venda({ items: [item({ unitPriceCents: 0 })] })],
    ['preço sugerido zero', venda({ items: [item({ expectedSuggestedPriceCents: 0 })] })],
    ['preço sugerido omitido', venda({ items: [item({ expectedSuggestedPriceCents: undefined })] })],
    ['preço acima do teto', venda({ items: [item({ unitPriceCents: MAX_UNIT_PRICE_CENTS + 1 })] })],
    ['total abaixo de 1 centavo', venda({ items: [item({ expectedUnit: 'KG', quantityMilli: 1, unitPriceCents: 1, expectedSuggestedPriceCents: 1 })] })],
    ['chave curta', venda({ requestKey: 'curta' })],
  ])('recusa %s', (_, corpo) => {
    expect(createSaleSchema.safeParse(corpo).success).toBe(false);
  });

  it('aceita fração em KG e L', () => {
    expect(createSaleSchema.safeParse(venda({ items: [item({ expectedUnit: 'KG', quantityMilli: 1250 })] })).success).toBe(true);
  });
});

describe('demais corpos', () => {
  it('cancelamento e estorno exigem motivo de 3 letras; espaços colapsados', () => {
    expect(cancelSaleSchema.safeParse({ reason: 'ab' }).success).toBe(false);
    expect(cancelSaleSchema.parse({ reason: '  Cliente   desistiu ' })).toEqual({ reason: 'Cliente desistiu' });
    expect(cancelSaleSchema.safeParse({ reason: 'Cliente desistiu', password: 'x' }).success).toBe(false);
  });

  it('recebimento: sem valor no corpo (o servidor usa o total), uma das seis formas', () => {
    const base = { requestKey: CHAVE, method: 'PIX', receivedOn: '2026-11-25' };
    expect(recordSalePaymentSchema.parse(base)).toEqual({ ...base, notes: null });
    expect(recordSalePaymentSchema.safeParse({ ...base, amountCents: 100 }).success).toBe(false);
    expect(recordSalePaymentSchema.safeParse({ ...base, method: 'BOLETO_FALSO' }).success).toBe(false);
  });

  it('busca de clientes: pelo menos 2 caracteres', () => {
    expect(saleConsumerSearchSchema.safeParse({ q: 'a' }).success).toBe(false);
    expect(saleConsumerSearchSchema.safeParse({ q: 'an' }).success).toBe(true);
  });

  it('listas: escopo próprio por padrão; período com as duas datas, até 366 dias', () => {
    expect(saleListQuerySchema.parse({})).toMatchObject({ scope: 'mine' });
    expect(saleListQuerySchema.safeParse({ from: '2026-11-01' }).success).toBe(false);
    expect(saleListQuerySchema.safeParse({ from: '2026-11-10', to: '2026-11-01' }).success).toBe(false);
    expect(saleListQuerySchema.safeParse({ from: '2025-01-01', to: '2026-11-01' }).success).toBe(false);
    expect(saleListQuerySchema.safeParse({ scope: 'todas' }).success).toBe(false);
  });
});

describe('impressão digital', () => {
  it('a ordem dos itens não muda a venda; qualquer dado diferente muda', () => {
    const a = { consumerId: null, items: [item(), item({ productId: 'prod_2' })] } as never;
    const b = { consumerId: null, items: [item({ productId: 'prod_2' }), item()] } as never;
    expect(impressaoDaVenda(a)).toBe(impressaoDaVenda(b));
    expect(impressaoDaVenda(a)).toMatch(/^[0-9a-f]{64}$/);
    for (const mudanca of [
      { consumerId: 'cons_1', items: [item(), item({ productId: 'prod_2' })] },
      { consumerId: null, items: [item({ quantityMilli: 3000 }), item({ productId: 'prod_2' })] },
      { consumerId: null, items: [item({ unitPriceCents: 1400 }), item({ productId: 'prod_2' })] },
      { consumerId: null, items: [item({ expectedSuggestedPriceCents: null }), item({ productId: 'prod_2' })] },
      { consumerId: null, items: [item()] },
    ]) {
      expect(impressaoDaVenda(mudanca as never)).not.toBe(impressaoDaVenda(a));
    }
  });

  it('recebimento repetido: mesma venda, forma, data e observação', () => {
    const r = { saleId: 's1', method: 'PIX', receivedOn: '2026-11-25', notes: 'troco ok' };
    expect(mesmoRecebimento(r, { ...r, notes: ' troco  ok ' })).toBe(true);
    expect(mesmoRecebimento(r, { ...r, method: 'DINHEIRO' })).toBe(false);
    expect(mesmoRecebimento(r, { ...r, saleId: 's2' })).toBe(false);
    expect(mesmoRecebimento(r, { ...r, receivedOn: '2026-11-24' })).toBe(false);
  });

  it('cancelamento e estorno repetidos: mesmo motivo', () => {
    expect(mesmoMotivo('Cliente desistiu', ' Cliente  desistiu')).toBe(true);
    expect(mesmoMotivo('Cliente desistiu', 'Produto com defeito')).toBe(false);
  });
});
