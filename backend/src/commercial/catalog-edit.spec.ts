import { describe, expect, it } from 'vitest';
import { assertUniqueCatalogName, catalogNameKey, planCatalogEdit, type CatalogItemState } from './catalog-edit.js';
import { SubscriptionRuleError } from './subscription.js';
import { catalogEditSummary } from '../platform/modular-catalog.service.js';

const atual: CatalogItemState = { name: 'Comissões', description: 'Regras de comissão.', priceCents: 1490 };

const codigoDe = (fn: () => unknown) => {
  try {
    fn();
  } catch (erro) {
    if (erro instanceof SubscriptionRuleError) return erro.code;
    throw erro;
  }
  return null;
};

describe('planCatalogEdit', () => {
  it('pedido igual ao estado atual não grava nada (repetição depois da rede cair)', () => {
    const pedido = { ...atual, name: 'Comissões por serviço' };
    // A tela leu o estado antigo, mas o pedido já foi aplicado.
    expect(planCatalogEdit(pedido, atual, pedido)).toEqual({ kind: 'UNCHANGED' });
  });

  it('diz o que muda: nome, descrição e preço separadamente', () => {
    expect(planCatalogEdit(atual, atual, { ...atual, name: 'Comissões por serviço' })).toEqual({
      kind: 'CHANGE',
      name: true,
      description: false,
      price: false,
    });
    expect(planCatalogEdit(atual, atual, { ...atual, description: 'Outra', priceCents: 1590 })).toEqual({
      kind: 'CHANGE',
      name: false,
      description: true,
      price: true,
    });
  });

  it('recusa quando outra tela mudou qualquer campo depois da leitura', () => {
    for (const lido of [
      { ...atual, name: 'Antigo' },
      { ...atual, description: 'Antiga' },
      { ...atual, priceCents: 990 },
      { ...atual, priceCents: null },
    ]) {
      expect(codigoDe(() => planCatalogEdit(atual, lido, { ...atual, name: 'Novo nome' }))).toBe('ALTERADO_POR_OUTRA_TELA');
    }
  });

  it('preço definido nunca volta a pendente; pendente pode continuar pendente', () => {
    expect(codigoDe(() => planCatalogEdit(atual, atual, { ...atual, priceCents: null }))).toBe('PRECO_OBRIGATORIO');
    const pendente = { ...atual, priceCents: null };
    expect(planCatalogEdit(pendente, pendente, { ...pendente, name: 'Novo' })).toEqual({
      kind: 'CHANGE',
      name: true,
      description: false,
      price: false,
    });
    expect(planCatalogEdit(pendente, pendente, { ...pendente, priceCents: 990 })).toMatchObject({ price: true });
  });
});

describe('nomes do catálogo', () => {
  it('compara sem acentos, maiúsculas e espaços extras', () => {
    expect(catalogNameKey('  Comissões   POR serviço ')).toBe('comissoes por servico');
  });

  it('recusa nome igual ao de outro item, aceita nome novo', () => {
    const outros = [{ name: 'Agendamento essencial' }, { name: 'Indicadores avançados' }];
    expect(codigoDe(() => assertUniqueCatalogName('indicadores  AVANCADOS', outros))).toBe('NOME_REPETIDO');
    expect(codigoDe(() => assertUniqueCatalogName('Agendamento Essencial', outros))).toBe('NOME_REPETIDO');
    expect(codigoDe(() => assertUniqueCatalogName('Comissões', outros))).toBeNull();
  });
});

describe('catalogEditSummary', () => {
  it('registra os valores anteriores e novos e que nada contratado muda', () => {
    const depois = { name: 'Comissões por serviço', description: 'Nova', priceCents: 1590 };
    const resumo = catalogEditSummary('adicional Comissões (COMISSOES)', atual, depois, {
      kind: 'CHANGE',
      name: true,
      description: true,
      price: true,
    });
    expect(resumo).toContain('nome "Comissões" para "Comissões por serviço"');
    expect(resumo).toContain('descrição "Regras de comissão." para "Nova"');
    expect(resumo).toMatch(/preço mensal padrão R\$\s14,90 para R\$\s15,90/);
    expect(resumo).toContain('Assinaturas já contratadas, pagamentos e períodos não mudam.');
  });

  it('preço antes pendente aparece como pendente', () => {
    const resumo = catalogEditSummary('essencial', { ...atual, priceCents: null }, atual, {
      kind: 'CHANGE',
      name: false,
      description: false,
      price: true,
    });
    expect(resumo).toMatch(/pendente para R\$\s14,90/);
  });
});
