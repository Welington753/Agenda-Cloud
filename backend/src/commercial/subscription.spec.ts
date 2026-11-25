// Valores de exemplo (R$ 29,90 / 9,90 / 14,90), não preços aprovados.
import { describe, expect, it } from 'vitest';
import { FeatureKey } from '../entities/enums/feature-key.enum.js';
import type { AddonModule } from './modular-plan.js';
import { assertLimitCoversUsage, quoteSubscription, SubscriptionRuleError, subscriptionDiff } from './subscription.js';

const catalogo: AddonModule[] = [
  { code: 'INDICADORES', name: 'Indicadores avançados', description: '', featureKey: FeatureKey.RELATORIOS, availability: 'AVAILABLE', priceCents: 990 },
  { code: 'COMISSOES', name: 'Comissões', description: '', featureKey: FeatureKey.COMISSOES, availability: 'AVAILABLE', priceCents: null },
  { code: 'WHATSAPP', name: 'WhatsApp automático', description: '', featureKey: null, availability: 'IN_DEVELOPMENT', priceCents: null },
  { code: 'ESTOQUE', name: 'Controle de estoque', description: '', featureKey: null, availability: 'PLANNED', priceCents: 1490 },
];

const codigo = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as SubscriptionRuleError).code;
  }
  return null;
};

// Catálogo depois da migration SalesModule: ESTOQUE disponível com preço,
// VENDAS disponível sem preço (o estado em que a migration o deixa) e com.
const comVendas = (precoVendas: number | null): AddonModule[] => [
  { code: 'ESTOQUE', name: 'Controle de estoque', description: '', featureKey: FeatureKey.ESTOQUE, availability: 'AVAILABLE', priceCents: 1490 },
  { code: 'VENDAS', name: 'Vendas', description: '', featureKey: FeatureKey.VENDAS, availability: 'AVAILABLE', priceCents: precoVendas },
];

describe('dependência VENDAS → ESTOQUE e preço ausente', () => {
  it('VENDAS sem ESTOQUE é recusado, com o que falta nos detalhes', () => {
    try {
      quoteSubscription(2990, comVendas(990), { addons: ['VENDAS'], teamUserLimit: 1 });
      expect.unreachable();
    } catch (e) {
      expect((e as SubscriptionRuleError).code).toBe('MODULO_DEPENDENTE');
      expect((e as SubscriptionRuleError).details).toEqual({ module: 'VENDAS', requires: ['ESTOQUE'] });
      expect((e as Error).message).toMatch(/Vendas exige Controle de estoque/);
    }
  });

  it('retirar só o ESTOQUE de quem tem os dois é a mesma versão recusada; tirar os dois juntos passa', () => {
    expect(codigo(() => quoteSubscription(2990, comVendas(990), { addons: ['VENDAS'], teamUserLimit: 1 }))).toBe('MODULO_DEPENDENTE');
    expect(quoteSubscription(2990, comVendas(990), { addons: [], teamUserLimit: 1 }).items).toEqual([]);
    expect(quoteSubscription(2990, comVendas(990), { addons: ['ESTOQUE'], teamUserLimit: 1 }).items).toHaveLength(1);
  });

  it('VENDAS sem preço nunca é gratuito: PRECO_PENDENTE, mesmo com ESTOQUE', () => {
    expect(codigo(() => quoteSubscription(2990, comVendas(null), { addons: ['ESTOQUE', 'VENDAS'], teamUserLimit: 1 }))).toBe(
      'PRECO_PENDENTE',
    );
  });

  it('com preço e ESTOQUE junto, soma os dois', () => {
    const q = quoteSubscription(2990, comVendas(990), { addons: ['VENDAS', 'ESTOQUE'], teamUserLimit: 1 });
    expect(q.items.map((i) => i.code)).toEqual(['ESTOQUE', 'VENDAS']);
    expect(q.catalogTotalCents).toBe(2990 + 1490 + 990);
  });
});

