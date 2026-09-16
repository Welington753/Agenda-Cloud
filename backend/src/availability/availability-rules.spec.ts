// Regras do cálculo de disponibilidade (Lote 6D.4). Tudo aqui é puro: o
// "agora" é injetado em todo teste, então nenhum resultado muda conforme a
// hora ou o fuso da máquina que executa.
import { describe, expect, it } from 'vitest';
import {
  calcularHorariosDisponiveis,
  diaLocalDoInstante,
  PASSO_PADRAO_MINUTOS,
  type EntradaDeCalculo,
  type JanelaOcupada,
} from './availability-rules.js';

const SP = 'America/Sao_Paulo';
const NY = 'America/New_York';
const TOQUIO = 'Asia/Tokyo';

const DIA = { year: 2026, month: 9, day: 20 };
/** Bem antes do dia consultado: nenhum horário cai no passado por acidente. */
const ONTEM = new Date('2026-09-19T00:00:00Z');

function entrada(sobrescreve: Partial<EntradaDeCalculo> = {}): EntradaDeCalculo {
  return {
    data: DIA,
    timeZone: SP,
    intervalos: [{ start: '09:00', end: '18:00' }],
    duracaoMinutos: 60,
    bufferMinutos: 0,
    passoMinutos: PASSO_PADRAO_MINUTOS,
    ocupados: [],
    agora: ONTEM,
    antecedenciaMinimaMinutos: 0,
    limiteDiasFuturos: null,
    ...sobrescreve,
  };
}

function ocupado(inicio: string, fim: string, origem: JanelaOcupada['origem'] = 'agendamento') {
  return { inicio: new Date(inicio), fim: new Date(fim), origem };
}

function horasLocais(resultado: ReturnType<typeof calcularHorariosDisponiveis>): string[] {
  return resultado.slots.map((s) => s.localStart);
}

describe('encaixe no intervalo', () => {
  it('o atendimento que termina exatamente no fim do intervalo é oferecido', () => {
    const resultado = calcularHorariosDisponiveis(
      entrada({ intervalos: [{ start: '09:00', end: '10:00' }], duracaoMinutos: 60 }),
    );

    expect(horasLocais(resultado)).toEqual(['09:00']);
    expect(resultado.motivo).toBeNull();
  });

  it('um minuto a mais que o intervalo não cabe', () => {
    const resultado = calcularHorariosDisponiveis(
      entrada({ intervalos: [{ start: '09:00', end: '10:00' }], duracaoMinutos: 61 }),
    );

    expect(resultado.slots).toEqual([]);
    expect(resultado.motivo).toBe('sem_horario_livre');
  });

  it('duração maior que o expediente inteiro não gera horário nenhum', () => {
    const resultado = calcularHorariosDisponiveis(entrada({ duracaoMinutos: 600 }));

    expect(resultado.slots).toEqual([]);
    expect(resultado.motivo).toBe('sem_horario_livre');
  });

  it('a grade é ancorada no início do intervalo, não na meia-noite', () => {
    const resultado = calcularHorariosDisponiveis(
      entrada({ intervalos: [{ start: '09:10', end: '10:40' }], duracaoMinutos: 30 }),
    );

    expect(horasLocais(resultado)).toEqual(['09:10', '09:25', '09:40', '09:55', '10:10']);
  });

  it('espaçamento é independente da duração: 40 minutos ainda começa de 15 em 15', () => {
    const resultado = calcularHorariosDisponiveis(
      entrada({ intervalos: [{ start: '09:00', end: '11:00' }], duracaoMinutos: 40 }),
    );

    expect(horasLocais(resultado)).toEqual(['09:00', '09:15', '09:30', '09:45', '10:00', '10:15']);
  });
});

describe('pausa e dois turnos', () => {
  it('nenhum horário atravessa a pausa, e o turno da tarde é oferecido', () => {
    const resultado = calcularHorariosDisponiveis(
      entrada({
        intervalos: [
          { start: '09:00', end: '12:00' },
          { start: '13:00', end: '18:00' },
        ],
        duracaoMinutos: 60,
      }),
    );

    const horas = horasLocais(resultado);
    expect(horas[0]).toBe('09:00');
    expect(horas).toContain('11:00');
    // 11:15 terminaria 12:15, dentro da pausa.
    expect(horas).not.toContain('11:15');
    expect(horas).not.toContain('12:00');
    expect(horas).toContain('13:00');
    expect(horas[horas.length - 1]).toBe('17:00');
  });
});

