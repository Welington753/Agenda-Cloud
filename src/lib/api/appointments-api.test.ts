import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  buscarClientes,
  cancelarAgendamento,
  criarAgendamento,
  listarAgendamentos,
  listarHorariosParaRemarcar,
  remarcarAgendamento,
} from "./appointments-api";

const AGENDAMENTO = {
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

const DADOS = {
  professionalId: "p1",
  serviceId: "s1",
  startAt: "2026-09-20T12:00:00.000Z",
  consumer: { mode: "existing" as const, consumerId: "c1" },
};

function mockFetch(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(new Response(body === undefined ? null : JSON.stringify(body), { status })),
  );
}

function ultimaChamada() {
  return (globalThis.fetch as unknown as Mock<(u: string, i: RequestInit) => unknown>).mock.calls[0];
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("listarAgendamentos", () => {
  it("200 devolve a agenda do dia com o fuso", async () => {
    mockFetch(200, {
      timezone: "America/Sao_Paulo",
      date: "2026-09-20",
      appointments: [AGENDAMENTO],
    });

    const resultado = await listarAgendamentos("tenant_1", "2026-09-20");

    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.dados.timezone).toBe("America/Sao_Paulo");
      expect(resultado.dados.appointments).toHaveLength(1);
    }
  });

  it("chama a rota com escopo de tenant, cookie e sem cache", async () => {
    mockFetch(200, { timezone: "America/Sao_Paulo", date: "2026-09-20", appointments: [] });

    await listarAgendamentos("tenant_1", "2026-09-20");

    const [url, init] = ultimaChamada();
    expect(url).toContain("/tenants/tenant_1/appointments");
    expect(url).toContain("date=2026-09-20");
    expect(init.method).toBe("GET");
    expect(init.credentials).toBe("include");
    expect(init.cache).toBe("no-store");
  });

  it("corpo fora do contrato nunca vira dado na tela", async () => {
    mockFetch(200, { timezone: "X", date: "2026-09-20", appointments: [{ id: "a1" }] });
    const resultado = await listarAgendamentos("tenant_1", "2026-09-20");
    expect(resultado.ok).toBe(false);
  });
});

describe("criarAgendamento", () => {
  it("201 devolve a reserva criada", async () => {
    mockFetch(201, { appointment: AGENDAMENTO });

    const resultado = await criarAgendamento("tenant_1", DADOS);

    expect(resultado.ok).toBe(true);
    if (resultado.ok) expect(resultado.dados.id).toBe("a1");
  });

  it("envia só as escolhas — nunca preço, duração, fim ou status", async () => {
    mockFetch(201, { appointment: AGENDAMENTO });

    await criarAgendamento("tenant_1", DADOS);

    const [, init] = ultimaChamada();
    const corpo = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(Object.keys(corpo).sort()).toEqual(["consumer", "professionalId", "serviceId", "startAt"]);
    expect(corpo).not.toHaveProperty("priceCents");
    expect(corpo).not.toHaveProperty("status");
    expect(corpo).not.toHaveProperty("endAt");
  });

  it("409 vira horario_ocupado, distinto de qualquer outro erro", async () => {
    mockFetch(409, { message: "Este horário acabou de ser ocupado." });

    const resultado = await criarAgendamento("tenant_1", DADOS);

    expect(resultado.ok).toBe(false);
    if (!resultado.ok && resultado.falha.tipo === "horario_ocupado") {
      expect(resultado.falha.mensagem).toBe("Este horário acabou de ser ocupado.");
    } else {
      throw new Error("deveria ser horario_ocupado");
    }
  });

  it.each([
    [401, "nao_autenticado"],
    [403, "sem_permissao"],
    [404, "sem_acesso"],
    [400, "nao_agendavel"],
    [500, "indisponivel"],
  ])("status %i vira a falha %s", async (status, tipo) => {
    mockFetch(status, { message: "erro" });

    const resultado = await criarAgendamento("tenant_1", DADOS);

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.falha.tipo).toBe(tipo);
  });

  it("falha de rede é distinguida de erro HTTP", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("failed to fetch")));

    const resultado = await criarAgendamento("tenant_1", DADOS);

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.falha.tipo).toBe("falha_comunicacao");
  });
});

