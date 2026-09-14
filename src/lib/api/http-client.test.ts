import { afterEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "./http-client";

afterEach(() => {
  vi.unstubAllGlobals();
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
