import { describe, expect, it } from "vitest";
import type { AgendamentoReal, StatusAgendamentoReal } from "@/lib/api/appointments-api";
import {
  comoDataDeCalendario,
  mensagemFalhaAgendamento,
  mensagemFalhaCancelamento,
  mensagemFalhaRemarcacao,
  podeAlterarAgendamento,
  resumoDoAgendamento,
  ROTULO_STATUS,
  rotuloDaData,
  rotuloDeDuracao,
  rotuloDePreco,
} from "./agendamentos";

const AGENDAMENTO: AgendamentoReal = {
  id: "a1",
  startAt: "2026-09-20T12:00:00.000Z",
  serviceEndAt: "2026-09-20T13:00:00.000Z",
  occupancyEndAt: "2026-09-20T13:10:00.000Z",
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
};

describe("mensagemFalhaAgendamento", () => {
  it("409 orienta a consultar de novo", () => {
    const mensagem = mensagemFalhaAgendamento({ tipo: "horario_ocupado", mensagem: null });
    expect(mensagem).toContain("ocupado");
  });

  it("409 preserva a mensagem do servidor quando ela vem", () => {
    const mensagem = mensagemFalhaAgendamento({
      tipo: "horario_ocupado",
      mensagem: "Este horário acabou de ser ocupado.",
    });
    expect(mensagem).toBe("Este horário acabou de ser ocupado.");
  });

  it("falha de comunicação NUNCA afirma que a reserva não foi criada", () => {
    const mensagem = mensagemFalhaAgendamento({ tipo: "falha_comunicacao" });
    expect(mensagem).toContain("pode ter sido criada");
    expect(mensagem).toContain("confira a agenda");
    expect(mensagem).not.toMatch(/não foi criad|nenhuma reserva/i);
  });

  it("403 fala de agendar, não de outra área", () => {
    expect(mensagemFalhaAgendamento({ tipo: "sem_permissao" })).toContain("agendar");
  });

  it("400 preserva a orientação específica do servidor", () => {
    expect(
      mensagemFalhaAgendamento({ tipo: "nao_agendavel", mensagem: "Este serviço está desativado." }),
    ).toBe("Este serviço está desativado.");
  });

  it("cada tipo tem redação própria", () => {
    const textos = new Set([
      mensagemFalhaAgendamento({ tipo: "nao_autenticado" }),
      mensagemFalhaAgendamento({ tipo: "sem_acesso" }),
      mensagemFalhaAgendamento({ tipo: "sem_permissao" }),
      mensagemFalhaAgendamento({ tipo: "horario_ocupado", mensagem: null }),
      mensagemFalhaAgendamento({ tipo: "nao_agendavel", mensagem: null }),
      mensagemFalhaAgendamento({ tipo: "falha_comunicacao" }),
      mensagemFalhaAgendamento({ tipo: "indisponivel" }),
    ]);
    expect(textos.size).toBe(7);
  });
});

describe("rotuloDePreco", () => {
  it("preço indefinido é 'sob consulta', nunca R$ 0,00", () => {
    expect(rotuloDePreco(null)).toBe("Sob consulta");
    expect(rotuloDePreco(null)).not.toContain("0,00");
  });

  it("zero gravado é zero de verdade, não 'sob consulta'", () => {
    expect(rotuloDePreco(0)).toContain("0,00");
  });

  it("formata centavos em reais", () => {
    expect(rotuloDePreco(5000)).toContain("50,00");
  });
});

describe("rotuloDeDuracao", () => {
  it.each([
    [30, "30 min"],
    [60, "1 h"],
    [90, "1 h 30 min"],
  ])("%i minutos vira %s", (minutos, esperado) => {
    expect(rotuloDeDuracao(minutos)).toBe(esperado);
  });
});

describe("comoDataDeCalendario", () => {
  it("usa componentes locais, nunca UTC", () => {
    expect(comoDataDeCalendario(new Date(2026, 8, 20, 23, 30))).toBe("2026-09-20");
  });
});

describe("rotuloDaData", () => {
  it("lê a data de calendário sem deslocar o dia", () => {
    expect(rotuloDaData("2026-09-20")).toContain("20");
  });

  it("devolve a entrada quando não é data", () => {
    expect(rotuloDaData("nada")).toBe("nada");
  });
});

