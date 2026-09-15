import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  criarServico,
  desativarServico,
  reativarServico,
  editarServico,
  listarServicos,
} from "./services-api";
import type { DadosServicoReal } from "./services-api";

const SERVICO_VALIDO = {
  id: "service_1",
  name: "Atendimento padrão",
  shortDescription: "Sessão inicial",
  priceCents: 12345,
  priceVisible: true,
  durationMinutes: 50,
  bufferAfterMinutes: 10,
  modality: "IN_PERSON",
  activeInPublicBooking: true,
  requiresManualConfirmation: false,
  active: true,
  createdAt: "2026-09-01T12:00:00.000Z",
};

const DADOS: DadosServicoReal = {
  name: "Atendimento padrão",
  shortDescription: "Sessão inicial",
  priceCents: 12345,
  priceVisible: true,
  durationMinutes: 50,
  bufferAfterMinutes: 10,
  modality: "IN_PERSON",
  activeInPublicBooking: true,
  requiresManualConfirmation: false,
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

describe("listarServicos", () => {
  it("200 devolve a lista validada", async () => {
    mockFetch(200, { services: [SERVICO_VALIDO] });

    const resultado = await listarServicos("tenant_1");

    expect(resultado.ok).toBe(true);
    if (resultado.ok) expect(resultado.dados[0].priceCents).toBe(12345);
  });

  it("chama a rota com escopo de tenant, com cookie e sem cache", async () => {
    mockFetch(200, { services: [] });

    await listarServicos("tenant_1");

    const [url, init] = ultimaChamada();
    expect(url).toContain("/tenants/tenant_1/services");
    expect(init.method).toBe("GET");
    expect(init.credentials).toBe("include");
    expect(init.cache).toBe("no-store");
  });

  it("escapa o tenantId na URL", async () => {
    mockFetch(200, { services: [] });

    await listarServicos("tenant/../outro");

    expect(String(ultimaChamada()[0])).toContain("tenant%2F..%2Foutro");
  });

  it.each([
    [401, "nao_autenticado"],
    [403, "sem_permissao"],
    [404, "sem_acesso"],
    [500, "indisponivel"],
  ])("status %i vira a falha %s", async (status, tipo) => {
    mockFetch(status, { message: "erro" });

    const resultado = await listarServicos("tenant_1");

    expect(resultado).toEqual({ ok: false, falha: { tipo } });
  });

  it("falha de rede é distinta de qualquer resposta HTTP", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

    expect(await listarServicos("tenant_1")).toEqual({
      ok: false,
      falha: { tipo: "falha_comunicacao" },
    });
  });

  it("corpo fora do contrato vira indisponivel, nunca lista vazia silenciosa", async () => {
    mockFetch(200, { services: [{ id: "x" }] });

    expect(await listarServicos("tenant_1")).toEqual({ ok: false, falha: { tipo: "indisponivel" } });
  });
});

describe("criarServico", () => {
  it("201 devolve o serviço criado", async () => {
    mockFetch(201, { service: SERVICO_VALIDO });

    const resultado = await criarServico("tenant_1", DADOS);

    expect(resultado.ok).toBe(true);
    if (resultado.ok) expect(resultado.dados.id).toBe("service_1");
  });

  it("envia exatamente os campos do contrato — nunca tenantId/id/active no corpo", async () => {
    mockFetch(201, { service: SERVICO_VALIDO });

    await criarServico("tenant_1", DADOS);

    const [, init] = ultimaChamada();
    const corpo = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(init.method).toBe("POST");
    expect(corpo).toEqual(DADOS);
    expect(corpo).not.toHaveProperty("tenantId");
    expect(corpo).not.toHaveProperty("id");
    expect(corpo).not.toHaveProperty("active");
  });

  it("400 preserva a mensagem do backend", async () => {
    mockFetch(400, { message: "Dados inválidos. Campos com problema: durationMinutes." });

    expect(await criarServico("tenant_1", DADOS)).toEqual({
      ok: false,
      falha: { tipo: "dados_invalidos", mensagem: "Dados inválidos. Campos com problema: durationMinutes." },
    });
  });

  it("preço nulo viaja como null, nunca como 0 nem omitido", async () => {
    mockFetch(201, { service: { ...SERVICO_VALIDO, priceCents: null } });

    await criarServico("tenant_1", { ...DADOS, priceCents: null });

    const corpo = JSON.parse(String(ultimaChamada()[1].body)) as Record<string, unknown>;
    expect(corpo.priceCents).toBeNull();
  });
});

describe("editarServico", () => {
  it("usa PATCH na rota com escopo de tenant e id do serviço", async () => {
    mockFetch(200, { service: SERVICO_VALIDO });

    await editarServico("tenant_1", "service_1", { name: "Novo nome" });

    const [url, init] = ultimaChamada();
    expect(url).toContain("/tenants/tenant_1/services/service_1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ name: "Novo nome" });
  });

  it("404 de serviço de outro estabelecimento vira sem_acesso", async () => {
    mockFetch(404, { message: "Serviço não encontrado." });

    expect(await editarServico("tenant_1", "service_de_outro", { name: "x" })).toEqual({
      ok: false,
      falha: { tipo: "sem_acesso" },
    });
  });
});

describe("desativarServico", () => {
  it("chama a ação própria de desativação, nunca DELETE", async () => {
    mockFetch(200, { service: { ...SERVICO_VALIDO, active: false } });

    const resultado = await desativarServico("tenant_1", "service_1");

    const [url, init] = ultimaChamada();
    expect(url).toContain("/tenants/tenant_1/services/service_1/deactivate");
    expect(init.method).toBe("POST");
    expect(init.method).not.toBe("DELETE");
    expect(resultado.ok).toBe(true);
    if (resultado.ok) expect(resultado.dados.active).toBe(false);
  });
});

describe("reativarServico", () => {
  it("chama a ação própria de reativação, nunca PATCH com active:true", async () => {
    mockFetch(200, { service: { ...SERVICO_VALIDO, active: true } });

    const resultado = await reativarServico("tenant_1", "service_1");

    const [url, init] = ultimaChamada();
    expect(url).toContain("/tenants/tenant_1/services/service_1/reactivate");
    expect(init.method).toBe("POST");
    expect(resultado.ok).toBe(true);
    if (resultado.ok) expect(resultado.dados.active).toBe(true);
  });

  it("nunca envia corpo — reativação não recebe dados do cliente", async () => {
    mockFetch(200, { service: SERVICO_VALIDO });

    await reativarServico("tenant_1", "service_1");

    const [, init] = ultimaChamada();
    expect(init.body).toBeUndefined();
  });

  it("404 de serviço de outro estabelecimento vira sem_acesso", async () => {
    mockFetch(404, { message: "Serviço não encontrado." });

    expect(await reativarServico("tenant_1", "service_de_outro")).toEqual({
      ok: false,
      falha: { tipo: "sem_acesso" },
    });
  });

  it("403 sem permissão vira sem_permissao", async () => {
    mockFetch(403, { message: "Sem permissão." });

    expect(await reativarServico("tenant_1", "service_1")).toEqual({
      ok: false,
      falha: { tipo: "sem_permissao" },
    });
  });

  it("falha de rede é distinta de qualquer resposta HTTP", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

    expect(await reativarServico("tenant_1", "service_1")).toEqual({
      ok: false,
      falha: { tipo: "falha_comunicacao" },
    });
  });
});
