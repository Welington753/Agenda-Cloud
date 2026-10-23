import { afterEach, describe, expect, it, vi } from "vitest";
import { buscarSessaoAtual, login, logout } from "./auth-api";

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

  // Resposta observada no piloto enquanto o serviço do Render acorda: 502 em
  // HTML gerado pela borda da hospedagem, sem passar pela API.
  it.each([502, 503, 504])("%i da hospedagem vira falha de comunicação, nunca não autenticado", async (status) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("<html><body>Bad Gateway</body></html>", {
          status,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
      ),
    );

    const resultado = await buscarSessaoAtual();

    expect(resultado).toEqual({ ok: false, falha: { tipo: "falha_comunicacao" } });
  });

  it("502 em JSON da própria API é erro real (indisponivel), nunca 'servidor acordando'", async () => {
    mockFetch(502, { message: "Bad Gateway", statusCode: 502 });

    const resultado = await buscarSessaoAtual();

    expect(resultado).toEqual({ ok: false, falha: { tipo: "indisponivel" } });
  });

  it("500 da API continua indisponível, não falha de comunicação", async () => {
    mockFetch(500, { message: "Erro interno." });

    const resultado = await buscarSessaoAtual();

    expect(resultado).toEqual({ ok: false, falha: { tipo: "indisponivel" } });
  });

  it("repassa o sinal de cancelamento ao fetch", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    const controle = new AbortController();

    await buscarSessaoAtual(controle.signal);

    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).signal).toBe(controle.signal);
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
