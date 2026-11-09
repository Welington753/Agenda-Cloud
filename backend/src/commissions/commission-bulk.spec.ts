import { describe, expect, it } from 'vitest';
import { CommissionType } from '../entities/enums/commission-type.enum.js';
import { impressaoDaPrevia, planejarAplicacao, resumirResultados, type CurrentSettings } from './commission-bulk.js';
import { CONFIGURACAO_SEM_LINHA } from './commission-calculation.js';

const DEZ_POR_CENTO = { type: CommissionType.PERCENTAGE, value: 1000 };
const FIXO_15 = { type: CommissionType.FIXED, value: 1500 };
const NOVA = { receivesCommission: true, defaultRule: DEZ_POR_CENTO };

const semLinha: CurrentSettings = { stored: false, settings: CONFIGURACAO_SEM_LINHA };
const gravada = (receivesCommission: boolean, defaultRule: typeof DEZ_POR_CENTO | typeof FIXO_15 | null): CurrentSettings => ({
  stored: true,
  settings: { receivesCommission, defaultRule },
});

describe('planejarAplicacao: SUBSTITUIR', () => {
  it.each([
    ['sem linha', semLinha],
    ['recebe sem regra geral', gravada(true, null)],
    ['recebe com outra regra', gravada(true, FIXO_15)],
    ['não recebe, sem regra', gravada(false, null)],
    ['não recebe, com a mesma regra', gravada(false, DEZ_POR_CENTO)],
  ])('%s: substitui e liga "Recebe comissão"', (_nome, atual) => {
    expect(planejarAplicacao('REPLACE', DEZ_POR_CENTO, atual)).toEqual({ outcome: 'CHANGE', next: NOVA });
  });

  it('já recebe com a mesma regra: sem mudança', () => {
    expect(planejarAplicacao('REPLACE', DEZ_POR_CENTO, gravada(true, DEZ_POR_CENTO))).toEqual({
      outcome: 'UNCHANGED',
      next: NOVA,
    });
  });

  it('mesmo tipo com outro valor conta como diferente', () => {
    expect(planejarAplicacao('REPLACE', DEZ_POR_CENTO, gravada(true, { type: CommissionType.PERCENTAGE, value: 999 })).outcome).toBe(
      'CHANGE',
    );
  });
});

describe('planejarAplicacao: PRESERVAR', () => {
  it('sem linha (recebe, sem regra geral): recebe a regra nova', () => {
    expect(planejarAplicacao('PRESERVE', DEZ_POR_CENTO, semLinha)).toEqual({ outcome: 'CHANGE', next: NOVA });
  });

  it('recebe sem regra geral: recebe a regra nova', () => {
    expect(planejarAplicacao('PRESERVE', DEZ_POR_CENTO, gravada(true, null))).toEqual({ outcome: 'CHANGE', next: NOVA });
  });

  it('recebe com outra regra: preservado', () => {
    const atual = gravada(true, FIXO_15);
    expect(planejarAplicacao('PRESERVE', DEZ_POR_CENTO, atual)).toEqual({ outcome: 'PRESERVE', next: atual.settings });
  });

  it('recebe com a mesma regra: sem mudança', () => {
    expect(planejarAplicacao('PRESERVE', DEZ_POR_CENTO, gravada(true, DEZ_POR_CENTO)).outcome).toBe('UNCHANGED');
  });

  it.each([
    ['sem regra', null],
    ['com a mesma regra', DEZ_POR_CENTO],
    ['com outra regra', FIXO_15],
  ] as const)('não recebe (%s): preservado e continua desligado', (_nome, regra) => {
    const atual = gravada(false, regra);
    expect(planejarAplicacao('PRESERVE', DEZ_POR_CENTO, atual)).toEqual({ outcome: 'PRESERVE', next: atual.settings });
  });
});

describe('impressaoDaPrevia', () => {
  const base = {
    target: 'ALL' as const,
    mode: 'PRESERVE' as const,
    rule: DEZ_POR_CENTO,
    professionals: [
      { id: 'b', active: true, current: gravada(true, FIXO_15) },
      { id: 'a', active: true, current: semLinha },
    ],
  };

  it('é estável e não depende da ordem de entrada', () => {
    const invertida = { ...base, professionals: [...base.professionals].reverse() };
    expect(impressaoDaPrevia(base)).toMatch(/^[0-9a-f]{64}$/);
    expect(impressaoDaPrevia(invertida)).toBe(impressaoDaPrevia(base));
  });

  it.each([
    ['alcance', { ...base, target: 'SELECTED' as const }],
    ['modo', { ...base, mode: 'REPLACE' as const }],
    ['tipo da regra', { ...base, rule: { type: CommissionType.FIXED, value: 1000 } }],
    ['valor da regra', { ...base, rule: { type: CommissionType.PERCENTAGE, value: 1001 } }],
    ['profissional a mais', { ...base, professionals: [...base.professionals, { id: 'c', active: true, current: semLinha }] }],
    ['profissional a menos', { ...base, professionals: base.professionals.slice(1) }],
    ['ativo', { ...base, professionals: [{ ...base.professionals[0], active: false }, base.professionals[1]] }],
    ['linha gravada', { ...base, professionals: [base.professionals[0], { id: 'a', active: true, current: gravada(true, null) }] }],
    ['recebe', { ...base, professionals: [{ id: 'b', active: true, current: gravada(false, FIXO_15) }, base.professionals[1]] }],
    ['regra atual', { ...base, professionals: [{ id: 'b', active: true, current: gravada(true, DEZ_POR_CENTO) }, base.professionals[1]] }],
  ])('muda com %s', (_nome, outra) => {
    expect(impressaoDaPrevia(outra)).not.toBe(impressaoDaPrevia(base));
  });
});

describe('resumirResultados', () => {
  it('conta cada resultado', () => {
    expect(resumirResultados(['CHANGE', 'PRESERVE', 'CHANGE', 'UNCHANGED'])).toEqual({ change: 2, preserve: 1, unchanged: 1, total: 4 });
  });
});
