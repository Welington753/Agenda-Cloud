import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { INTERVALO_MINIMO_MS, origemParaAcordar, pedirPartidaDaApi, reiniciarPedidosDePartida } from "./acordar-api";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  reiniciarPedidosDePartida();
  fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("origemParaAcordar", () => {
  it("aceita HTTPS e HTTP só em endereço local, sempre só a origem", () => {
    expect(origemParaAcordar("https://api.exemplo.test/qualquer?x=1")).toBe("https://api.exemplo.test");
    expect(origemParaAcordar("http://127.0.0.1:4000")).toBe("http://127.0.0.1:4000");
    expect(origemParaAcordar("http://localhost:4000")).toBe("http://localhost:4000");
    for (const valor of [null, "", "nao-e-url", "http://api.exemplo.test", "javascript:alert(1)", "ftp://x.test"]) {
      expect(origemParaAcordar(valor)).toBeNull();
    }
  });
});

describe("pedirPartidaDaApi", () => {
  it("um GET à raiz, no-cors, sem cookie e sem cache", () => {
    expect(pedirPartidaDaApi("https://api.exemplo.test", 1_000)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.exemplo.test/");
    expect(init).toMatchObject({ mode: "no-cors", credentials: "omit", cache: "no-store" });
    expect(init.method).toBeUndefined();
    expect(init.body).toBeUndefined();
  });

  it("no máximo um pedido por intervalo", () => {
    expect(pedirPartidaDaApi("https://api.exemplo.test", 1_000)).toBe(true);
    expect(pedirPartidaDaApi("https://api.exemplo.test", 1_000 + INTERVALO_MINIMO_MS - 1)).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(pedirPartidaDaApi("https://api.exemplo.test", 1_000 + INTERVALO_MINIMO_MS)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("origem inválida: nada é enviado", () => {
    expect(pedirPartidaDaApi(null)).toBe(false);
    expect(pedirPartidaDaApi("http://api.exemplo.test")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falha do pedido nunca lança", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    expect(() => pedirPartidaDaApi("https://api.exemplo.test")).not.toThrow();
    await Promise.resolve();
  });
});