describe("ROTULO_STATUS", () => {
  it("cobre todos os estados do backend", () => {
    expect(Object.keys(ROTULO_STATUS)).toEqual([
      "PENDING",
      "CONFIRMED",
      "IN_PROGRESS",
      "COMPLETED",
      "CANCELED",
      "NO_SHOW",
    ]);
  });
});

describe("resumoDoAgendamento", () => {
  it("identifica a reserva pelo horário, serviço, profissional e cliente", () => {
    const resumo = resumoDoAgendamento(AGENDAMENTO);
    expect(resumo).toContain("09:00–10:00");
    expect(resumo).toContain("Corte");
    expect(resumo).toContain("Ana");
    expect(resumo).toContain("Maria");
  });
});

// --------------------------------------------------------------------------
// Lote 6D.6 — elegibilidade e redações de cancelar/remarcar.
describe("podeAlterarAgendamento", () => {
  const AGORA = new Date("2026-09-19T12:00:00Z");
  const futuro = (status: StatusAgendamentoReal) =>
    ({ ...AGENDAMENTO, status, startAt: "2026-09-20T12:00:00.000Z" }) as AgendamentoReal;

  it.each(["PENDING", "CONFIRMED"] as StatusAgendamentoReal[])(
    "%s no futuro pode ser alterado",
    (status) => {
      expect(podeAlterarAgendamento(futuro(status), AGORA)).toBe(true);
    },
  );

  it.each(["IN_PROGRESS", "COMPLETED", "NO_SHOW", "CANCELED"] as StatusAgendamentoReal[])(
    "%s não pode ser alterado nem no futuro",
    (status) => {
      expect(podeAlterarAgendamento(futuro(status), AGORA)).toBe(false);
    },
  );

  it("reserva que já começou não pode ser alterada", () => {
    const passada = {
      ...AGENDAMENTO,
      status: "CONFIRMED",
      startAt: "2026-09-18T12:00:00.000Z",
    } as AgendamentoReal;
    expect(podeAlterarAgendamento(passada, AGORA)).toBe(false);
  });

  it("compara o INSTANTE, não a hora local exibida", () => {
    // Mesma hora local ("09:00") em dois dias diferentes: o que decide é o
    // instante em `startAt`.
    const reserva = {
      ...AGENDAMENTO,
      status: "CONFIRMED",
      startAt: "2026-09-19T12:00:00.000Z",
      localStart: "09:00",
    } as AgendamentoReal;
    expect(podeAlterarAgendamento(reserva, new Date("2026-09-19T11:59:59Z"))).toBe(true);
    expect(podeAlterarAgendamento(reserva, new Date("2026-09-19T12:00:01Z"))).toBe(false);
  });
});

describe("mensagemFalhaCancelamento", () => {
  it("falha de rede NUNCA afirma que não cancelou, e manda conferir", () => {
    const texto = mensagemFalhaCancelamento({ tipo: "falha_comunicacao" });
    expect(texto).toMatch(/pode ter sido/i);
    expect(texto).toMatch(/consulte a reserva/i);
    expect(texto).not.toMatch(/não foi cancelad/i);
  });

  it("usa a mensagem do servidor no 400", () => {
    expect(
      mensagemFalhaCancelamento({ tipo: "nao_agendavel", mensagem: "Já começou." }),
    ).toBe("Já começou.");
  });

  it("sem permissão fala de cancelar, não de agendar", () => {
    expect(mensagemFalhaCancelamento({ tipo: "sem_permissao" })).toMatch(/cancelar/i);
  });
});

describe("mensagemFalhaRemarcacao", () => {
  it("falha de rede NUNCA afirma que não remarcou, e manda conferir", () => {
    const texto = mensagemFalhaRemarcacao({ tipo: "falha_comunicacao" });
    expect(texto).toMatch(/pode ter sido/i);
    expect(texto).toMatch(/consulte a reserva/i);
  });

  it("repassa a mensagem do 409 — distingue ocupado de reserva alterada", () => {
    expect(
      mensagemFalhaRemarcacao({
        tipo: "horario_ocupado",
        mensagem: "Esta reserva mudou desde que a tela carregou.",
      }),
    ).toBe("Esta reserva mudou desde que a tela carregou.");
  });

  it("sem permissão fala de remarcar", () => {
    expect(mensagemFalhaRemarcacao({ tipo: "sem_permissao" })).toMatch(/remarcar/i);
  });
});
