// Conversão de fuso (Lote 6D.4). Os fusos usados aqui são escolhidos de
// propósito: America/Sao_Paulo não tem mais horário de verão (deslocamento
// fixo), America/New_York tem as duas viradas, e Asia/Tokyo prova que nada
// depende do fuso da máquina que roda o teste.
import { describe, expect, it } from 'vitest';
import {
  dataLocalDe,
  deslocamentoEmMinutos,
  diaDaSemanaDe,
  diasEntre,
  ErroDeFuso,
  horaLocalDe,
  instantesDaHoraLocal,
  janelaDeCarregamento,
  partesLocais,
  resolverHoraLocal,
  rotuloDeDeslocamento,
} from './time-zone.js';

const SP = 'America/Sao_Paulo';
const NY = 'America/New_York';
const TOQUIO = 'Asia/Tokyo';

describe('deslocamentoEmMinutos', () => {
  it('lê o deslocamento vigente naquele instante, não um fixo', () => {
    expect(deslocamentoEmMinutos(new Date('2026-09-20T12:00:00Z'), SP)).toBe(-180);
    expect(deslocamentoEmMinutos(new Date('2026-01-15T12:00:00Z'), NY)).toBe(-300);
    expect(deslocamentoEmMinutos(new Date('2026-07-15T12:00:00Z'), NY)).toBe(-240);
    expect(deslocamentoEmMinutos(new Date('2026-09-20T12:00:00Z'), TOQUIO)).toBe(540);
  });

  it('milissegundo no instante não vira deslocamento fracionário', () => {
    expect(deslocamentoEmMinutos(new Date('2026-09-20T12:00:00.750Z'), SP)).toBe(-180);
  });

  it('fuso inexistente é erro explícito, nunca um padrão silencioso', () => {
    expect(() => deslocamentoEmMinutos(new Date(), 'Marte/Olympus')).toThrow(ErroDeFuso);
  });
});

describe('rotuloDeDeslocamento', () => {
  it.each([
    [-180, '-03:00'],
    [540, '+09:00'],
    [-210, '-03:30'],
    [0, '+00:00'],
  ])('%i vira %s', (minutos, rotulo) => {
    expect(rotuloDeDeslocamento(minutos)).toBe(rotulo);
  });
});

describe('resolverHoraLocal', () => {
  it('hora comum resolve num instante só', () => {
    const resolucao = resolverHoraLocal({ year: 2026, month: 9, day: 20 }, 9, 0, SP);

    expect(resolucao.tipo).toBe('normal');
    expect(resolucao.instantes).toHaveLength(1);
    expect(resolucao.instantes[0].toISOString()).toBe('2026-09-20T12:00:00.000Z');
  });

  it('a mesma hora local em outro fuso dá outro instante', () => {
    const emToquio = resolverHoraLocal({ year: 2026, month: 9, day: 20 }, 9, 0, TOQUIO);
    expect(emToquio.instantes[0].toISOString()).toBe('2026-09-20T00:00:00.000Z');
  });

  it('hora que o relógio pulou é INEXISTENTE e não vira instante inválido', () => {
    // 2026-03-08, EUA: 02:00 vira 03:00. 02:30 não acontece.
    const resolucao = resolverHoraLocal({ year: 2026, month: 3, day: 8 }, 2, 30, NY);

    expect(resolucao.tipo).toBe('inexistente');
    expect(resolucao.instantes).toEqual([]);
    expect(resolucao.aposLacuna?.toISOString()).toBe('2026-03-08T07:30:00.000Z');
    // O instante oferecido é REAL e mostra a hora já deslocada.
    expect(horaLocalDe(resolucao.aposLacuna as Date, NY)).toBe('03:30');
  });

  it('hora que o relógio repetiu tem DOIS instantes distinguíveis', () => {
    // 2026-11-01, EUA: 02:00 volta para 01:00. 01:30 acontece duas vezes.
    const resolucao = resolverHoraLocal({ year: 2026, month: 11, day: 1 }, 1, 30, NY);

    expect(resolucao.tipo).toBe('repetida');
    expect(resolucao.instantes.map((i) => i.toISOString())).toEqual([
      '2026-11-01T05:30:00.000Z',
      '2026-11-01T06:30:00.000Z',
    ]);
    // Mesma hora local, deslocamentos diferentes — é isso que os separa.
    expect(resolucao.instantes.map((i) => horaLocalDe(i, NY))).toEqual(['01:30', '01:30']);
    expect(resolucao.instantes.map((i) => deslocamentoEmMinutos(i, NY))).toEqual([-240, -300]);
  });

  it('instantesDaHoraLocal devolve só os válidos', () => {
    expect(instantesDaHoraLocal({ year: 2026, month: 3, day: 8 }, 2, 30, NY)).toEqual([]);
    expect(instantesDaHoraLocal({ year: 2026, month: 11, day: 1 }, 1, 30, NY)).toHaveLength(2);
  });
});

describe('leitura local', () => {
  it('horaLocalDe e dataLocalDe usam o fuso pedido, nunca o do processo', () => {
    const instante = new Date('2026-09-21T02:00:00Z');

    expect(dataLocalDe(instante, SP)).toBe('2026-09-20');
    expect(horaLocalDe(instante, SP)).toBe('23:00');
    expect(dataLocalDe(instante, TOQUIO)).toBe('2026-09-21');
    expect(horaLocalDe(instante, TOQUIO)).toBe('11:00');
  });

  it('meia-noite local sai como 00, nunca 24', () => {
    expect(horaLocalDe(new Date('2026-09-20T03:00:00Z'), SP)).toBe('00:00');
    expect(partesLocais(new Date('2026-09-20T03:00:00Z'), SP).hour).toBe(0);
  });
});

describe('datas de calendário', () => {
  it('diaDaSemanaDe não depende de fuso', () => {
    expect(diaDaSemanaDe({ year: 2026, month: 9, day: 20 })).toBe(0);
    expect(diaDaSemanaDe({ year: 2026, month: 9, day: 21 })).toBe(1);
  });

  it('diasEntre conta dias inteiros, inclusive atravessando virada de fuso', () => {
    expect(diasEntre({ year: 2026, month: 9, day: 20 }, { year: 2026, month: 9, day: 27 })).toBe(7);
    expect(diasEntre({ year: 2026, month: 3, day: 1 }, { year: 2026, month: 3, day: 31 })).toBe(30);
    expect(diasEntre({ year: 2026, month: 9, day: 20 }, { year: 2026, month: 9, day: 19 })).toBe(-1);
  });
});

describe('janelaDeCarregamento', () => {
  it('cobre o dia local inteiro com folga dos dois lados, em qualquer fuso', () => {
    const janela = janelaDeCarregamento({ year: 2026, month: 9, day: 20 });

    // Extremos possíveis do dia local: -12 (Baker) a +14 (Kiritimati).
    const maisCedo = new Date('2026-09-19T10:00:00Z'); // 2026-09-20 00:00 em +14
    const maisTarde = new Date('2026-09-21T11:59:00Z'); // 2026-09-20 23:59 em -12

    expect(janela.inicio.getTime()).toBeLessThanOrEqual(maisCedo.getTime());
    expect(janela.fim.getTime()).toBeGreaterThanOrEqual(maisTarde.getTime());
  });
});