describe('conflitos', () => {
  it('evento adjacente não bloqueia: fim excluído', () => {
    const resultado = calcularHorariosDisponiveis(
      entrada({
        intervalos: [{ start: '09:00', end: '12:00' }],
        duracaoMinutos: 60,
        passoMinutos: 60,
        ocupados: [ocupado('2026-09-20T13:00:00Z', '2026-09-20T14:00:00Z')], // 10:00-11:00 local
      }),
    );

    // 09:00 termina 10:00 (encosta) e 11:00 começa quando o outro termina.
    expect(horasLocais(resultado)).toEqual(['09:00', '11:00']);
  });

  it('evento sobreposto bloqueia', () => {
    const resultado = calcularHorariosDisponiveis(
      entrada({
        intervalos: [{ start: '09:00', end: '12:00' }],
        duracaoMinutos: 60,
        passoMinutos: 60,
        ocupados: [ocupado('2026-09-20T12:30:00Z', '2026-09-20T13:30:00Z')], // 09:30-10:30
      }),
    );

    expect(horasLocais(resultado)).toEqual(['11:00']);
  });

  it('conflito que COMEÇOU no dia anterior ocupa a manhã de hoje', () => {
    const resultado = calcularHorariosDisponiveis(
      entrada({
        intervalos: [{ start: '09:00', end: '12:00' }],
        duracaoMinutos: 60,
        passoMinutos: 60,
        // 19/09 23:00 -> 20/09 10:00, hora local.
        ocupados: [ocupado('2026-09-20T02:00:00Z', '2026-09-20T13:00:00Z')],
      }),
    );

    expect(horasLocais(resultado)).toEqual(['10:00', '11:00']);
  });

  it('bloqueio ocupa igual a agendamento', () => {
    const resultado = calcularHorariosDisponiveis(
      entrada({
        intervalos: [{ start: '09:00', end: '11:00' }],
        duracaoMinutos: 60,
        passoMinutos: 60,
        ocupados: [ocupado('2026-09-20T12:00:00Z', '2026-09-20T13:00:00Z', 'bloqueio')],
      }),
    );

    expect(horasLocais(resultado)).toEqual(['10:00']);
  });

  it('a ocupação é a janela PERSISTIDA, não a duração atual do catálogo', () => {
    // Reserva antiga de 90 minutos enquanto o serviço hoje dura 30: o horário
    // ocupado continua sendo o gravado.
    const resultado = calcularHorariosDisponiveis(
      entrada({
        intervalos: [{ start: '09:00', end: '12:00' }],
        duracaoMinutos: 30,
        passoMinutos: 30,
        ocupados: [ocupado('2026-09-20T12:00:00Z', '2026-09-20T13:30:00Z')], // 09:00-10:30
      }),
    );

    expect(horasLocais(resultado)).toEqual(['10:30', '11:00', '11:30']);
  });
});

describe('buffer do serviço consultado', () => {
  it('o buffer precisa caber dentro do intervalo', () => {
    const cabe = calcularHorariosDisponiveis(
      entrada({
        intervalos: [{ start: '09:00', end: '10:00' }],
        duracaoMinutos: 45,
        bufferMinutos: 15,
      }),
    );
    expect(horasLocais(cabe)).toEqual(['09:00']);

    const naoCabe = calcularHorariosDisponiveis(
      entrada({
        intervalos: [{ start: '09:00', end: '10:00' }],
        duracaoMinutos: 50,
        bufferMinutos: 15,
      }),
    );
    expect(naoCabe.slots).toEqual([]);
  });

  it('o buffer separa do conflito seguinte, mas não entra no fim exibido', () => {
    const resultado = calcularHorariosDisponiveis(
      entrada({
        intervalos: [{ start: '09:00', end: '12:15' }],
        duracaoMinutos: 60,
        bufferMinutos: 15,
        passoMinutos: 60,
        ocupados: [ocupado('2026-09-20T13:00:00Z', '2026-09-20T14:00:00Z')], // 10:00-11:00
      }),
    );

    // 09:00 terminaria 10:00 + 15 de buffer, invadindo o agendamento.
    expect(horasLocais(resultado)).toEqual(['11:00']);
    // O fim exibido é o do ATENDIMENTO, sem o buffer.
    expect(resultado.slots[0].localEnd).toBe('12:00');
  });
});

