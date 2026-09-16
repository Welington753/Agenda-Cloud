import { describe, expect, it } from "vitest";
import type { DisponibilidadeReal, HorarioReal } from "@/lib/api/availability-api";
import {
  comoDataDeCalendario,
  dataInicial,
  marcarAmbiguos,
  mensagemFalhaDisponibilidade,
  mensagemSemHorario,
  regrasAplicadas,
  rotuloDaData,
  rotuloDeDuracao,
} from "./disponibilidade";

function horario(localStart: string, offsetLabel = "-03:00", startAt = `2026-09-20T12:00:00.000Z`): HorarioReal {
  return {
    startAt,
    endAt: startAt,
    localStart,
    localEnd: localStart,
    offsetMinutes: -180,
    offsetLabel,
  };
}

const BASE: DisponibilidadeReal = {
  professionalId: "p1",
  serviceId: "s1",
  date: "2026-09-20",
  timezone: "America/Sao_Paulo",
  durationMinutes: 30,
  bufferAfterMinutes: 0,
  slotStepMinutes: 15,
  minLeadMinutes: null,
  maxFutureDays: null,
  slots: [],
  emptyReason: null,
};

describe("mensagemFalhaDisponibilidade", () => {
  it("o 403 fala da agenda, não da gestão de profissionais", () => {
    expect(mensagemFalhaDisponibilidade({ tipo: "sem_permissao" })).toContain("consultar a agenda");
  });

  it("404 nunca revela que o estabelecimento existe", () => {
    const mensagem = mensagemFalhaDisponibilidade({ tipo: "sem_acesso" });
    expect(mensagem).toBe("Você não tem acesso a este estabelecimento.");
  });

  it("preserva a orientação específica que veio do backend", () => {
    const mensagem = mensagemFalhaDisponibilidade({
      tipo: "nao_consultavel",
      mensagem: "Este serviço está desativado.",
    });
    expect(mensagem).toBe("Este serviço está desativado.");
  });

  it("sem mensagem do backend, cai numa redação genérica sem inventar causa", () => {
    const mensagem = mensagemFalhaDisponibilidade({ tipo: "nao_consultavel", mensagem: null });
    expect(mensagem).toContain("Revise a seleção");
  });

  it("falha de comunicação não afirma nada sobre o estado do servidor", () => {
    const mensagem = mensagemFalhaDisponibilidade({ tipo: "falha_comunicacao" });
    expect(mensagem).toContain("antes de o servidor responder");
  });
});

describe("mensagemSemHorario", () => {
  it.each([
    ["sem_jornada", "horários de trabalho"],
    ["fora_da_janela_futura", "limite de agendamento futuro"],
    ["sem_horario_livre", "ocupada"],
  ] as const)("%s explica a causa real", (motivo, trecho) => {
    expect(mensagemSemHorario(motivo)).toContain(trecho);
  });

  it("cada motivo tem uma redação própria — nunca a mesma frase genérica", () => {
    const textos = new Set([
      mensagemSemHorario("sem_jornada"),
      mensagemSemHorario("fora_da_janela_futura"),
      mensagemSemHorario("sem_horario_livre"),
    ]);
    expect(textos.size).toBe(3);
  });
});

describe("comoDataDeCalendario", () => {
  it("usa os componentes locais, nunca UTC", () => {
    // 23:30 local do dia 20 — `toISOString()` num fuso a oeste diria 21.
    const data = new Date(2026, 8, 20, 23, 30, 0);
    expect(comoDataDeCalendario(data)).toBe("2026-09-20");
  });

  it("preenche mês e dia com zero à esquerda", () => {
    expect(comoDataDeCalendario(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("dataInicial parte do hoje injetado, nunca de um relógio implícito", () => {
    expect(dataInicial(new Date(2027, 10, 2, 8, 0, 0))).toBe("2027-11-02");
  });
});

describe("rotuloDaData", () => {
  it("lê a data de calendário sem deslocar o dia", () => {
    expect(rotuloDaData("2026-09-20")).toContain("20");
    expect(rotuloDaData("2026-09-20")).toContain("2026");
  });

  it("devolve a entrada quando ela não é uma data", () => {
    expect(rotuloDaData("nada")).toBe("nada");
  });
});

describe("rotuloDeDuracao", () => {
  it.each([
    [30, "30 min"],
    [60, "1 h"],
    [90, "1 h 30 min"],
    [135, "2 h 15 min"],
  ])("%i minutos vira %s", (minutos, esperado) => {
    expect(rotuloDeDuracao(minutos)).toBe(esperado);
  });
});

describe("marcarAmbiguos", () => {
  it("marca só as horas locais repetidas (dia em que o relógio volta)", () => {
    const marcados = marcarAmbiguos([
      horario("00:30"),
      horario("01:00", "-04:00", "2026-11-01T05:00:00.000Z"),
      horario("01:00", "-05:00", "2026-11-01T06:00:00.000Z"),
      horario("02:00"),
    ]);

    expect(marcados.map((s) => s.ambiguo)).toEqual([false, true, true, false]);
  });

  it("dia normal não marca nada", () => {
    const marcados = marcarAmbiguos([horario("09:00"), horario("09:15")]);
    expect(marcados.every((s) => !s.ambiguo)).toBe(true);
  });

  it("lista vazia não quebra", () => {
    expect(marcarAmbiguos([])).toEqual([]);
  });
});

describe("regrasAplicadas", () => {
  it("cita sempre duração e passo da grade", () => {
    const regras = regrasAplicadas(BASE);
    expect(regras[0]).toContain("30 min");
    expect(regras[1]).toContain("15 em 15");
  });

  it("sem política gravada, não inventa antecedência nem limite futuro", () => {
    const regras = regrasAplicadas(BASE).join(" | ");
    expect(regras).not.toContain("Antecedência");
    expect(regras).not.toContain("Limite");
  });

  it("com política gravada, diz exatamente o que o servidor aplicou", () => {
    const regras = regrasAplicadas({ ...BASE, minLeadMinutes: 120, maxFutureDays: 30 }).join(" | ");
    expect(regras).toContain("Antecedência mínima: 2 h");
    expect(regras).toContain("Limite de agendamento futuro: 30 dias");
  });

  it("antecedência de 0 gravada é citada — zero configurado não é ausência", () => {
    const regras = regrasAplicadas({ ...BASE, minLeadMinutes: 0 }).join(" | ");
    expect(regras).toContain("Antecedência mínima: 0 min");
  });

  it("buffer zero não vira linha de ruído", () => {
    expect(regrasAplicadas(BASE).join(" | ")).not.toContain("Intervalo após");
    expect(regrasAplicadas({ ...BASE, bufferAfterMinutes: 10 }).join(" | ")).toContain(
      "Intervalo após o atendimento: 10 min",
    );
  });
});