describe("buscarClientes", () => {
  it("200 devolve os clientes encontrados", async () => {
    mockFetch(200, {
      consumers: [{ id: "c1", name: "Maria", whatsapp: "(11) 90000-0000", email: null }],
    });

    const resultado = await buscarClientes("tenant_1", "Maria");

    expect(resultado.ok).toBe(true);
    if (resultado.ok) expect(resultado.dados[0].name).toBe("Maria");
  });

  it("escapa o termo e o tenant na URL", async () => {
    mockFetch(200, { consumers: [] });

    await buscarClientes("tenant/../x", "a&b");

    const [url] = ultimaChamada();
    expect(url).toContain("tenant%2F..%2Fx");
    expect(url).toContain("q=a%26b");
  });
});

// --------------------------------------------------------------------------
// Lote 6D.6 — cancelar, remarcar e consultar horários para remarcar.
describe("cancelarAgendamento", () => {
  afterEach(() => vi.unstubAllGlobals());

  const MOSTRADO = { expectedStartAt: "2026-09-20T12:00:00.000Z" };

  it("envia POST em .../cancel só com o instante que a confirmação mostrava", async () => {
    mockFetch(200, { appointment: { ...AGENDAMENTO, status: "CANCELED" } });

    const resultado = await cancelarAgendamento("tenant_1", "a1", MOSTRADO);

    expect(resultado.ok).toBe(true);
    if (resultado.ok) expect(resultado.dados.status).toBe("CANCELED");

    const [url, init] = ultimaChamada();
    expect(url).toContain("/tenants/tenant_1/appointments/a1/cancel");
    expect(init.method).toBe("POST");
    // Só o instante mostrado: nenhum campo que o servidor decide viaja daqui.
    expect(JSON.parse(init.body as string)).toEqual(MOSTRADO);
  });

  it("409 (reserva alterada desde a confirmação) vira horario_ocupado com a mensagem do servidor", async () => {
    mockFetch(409, { message: "O horário desta reserva mudou desde que a confirmação foi aberta." });

    const resultado = await cancelarAgendamento("tenant_1", "a1", MOSTRADO);

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.falha.tipo).toBe("horario_ocupado");
      if (resultado.falha.tipo === "horario_ocupado") {
        expect(resultado.falha.mensagem).toContain("mudou");
      }
    }
    // Uma chamada só: a recusa nunca é reenviada daqui.
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("escapa o id e o tenant na URL", async () => {
    mockFetch(200, { appointment: AGENDAMENTO });

    await cancelarAgendamento("tenant/../x", "a/../b", MOSTRADO);

    const [url] = ultimaChamada();
    expect(url).toContain("tenant%2F..%2Fx");
    expect(url).toContain("a%2F..%2Fb");
  });

  it("400 vira nao_agendavel com a mensagem do servidor", async () => {
    mockFetch(400, { message: "Só é possível cancelar uma reserva que ainda não começou." });

    const resultado = await cancelarAgendamento("tenant_1", "a1", MOSTRADO);

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.falha.tipo).toBe("nao_agendavel");
      if (resultado.falha.tipo === "nao_agendavel") {
        expect(resultado.falha.mensagem).toContain("ainda não começou");
      }
    }
  });

  it("falha de rede é falha_comunicacao, nunca 'não cancelou'", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    const resultado = await cancelarAgendamento("tenant_1", "a1", MOSTRADO);

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.falha.tipo).toBe("falha_comunicacao");
  });

  it("corpo inesperado é indisponivel, nunca aceito como sucesso", async () => {
    mockFetch(200, { appointment: { id: "a1" } });

    const resultado = await cancelarAgendamento("tenant_1", "a1", MOSTRADO);

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.falha.tipo).toBe("indisponivel");
  });
});

