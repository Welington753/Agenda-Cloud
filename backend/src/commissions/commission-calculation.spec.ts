import { describe, expect, it } from 'vitest';
import { CommissionType } from '../entities/enums/commission-type.enum.js';
import {
  CONFIGURACAO_SEM_LINHA,
  calcularComissaoDoItem,
  origemDaRegraApurada,
  percentualEmCentavos,
  regraEfetiva,
  ruleToView,
  situacaoDoItem,
  viewToRule,
} from './commission-calculation.js';
import { commissionReportQuerySchema, commissionRuleSchema, commissionSettingsSchema } from './commissions.dto.js';

const pct = (value: number) => ({ type: CommissionType.PERCENTAGE, value });
const fixo = (value: number) => ({ type: CommissionType.FIXED, value });

describe('cálculo da comissão de um item', () => {
  it('percentual em centavos inteiros, meio centavo para cima', () => {
    expect(percentualEmCentavos(5000, 4000)).toBe(2000);
    // 12,5% de R$ 33,33 = 416,625 centavos.
    expect(percentualEmCentavos(3333, 1250)).toBe(417);
    // 0,01%: R$ 0,50 dá 0,005 centavo (zero); R$ 50,00 dá meio centavo, que
    // sobe; R$ 49,99 fica abaixo do meio.
    expect(percentualEmCentavos(50, 1)).toBe(0);
    expect(percentualEmCentavos(5000, 1)).toBe(1);
    expect(percentualEmCentavos(4999, 1)).toBe(0);
    expect(percentualEmCentavos(15000, 1)).toBe(2);
    // Teto do int4 a 100%: exato, sem float.
    expect(percentualEmCentavos(2_147_483_647, 10_000)).toBe(2_147_483_647);
    // 1/3 de cada item soma diferente de 1/3 do total: arredonda por item.
    const itens = [1000, 1000, 1000].map((p) => percentualEmCentavos(p, 3333));
    expect(itens).toEqual([333, 333, 333]);
  });

  it('percentual sobre o preço registrado; parte do estabelecimento é o resto', () => {
    expect(calcularComissaoDoItem(5000, pct(4000))).toEqual({ professionalCents: 2000, establishmentCents: 3000 });
  });

  it('sem comissão (0%) é zero, e conta como regra', () => {
    expect(calcularComissaoDoItem(5000, pct(0))).toEqual({ professionalCents: 0, establishmentCents: 5000 });
    expect(situacaoDoItem({ appliedType: 'PERCENTAGE', priceCents: 5000, professionalCents: 0 })).toBe('OK');
  });

  it('valor fixo independe do preço; acima do preço não inventa parte do estabelecimento', () => {
    expect(calcularComissaoDoItem(5000, fixo(1500))).toEqual({ professionalCents: 1500, establishmentCents: 3500 });
    expect(calcularComissaoDoItem(null, fixo(1500))).toEqual({ professionalCents: 1500, establishmentCents: null });
    expect(calcularComissaoDoItem(1000, fixo(1500))).toEqual({ professionalCents: 1500, establishmentCents: null });
    expect(situacaoDoItem({ appliedType: 'FIXED', priceCents: 1000, professionalCents: 1500 })).toBe('ACIMA_DO_PRECO');
  });

  it('sem regra ou percentual sem preço: nenhum valor, nunca zero', () => {
    expect(calcularComissaoDoItem(5000, null)).toEqual({ professionalCents: null, establishmentCents: null });
    expect(calcularComissaoDoItem(null, pct(4000))).toEqual({ professionalCents: null, establishmentCents: null });
    expect(situacaoDoItem({ appliedType: null, priceCents: 5000, professionalCents: null })).toBe('NAO_CONFIGURADA');
    expect(situacaoDoItem({ appliedType: 'PERCENTAGE', priceCents: null, professionalCents: null })).toBe('SEM_PRECO');
  });
});

describe('representação da regra', () => {
  it('"sem comissão" é PERCENTAGE 0; ida e volta preservam o tipo', () => {
    expect(viewToRule({ kind: 'NONE', value: null })).toEqual(pct(0));
    expect(ruleToView(pct(0))).toEqual({ kind: 'NONE', value: null });
    expect(ruleToView(pct(1250))).toEqual({ kind: 'PERCENTAGE', value: 1250 });
    expect(ruleToView(fixo(0))).toEqual({ kind: 'FIXED', value: 0 });
    expect(viewToRule({ kind: 'FIXED', value: 990 })).toEqual(fixo(990));
  });

  it('a entrada recusa zero, fração, acima de 100% e valor em "sem comissão"', () => {
    expect(commissionRuleSchema.safeParse({ kind: 'NONE' }).success).toBe(true);
    expect(commissionRuleSchema.safeParse({ kind: 'NONE', value: 0 }).success).toBe(false);
    expect(commissionRuleSchema.safeParse({ kind: 'PERCENTAGE', value: 1250 }).success).toBe(true);
    expect(commissionRuleSchema.safeParse({ kind: 'PERCENTAGE', value: 0 }).success).toBe(false);
    expect(commissionRuleSchema.safeParse({ kind: 'PERCENTAGE', value: 10001 }).success).toBe(false);
    expect(commissionRuleSchema.safeParse({ kind: 'PERCENTAGE', value: 12.5 }).success).toBe(false);
    expect(commissionRuleSchema.safeParse({ kind: 'FIXED', value: 1 }).success).toBe(true);
    expect(commissionRuleSchema.safeParse({ kind: 'FIXED', value: 0 }).success).toBe(false);
    expect(commissionRuleSchema.safeParse({ kind: 'FIXED', value: 100_000_001 }).success).toBe(false);
    expect(commissionRuleSchema.safeParse({ kind: 'FIXED', value: 10, tenantId: 'x' }).success).toBe(false);
    expect(commissionRuleSchema.safeParse({ kind: 'OUTRO', value: 10 }).success).toBe(false);
  });

  it('o período do relatório é o do Início; um lado só é recusado', () => {
    expect(commissionReportQuerySchema.safeParse({}).success).toBe(true);
    expect(commissionReportQuerySchema.safeParse({ from: '2026-11-01', to: '2026-11-30', professionalId: 'p1' }).success).toBe(
      true,
    );
    expect(commissionReportQuerySchema.safeParse({ from: '2026-11-01' }).success).toBe(false);
    expect(commissionReportQuerySchema.safeParse({ from: '2026-11-30', to: '2026-11-01' }).success).toBe(false);
    expect(commissionReportQuerySchema.safeParse({ from: '2025-01-01', to: '2026-11-01' }).success).toBe(false);
    expect(commissionReportQuerySchema.safeParse({ tenantId: 'x' }).success).toBe(false);
  });
});

