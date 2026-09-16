import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { buscarHorarios, salvarHorarios } from "./working-hours-api";

const SEMANA_VALIDA = {
  timezone: "America/Sao_Paulo",
  days: [
    {
      weekday: 1,
      intervals: [
        { start: "09:00", end: "12:00" },
        { start: "13:00", end: "18:00" },
      ],
    },
  ],
};

function mockFetch(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(body === undefined ? null : JSON.stringify(body), { status }),
    ),
  );
}

function ultimaChamada() {
  return (globalThis.fetch as unknown as Mock<(u: string, i: RequestInit) => unknown>).mock.calls[0];
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buscarHorarios", () => {
  it("200 devolve a semana e o fuso", async () => {
    mockFetch(200, { schedule: SEMANA_VALIDA });

    const resultado = await buscarHorarios("tenant_1", "professional_1");

    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.dados.timezone).toBe("America/Sao_Paulo");
      expect(resultado.dados.days[0].intervals).toHaveLength(2);
    }
  });

  it("chama a rota com escopo de tenant e profissional, com cookie e sem cache", async () => {
    mockFetch(200, { schedule: { timezone: "America/Sao_Paulo", days: [] } });

    await buscarHorarios("tenant_1", "professional_1");

    const [url, init] = ultimaChamada();
    expect(url).toContain("/tenants/tenant_1/professionals/professional_1/schedule");
    expect(init.method).toBe("GET");
    expect(init.credentials).toBe("include");
    expect(init.cache).toBe("no-store");
  });

  it("escapa os ids na URL", async () => {
    mockFetch(200, { schedule: { timezone: "America/Sao_Paulo", days: [] } });

    await buscarHorarios("tenant/../outro", "prof/../outro");

    expect(String(ultimaChamada()[0])).toContain("tenant%2F..%2Foutro");
    expect(String(ultimaChamada()[0])).toContain("prof%2F..%2Foutro");
  });

  it.each([
    [401, "nao_autenticado"],
    [403, "sem_permissao"],
    [404, "sem_acesso"],
    [500, "indisponivel"],
  ])("status %i vira a falha %s", async (status, tipo) => {
    mockFetch(status, { message: "erro" });

    expect(await buscarHorarios("tenant_1", "professional_1")).toEqual({
      ok: false,
      falha: { tipo },
    });
  });

  it("falha de rede é distinta de qualquer resposta HTTP", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

    expect(await buscarHorarios("tenant_1", "professional_1")).toEqual({
      ok: false,
      falha: { tipo: "falha_comunicacao" },
    });
  });

  it("corpo fora do contrato vira indisponivel, nunca semana vazia silenciosa", async () => {
    mockFetch(200, { schedule: { days: [{ weekday: "segunda", intervals: [] }] } });

    expect(await buscarHorarios("tenant_1", "professional_1")).toEqual({
      ok: false,
      falha: { tipo: "indisponivel" },
    });
  });

  it("semana sem configuração é sucesso com lista vazia, não erro", async () => {
    mockFetch(200, { schedule: { timezone: "America/Sao_Paulo", days: [] } });

    const resultado = await buscarHorarios("tenant_1", "professional_1");
    expect(resultado.ok).toBe(true);
    if (resultado.ok) expect(resultado.dados.days).toEqual([]);
  });
});

describe("salvarHorarios", () => {
  it("usa PUT e envia a semana inteira no corpo", async () => {
    mockFetch(200, { schedule: SEMANA_VALIDA });

    await salvarHorarios("tenant_1", "professional_1", SEMANA_VALIDA.days);

    const [url, init] = ultimaChamada();
    expect(url).toContain("/tenants/tenant_1/professionals/professional_1/schedule");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual({ days: SEMANA_VALIDA.days });
  });

  it("semana vazia viaja como lista vazia — nunca omitida", async () => {
    mockFetch(200, { schedule: { timezone: "America/Sao_Paulo", days: [] } });

    await salvarHorarios("tenant_1", "professional_1", []);

    expect(JSON.parse(String(ultimaChamada()[1].body))).toEqual({ days: [] });
  });

  it("nunca envia tenantId, professionalId ou active no corpo", async () => {
    mockFetch(200, { schedule: SEMANA_VALIDA });

    await salvarHorarios("tenant_1", "professional_1", SEMANA_VALIDA.days);

    const corpo = JSON.parse(String(ultimaChamada()[1].body)) as Record<string, unknown>;
    expect(Object.keys(corpo)).toEqual(["days"]);
  });

  it("400 preserva a mensagem de regra do backend", async () => {
    mockFetch(400, { message: "Em segunda-feira, os intervalos se sobrepõem." });

    expect(await salvarHorarios("tenant_1", "professional_1", [])).toEqual({
      ok: false,
      falha: {
        tipo: "dados_invalidos",
        mensagem: "Em segunda-feira, os intervalos se sobrepõem.",
      },
    });
  });

  it("404 de profissional de outro estabelecimento vira sem_acesso", async () => {
    mockFetch(404, { message: "Profissional não encontrado." });

    expect(await salvarHorarios("tenant_1", "professional_de_outro", [])).toEqual({
      ok: false,
      falha: { tipo: "sem_acesso" },
    });
  });
});
