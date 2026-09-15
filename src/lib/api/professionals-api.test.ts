import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  criarProfissional,
  definirServicosDoProfissional,
  desativarProfissional,
  editarProfissional,
  listarProfissionais,
  reativarProfissional,
} from "./professionals-api";
import type { DadosProfissionalReal } from "./professionals-api";

const PROFISSIONAL_VALIDO = {
  id: "professional_1",
  name: "João Silva",
  avatarInitials: "JS",
  avatarColor: "#B5651D",
  active: true,
  createdAt: "2026-09-01T12:00:00.000Z",
  services: [{ id: "link_1", serviceId: "service_1", serviceName: "Corte", serviceActive: true }],
};

const DADOS: DadosProfissionalReal = { name: "João Silva", serviceIds: ["service_1"] };

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

describe("listarProfissionais", () => {
  it("200 devolve a lista validada, incluindo os vínculos de serviço", async () => {
    mockFetch(200, { professionals: [PROFISSIONAL_VALIDO] });

    const resultado = await listarProfissionais("tenant_1");

    expect(resultado.ok).toBe(true);
    if (resultado.ok) expect(resultado.dados[0].services[0].serviceName).toBe("Corte");
  });

  it("chama a rota com escopo de tenant, com cookie e sem cache", async () => {
    mockFetch(200, { professionals: [] });

    await listarProfissionais("tenant_1");

    const [url, init] = ultimaChamada();
    expect(url).toContain("/tenants/tenant_1/professionals");
    expect(init.method).toBe("GET");
    expect(init.credentials).toBe("include");
    expect(init.cache).toBe("no-store");
  });

  it.each([
    [401, "nao_autenticado"],
    [403, "sem_permissao"],
    [404, "sem_acesso"],
    [409, "conflito"],
    [500, "indisponivel"],
  ])("status %i vira a falha %s", async (status, tipo) => {
    mockFetch(status, { message: "erro" });

    const resultado = await listarProfissionais("tenant_1");

    expect(resultado).toEqual({ ok: false, falha: { tipo } });
  });

  it("falha de rede é distinta de qualquer resposta HTTP", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

    expect(await listarProfissionais("tenant_1")).toEqual({
      ok: false,
      falha: { tipo: "falha_comunicacao" },
    });
  });

  it("corpo fora do contrato vira indisponivel, nunca lista vazia silenciosa", async () => {
    mockFetch(200, { professionals: [{ id: "x" }] });

    expect(await listarProfissionais("tenant_1")).toEqual({
      ok: false,
      falha: { tipo: "indisponivel" },
    });
  });
});

describe("criarProfissional", () => {
  it("201 devolve o profissional criado", async () => {
    mockFetch(201, { professional: PROFISSIONAL_VALIDO });

    const resultado = await criarProfissional("tenant_1", DADOS);

    expect(resultado.ok).toBe(true);
    if (resultado.ok) expect(resultado.dados.id).toBe("professional_1");
  });

  it("envia exatamente os campos do contrato — nunca tenantId/id/active/avatar no corpo", async () => {
    mockFetch(201, { professional: PROFISSIONAL_VALIDO });

    await criarProfissional("tenant_1", DADOS);

    const [, init] = ultimaChamada();
    const corpo = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(init.method).toBe("POST");
    expect(corpo).toEqual(DADOS);
    expect(corpo).not.toHaveProperty("tenantId");
    expect(corpo).not.toHaveProperty("id");
    expect(corpo).not.toHaveProperty("active");
    expect(corpo).not.toHaveProperty("avatarInitials");
    expect(corpo).not.toHaveProperty("avatarColor");
  });

  it("400 preserva a mensagem do backend", async () => {
    mockFetch(400, { message: "Um ou mais serviços informados não existem, estão inativos ou pertencem a outro estabelecimento." });

    expect(await criarProfissional("tenant_1", DADOS)).toEqual({
      ok: false,
      falha: {
        tipo: "dados_invalidos",
        mensagem: "Um ou mais serviços informados não existem, estão inativos ou pertencem a outro estabelecimento.",
      },
    });
  });
});

