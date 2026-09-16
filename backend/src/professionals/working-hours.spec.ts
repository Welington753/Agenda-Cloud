import { describe, expect, it } from 'vitest';
import {
  ErroDeHorario,
  ehHoraValida,
  minutosDaHora,
  normalizarDia,
  normalizarSemana,
  paraColunas,
  paraIntervalos,
} from './working-hours.js';

describe('formato e precisão da hora', () => {
  it.each(['00:00', '09:00', '13:30', '23:59'])('aceita %s', (valor) => {
    expect(ehHoraValida(valor)).toBe(true);
  });

  it.each(['9:00', '09:0', '24:00', '09:60', '0900', '09:00:00', '', ' 09:00'])(
    'recusa %s',
    (valor) => {
      expect(ehHoraValida(valor)).toBe(false);
    },
  );

  it('converte para minutos desde a meia-noite', () => {
    expect(minutosDaHora('00:00')).toBe(0);
    expect(minutosDaHora('09:30')).toBe(570);
    expect(minutosDaHora('23:59')).toBe(1439);
  });

  it('hora fora do formato explode em vez de virar NaN silencioso', () => {
    expect(() => minutosDaHora('9:00')).toThrow(ErroDeHorario);
  });
});

describe('normalizarDia', () => {
  it('ordena os intervalos por início, de forma determinística', () => {
    const intervalos = normalizarDia({
      weekday: 1,
      intervals: [
        { start: '13:00', end: '18:00' },
        { start: '09:00', end: '12:00' },
      ],
    });

    expect(intervalos).toEqual([
      { start: '09:00', end: '12:00' },
      { start: '13:00', end: '18:00' },
    ]);
  });

  it('recusa fim igual ou anterior ao início — nunca vira virada de dia', () => {
    expect(() => normalizarDia({ weekday: 1, intervals: [{ start: '18:00', end: '09:00' }] })).toThrow(
      /precisa ser depois do início/,
    );
    expect(() => normalizarDia({ weekday: 1, intervals: [{ start: '09:00', end: '09:00' }] })).toThrow(
      ErroDeHorario,
    );
  });

  it('recusa sobreposição, nomeando o dia', () => {
    expect(() =>
      normalizarDia({
        weekday: 2,
        intervals: [
          { start: '09:00', end: '13:00' },
          { start: '12:00', end: '18:00' },
        ],
      }),
    ).toThrow(/terça-feira.*se sobrep/);
  });

  it('adjacentes NÃO são sobreposição: viram um período contínuo', () => {
    const intervalos = normalizarDia({
      weekday: 1,
      intervals: [
        { start: '09:00', end: '12:00' },
        { start: '12:00', end: '18:00' },
      ],
    });

    expect(intervalos).toEqual([{ start: '09:00', end: '18:00' }]);
  });

  it('mantém dois intervalos quando existe pausa de verdade', () => {
    const intervalos = normalizarDia({
      weekday: 1,
      intervals: [
        { start: '09:00', end: '12:00' },
        { start: '13:00', end: '18:00' },
      ],
    });

    expect(intervalos).toHaveLength(2);
  });

  it('recusa três intervalos — limite estrutural do modelo, explicitado', () => {
    expect(() =>
      normalizarDia({
        weekday: 3,
        intervals: [
          { start: '08:00', end: '10:00' },
          { start: '11:00', end: '13:00' },
          { start: '14:00', end: '16:00' },
        ],
      }),
    ).toThrow(/no máximo 2 intervalos por dia/);
  });

  it('dia sem intervalo nenhum é dia sem atendimento, não erro', () => {
    expect(normalizarDia({ weekday: 0, intervals: [] })).toEqual([]);
  });
});

describe('normalizarSemana', () => {
  it('ordena por dia e descarta os dias sem atendimento', () => {
    const semana = normalizarSemana([
      { weekday: 5, intervals: [{ start: '09:00', end: '12:00' }] },
      { weekday: 0, intervals: [] },
      { weekday: 1, intervals: [{ start: '08:00', end: '17:00' }] },
    ]);

    expect(semana.map((d) => d.weekday)).toEqual([1, 5]);
  });

  it('recusa dia repetido no mesmo envio', () => {
    expect(() =>
      normalizarSemana([
        { weekday: 1, intervals: [{ start: '09:00', end: '12:00' }] },
        { weekday: 1, intervals: [{ start: '13:00', end: '18:00' }] },
      ]),
    ).toThrow(/aparece mais de uma vez/);
  });

  it.each([-1, 7, 1.5])('recusa weekday inválido (%s)', (weekday) => {
    expect(() => normalizarSemana([{ weekday, intervals: [] }])).toThrow(/Dia da semana inválido/);
  });

  it('semana vazia é válida: não atende em nenhum dia', () => {
    expect(normalizarSemana([])).toEqual([]);
  });

  it('a sobreposição é avaliada por dia, nunca entre dias diferentes', () => {
    const semana = normalizarSemana([
      { weekday: 1, intervals: [{ start: '09:00', end: '18:00' }] },
      { weekday: 2, intervals: [{ start: '09:00', end: '18:00' }] },
    ]);

    expect(semana).toHaveLength(2);
  });
});

describe('mapeamento para as colunas reais', () => {
  it('um intervalo vira início/fim sem pausa', () => {
    expect(paraColunas([{ start: '09:00', end: '18:00' }])).toEqual({
      startTime: '09:00',
      endTime: '18:00',
      lunchStart: undefined,
      lunchEnd: undefined,
    });
  });

  it('dois intervalos viram início/fim com a pausa entre eles', () => {
    expect(
      paraColunas([
        { start: '09:00', end: '12:00' },
        { start: '13:00', end: '18:00' },
      ]),
    ).toEqual({ startTime: '09:00', endTime: '18:00', lunchStart: '12:00', lunchEnd: '13:00' });
  });

  it('ida e volta preserva os intervalos', () => {
    const originais = [
      { start: '09:00', end: '12:00' },
      { start: '13:00', end: '18:00' },
    ];
    expect(paraIntervalos(paraColunas(originais))).toEqual(originais);
  });

  it('leitura devolve a linha como está, sem corrigir dado fora da regra', () => {
    // Linha "impossível" pela gravação deste lote (fim antes do início).
    // A leitura precisa mostrar o que existe — quem recusa é a gravação.
    expect(paraIntervalos({ startTime: '22:00', endTime: '06:00' })).toEqual([
      { start: '22:00', end: '06:00' },
    ]);
  });

  it('pausa pela metade no banco não inventa intervalo', () => {
    expect(paraIntervalos({ startTime: '09:00', endTime: '18:00', lunchStart: '12:00' })).toEqual([
      { start: '09:00', end: '18:00' },
    ]);
  });
});
