import { describe, expect, it } from 'vitest';
import { CommissionType } from '../entities/enums/commission-type.enum.js';
import { impressaoDaPrevia, planejarAplicacao, resumirResultados, type CurrentSettings } from './commission-bulk.js';
import { CONFIGURACAO_SEM_LINHA } from './commission-calculation.js';
import { impressaoDasExcecoes } from './commission-exceptions.js';

const DEZ_POR_CENTO = { type: CommissionType.PERCENTAGE, value: 1000 };
const FIXO_15 = { type: CommissionType.FIXED, value: 1500 };
const NOVA = { receivesCommission: true, defaultRule: DEZ_POR_CENTO };

const BARBA_15 = { serviceId: 'barba', rule: { type: CommissionType.PERCENTAGE, value: 1500 } };
const CORTE_SEM = { serviceId: 'corte', rule: { type: CommissionType.PERCENTAGE, value: 0 } };

const semLinha: CurrentSettings = { stored: false, settings: CONFIGURACAO_SEM_LINHA, exceptions: [] };
const gravada = (
  receivesCommission: boolean,
  defaultRule: typeof DEZ_POR_CENTO | typeof FIXO_15 | null,
  exceptions: CurrentSettings['exceptions'] = [],
): CurrentSettings => ({
  stored: true,
  settings: { receivesCommission, defaultRule },
  exceptions,
});
const troca = { outcome: 'CHANGE', next: NOVA, settingsChange: true, removesExceptions: false };

describe('planejarAplicacao: SUBSTITUIR', () => {
  it.each([
    ['sem linha', semLinha],
    ['recebe sem regra geral', gravada(true, null)],
    ['recebe com outra regra', gravada(true, FIXO_15)],
    ['não recebe, sem regra', gravada(false, null)],
    ['não recebe, com a mesma regra', gravada(false, DEZ_POR_CENTO)],
  ])('%s: substitui e liga "Recebe comissão"', (_nome, atual) => {
    expect(planejarAplicacao('REPLACE', DEZ_POR_CENTO, atual)).toEqual(troca);
  });

  it('já recebe com a mesma regra: sem mudança', () => {
    expect(planejarAplicacao('REPLACE', DEZ_POR_CENTO, gravada(true, DEZ_POR_CENTO))).toEqual({
      outcome: 'UNCHANGED',
      next: NOVA,
      settingsChange: false,
      removesExceptions: false,
    });
  });

  it('manter exceções (o padrão): as exceções ficam, mesmo substituindo a regra geral', () => {
    const atual = gravada(true, FIXO_15, [BARBA_15, CORTE_SEM]);
    expect(planejarAplicacao('REPLACE', DEZ_POR_CENTO, atual)).toEqual(troca);
    expect(planejarAplicacao('REPLACE', DEZ_POR_CENTO, atual, 'KEEP')).toEqual(troca);
  });

  it('remover exceções: troca a regra e remove as exceções', () => {
    expect(planejarAplicacao('REPLACE', DEZ_POR_CENTO, gravada(true, FIXO_15, [BARBA_15]), 'REMOVE')).toEqual({
      ...troca,
      removesExceptions: true,
    });
  });

  it('remover exceções com a regra geral já igual: altera só pelas exceções', () => {
    expect(planejarAplicacao('REPLACE', DEZ_POR_CENTO, gravada(true, DEZ_POR_CENTO, [CORTE_SEM]), 'REMOVE')).toEqual({
      outcome: 'CHANGE',
      next: NOVA,
      settingsChange: false,
      removesExceptions: true,
    });
  });

  it('remover sem exceções gravadas: nada a remover', () => {
    expect(planejarAplicacao('REPLACE', DEZ_POR_CENTO, gravada(true, DEZ_POR_CENTO), 'REMOVE').outcome).toBe('UNCHANGED');
    expect(planejarAplicacao('REPLACE', DEZ_POR_CENTO, gravada(true, FIXO_15), 'REMOVE').removesExceptions).toBe(false);
  });

  it('mesmo tipo com outro valor conta como diferente', () => {
    expect(planejarAplicacao('REPLACE', DEZ_POR_CENTO, gravada(true, { type: CommissionType.PERCENTAGE, value: 999 })).outcome).toBe(
      'CHANGE',
    );
  });
});

describe('planejarAplicacao: PRESERVAR', () => {
  it('sem linha (recebe, sem regra geral): recebe a regra nova', () => {
    expect(planejarAplicacao('PRESERVE', DEZ_POR_CENTO, semLinha)).toEqual(troca);
  });

  it('recebe sem regra geral: recebe a regra nova', () => {
    expect(planejarAplicacao('PRESERVE', DEZ_POR_CENTO, gravada(true, null))).toEqual(troca);
  });

  it('recebe com outra regra: preservado', () => {
    const atual = gravada(true, FIXO_15);
    expect(planejarAplicacao('PRESERVE', DEZ_POR_CENTO, atual)).toEqual({
      outcome: 'PRESERVE',
      next: atual.settings,
      settingsChange: false,
      removesExceptions: false,
    });
  });

  it('nunca remove exceções, mesmo que a escolha chegue (o DTO recusa)', () => {
    expect(planejarAplicacao('PRESERVE', DEZ_POR_CENTO, gravada(true, null, [BARBA_15]), 'REMOVE')).toEqual(troca);
    expect(planejarAplicacao('PRESERVE', DEZ_POR_CENTO, gravada(true, FIXO_15, [BARBA_15]), 'REMOVE').removesExceptions).toBe(false);
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
    expect(planejarAplicacao('PRESERVE', DEZ_POR_CENTO, atual)).toMatchObject({ outcome: 'PRESERVE', next: atual.settings });
  });
});

