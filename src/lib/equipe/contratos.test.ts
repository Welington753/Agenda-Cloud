import { describe, expect, it } from "vitest";
import { ehMinhaAgenda, ehVisaoDaEquipe, perguntaDaAcao, textoDasVagas } from "./contratos";

const atendimento = {
  id: "a1",
  startAt: "2026-10-27T13:00:00.000Z",
  localDate: "2026-10-27",
  localStart: "10:00",
  localServiceEnd: "11:00",
  durationMinutes: 60,
  status: "CONFIRMED",
  service: { name: "Corte" },
  consumer: { name: "Maria" },
  actions: ["start"],
};

const agenda = {
  professional: { id: "p1", name: "Ana" },
  timezone: "America/Sao_Paulo",
  date: "2026-10-27",
  permissions: { start: true, complete: false, "no-show": false },
  appointments: [atendimento],
  complete: true,
};

const visao = {
  tenant: { id: "t1", name: "Estúdio" },
  plan: { name: "Essencial", maxProfessionals: 3 },
  seats: { limit: 3, activeAccesses: 1, pendingInvites: 1, suspendedAccesses: 0, used: 2, available: 1 },
  professionals: { active: 3, limit: 3 },
  grantablePermissions: [],
  permissionLabels: [],
  maxInviteSends: 5,
  members: [
    {
      professional: { id: "p1", name: "Ana", active: true, futureAppointments: 0 },
      access: null,
      invite: null,
      situation: "NO_ACCESS",
    },
  ],
};

describe("contratos da equipe", () => {
  it("aceita a agenda do funcionário e recusa forma inesperada", () => {
    expect(ehMinhaAgenda(agenda)).toBe(true);
    expect(ehMinhaAgenda({ ...agenda, permissions: { start: true } })).toBe(false);
    expect(ehMinhaAgenda({ ...agenda, appointments: [{ ...atendimento, actions: ["cancel"] }] })).toBe(false);
    expect(ehMinhaAgenda({ ...agenda, appointments: [{ ...atendimento, consumer: null }] })).toBe(false);
  });

  it("aceita a visão da equipe e recusa vagas faltando ou situação desconhecida", () => {
    expect(ehVisaoDaEquipe(visao)).toBe(true);
    expect(ehVisaoDaEquipe({ ...visao, seats: { ...visao.seats, available: undefined } })).toBe(false);
    expect(ehVisaoDaEquipe({ ...visao, members: [{ ...visao.members[0], situation: "OUTRA" }] })).toBe(false);
  });

  it("textos com os números do servidor", () => {
    expect(textoDasVagas(visao.seats)).toBe("2 de 3 em uso (1 ativo, 1 convite pendente)");
    expect(perguntaDaAcao("no-show", atendimento as never)).toContain("Não compareceu");
    expect(perguntaDaAcao("start", atendimento as never)).toBe("Iniciar o atendimento de Maria, 10:00?");
  });
});
