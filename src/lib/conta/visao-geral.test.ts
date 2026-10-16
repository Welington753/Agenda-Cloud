import { describe, expect, it } from "vitest";
import type {
  AgendaDoDiaReal,
  AgendamentoReal,
  StatusAgendamentoReal,
} from "@/lib/api/appointments-api";
import {
  atendimentosEmAndamento,
  avaliarAgendaDeHoje,
  indicadoresDoDia,
  proximosAtendimentos,
} from "./visao-geral";

function reserva(
  id: string,
  startAt: string,
  status: StatusAgendamentoReal = "CONFIRMED",
): AgendamentoReal {
  return {
    id,
    startAt,
    serviceEndAt: new Date(Date.parse(startAt) + 30 * 60_000).toISOString(),
    occupancyEndAt: new Date(Date.parse(startAt) + 30 * 60_000).toISOString(),
    localStart: "09:00",
    localServiceEnd: "09:30",
    timezone: "America/Sao_Paulo",
    status,
    durationMinutes: 30,
    priceCents: null,
    notes: null,
    professional: { id: "p1", name: "Ana" },
    service: { id: "s1", name: "Corte" },
    consumer: { id: "c1", name: "Maria", whatsapp: "(11) 90000-0000" },
    unitId: "u1",
    createdAt: "2026-10-01T12:00:00.000Z",
  };
}

const AGORA = new Date("2026-10-15T13:00:00.000Z"); // 10:00 em São Paulo

describe("indicadoresDoDia", () => {
  it("conta cada status e deixa canceladas fora do total", () => {
    const lista = [
      reserva("a", "2026-10-15T12:00:00.000Z", "COMPLETED"),
      reserva("b", "2026-10-15T12:30:00.000Z", "NO_SHOW"),
      reserva("c", "2026-10-15T13:00:00.000Z", "IN_PROGRESS"),
      reserva("d", "2026-10-15T14:00:00.000Z", "PENDING"),
      reserva("e", "2026-10-15T15:00:00.000Z", "PENDING"),
      reserva("f", "2026-10-15T16:00:00.000Z", "CONFIRMED"),
      reserva("g", "2026-10-15T17:00:00.000Z", "CANCELED"),
    ];
    expect(indicadoresDoDia(lista)).toEqual({
      agendamentos: 6,
      aguardandoConfirmacao: 2,
      emAtendimento: 1,
      concluidos: 1,
    });
  });

  it("dia vazio é zero em tudo", () => {
    expect(indicadoresDoDia([])).toEqual({
      agendamentos: 0,
      aguardandoConfirmacao: 0,
      emAtendimento: 0,
      concluidos: 0,
    });
  });
});

describe("proximosAtendimentos", () => {
  it("só futuros PENDING/CONFIRMED, em ordem cronológica", () => {
    const lista = [
      reserva("tarde", "2026-10-15T18:00:00.000Z", "PENDING"),
      reserva("passado", "2026-10-15T12:00:00.000Z", "CONFIRMED"),
      reserva("agora-exato", AGORA.toISOString(), "CONFIRMED"),
      reserva("em-andamento", "2026-10-15T13:30:00.000Z", "IN_PROGRESS"),
      reserva("cancelado", "2026-10-15T14:00:00.000Z", "CANCELED"),
      reserva("cedo", "2026-10-15T13:15:00.000Z", "CONFIRMED"),
    ];
    expect(proximosAtendimentos(lista, AGORA).map((a) => a.id)).toEqual(["cedo", "tarde"]);
  });
});

describe("atendimentosEmAndamento", () => {
  it("só IN_PROGRESS, por horário", () => {
    const lista = [
      reserva("b", "2026-10-15T13:00:00.000Z", "IN_PROGRESS"),
      reserva("x", "2026-10-15T12:00:00.000Z", "CONFIRMED"),
      reserva("a", "2026-10-15T12:30:00.000Z", "IN_PROGRESS"),
    ];
    expect(atendimentosEmAndamento(lista).map((a) => a.id)).toEqual(["a", "b"]);
  });
});

describe("avaliarAgendaDeHoje", () => {
  const agenda = (extra: Partial<AgendaDoDiaReal>): AgendaDoDiaReal => ({
    timezone: "America/Sao_Paulo",
    date: "2026-10-15",
    appointments: [],
    completa: true,
    ...extra,
  });

  it("pronto só com o dia de hoje do estabelecimento e a lista completa", () => {
    expect(avaliarAgendaDeHoje(agenda({}), AGORA).tipo).toBe("pronto");
  });

  it("lista sem prova de completa nunca vira total", () => {
    expect(avaliarAgendaDeHoje(agenda({ completa: false }), AGORA)).toEqual({ tipo: "incompleto" });
  });

  it("resposta de outro dia (fuso ainda ajustando ou meia-noite) espera", () => {
    // 02:30Z do dia 16 ainda é dia 15 em São Paulo; a resposta do dia 16 não serve.
    expect(
      avaliarAgendaDeHoje(agenda({ date: "2026-10-16" }), new Date("2026-10-16T02:30:00.000Z")),
    ).toEqual({ tipo: "ajustando" });
  });
});