describe('jornada ausente', () => {
  it('sem intervalo nenhum, o motivo é jornada ausente — nunca dia livre', () => {
    const resultado = calcularHorariosDisponiveis(entrada({ intervalos: [] }));

    expect(resultado.slots).toEqual([]);
    expect(resultado.motivo).toBe('sem_jornada');
  });
});

describe('relógio controlado', () => {
  it('horário cujo início já passou não é oferecido', () => {
    const resultado = calcularHorariosDisponiveis(
      entrada({
        intervalos: [{ start: '09:00', end: '12:00' }],
        duracaoMinutos: 60,
        passoMinutos: 60,
        agora: new Date('2026-09-20T13:30:00Z'), // 10:30 local
      }),
    );

    expect(horasLocais(resultado)).toEqual(['11:00']);
  });

  it('um horário que começa exatamente agora ainda vale', () => {
    const resultado = calcularHorariosDisponiveis(
      entrada({
        intervalos: [{ start: '09:00', end: '11:00' }],
        duracaoMinutos: 60,
        passoMinutos: 60,
        agora: new Date('2026-09-20T13:00:00Z'), // 10:00 local
      }),
    );

    expect(horasLocais(resultado)).toEqual(['10:00']);
  });

  it('antecedência mínima empurra o primeiro horário', () => {
    const resultado = calcularHorariosDisponiveis(
      entrada({
        intervalos: [{ start: '09:00', end: '12:00' }],
        duracaoMinutos: 60,
        passoMinutos: 60,
        agora: new Date('2026-09-20T12:00:00Z'), // 09:00 local
        antecedenciaMinimaMinutos: 90,
      }),
    );

    expect(horasLocais(resultado)).toEqual(['11:00']);
  });

  it('data além do limite futuro tem motivo próprio', () => {
    const resultado = calcularHorariosDisponiveis(
      entrada({ agora: new Date('2026-09-01T12:00:00Z'), limiteDiasFuturos: 5 }),
    );

    expect(resultado.slots).toEqual([]);
    expect(resultado.motivo).toBe('fora_da_janela_futura');
  });

  it('sem política gravada não existe limite futuro inventado', () => {
    const resultado = calcularHorariosDisponiveis(
      entrada({ agora: new Date('2026-01-01T12:00:00Z'), limiteDiasFuturos: null }),
    );

    expect(resultado.slots.length).toBeGreaterThan(0);
  });

  it('o "hoje" do limite futuro é o do estabelecimento, não o do servidor', () => {
    // 2026-09-21T02:00Z ainda é dia 20 em São Paulo e já é dia 21 em Tóquio.
    const emSaoPaulo = calcularHorariosDisponiveis(
      entrada({ agora: new Date('2026-09-21T02:00:00Z'), limiteDiasFuturos: 0 }),
    );
    expect(emSaoPaulo.motivo).not.toBe('fora_da_janela_futura');

    expect(diaLocalDoInstante(new Date('2026-09-21T02:00:00Z'), SP)).toEqual(DIA);
    expect(diaLocalDoInstante(new Date('2026-09-21T02:00:00Z'), TOQUIO)).toEqual({
      year: 2026,
      month: 9,
      day: 21,
    });
  });
});

describe('fuso diferente do servidor', () => {
  it('os instantes saem no fuso do estabelecimento, não no da máquina', () => {
    const resultado = calcularHorariosDisponiveis(
      entrada({
        timeZone: TOQUIO,
        intervalos: [{ start: '09:00', end: '10:00' }],
        duracaoMinutos: 60,
      }),
    );

    expect(resultado.slots[0].startAt.toISOString()).toBe('2026-09-20T00:00:00.000Z');
    expect(resultado.slots[0].localStart).toBe('09:00');
    expect(resultado.slots[0].offsetLabel).toBe('+09:00');
  });
});

