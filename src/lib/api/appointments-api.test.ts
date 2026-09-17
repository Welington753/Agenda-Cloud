import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { buscarClientes, criarAgendamento, listarAgendamentos } from "./appointments-api";

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