describe('"Recebe comissão", regra geral e exceções', () => {
  it('a exceção do serviço vence a regra geral, inclusive "sem comissão"; sem as duas, não configurada', () => {
    expect(regraEfetiva(pct(1000), fixo(500))).toEqual({ scope: 'SERVICE', rule: pct(1000) });
    expect(regraEfetiva(fixo(800), pct(4000))).toEqual({ scope: 'SERVICE', rule: fixo(800) });
    // "Sem comissão" é PERCENTAGE 0: é exceção gravada e vence a regra geral.
    expect(regraEfetiva(pct(0), pct(4000))).toEqual({ scope: 'SERVICE', rule: pct(0) });
    expect(calcularComissaoDoItem(5000, regraEfetiva(pct(0), pct(4000)).rule)).toEqual({ professionalCents: 0, establishmentCents: 5000 });
    expect(regraEfetiva(null, pct(4000))).toEqual({ scope: 'DEFAULT', rule: pct(4000) });
    expect(regraEfetiva(null, fixo(1000))).toEqual({ scope: 'DEFAULT', rule: fixo(1000) });
    // Nunca vira zero: sem regra, sem valor.
    expect(regraEfetiva(null, null)).toEqual({ scope: null, rule: null });
    expect(calcularComissaoDoItem(5000, regraEfetiva(null, null).rule)).toEqual({ professionalCents: null, establishmentCents: null });
  });

  it('regra geral fixa vale por serviço realizado', () => {
    const geral = fixo(1000);
    const itens = [5000, 2500, null].map((preco) => calcularComissaoDoItem(preco, regraEfetiva(null, geral).rule));
    expect(itens.map((i) => i.professionalCents)).toEqual([1000, 1000, 1000]);
  });

  it('sem linha de configuração: recebe, sem regra geral (o estado anterior)', () => {
    expect(CONFIGURACAO_SEM_LINHA).toEqual({ receivesCommission: true, defaultRule: null });
    expect(Object.isFrozen(CONFIGURACAO_SEM_LINHA)).toBe(true);
  });

  it('origem do item apurado: escopo NULL com regra é regra antiga por serviço, nunca exceção; sem regra fica sem origem', () => {
    expect(origemDaRegraApurada('PERCENTAGE', 'SERVICE')).toBe('SERVICE');
    expect(origemDaRegraApurada('FIXED', 'DEFAULT')).toBe('DEFAULT');
    expect(origemDaRegraApurada('PERCENTAGE', null)).toBe('LEGACY_SERVICE');
    expect(origemDaRegraApurada(null, null)).toBeNull();
  });

  it('a configuração aceita ligar sem regra geral; regra geral só percentual ou fixa, sem "sem comissão"', () => {
    expect(commissionSettingsSchema.safeParse({ receivesCommission: true, defaultRule: null }).success).toBe(true);
    expect(commissionSettingsSchema.safeParse({ receivesCommission: false, defaultRule: null }).success).toBe(true);
    expect(commissionSettingsSchema.safeParse({ receivesCommission: true, defaultRule: { kind: 'PERCENTAGE', value: 4000 } }).success).toBe(true);
    expect(commissionSettingsSchema.safeParse({ receivesCommission: true, defaultRule: { kind: 'FIXED', value: 1000 } }).success).toBe(true);
    expect(commissionSettingsSchema.safeParse({ receivesCommission: true, defaultRule: { kind: 'NONE' } }).success).toBe(false);
    expect(commissionSettingsSchema.safeParse({ receivesCommission: true, defaultRule: { kind: 'PERCENTAGE', value: 0 } }).success).toBe(false);
    expect(commissionSettingsSchema.safeParse({ receivesCommission: true, defaultRule: { kind: 'FIXED', value: 12.5 } }).success).toBe(false);
    expect(commissionSettingsSchema.safeParse({ receivesCommission: true }).success).toBe(false);
    expect(commissionSettingsSchema.safeParse({ receivesCommission: 'sim', defaultRule: null }).success).toBe(false);
    expect(commissionSettingsSchema.safeParse({ receivesCommission: true, defaultRule: null, tenantId: 'x' }).success).toBe(false);
  });
});