describe('viradas de horário de verão', () => {
  it('hora local inexistente nunca é oferecida, e a jornada não some', () => {
    // 2026-03-08 em Nova York: 02:00 vira 03:00.
    const resultado = calcularHorariosDisponiveis(
      entrada({
        data: { year: 2026, month: 3, day: 8 },
        timeZone: NY,
        intervalos: [{ start: '01:00', end: '05:00' }],
        duracaoMinutos: 60,
        passoMinutos: 60,
        agora: new Date('2026-03-01T00:00:00Z'),
      }),
    );

    expect(horasLocais(resultado)).toEqual(['01:00', '03:00', '04:00']);
    expect(horasLocais(resultado)).not.toContain('02:00');
    // Nenhum instante repetido e todos reais.
    expect(new Set(resultado.slots.map((s) => s.startAt.getTime())).size).toBe(3);
  });

  it('jornada que COMEÇA numa hora inexistente começa quando o relógio volta a existir', () => {
    const resultado = calcularHorariosDisponiveis(
      entrada({
        data: { year: 2026, month: 3, day: 8 },
        timeZone: NY,
        intervalos: [{ start: '02:00', end: '05:00' }],
        duracaoMinutos: 60,
        passoMinutos: 60,
        agora: new Date('2026-03-01T00:00:00Z'),
      }),
    );

    expect(horasLocais(resultado)).toEqual(['03:00', '04:00']);
    expect(resultado.slots[0].startAt.toISOString()).toBe('2026-03-08T07:00:00.000Z');
  });

  it('hora local repetida vira DOIS horários distinguíveis, nunca duplicata', () => {
    // 2026-11-01 em Nova York: 02:00 volta para 01:00.
    const resultado = calcularHorariosDisponiveis(
      entrada({
        data: { year: 2026, month: 11, day: 1 },
        timeZone: NY,
        intervalos: [{ start: '00:00', end: '04:00' }],
        duracaoMinutos: 60,
        passoMinutos: 60,
        agora: new Date('2026-10-01T00:00:00Z'),
      }),
    );

    expect(horasLocais(resultado)).toEqual(['00:00', '01:00', '01:00', '02:00', '03:00']);

    const umaHora = resultado.slots.filter((s) => s.localStart === '01:00');
    expect(umaHora).toHaveLength(2);
    // Mesma hora local, instantes e deslocamentos diferentes: distinguíveis.
    expect(umaHora.map((s) => s.startAt.toISOString())).toEqual([
      '2026-11-01T05:00:00.000Z',
      '2026-11-01T06:00:00.000Z',
    ]);
    expect(umaHora.map((s) => s.offsetLabel)).toEqual(['-04:00', '-05:00']);
  });

  it('o dia com hora repetida tem 25 horas e todos os instantes são únicos', () => {
    const resultado = calcularHorariosDisponiveis(
      entrada({
        data: { year: 2026, month: 11, day: 1 },
        timeZone: NY,
        intervalos: [{ start: '00:00', end: '23:00' }],
        duracaoMinutos: 60,
        passoMinutos: 60,
        agora: new Date('2026-10-01T00:00:00Z'),
      }),
    );

    // 00:00 -> 23:00 local nesse dia são 24 horas absolutas, logo 23 horários
    // de 60 minutos... mais o que a hora repetida acrescenta.
    expect(resultado.slots).toHaveLength(24);
    expect(new Set(resultado.slots.map((s) => s.startAt.getTime())).size).toBe(24);
  });
});

describe('ordenação e unicidade', () => {
  it('a lista sai ordenada por instante, sem repetição', () => {
    const resultado = calcularHorariosDisponiveis(
      entrada({
        intervalos: [
          { start: '13:00', end: '15:00' },
          { start: '09:00', end: '11:00' },
        ],
        duracaoMinutos: 60,
        passoMinutos: 60,
      }),
    );

    expect(horasLocais(resultado)).toEqual(['09:00', '10:00', '13:00', '14:00']);
    const instantes = resultado.slots.map((s) => s.startAt.getTime());
    expect([...instantes].sort((a, b) => a - b)).toEqual(instantes);
    expect(new Set(instantes).size).toBe(instantes.length);
  });
});
