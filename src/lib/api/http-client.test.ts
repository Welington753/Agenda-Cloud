import { afterEach, describe, expect, it, vi } from "vitest";
import { reiniciarPedidosDePartida } from "./acordar-api";
import { EVENTO_ACESSO_VENCIDO, apiRequest, mensagemDoBackend } from "./http-client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("mensagemDoBackend", () => {
  it("devolve o message de texto do corpo de erro", () => {
    expect(mensagemDoBackend({ statusCode: 409, message: "Horário ocupado." })).toBe("Horário ocupado.");
  });

  it("sem message de texto: null, nunca um texto inventado", () => {
    expect(mensagemDoBackend(null)).toBeNull();
    expect(mensagemDoBackend("Horário ocupado.")).toBeNull();
    expect(mensagemDoBackend({})).toBeNull();
    expect(mensagemDoBackend({ message: ["a", "b"] })).toBeNull();
    expect(mensagemDoBackend({ message: 42 })).toBeNull();
  });
});

describe("apiRequest", () => {
  it("sempre inclui credentials: include (cookie HttpOnly de sessão)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await apiRequest("/auth/me");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.credentials).toBe("include");
    expect(init.cache).toBe("no-store");
  });

  it("resposta 2xx com corpo JSON vira kind: success com os dados", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 })));

    const resultado = await apiRequest<{ ok: boolean }>("/auth/me");

    expect(resultado).toEqual({ kind: "success", status: 200, data: { ok: true } });
  });

  it("resposta 204 sem corpo vira kind: success com data null", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));

    const resultado = await apiRequest("/auth/logout", { method: "POST" });

    expect(resultado).toEqual({ kind: "success", status: 204, data: null });
  });

  it("resposta 4xx/5xx vira kind: http-error, nunca lançada como exceção", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "Não autenticado." }), { status: 401 })),
    );

    const resultado = await apiRequest("/auth/me");

    expect(resultado).toEqual({ kind: "http-error", status: 401, data: { message: "Não autenticado." } });
  });

  it("corpo de erro não-JSON (ex.: texto puro de rate limiter) nunca derruba a chamada", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Too many requests", { status: 429 })));

    const resultado = await apiRequest("/auth/login", { method: "POST", body: { email: "a@b.com", password: "x" } });

    expect(resultado).toEqual({ kind: "http-error", status: 429, data: null });
  });

  it("API indisponível atrás do proxy (502/504 marcado pelo proxy) vira network-error", async () => {
    for (const status of [502, 504]) {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ message: "API indisponível." }), {
            status,
            headers: { "x-agenda-proxy-error": "upstream-unavailable" },
          }),
        ),
      );
      expect(await apiRequest("/auth/me")).toEqual({ kind: "network-error" });
    }
  });

  it("hospedagem no lugar da API: pede a partida direto à API, sem repetir o POST", async () => {
    reiniciarPedidosDePartida();
    const fetchMock = vi.fn().mockImplementation(async (url: string) =>
      url.endsWith("/auth/login")
        ? new Response(JSON.stringify({ message: "API indisponível." }), {
            status: 502,
            headers: {
              "x-agenda-proxy-error": "upstream-unavailable",
              "x-agenda-acordar-api": "https://api.exemplo.test",
            },
          })
        : new Response(null, { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const resultado = await apiRequest("/auth/login", { method: "POST", body: { email: "a@b.com", password: "x" } });

    expect(resultado).toEqual({ kind: "network-error" });
    const chamadas = fetchMock.mock.calls as [string, RequestInit][];
    expect(chamadas.filter(([url]) => url.endsWith("/auth/login"))).toHaveLength(1);
    expect(chamadas.filter(([url]) => url === "https://api.exemplo.test/")).toHaveLength(1);
    const [, init] = chamadas.find(([url]) => url === "https://api.exemplo.test/")!;
    expect(init).toMatchObject({ mode: "no-cors", credentials: "omit" });
  });

  it("502 da própria API (sem o marcador do proxy) continua http-error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 502 })));
    expect(await apiRequest("/auth/me")).toEqual({ kind: "http-error", status: 502, data: {} });
  });

  it("503 da própria API com corpo JSON continua http-error (erro real, nunca 'acordando')", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: "Cadastro temporariamente indisponível." }), {
          status: 503,
          headers: { "content-type": "application/json; charset=utf-8" },
        }),
      ),
    );
    expect(await apiRequest("/auth/register", { method: "POST", body: {} })).toMatchObject({
      kind: "http-error",
      status: 503,
    });
  });

  // Hospedagem respondendo no lugar da API (borda do Render, página de
  // "serviço acordando"): a API não chegou a responder.
  it.each([
    [502, "text/html; charset=utf-8", "<html><body>Bad Gateway</body></html>"],
    [503, "text/html", "<html>Service waking up</html>"],
    [200, "text/html; charset=utf-8", "<!doctype html><html></html>"],
    [502, "text/plain", "Bad Gateway"],
    [504, null, ""],
  ])("%i com %s da hospedagem vira network-error", async (status, contentType, corpo) => {
    const headers = contentType ? { "content-type": contentType } : undefined;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(corpo || null, { status, headers })));
    expect(await apiRequest("/auth/me")).toEqual({ kind: "network-error" });
  });

  it.each([401, 403, 429])("%i nunca vira network-error", async (status) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "x" }), { status })),
    );
    expect(await apiRequest("/auth/me")).toMatchObject({ kind: "http-error", status });
  });

  it("corpo interrompido no meio da leitura vira network-error", async () => {
    const corpo = new ReadableStream({
      start(controle) {
        controle.error(new TypeError("network error"));
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(corpo, { status: 200 })));
    expect(await apiRequest("/auth/me")).toEqual({ kind: "network-error" });
  });

  it("fetch rejeitando (rede/offline) vira kind: network-error, nunca é confundido com http-error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

    const resultado = await apiRequest("/auth/me");

    expect(resultado).toEqual({ kind: "network-error" });
  });

  it("envia o corpo como JSON com Content-Type quando presente", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await apiRequest("/auth/login", { method: "POST", body: { email: "a@b.com", password: "senha-valida-123" } });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe(JSON.stringify({ email: "a@b.com", password: "senha-valida-123" }));
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });
});

describe("acesso do estabelecimento vencido com a sessão aberta", () => {
  it("403 ACESSO_VENCIDO avisa a tela (que relê a sessão); outros 403 não", async () => {
    const ouvinte = vi.fn();
    // Ambiente node: um alvo de eventos no lugar de window.
    const janela = new EventTarget();
    vi.stubGlobal("window", janela);
    janela.addEventListener(EVENTO_ACESSO_VENCIDO, ouvinte);
    try {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: "ACESSO_VENCIDO", message: "venceu" }), { status: 403 })),
      );
      const r = await apiRequest("/tenants/t1/consumers/page");
      expect(r).toMatchObject({ kind: "http-error", status: 403 });
      expect(ouvinte).toHaveBeenCalledTimes(1);

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: "RECURSO_NAO_CONTRATADO" }), { status: 403 })),
      );
      await apiRequest("/tenants/t1/payments");
      expect(ouvinte).toHaveBeenCalledTimes(1);
    } finally {
      janela.removeEventListener(EVENTO_ACESSO_VENCIDO, ouvinte);
    }
  });
});
