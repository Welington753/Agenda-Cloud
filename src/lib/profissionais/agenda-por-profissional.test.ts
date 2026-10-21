import { describe, expect, it } from "vitest";
import type { AgendamentoReal } from "@/lib/api/appointments-api";
import type { ProfissionalReal } from "@/lib/api/professionals-api";
import { agruparPorProfissional } from "./agenda-visual";

function reserva(id: string, startAt: string, professional: { id: string; name: string }): AgendamentoReal {
  return {
    id,
    startAt,
    serviceEndAt: new Date(Date.parse(startAt) + 30 * 60_000).toISOString(),
    occupancyEndAt: new Date(Date.parse(startAt) + 30 * 60_000).toISOString(),
    localStart: "09:00",
    localServiceEnd: "09:30",
    timezone: "America/Sao_Paulo",
    status: "CONFIRMED",
    durationMinutes: 30,
    priceCents: null,
    notes: null,
    professional,
    service: { id: "s1", name: "Corte" },
    consumer: { id: `c-${id}`, name: `Cliente ${id}`, whatsapp: "(11) 90000-0000" },
    unitId: "u1",
    createdAt: "2026-09-19T12:00:00.000Z",
  };
}

function profissional(id: string, name: string, active = true): ProfissionalReal {
  return { id, name, avatarInitials: "", avatarColor: "#000", active, createdAt: "", services: [] };
}

const ANA = { id: "p-ana", name: "Ana" };
const BRUNO = { id: "p-bruno", name: "Bruno" };
const CARLA = { id: "p-carla", name: "Carla" };

describe("agruparPorProfissional", () => {
  const agenda = [
    reserva("b2", "2026-09-20T15:00:00.000Z", BRUNO),
    reserva("a2", "2026-09-20T14:00:00.000Z", ANA),
    reserva("b1", "2026-09-20T12:00:00.000Z", BRUNO),
    reserva("a1", "2026-09-20T12:30:00.000Z", ANA),
  ];

  it("agrupa por profissional, grupos em ordem alfabética e reservas em ordem cronológica", () => {
    const grupos = agruparPorProfissional(agenda, [profissional(ANA.id, "Ana"), profissional(BRUNO.id, "Bruno")], false);
    expect(grupos.map((g) => g.nome)).toEqual(["Ana", "Bruno"]);
    expect(grupos[0].agendamentos.map((a) => a.id)).toEqual(["a1", "a2"]);
    expect(grupos[1].agendamentos.map((a) => a.id)).toEqual(["b1", "b2"]);
  });

  it("não perde nem duplica reservas", () => {
    const grupos = agruparPorProfissional(agenda, [], false);
    const ids = grupos.flatMap((g) => g.agendamentos.map((a) => a.id)).sort();
    expect(ids).toEqual(["a1", "a2", "b1", "b2"]);
  });

  it("mantém reservas de profissional inativo e de quem não está no catálogo", () => {
    const comCarla = [...agenda, reserva("c1", "2026-09-20T13:00:00.000Z", CARLA)];
    const grupos = agruparPorProfissional(comCarla, [profissional(ANA.id, "Ana", false)], false);
    const ana = grupos.find((g) => g.professionalId === ANA.id)!;
    expect(ana.inativo).toBe(true);
    expect(ana.agendamentos).toHaveLength(2);
    // Bruno e Carla não vieram no catálogo: o nome sai da própria reserva.
    expect(grupos.map((g) => g.nome)).toEqual(["Ana", "Bruno", "Carla"]);
  });

  it("profissional ativo sem reserva só aparece quando pedido (lista completa e sem filtro)", () => {
    const catalogo = [
      profissional(ANA.id, "Ana"),
      profissional(BRUNO.id, "Bruno"),
      profissional("p-dani", "Dani"),
      profissional("p-edu", "Edu", false),
    ];
    expect(agruparPorProfissional(agenda, catalogo, false).map((g) => g.nome)).toEqual(["Ana", "Bruno"]);
    const completos = agruparPorProfissional(agenda, catalogo, true);
    expect(completos.map((g) => g.nome)).toEqual(["Ana", "Bruno", "Dani"]);
    expect(completos.find((g) => g.nome === "Dani")!.agendamentos).toEqual([]);
  });

  it("dia vazio sem pedido de grupos vazios não gera grupo nenhum", () => {
    expect(agruparPorProfissional([], [profissional(ANA.id, "Ana")], false)).toEqual([]);
  });
});
