import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { buscarSessaoAtual, cadastrar, login, logout } from "./auth-api";

const SESSAO_VALIDA = {
  user: { id: "user_1", name: "Maria Souza", email: "maria@example.com" },
  contexts: [
    {
      membershipId: "membership_1",
      tenantId: "tenant_1",
      tenantName: "Studio Bela",
      tenantSlug: "studio-bela",
      role: "DONO",
      unit: { id: "unit_1", name: "Studio Bela", isPrimary: true },
      planCode: "equipe",
      planName: "Gestão",
      trial: { trialStartAt: "2026-09-10T12:00:00.000Z", trialEndAt: "2026-09-24T12:00:00.000Z", durationDays: 14 },
      tenantStatus: "TRIAL",
    },
  ],
  activeContext: null,
  requiresTenantSelection: false,
  hasEstablishmentAccess: true,
};

function mockFetch(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(body === undefined ? null : JSON.stringify(body), { status })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("login", () => {
  it("200 com contrato válido vira ok:true com os dados", async () => {
    mockFetch(200, { ...SESSAO_VALIDA, activeContext: SESSAO_VALIDA.contexts[0] });

    const resultado = await login("maria@example.com", "senha-valida-123");

    expect(resultado.ok).toBe(true);
    if (resultado.ok) expect(resultado.dados.user.email).toBe("maria@example.com");
  });

  it("401 vira credenciais_invalidas (mensagem genérica do backend, nunca distinguida aqui)", async () => {
    mockFetch(401, { message: "Não foi possível entrar com essas credenciais." });

    const resultado = await login("maria@example.com", "senha-errada-123");

    expect(resultado).toEqual({ ok: false, falha: { tipo: "credenciais_invalidas" } });
  });

  it("429 vira limite_tentativas", async () => {
    mockFetch(429, undefined);

    const resultado = await login("maria@example.com", "senha-valida-123");

    expect(resultado).toEqual({ ok: false, falha: { tipo: "limite_tentativas" } });
  });

  it("falha de rede vira falha_comunicacao, nunca credenciais_invalidas", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

    const resultado = await login("maria@example.com", "senha-valida-123");

    expect(resultado).toEqual({ ok: false, falha: { tipo: "falha_comunicacao" } });
  });

  it("500 inesperado vira indisponivel, nunca finge sucesso", async () => {
    mockFetch(500, { message: "Erro interno." });

    const resultado = await login("maria@example.com", "senha-valida-123");

    expect(resultado).toEqual({ ok: false, falha: { tipo: "indisponivel" } });
  });

  it("200 com corpo que não bate o contrato esperado vira indisponivel, nunca é tratado como sessão válida", async () => {
    mockFetch(200, { algumaCoisaInesperada: true });

    const resultado = await login("maria@example.com", "senha-valida-123");

    expect(resultado).toEqual({ ok: false, falha: { tipo: "indisponivel" } });
  });
});

describe("buscarSessaoAtual", () => {
  it("401 vira ok:true com dados null — não autenticado nunca é uma falha de comunicação", async () => {
    mockFetch(401, { message: "Não autenticado." });

    const resultado = await buscarSessaoAtual();

    expect(resultado).toEqual({ ok: true, dados: null });
  });

  it("falha de rede permanece uma falha, distinta de não autenticado", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

    const resultado = await buscarSessaoAtual();

    expect(resultado).toEqual({ ok: false, falha: { tipo: "falha_comunicacao" } });
  });

  it("200 válido vira ok:true com a sessão", async () => {
    mockFetch(200, SESSAO_VALIDA);

    const resultado = await buscarSessaoAtual();

    expect(resultado).toEqual({ ok: true, dados: SESSAO_VALIDA });
  });
});

describe("logout", () => {
  it("204 vira ok:true", async () => {
    mockFetch(204, undefined);

    expect(await logout()).toEqual({ ok: true, dados: undefined });
  });

  it("falha de rede vira falha_comunicacao — nunca afirma revogação no servidor", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

    expect(await logout()).toEqual({ ok: false, falha: { tipo: "falha_comunicacao" } });
  });
});

