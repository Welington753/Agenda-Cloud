// Matriz das quatro ações de status (Lote 6D.7), com as bordas de horário.
// O relógio é sempre parâmetro: nenhum teste depende da hora em que roda.
import { describe, expect, it } from 'vitest';
import { AppointmentStatus } from '../entities/enums/appointment-status.enum.js';
import {
  ACOES_DE_STATUS,
  DESTINO_DA_ACAO,
  transicaoPermitida,
  type AcaoDeStatus,
} from './appointment-status-transitions.js';

const INICIO = new Date('2026-09-20T12:00:00.000Z');
const MINUTO = 60_000;
const em = (deslocamentoMs: number) => new Date(INICIO.getTime() + deslocamentoMs);

const {
  PENDING,
  CONFIRMED,
  IN_PROGRESS,
  COMPLETED,
  CANCELED,
  NO_SHOW,
} = AppointmentStatus;

describe('destino de cada ação', () => {
  it('é fixo por ação', () => {
    expect(DESTINO_DA_ACAO).toEqual({
      confirm: CONFIRMED,
      start: IN_PROGRESS,
      complete: COMPLETED,
      'no-show': NO_SHOW,
    });
  });
});

describe('estados finais', () => {
  it.each(
    ACOES_DE_STATUS.flatMap((acao) =>
      [COMPLETED, NO_SHOW, CANCELED].map((status) => [acao, status] as const),
    ),
  )('%s nunca sai de %s', (acao, status) => {
    // Antes, no início e bem depois: nenhum instante abre um estado final.
    for (const agora of [em(-60 * MINUTO), INICIO, em(5 * 60 * MINUTO)]) {
      expect(transicaoPermitida(acao, status, INICIO, agora)).toBe(false);
    }
  });
});

describe('confirmar: PENDING -> CONFIRMED só antes do início', () => {
  it('aceita PENDING antes do início', () => {
    expect(transicaoPermitida('confirm', PENDING, INICIO, em(-1))).toBe(true);
  });

  it('recusa no instante do início e depois', () => {
    expect(transicaoPermitida('confirm', PENDING, INICIO, INICIO)).toBe(false);
    expect(transicaoPermitida('confirm', PENDING, INICIO, em(MINUTO))).toBe(false);
  });

  it.each([CONFIRMED, IN_PROGRESS])('recusa a partir de %s', (status) => {
    expect(transicaoPermitida('confirm', status, INICIO, em(-60 * MINUTO))).toBe(false);
  });
});

describe('iniciar: PENDING ou CONFIRMED, a partir de 30 min antes, sem limite final', () => {
  it.each([PENDING, CONFIRMED])('%s: recusa 1 ms antes da janela', (status) => {
    expect(transicaoPermitida('start', status, INICIO, em(-30 * MINUTO - 1))).toBe(false);
  });

  it.each([PENDING, CONFIRMED])('%s: aceita exatamente 30 min antes', (status) => {
    expect(transicaoPermitida('start', status, INICIO, em(-30 * MINUTO))).toBe(true);
  });

  it.each([PENDING, CONFIRMED])('%s: aceita no início e horas depois', (status) => {
    expect(transicaoPermitida('start', status, INICIO, INICIO)).toBe(true);
    expect(transicaoPermitida('start', status, INICIO, em(10 * 60 * MINUTO))).toBe(true);
  });

  it('recusa a partir de IN_PROGRESS (repetição é tratada antes, pelo service)', () => {
    expect(transicaoPermitida('start', IN_PROGRESS, INICIO, INICIO)).toBe(false);
  });
});

describe('concluir', () => {
  it('IN_PROGRESS conclui a qualquer momento, mesmo antes do início marcado', () => {
    // Iniciado 30 min antes e terminado antes da hora marcada é legítimo.
    expect(transicaoPermitida('complete', IN_PROGRESS, INICIO, em(-20 * MINUTO))).toBe(true);
    expect(transicaoPermitida('complete', IN_PROGRESS, INICIO, em(10 * 60 * MINUTO))).toBe(true);
  });

  it('CONFIRMED conclui direto só a partir do início marcado', () => {
    expect(transicaoPermitida('complete', CONFIRMED, INICIO, em(-1))).toBe(false);
    expect(transicaoPermitida('complete', CONFIRMED, INICIO, INICIO)).toBe(true);
    expect(transicaoPermitida('complete', CONFIRMED, INICIO, em(3 * 60 * MINUTO))).toBe(true);
  });

  it('PENDING nunca conclui direto — precisa ser iniciado (ou confirmado) antes', () => {
    expect(transicaoPermitida('complete', PENDING, INICIO, em(60 * MINUTO))).toBe(false);
  });
});

describe('registrar falta: PENDING ou CONFIRMED, só depois do início', () => {
  it.each([PENDING, CONFIRMED])('%s: recusa antes e NO instante do início', (status) => {
    expect(transicaoPermitida('no-show', status, INICIO, em(-1))).toBe(false);
    expect(transicaoPermitida('no-show', status, INICIO, INICIO)).toBe(false);
  });

  it.each([PENDING, CONFIRMED])('%s: aceita 1 ms depois do início', (status) => {
    expect(transicaoPermitida('no-show', status, INICIO, em(1))).toBe(true);
  });

  it('atendimento em andamento não vira falta', () => {
    expect(transicaoPermitida('no-show', IN_PROGRESS, INICIO, em(60 * MINUTO))).toBe(false);
  });
});

describe('nenhuma ação desconhecida passa', () => {
  it('o conjunto de ações é exatamente o aprovado', () => {
    const acoes: AcaoDeStatus[] = ['confirm', 'start', 'complete', 'no-show'];
    expect(ACOES_DE_STATUS).toEqual(acoes);
  });
});