describe('impressaoDaPrevia', () => {
  const base = {
    target: 'ALL' as const,
    mode: 'PRESERVE' as const,
    rule: DEZ_POR_CENTO,
    exceptions: 'KEEP' as const,
    professionals: [
      { id: 'b', active: true, current: gravada(true, FIXO_15, [BARBA_15]) },
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
    ['escolha das exceções', { ...base, exceptions: 'REMOVE' as const }],
    ['exceção a mais', { ...base, professionals: [{ id: 'b', active: true, current: gravada(true, FIXO_15, [BARBA_15, CORTE_SEM]) }, base.professionals[1]] }],
    ['exceção a menos', { ...base, professionals: [{ id: 'b', active: true, current: gravada(true, FIXO_15) }, base.professionals[1]] }],
    [
      'valor da exceção',
      { ...base, professionals: [{ id: 'b', active: true, current: gravada(true, FIXO_15, [{ ...BARBA_15, rule: { ...BARBA_15.rule, value: 1400 } }]) }, base.professionals[1]] },
    ],
    [
      'tipo da exceção',
      { ...base, professionals: [{ id: 'b', active: true, current: gravada(true, FIXO_15, [{ ...BARBA_15, rule: { type: CommissionType.FIXED, value: 1500 } }]) }, base.professionals[1]] },
    ],
    ['exceção em outro serviço', { ...base, professionals: [{ id: 'b', active: true, current: gravada(true, FIXO_15, [{ ...BARBA_15, serviceId: 'outro' }]) }, base.professionals[1]] }],
    ['profissional a mais', { ...base, professionals: [...base.professionals, { id: 'c', active: true, current: semLinha }] }],
    ['profissional a menos', { ...base, professionals: base.professionals.slice(1) }],
    ['ativo', { ...base, professionals: [{ ...base.professionals[0], active: false }, base.professionals[1]] }],
    ['linha gravada', { ...base, professionals: [base.professionals[0], { id: 'a', active: true, current: gravada(true, null) }] }],
    ['recebe', { ...base, professionals: [{ id: 'b', active: true, current: gravada(false, FIXO_15) }, base.professionals[1]] }],
    ['regra atual', { ...base, professionals: [{ id: 'b', active: true, current: gravada(true, DEZ_POR_CENTO, [BARBA_15]) }, base.professionals[1]] }],
  ])('muda com %s', (_nome, outra) => {
    expect(impressaoDaPrevia(outra)).not.toBe(impressaoDaPrevia(base));
  });

  it('a ordem das exceções não importa', () => {
    const duas = (ex: CurrentSettings['exceptions']) => ({ ...base, professionals: [{ id: 'b', active: true, current: gravada(true, FIXO_15, ex) }] });
    expect(impressaoDaPrevia(duas([BARBA_15, CORTE_SEM]))).toBe(impressaoDaPrevia(duas([CORTE_SEM, BARBA_15])));
  });
});

describe('impressaoDasExcecoes', () => {
  it('estável, independente da ordem, e sensível a cada exceção', () => {
    expect(impressaoDasExcecoes([BARBA_15, CORTE_SEM])).toMatch(/^[0-9a-f]{64}$/);
    expect(impressaoDasExcecoes([CORTE_SEM, BARBA_15])).toBe(impressaoDasExcecoes([BARBA_15, CORTE_SEM]));
    expect(impressaoDasExcecoes([BARBA_15])).not.toBe(impressaoDasExcecoes([BARBA_15, CORTE_SEM]));
    expect(impressaoDasExcecoes([{ ...BARBA_15, rule: { ...BARBA_15.rule, value: 1501 } }])).not.toBe(impressaoDasExcecoes([BARBA_15]));
    expect(impressaoDasExcecoes([])).not.toBe(impressaoDasExcecoes([BARBA_15]));
  });
});

describe('resumirResultados', () => {
  it('conta cada resultado', () => {
    const itens = [
      { outcome: 'CHANGE' as const, exceptionsRemoved: 2 },
      { outcome: 'PRESERVE' as const, exceptionsRemoved: 0 },
      { outcome: 'CHANGE' as const, exceptionsRemoved: 1 },
      { outcome: 'UNCHANGED' as const, exceptionsRemoved: 0 },
    ];
    expect(resumirResultados(itens)).toEqual({ change: 2, preserve: 1, unchanged: 1, total: 4, exceptionsRemoved: 3 });
  });
});