describe("editarProfissional", () => {
  it("usa PATCH na rota com escopo de tenant e id do profissional", async () => {
    mockFetch(200, { professional: PROFISSIONAL_VALIDO });

    await editarProfissional("tenant_1", "professional_1", { name: "Novo nome" });

    const [url, init] = ultimaChamada();
    expect(url).toContain("/tenants/tenant_1/professionals/professional_1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ name: "Novo nome" });
  });

  it("404 de profissional de outro estabelecimento vira sem_acesso", async () => {
    mockFetch(404, { message: "Profissional não encontrado." });

    expect(await editarProfissional("tenant_1", "professional_de_outro", { name: "x" })).toEqual({
      ok: false,
      falha: { tipo: "sem_acesso" },
    });
  });
});

describe("desativarProfissional", () => {
  it("chama a ação própria de desativação, nunca DELETE", async () => {
    mockFetch(200, { professional: { ...PROFISSIONAL_VALIDO, active: false } });

    const resultado = await desativarProfissional("tenant_1", "professional_1");

    const [url, init] = ultimaChamada();
    expect(url).toContain("/tenants/tenant_1/professionals/professional_1/deactivate");
    expect(init.method).toBe("POST");
    expect(init.method).not.toBe("DELETE");
    expect(resultado.ok).toBe(true);
    if (resultado.ok) expect(resultado.dados.active).toBe(false);
  });
});

describe("reativarProfissional", () => {
  it("chama a ação própria de reativação, nunca PATCH com active:true", async () => {
    mockFetch(200, { professional: { ...PROFISSIONAL_VALIDO, active: true } });

    const resultado = await reativarProfissional("tenant_1", "professional_1");

    const [url, init] = ultimaChamada();
    expect(url).toContain("/tenants/tenant_1/professionals/professional_1/reactivate");
    expect(init.method).toBe("POST");
    expect(resultado.ok).toBe(true);
    if (resultado.ok) expect(resultado.dados.active).toBe(true);
  });

  it("nunca envia corpo — reativação não recebe dados do cliente", async () => {
    mockFetch(200, { professional: PROFISSIONAL_VALIDO });

    await reativarProfissional("tenant_1", "professional_1");

    const [, init] = ultimaChamada();
    expect(init.body).toBeUndefined();
  });
});

describe("definirServicosDoProfissional", () => {
  it("usa PUT na rota de vínculos com o conjunto final desejado", async () => {
    mockFetch(200, { professional: PROFISSIONAL_VALIDO });

    await definirServicosDoProfissional("tenant_1", "professional_1", {
      serviceIds: ["service_1", "service_2"],
    });

    const [url, init] = ultimaChamada();
    expect(url).toContain("/tenants/tenant_1/professionals/professional_1/services");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual({ serviceIds: ["service_1", "service_2"] });
  });

  it("lista vazia remove todos os vínculos — nunca omitida", async () => {
    mockFetch(200, { professional: { ...PROFISSIONAL_VALIDO, services: [] } });

    await definirServicosDoProfissional("tenant_1", "professional_1", { serviceIds: [] });

    const [, init] = ultimaChamada();
    expect(JSON.parse(String(init.body))).toEqual({ serviceIds: [] });
  });

  it("409 de corrida concorrente vira conflito", async () => {
    mockFetch(409, { message: "Este serviço já está vinculado ao profissional." });

    expect(
      await definirServicosDoProfissional("tenant_1", "professional_1", { serviceIds: ["service_1"] }),
    ).toEqual({ ok: false, falha: { tipo: "conflito" } });
  });

  it("400 de serviço inelegível preserva a mensagem do backend", async () => {
    mockFetch(400, { message: "Um ou mais serviços informados não existem, estão inativos ou pertencem a outro estabelecimento." });

    expect(
      await definirServicosDoProfissional("tenant_1", "professional_1", {
        serviceIds: ["service_de_outro_tenant"],
      }),
    ).toEqual({
      ok: false,
      falha: {
        tipo: "dados_invalidos",
        mensagem: "Um ou mais serviços informados não existem, estão inativos ou pertencem a outro estabelecimento.",
      },
    });
  });
});
