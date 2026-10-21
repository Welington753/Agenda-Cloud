// Política de programação com relógio fixo: nenhum caso depende da hora em
// que o teste roda.
import { describe, expect, it } from 'vitest';
import {
  chaveDeDeduplicacao,
  instanteDoLembreteDaVespera,
  planejarNotificacoes,
  type TarefaPlanejada,
} from './notification-policy.js';

const SP = 'America/Sao_Paulo'; // UTC-3, sem horário de verão
const NY = 'America/New_York'; // horário de verão: 2026-11-01 02:00 volta para 01:00

function resumo(tarefas: TarefaPlanejada[]) {
  return tarefas.map((t) => ({
    tipo: t.tipo,
    programadaPara: t.programadaPara.toISOString(),
    prazo: t.prazo.toISOString(),
  }));
}

// Atendimento: sexta 2026-10-30 às 14:00 em São Paulo (17:00Z).
const INICIO = new Date('2026-10-30T17:00:00.000Z');

describe('planejarNotificacoes', () => {
  it('com antecedência: confirmação agora, véspera às 09:00 locais e 2 h antes', () => {
    const agora = new Date('2026-10-20T15:00:00.000Z');
    expect(resumo(planejarNotificacoes({ inicio: INICIO, timezone: SP, agora, incluirConfirmacao: true }))).toEqual([
      { tipo: 'CONFIRMATION', programadaPara: agora.toISOString(), prazo: INICIO.toISOString() },
      // 2026-10-29 09:00 em SP = 12:00Z; prazo 6 h depois.
      { tipo: 'REMINDER_DAY_BEFORE', programadaPara: '2026-10-29T12:00:00.000Z', prazo: '2026-10-29T18:00:00.000Z' },
      { tipo: 'REMINDER_2H', programadaPara: '2026-10-30T15:00:00.000Z', prazo: '2026-10-30T16:30:00.000Z' },
    ]);
  });

  it('feita no dia antes da véspera, à noite, ainda ganha o lembrete da véspera', () => {
    // 2026-10-28 23:30 em SP (02:30Z do dia 29).
    const agora = new Date('2026-10-29T02:30:00.000Z');
    const tipos = planejarNotificacoes({ inicio: INICIO, timezone: SP, agora, incluirConfirmacao: true }).map((t) => t.tipo);
    expect(tipos).toEqual(['CONFIRMATION', 'REMINDER_DAY_BEFORE', 'REMINDER_2H']);
  });

  it('feita NA véspera (mesmo antes das 09:00): sem lembrete da véspera', () => {
    // 2026-10-29 07:00 em SP — antes das 09:00, mas já é a véspera.
    const agora = new Date('2026-10-29T10:00:00.000Z');
    const tipos = planejarNotificacoes({ inicio: INICIO, timezone: SP, agora, incluirConfirmacao: true }).map((t) => t.tipo);
    expect(tipos).toEqual(['CONFIRMATION', 'REMINDER_2H']);
  });

  it('feita no próprio dia: só confirmação e, se ainda der, o lembrete de 2 h', () => {
    const cedo = new Date('2026-10-30T11:00:00.000Z'); // 08:00 local
    expect(
      planejarNotificacoes({ inicio: INICIO, timezone: SP, agora: cedo, incluirConfirmacao: true }).map((t) => t.tipo),
    ).toEqual(['CONFIRMATION', 'REMINDER_2H']);
  });

  it('confirmação tardia: o lembrete de 2 h já passou e NÃO é programado', () => {
    const tarde = new Date('2026-10-30T16:00:00.000Z'); // 1 h antes
    expect(
      planejarNotificacoes({ inicio: INICIO, timezone: SP, agora: tarde, incluirConfirmacao: true }).map((t) => t.tipo),
    ).toEqual(['CONFIRMATION']);
    // Exatamente no instante do lembrete também não conta como futuro.
    const exato = new Date('2026-10-30T15:00:00.000Z');
    expect(
      planejarNotificacoes({ inicio: INICIO, timezone: SP, agora: exato, incluirConfirmacao: true }).map((t) => t.tipo),
    ).toEqual(['CONFIRMATION']);
  });

  it('reserva que já começou não recebe nada', () => {
    expect(planejarNotificacoes({ inicio: INICIO, timezone: SP, agora: INICIO, incluirConfirmacao: true })).toEqual([]);
  });

  it('remarcação: sem confirmação nova; regras de véspera e 2 h refeitas a partir da remarcação', () => {
    const naVespera = new Date('2026-10-29T13:00:00.000Z'); // véspera, 10:00 local
    expect(
      planejarNotificacoes({ inicio: INICIO, timezone: SP, agora: naVespera, incluirConfirmacao: false }).map((t) => t.tipo),
    ).toEqual(['REMINDER_2H']);
  });

  it('virada de dia: atendimento às 00:30 tem véspera no dia anterior, mesmo a 30 min de distância', () => {
    // 2026-10-31 00:30 em SP = 03:30Z. A véspera é 30/10, às 09:00 locais.
    const inicio = new Date('2026-10-31T03:30:00.000Z');
    expect(instanteDoLembreteDaVespera(inicio, SP).toISOString()).toBe('2026-10-30T12:00:00.000Z');
    // Confirmada em 30/10 às 23:00 local (02:00Z do 31): é a véspera — sem lembrete da véspera.
    const agora = new Date('2026-10-31T02:00:00.000Z');
    expect(
      planejarNotificacoes({ inicio, timezone: SP, agora, incluirConfirmacao: true }).map((t) => t.tipo),
    ).toEqual(['CONFIRMATION']);
  });

  it('usa o calendário do ESTABELECIMENTO, não o UTC: mesma data UTC, vésperas diferentes', () => {
    // 2026-10-30T02:00Z é 29/10 23:00 em SP e 30/10 11:00 em Tóquio.
    const inicio = new Date('2026-10-30T02:00:00.000Z');
    expect(instanteDoLembreteDaVespera(inicio, SP).toISOString()).toBe('2026-10-28T12:00:00.000Z');
    expect(instanteDoLembreteDaVespera(inicio, 'Asia/Tokyo').toISOString()).toBe('2026-10-29T00:00:00.000Z');
  });

  it('horário de verão: véspera pelo calendário, não "início − 24 h"', () => {
    // NY volta o relógio em 2026-11-01. Atendimento 2026-11-02 08:00 EST (13:00Z).
    const inicio = new Date('2026-11-02T13:00:00.000Z');
    // Véspera 2026-11-01 09:00 EST = 14:00Z (já depois da volta).
    expect(instanteDoLembreteDaVespera(inicio, NY).toISOString()).toBe('2026-11-01T14:00:00.000Z');
    // Atendimento 2026-11-01 10:00 EST (15:00Z): véspera 31/10 09:00 EDT = 13:00Z,
    // que é 26 h antes, não 24.
    const noDiaDaVirada = new Date('2026-11-01T15:00:00.000Z');
    expect(instanteDoLembreteDaVespera(noDiaDaVirada, NY).toISOString()).toBe('2026-10-31T13:00:00.000Z');
  });
});

describe('chaveDeDeduplicacao', () => {
  it('confirmação é uma por reserva; lembretes, um por reserva e início', () => {
    expect(chaveDeDeduplicacao('a1', 'CONFIRMATION', INICIO)).toBe('a1:CONFIRMATION');
    expect(chaveDeDeduplicacao('a1', 'REMINDER_2H', INICIO)).toBe('a1:REMINDER_2H:2026-10-30T17:00:00.000Z');
    expect(chaveDeDeduplicacao('a1', 'REMINDER_2H', new Date('2026-10-30T18:00:00.000Z'))).not.toBe(
      chaveDeDeduplicacao('a1', 'REMINDER_2H', INICIO),
    );
  });
});
