import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { consultarDisponibilidade } from "./availability-api";

const DISPONIBILIDADE = {
  professionalId: "professional_1",
  serviceId: "service_1",
  date: "2026-09-20",
  timezone: "America/Sao_Paulo",
  durationMinutes: 30,
  bufferAfterMinutes: 10,
  slotStepMinutes: 15,
  minLeadMinutes: null,
  maxFutureDays: null,
  slots: [
    {
      startAt: "2026-09-20T12:00:00.000Z",
      endAt: "2026-09-20T12:30:00.000Z",
      localStart: "09:00",
      localEnd: "09:30",
      offsetMinutes: -180,
      offsetLabel: "-03:00",
    },
  ],
  emptyReason: null,
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

describe("consultarDisponibilidade", () => {
  it("200 devolve os horários, o fuso e as regras aplicadas", async () => {
    mockFetch(200, { availability: DISPONIBILIDADE });

    const resultado = await consultarDisponibilidade("tenant_1", "professional_1", "service_1", "2026-09-20");

    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.dados.timezone).toBe("America/Sao_Paulo");
      expect(resultado.dados.slots).toHaveLength(1);
      expect(resultado.dados.slots[0].localStart).toBe("09:00");
      expect(resultado.dados.slotStepMinutes).toBe(15);
      expect(resultado.dados.bufferAfterMinutes).toBe(10);
      expect(resultado.dados.emptyReason).toBeNull();
    }
  });

  it("chama a rota com escopo de tenant e profissional, com cookie e sem cache", async () => {
    mockFetch(200, { availability: DISPONIBILIDADE });

    await consultarDisponibilidade("tenant_1", "professional_1", "service_1", "2026-09-20");

    const [url, init] = ultimaChamada();
    expect(url).toContain("/tenants/tenant_1/professionals/professional_1/availability");
    expect(url).toContain("serviceId=service_1");
    expect(url).toContain("date=2026-09-20");
    expect(init.method).toBe("GET");
    expect(init.credentials).toBe("include");
    expect(init.cache).toBe("no-store");
  });

  it("é uma consulta: nunca envia corpo nem usa método de gravação", async () => {
    mockFetch(200, { availability: DISPONIBILIDADE });

    await consultarDisponibilidade("tenant_1", "professional_1", "service_1", "2026-09-20");

    const [, init] = ultimaChamada();
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
  });

  it("escapa todos os identificadores na URL", async () => {
    mockFetch(200, { availability: DISPONIBILIDADE });

    await consultarDisponibilidade("tenant/../x", "prof 1", "serv&id", "2026-09-20");

    const [url] = ultimaChamada();
    expect(url).toContain("tenant%2F..%2Fx");
    expect(url).toContain("prof%201");
    expect(url).toContain("serviceId=serv%26id");
  });

  it("lista vazia com motivo é sucesso, nunca falha", async () => {
    mockFetch(200, {
      availability: { ...DISPONIBILIDADE, slots: [], emptyReason: "sem_jornada" },
    });

    const resultado = await consultarDisponibilidade("tenant_1", "professional_1", "service_1", "2026-09-20");

    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.dados.slots).toHaveLength(0);
      expect(resultado.dados.emptyReason).toBe("sem_jornada");
    }
  });

  it.each([
    [401, "nao_autenticado"],
    [403, "sem_permissao"],
    [404, "sem_acesso"],
    [500, "indisponivel"],
  ])("status %i vira a falha %s", async (status, tipo) => {
    mockFetch(status, { message: "erro" });

    const resultado = await consultarDisponibilidade("tenant_1", "professional_1", "service_1", "2026-09-20");

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.falha.tipo).toBe(tipo);
  });

  it("400 preserva a mensagem do backend — cada caso tem orientação própria", async () => {
    mockFetch(400, { message: "Este profissional não realiza o serviço selecionado." });

    const resultado = await consultarDisponibilidade("tenant_1", "professional_1", "service_1", "2026-09-20");

    expect(resultado.ok).toBe(false);
    if (!resultado.ok && resultado.falha.tipo === "nao_consultavel") {
      expect(resultado.falha.mensagem).toBe("Este profissional não realiza o serviço selecionado.");
    }
  });

  it("400 sem corpo utilizável não inventa mensagem", async () => {
    mockFetch(400, { erro: "sem campo message" });

    const resultado = await consultarDisponibilidade("tenant_1", "professional_1", "service_1", "2026-09-20");

    expect(resultado.ok).toBe(false);
    if (!resultado.ok && resultado.falha.tipo === "nao_consultavel") {
      expect(resultado.falha.mensagem).toBeNull();
    }
  });

  it("falha de rede é distinguida de erro HTTP", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("failed to fetch")));

    const resultado = await consultarDisponibilidade("tenant_1", "professional_1", "service_1", "2026-09-20");

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.falha.tipo).toBe("falha_comunicacao");
  });

  it("corpo 200 fora do contrato nunca vira dado na tela", async () => {
    mockFetch(200, { availability: { ...DISPONIBILIDADE, slots: [{ startAt: "x" }] } });

    const resultado = await consultarDisponibilidade("tenant_1", "professional_1", "service_1", "2026-09-20");

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.falha.tipo).toBe("indisponivel");
  });

  it("motivo desconhecido é recusado — o contrato é uma lista fechada", async () => {
    mockFetch(200, { availability: { ...DISPONIBILIDADE, slots: [], emptyReason: "ferias" } });

    const resultado = await consultarDisponibilidade("tenant_1", "professional_1", "service_1", "2026-09-20");

    expect(resultado.ok).toBe(false);
  });
});