const CADASTRO_VALIDO = {
  ownerName: "Maria Souza",
  businessName: "Studio Bela",
  email: "maria@example.com",
  phone: "11999998888",
  password: "senha-de-teste-123",
};

const RESPOSTA_CADASTRO = {
  user: { id: "user_1", name: "Maria Souza", email: "maria@example.com" },
  tenant: { id: "tenant_1", slug: "studio-bela", status: "TRIAL" },
  unit: { id: "unit_1", name: "Studio Bela", isPrimary: true },
  membership: { role: "DONO" },
  plan: { code: "equipe", name: "Gestão", priceCents: null },
  trial: { trialStartAt: "2026-09-10T12:00:00.000Z", trialEndAt: "2026-09-24T12:00:00.000Z", durationDays: 14 },
};

describe("cadastrar", () => {
  it("201 com contrato válido vira ok:true com os dados da conta criada", async () => {
    mockFetch(201, RESPOSTA_CADASTRO);

    const resultado = await cadastrar(CADASTRO_VALIDO);

    expect(resultado.ok).toBe(true);
    if (resultado.ok) expect(resultado.dados.tenant.slug).toBe("studio-bela");
  });

  it("envia exatamente os campos do DTO para /auth/register, com cookies e sem cache", async () => {
    mockFetch(201, RESPOSTA_CADASTRO);

    await cadastrar(CADASTRO_VALIDO);

    const [url, init] = (globalThis.fetch as unknown as Mock<(u: string, i: RequestInit) => unknown>).mock.calls[0];
    expect(url).toContain("/auth/register");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(init.cache).toBe("no-store");
    expect(JSON.parse(String(init.body))).toEqual(CADASTRO_VALIDO);
  });

  it("409 vira email_em_uso, nunca uma falha genérica", async () => {
    mockFetch(409, { message: "E-mail já cadastrado." });

    expect(await cadastrar(CADASTRO_VALIDO)).toEqual({ ok: false, falha: { tipo: "email_em_uso" } });
  });

  it("400 vira dados_invalidos preservando a mensagem do backend", async () => {
    mockFetch(400, { message: "Dados inválidos. Campos com problema: phone." });

    expect(await cadastrar(CADASTRO_VALIDO)).toEqual({
      ok: false,
      falha: { tipo: "dados_invalidos", mensagem: "Dados inválidos. Campos com problema: phone." },
    });
  });

  it("400 sem corpo JSON (ex.: texto puro) ainda vira dados_invalidos, com mensagem nula", async () => {
    mockFetch(400, undefined);

    expect(await cadastrar(CADASTRO_VALIDO)).toEqual({
      ok: false,
      falha: { tipo: "dados_invalidos", mensagem: null },
    });
  });

  it("429 do rate limit de cadastro vira limite_tentativas", async () => {
    mockFetch(429, undefined);

    expect(await cadastrar(CADASTRO_VALIDO)).toEqual({ ok: false, falha: { tipo: "limite_tentativas" } });
  });

  it("503 (plano indisponível no catálogo) vira indisponivel", async () => {
    mockFetch(503, { message: "Cadastro temporariamente indisponível." });

    expect(await cadastrar(CADASTRO_VALIDO)).toEqual({ ok: false, falha: { tipo: "indisponivel" } });
  });

  it("falha de rede vira falha_comunicacao — nunca email_em_uso nem sucesso", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

    expect(await cadastrar(CADASTRO_VALIDO)).toEqual({ ok: false, falha: { tipo: "falha_comunicacao" } });
  });

  it("201 com corpo fora do contrato vira indisponivel, nunca sucesso silencioso", async () => {
    mockFetch(201, { user: { id: "user_1", name: "Maria", email: "maria@example.com" } });

    expect(await cadastrar(CADASTRO_VALIDO)).toEqual({ ok: false, falha: { tipo: "indisponivel" } });
  });
});
