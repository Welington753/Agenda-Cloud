import { describe, expect, it } from "vitest";
import type { AgendamentoReal, StatusAgendamentoReal } from "@/lib/api/appointments-api";
import type { ProfissionalReal } from "@/lib/api/professionals-api";
import {
  deslocarData,
  estaNoHorario,
  filtrarPorProfissional,
  hojeNoFuso,
  mensagemFalhaAgenda,
  opcoesDeProfissional,
  ordenarPorHorario,
  resumoDoDia,
  rotuloDoResumo,
  TODOS_OS_PROFISSIONAIS,
} from "./agenda-visual";

function reserva(
  id: string,
  startAt: string,
  extra: Partial<AgendamentoReal> & { status?: StatusAgendamentoReal } = {},
): AgendamentoReal {
  return {
    id,
    startAt,
    serviceEndAt: new Date(Date.parse(startAt) + 60 * 60_000).toISOString(),
    occupancyEndAt: new Date(Date.parse(startAt) + 60 * 60_000).toISOString(),
    localStart: "09:00",
    localServiceEnd: "10:00",
    timezone: "America/Sao_Paulo",
    status: "CONFIRMED",
    durationMinutes: 60,
    priceCents: 5000,
    notes: null,
    professional: { id: "p1", name: "Ana" },
    service: { id: "s1", name: "Corte" },
    consumer: { id: "c1", name: "Maria", whatsapp: "(11) 90000-0000" },
    unitId: "u1",
    createdAt: "2026-09-19T12:00:00.000Z",
    ...extra,
  };
}

function profissional(id: string, name: string, active = true): ProfissionalReal {
  return {
    id,
    name,
    avatarInitials: name.slice(0, 2),
    avatarColor: "#000",
    active,
    createdAt: "2026-01-01T00:00:00.000Z",
    services: [],
  };
}

describe("hojeNoFuso", () => {
  // 02:30Z do dia 21 ainda é 23:30 do dia 20 em São Paulo (UTC-3).
  const INSTANTE = new Date("2026-09-21T02:30:00.000Z");

  it("usa o fuso do estabelecimento, não o do navegador", () => {
    expect(hojeNoFuso("America/Sao_Paulo", INSTANTE)).toBe("2026-09-20");
    expect(hojeNoFuso("Asia/Tokyo", INSTANTE)).toBe("2026-09-21");
  });

  it("fuso inválido devolve null em vez de inventar uma data", () => {
    expect(hojeNoFuso("Fuso/Inexistente", INSTANTE)).toBeNull();
  });
});