describe("remarcarAgendamento", () => {
  afterEach(() => vi.unstubAllGlobals());

  const DADOS_REMARCACAO = {
    startAt: "2026-09-20T13:00:00.000Z",
    expectedStartAt: "2026-09-20T12:00:00.000Z",
  };

  it("envia POST em .../reschedule só com os dois instantes", async () => {
    mockFetch(200, {
      appointment: { ...AGENDAMENTO, startAt: "2026-09-20T13:00:00.000Z", localStart: "10:00" },
    });

    const resultado = await remarcarAgendamento("tenant_1", "a1", DADOS_REMARCACAO);

    expect(resultado.ok).toBe(true);
    if (resultado.ok) expect(resultado.dados.localStart).toBe("10:00");

    const [url, init] = ultimaChamada();
    expect(url).toContain("/tenants/tenant_1/appointments/a1/reschedule");
    expect(init.method).toBe("POST");
    // Nada de profissional, serviço, cliente, preço, duração ou status.
    expect(JSON.parse(init.body as string)).toEqual(DADOS_REMARCACAO);
  });

  it("409 vira horario_ocupado com a mensagem do servidor", async () => {
    mockFetch(409, { message: "Esta reserva mudou desde que a tela carregou." });

    const resultado = await remarcarAgendamento("tenant_1", "a1", DADOS_REMARCACAO);

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.falha.tipo).toBe("horario_ocupado");
      if (resultado.falha.tipo === "horario_ocupado") {
        expect(resultado.falha.mensagem).toContain("mudou desde que a tela carregou");
      }
    }
  });

  it("403 vira sem_permissao", async () => {
    mockFetch(403, { message: "Você não tem permissão." });

    const resultado = await remarcarAgendamento("tenant_1", "a1", DADOS_REMARCACAO);

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.falha.tipo).toBe("sem_permissao");
  });
});

describe("listarHorariosParaRemarcar", () => {
  afterEach(() => vi.unstubAllGlobals());

  const OPCOES = {
    appointmentId: "a1",
    date: "2026-09-20",
    timezone: "America/Sao_Paulo",
    durationMinutes: 60,
    slots: [
      {
        startAt: "2026-09-20T12:00:00.000Z",
        endAt: "2026-09-20T13:00:00.000Z",
        localStart: "09:00",
        localEnd: "10:00",
        offsetMinutes: -180,
        offsetLabel: "UTC-03:00",
      },
    ],
    emptyReason: null,
  };

  it("consulta por GET, com a data na query e sem profissional/serviço", async () => {
    mockFetch(200, { options: OPCOES });

    const resultado = await listarHorariosParaRemarcar("tenant_1", "a1", "2026-09-20");

    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.dados.slots[0].localStart).toBe("09:00");
      // Duração CONGELADA da reserva, devolvida pelo servidor.
      expect(resultado.dados.durationMinutes).toBe(60);
    }

    const [url, init] = ultimaChamada();
    expect(url).toContain("/appointments/a1/reschedule-options?date=2026-09-20");
    expect(init.method).toBe("GET");
    expect(url).not.toContain("professionalId");
    expect(url).not.toContain("serviceId");
  });

  it("slot com campo faltando é indisponivel, nunca renderizado pela metade", async () => {
    mockFetch(200, {
      options: { ...OPCOES, slots: [{ startAt: "2026-09-20T12:00:00.000Z" }] },
    });

    const resultado = await listarHorariosParaRemarcar("tenant_1", "a1", "2026-09-20");

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.falha.tipo).toBe("indisponivel");
  });

  it("404 vira sem_acesso", async () => {
    mockFetch(404, { message: "Agendamento não encontrado." });

    const resultado = await listarHorariosParaRemarcar("tenant_1", "a1", "2026-09-20");

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.falha.tipo).toBe("sem_acesso");
  });
});
