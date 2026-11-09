import { describe, expect, it, vi } from "vitest";
import type { ConfiguracaoProxy } from "@/lib/api/proxy-config";
import { lerPaginaNoServidor, slugPublicoNormalizado } from "./pagina-no-servidor";

const SEGREDO = "segredo-ficticio-de-teste-0123456789abcdef";
const CONFIG: ConfiguracaoProxy = {
  destino: new URL("https://api.exemplo.test"),
  origemPublica: "https://agenda.exemplo.test",
  segredo: SEGREDO,
  fonteIpCliente: "cf-connecting-ip",
};

const PERFIL = {
  establishment: { name: "Studio Exemplo", slug: "studio-exemplo", timezone: "America/Sao_Paulo" },
  services: [],
  professionals: [],
};

function json(status: number, corpo: unknown) {
  return new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}

function fetchQueResponde(resposta: Response | Error) {
  return vi.fn((): Promise<Response> => (resposta instanceof Error ? Promise.reject(resposta) : Promise.resolve(resposta)));
}

describe("slug público", () => {
  it("normaliza como a API (minúsculas) e recusa formato inválido", () => {
    expect(slugPublicoNormalizado("Studio-Exemplo")).toBe("studio-exemplo");
    expect(slugPublicoNormalizado("studio%20exemplo")).toBeNull();
    expect(slugPublicoNormalizado("-studio")).toBeNull();
    expect(slugPublicoNormalizado("a".repeat(81))).toBeNull();
    expect(slugPublicoNormalizado("%E0%A4%A")).toBeNull();
  });
});

describe("leitura da página pública no servidor", () => {
  it("encontrada: usa o slug canônico devolvido pela API", async () => {
    const f = fetchQueResponde(json(200, { profile: PERFIL }));
    const r = await lerPaginaNoServidor("Studio-Exemplo", CONFIG, new Headers(), f);
    expect(r).toEqual({ tipo: "encontrada", pagina: PERFIL, slug: "studio-exemplo" });
    const [url, init] = f.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe("https://api.exemplo.test/public/studio-exemplo");
    expect(init.redirect).toBe("manual");
    expect(init.cache).toBe("no-store");
  });

  it("repassa o IP do visitante só com o segredo e só de CF-Connecting-IP válido; nunca cookie", async () => {
    const f = fetchQueResponde(json(200, { profile: PERFIL }));
    const entrada = new Headers({ "cf-connecting-ip": "203.0.113.7", cookie: "session_token=ficticio", "x-forwarded-for": "198.51.100.1" });
    await lerPaginaNoServidor("studio-exemplo", CONFIG, entrada, f);
    const headers = (f.mock.calls[0] as unknown as [URL, RequestInit])[1].headers as Headers;
    expect(headers.get("x-agenda-proxy-secret")).toBe(SEGREDO);
    expect(headers.get("x-agenda-client-ip")).toBe("203.0.113.7");
    expect(headers.get("cookie")).toBeNull();
    expect(headers.get("x-forwarded-for")).toBeNull();
  });

  it("404 em JSON da API: inexistente (estabelecimento sem página, desligada ou inativo)", async () => {
    const r = await lerPaginaNoServidor("sem-pagina", CONFIG, new Headers(), fetchQueResponde(json(404, { message: "x" })));
    expect(r).toEqual({ tipo: "inexistente" });
  });

  it("slug fora do formato: inexistente sem chamar a API", async () => {
    const f = fetchQueResponde(json(200, { profile: PERFIL }));
    expect(await lerPaginaNoServidor("não-é-slug", CONFIG, new Headers(), f)).toEqual({ tipo: "inexistente" });
    expect(f).not.toHaveBeenCalled();
  });

  it.each([
    ["404 em HTML (hospedagem)", new Response("<html>Not Found</html>", { status: 404, headers: { "content-type": "text/html" } })],
    ["502 da hospedagem (API hibernada)", new Response("<html>Bad Gateway</html>", { status: 502, headers: { "content-type": "text/html" } })],
    ["429 da API", json(429, { message: "limite" })],
    ["500 da API", json(500, { message: "erro" })],
    ["200 com forma inesperada", json(200, { profile: { nada: true } })],
    ["rede caiu", new TypeError("fetch failed")],
    ["prazo esgotado", new DOMException("tempo", "TimeoutError")],
  ])("%s: desconhecida, nunca 404", async (_nome, resposta) => {
    const r = await lerPaginaNoServidor("studio-exemplo", CONFIG, new Headers(), fetchQueResponde(resposta));
    expect(r).toEqual({ tipo: "desconhecida" });
  });

  it("API que não responde: o prazo real corta a espera e dá desconhecida", async () => {
    const pendurada = (_url: URL, init: RequestInit) =>
      new Promise<Response>((_resolve, rejeitar) => {
        init.signal?.addEventListener("abort", () => rejeitar(init.signal?.reason));
      });
    const inicio = Date.now();
    expect(await lerPaginaNoServidor("studio-exemplo", CONFIG, new Headers(), pendurada, 30)).toEqual({ tipo: "desconhecida" });
    expect(Date.now() - inicio).toBeLessThan(2_000);
  });

  it("sem configuração do proxy (desenvolvimento, chamada direta): não lê nada", async () => {
    const f = fetchQueResponde(json(200, { profile: PERFIL }));
    expect(await lerPaginaNoServidor("studio-exemplo", null, new Headers(), f)).toEqual({ tipo: "desconhecida" });
    expect(f).not.toHaveBeenCalled();
  });
});