describe('quoteSubscription', () => {
  it('soma base + adicionais disponíveis em centavos', () => {
    const q = quoteSubscription(2990, catalogo, { addons: ['INDICADORES'], teamUserLimit: 5 });
    expect(q.catalogTotalCents).toBe(3980);
    expect(q.contractedTotalCents).toBe(3980);
    expect(q.negotiated).toBe(false);
    expect(q.items).toEqual([{ code: 'INDICADORES', name: 'Indicadores avançados', priceCents: 990 }]);
  });

  it('só o essencial vale sozinho', () => {
    expect(quoteSubscription(2990, catalogo, { addons: [], teamUserLimit: 0 }).catalogTotalCents).toBe(2990);
  });

  it('ignora repetição do mesmo adicional', () => {
    expect(quoteSubscription(2990, catalogo, { addons: ['INDICADORES', 'INDICADORES'], teamUserLimit: 1 }).items).toHaveLength(1);
  });

  it('planejado e em desenvolvimento não são contratáveis, mesmo com preço', () => {
    expect(codigo(() => quoteSubscription(2990, catalogo, { addons: ['ESTOQUE'], teamUserLimit: 1 }))).toBe('MODULO_INDISPONIVEL');
    expect(codigo(() => quoteSubscription(2990, catalogo, { addons: ['WHATSAPP'], teamUserLimit: 1 }))).toBe('MODULO_INDISPONIVEL');
  });

  it('recusa adicional desconhecido, preço pendente e base pendente', () => {
    expect(codigo(() => quoteSubscription(2990, catalogo, { addons: ['X'], teamUserLimit: 1 }))).toBe('MODULO_DESCONHECIDO');
    expect(codigo(() => quoteSubscription(2990, catalogo, { addons: ['COMISSOES'], teamUserLimit: 1 }))).toBe('PRECO_PENDENTE');
    expect(codigo(() => quoteSubscription(null, catalogo, { addons: [], teamUserLimit: 1 }))).toBe('PRECO_BASE_PENDENTE');
  });

  it('valor negociado exige motivo e fica registrado', () => {
    expect(
      codigo(() => quoteSubscription(2990, catalogo, { addons: ['INDICADORES'], contractedTotalCents: 3500, teamUserLimit: 1 })),
    ).toBe('MOTIVO_OBRIGATORIO');
    const q = quoteSubscription(2990, catalogo, {
      addons: ['INDICADORES'],
      contractedTotalCents: 3500,
      reason: '  Desconto de lançamento ',
      teamUserLimit: 1,
    });
    expect(q).toMatchObject({ catalogTotalCents: 3980, contractedTotalCents: 3500, negotiated: true, reason: 'Desconto de lançamento' });
  });
});

describe('subscriptionDiff', () => {
  it('primeira versão sempre muda', () => {
    expect(subscriptionDiff(null, { addons: [], contractedTotalCents: 2990, teamUserLimit: 0 }).changed).toBe(true);
  });

  it('aponta adicionais incluídos, retirados, valor e limite', () => {
    const d = subscriptionDiff(
      { addons: ['COMISSOES'], contractedTotalCents: 4480, teamUserLimit: 3 },
      { addons: ['INDICADORES'], contractedTotalCents: 3980, teamUserLimit: 5 },
    );
    expect(d).toMatchObject({ added: ['INDICADORES'], removed: ['COMISSOES'], previousTotalCents: 4480, newTotalCents: 3980, changed: true });
  });

  it('nada muda quando tudo é igual', () => {
    const s = { addons: ['INDICADORES'], contractedTotalCents: 3980, teamUserLimit: 5 };
    expect(subscriptionDiff(s, { ...s }).changed).toBe(false);
  });
});

describe('assertLimitCoversUsage', () => {
  it('recusa reduzir abaixo de ativos + convites e explica', () => {
    try {
      assertLimitCoversUsage(2, { used: 3, activeAccesses: 2, pendingInvites: 1 });
      expect.unreachable();
    } catch (e) {
      expect((e as SubscriptionRuleError).code).toBe('LIMITE_ABAIXO_DO_USO');
      expect((e as Error).message).toMatch(/2 acesso\(s\) ativo\(s\) e 1 reservado\(s\) por convite/);
    }
  });

  it('aceita limite igual ao uso e zero sem uso', () => {
    expect(() => assertLimitCoversUsage(3, { used: 3, activeAccesses: 2, pendingInvites: 1 })).not.toThrow();
    expect(() => assertLimitCoversUsage(0, { used: 0, activeAccesses: 0, pendingInvites: 0 })).not.toThrow();
  });
});