describe("deslocarData", () => {
  it("anda dias de calendário, virando mês e ano", () => {
    expect(deslocarData("2026-09-20", 1)).toBe("2026-09-21");
    expect(deslocarData("2026-09-30", 1)).toBe("2026-10-01");
    expect(deslocarData("2026-01-01", -1)).toBe("2025-12-31");
    expect(deslocarData("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("data malformada volta igual", () => {
    expect(deslocarData("", 1)).toBe("");
    expect(deslocarData("ontem", 1)).toBe("ontem");
  });
});

describe("ordenarPorHorario", () => {
  it("ordena pelo instante, com empate pela criação, sem mutar a lista", () => {
    const tarde = reserva("tarde", "2026-09-20T17:00:00.000Z");
    const cedoNova = reserva("cedo-nova", "2026-09-20T12:00:00.000Z", {
      createdAt: "2026-09-19T15:00:00.000Z",
    });
    const cedoAntiga = reserva("cedo-antiga", "2026-09-20T12:00:00.000Z", {
      createdAt: "2026-09-19T10:00:00.000Z",
    });
    const lista = [tarde, cedoNova, cedoAntiga];
    expect(ordenarPorHorario(lista).map((a) => a.id)).toEqual([
      "cedo-antiga",
      "cedo-nova",
      "tarde",
    ]);
    expect(lista.map((a) => a.id)).toEqual(["tarde", "cedo-nova", "cedo-antiga"]);
  });
});

describe("filtrarPorProfissional", () => {
  const ana = reserva("a", "2026-09-20T12:00:00.000Z");
  const bia = reserva("b", "2026-09-20T13:00:00.000Z", { professional: { id: "p2", name: "Bia" } });

  it("todos devolve tudo; um id devolve só as reservas dele", () => {
    expect(filtrarPorProfissional([ana, bia], TODOS_OS_PROFISSIONAIS)).toEqual([ana, bia]);
    expect(filtrarPorProfissional([ana, bia], "p2")).toEqual([bia]);
    expect(filtrarPorProfissional([ana, bia], "p-sem-reserva")).toEqual([]);
  });
});

describe("opcoesDeProfissional", () => {
  it("junta cadastrados e quem só aparece na agenda, marca inativo e ordena", () => {
    const agenda = [
      reserva("a", "2026-09-20T12:00:00.000Z", { professional: { id: "p9", name: "Zeca" } }),
      reserva("b", "2026-09-20T13:00:00.000Z", { professional: { id: "p1", name: "Ana" } }),
    ];
    expect(
      opcoesDeProfissional([profissional("p1", "Ana"), profissional("p2", "Bruno", false)], agenda),
    ).toEqual([
      { id: "p1", nome: "Ana" },
      { id: "p2", nome: "Bruno (inativo)" },
      { id: "p9", nome: "Zeca" },
    ]);
  });
});

describe("estaNoHorario", () => {
  const inicio = "2026-09-20T12:00:00.000Z";

  it("verdadeiro entre o início e o fim do atendimento", () => {
    const a = reserva("a", inicio);
    expect(estaNoHorario(a, new Date("2026-09-20T11:59:59.000Z"))).toBe(false);
    expect(estaNoHorario(a, new Date(inicio))).toBe(true);
    expect(estaNoHorario(a, new Date("2026-09-20T12:59:00.000Z"))).toBe(true);
    expect(estaNoHorario(a, new Date("2026-09-20T13:00:00.000Z"))).toBe(false);
  });

  it("reserva encerrada nunca é destacada como atual", () => {
    for (const status of ["COMPLETED", "CANCELED", "NO_SHOW"] as const) {
      expect(estaNoHorario(reserva("a", inicio, { status }), new Date(inicio))).toBe(false);
    }
  });
});

describe("resumoDoDia / rotuloDoResumo", () => {
  it("conta atendimentos sem as canceladas", () => {
    const resumo = resumoDoDia([
      reserva("a", "2026-09-20T12:00:00.000Z", { status: "IN_PROGRESS" }),
      reserva("b", "2026-09-20T13:00:00.000Z"),
      reserva("c", "2026-09-20T14:00:00.000Z", { status: "CANCELED" }),
    ]);
    expect(resumo).toEqual({ atendimentos: 2, emAtendimento: 1, canceladas: 1 });
    expect(rotuloDoResumo(resumo)).toBe("2 atendimentos · 1 em atendimento · 1 cancelado");
  });

  it("singular e partes zeradas omitidas", () => {
    expect(rotuloDoResumo({ atendimentos: 1, emAtendimento: 0, canceladas: 0 })).toBe(
      "1 atendimento",
    );
    expect(rotuloDoResumo({ atendimentos: 0, emAtendimento: 0, canceladas: 2 })).toBe(
      "0 atendimentos · 2 cancelados",
    );
  });
});

describe("mensagemFalhaAgenda", () => {
  it("falha de rede numa leitura não fala em reserva criada", () => {
    const texto = mensagemFalhaAgenda({ tipo: "falha_comunicacao" });
    expect(texto).toContain("carregar a agenda");
    expect(texto).not.toContain("criada");
  });

  it("sem permissão fala em ver a agenda; o resto segue as frases de sempre", () => {
    expect(mensagemFalhaAgenda({ tipo: "sem_permissao" })).toContain("ver a agenda");
    expect(mensagemFalhaAgenda({ tipo: "nao_autenticado" })).toBe(
      "Sua sessão expirou. Entre novamente para continuar.",
    );
  });
});
