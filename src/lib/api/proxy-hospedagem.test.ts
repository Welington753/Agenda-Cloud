// Proxy da API quando a HOSPEDAGEM responde no lugar dela: com a API
// hibernada, o Render devolve ao servidor do web uma página HTML 502 em
// menos de 1 s e não acorda a API (piloto, 2026-10-22). Em 2026-11-16 a
// mesma situação chegou como 429, em texto puro ou com a página de desafio
// da Cloudflare. Ver docs/plans/recuperacao-apos-hibernacao-continuidade.md.
import { describe, expect, it, vi } from "vitest";

import { encaminharParaApi } from "./proxy";
import type { ConfiguracaoProxy } from "./proxy-config";

const ORIGEM = "https://agenda-web.exemplo.test";
const configuracao: ConfiguracaoProxy = {
  destino: new URL("https://agenda-api.exemplo.test"),
  origemPublica: ORIGEM,
  segredo: "segredo-de-teste-com-tamanho-suficiente-0123456789",
  fonteIpCliente: "socket",
};

function paginaDaHospedagem(): Response {
  return new Response("<!DOCTYPE html><title>502</title>", {
    status: 502,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function requisicao(caminho: string, init: RequestInit = {}): Request {
  return new Request(`${ORIGEM}/agenda_api${caminho}`, init);
}

describe("hospedagem respondendo no lugar da API", () => {
  it("página HTML 5xx vira 502 indisponível, com a origem da API para o navegador acordá-la", async () => {
    const fetchFalso = vi.fn().mockResolvedValue(paginaDaHospedagem());
    const resposta = await encaminharParaApi(requisicao("/auth/me"), ["auth", "me"], configuracao, fetchFalso);
    expect(resposta.status).toBe(502);
    expect(resposta.headers.get("x-agenda-proxy-error")).toBe("upstream-unavailable");
    expect(resposta.headers.get("x-agenda-acordar-api")).toBe("https://agenda-api.exemplo.test");
    expect(resposta.headers.get("cache-control")).toBe("no-store");
    expect(await resposta.json()).toEqual({ message: "API indisponível." });
    expect(fetchFalso).toHaveBeenCalledTimes(1);
  });

  it("POST de login recebendo a página da hospedagem: uma única chamada à API", async () => {
    const fetchFalso = vi.fn().mockResolvedValue(paginaDaHospedagem());
    const resposta = await encaminharParaApi(
      requisicao("/auth/login", { method: "POST", headers: { origin: ORIGEM, "content-type": "application/json" }, body: "{}" }),
      ["auth", "login"],
      configuracao,
      fetchFalso,
    );
    expect(resposta.headers.get("x-agenda-acordar-api")).toBe("https://agenda-api.exemplo.test");
    expect(fetchFalso).toHaveBeenCalledTimes(1);
  });

  it("erro JSON da própria API passa sem alteração e sem pedido de partida", async () => {
    const fetchFalso = vi.fn().mockResolvedValue(
      Response.json({ message: "Cadastro indisponível.", statusCode: 503 }, { status: 503 }),
    );
    const resposta = await encaminharParaApi(requisicao("/auth/me"), ["auth", "me"], configuracao, fetchFalso);
    expect(resposta.status).toBe(503);
    expect(resposta.headers.get("x-agenda-proxy-error")).toBeNull();
    expect(resposta.headers.get("x-agenda-acordar-api")).toBeNull();
  });

  it("API fora do ar (fetch falhou): indisponível, sem pedido de partida", async () => {
    const fetchFalso = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    const resposta = await encaminharParaApi(requisicao("/auth/me"), ["auth", "me"], configuracao, fetchFalso);
    expect(resposta.headers.get("x-agenda-proxy-error")).toBe("upstream-unavailable");
    expect(resposta.headers.get("x-agenda-acordar-api")).toBeNull();
  });
});

// Os dois 429 recebidos pelo proxy do piloto em 2026-11-16, com a API
// hibernada: status, tipo e corpo como vieram (a página de desafio está
// reduzida, sem os valores de sessão). Nenhum trazia `Retry-After` nem
// `RateLimit-*`.
const TEXTO_DA_BORDA = "Too Many Requests\n";
const PAGINA_DE_DESAFIO =
  '<!DOCTYPE html><html lang="en-US"><head><title>Just a moment...</title>' +
  '<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">' +
  '<meta name="robots" content="noindex,nofollow"></head><body>' +
  '<noscript><span id="challenge-error-text">Enable JavaScript and cookies to continue</span></noscript>' +
  "<script>(function(){window._cf_chl_opt = {cType: 'managed',cZone: 'agenda-api.exemplo.test'};" +
  "var a = document.createElement('script');" +
  "a.src = '/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1?ray=0000000000000000';" +
  "document.getElementsByTagName('head')[0].appendChild(a);}());</script></body></html>";

const LIMITES_DA_HOSPEDAGEM = [
  ["texto puro", "text/plain; charset=utf-8", TEXTO_DA_BORDA],
  ["página de desafio", "text/html; charset=UTF-8", PAGINA_DE_DESAFIO],
] as const;

function resposta429(tipo: string | null, corpo: string | null, cabecalhos: Record<string, string> = {}): Response {
  return new Response(corpo, { status: 429, headers: { ...(tipo ? { "content-type": tipo } : {}), ...cabecalhos } });
}

// Cabeçalhos que o express-rate-limit da API envia num 429
// (`standardHeaders: true`), na versão publicada e na integração.
const CABECALHOS_DO_LIMITADOR = {
  "retry-after": "900",
  "ratelimit-policy": "5;w=900",
  "ratelimit-limit": "5",
  "ratelimit-remaining": "0",
  "ratelimit-reset": "900",
};

async function esperarRepasseSemAlteracao(recebida: Response, corpo: string, cabecalhos: Record<string, string> = {}) {
  expect(recebida.status).toBe(429);
  expect(recebida.headers.get("x-agenda-proxy-error")).toBeNull();
  expect(recebida.headers.get("x-agenda-acordar-api")).toBeNull();
  for (const [nome, valor] of Object.entries(cabecalhos)) expect(recebida.headers.get(nome), nome).toBe(valor);
  expect(await recebida.text()).toBe(corpo);
}

describe("429 da hospedagem no lugar da API hibernada", () => {
  it.each(LIMITES_DA_HOSPEDAGEM)(
    "%s: vira 502 indisponível, com a origem da API para o navegador acordá-la",
    async (_nome, tipo, corpo) => {
      const fetchFalso = vi.fn().mockResolvedValue(resposta429(tipo, corpo));
      const resposta = await encaminharParaApi(requisicao("/auth/me"), ["auth", "me"], configuracao, fetchFalso);
      expect(resposta.status).toBe(502);
      expect(resposta.headers.get("x-agenda-proxy-error")).toBe("upstream-unavailable");
      expect(resposta.headers.get("x-agenda-acordar-api")).toBe("https://agenda-api.exemplo.test");
      expect(resposta.headers.get("cache-control")).toBe("no-store");
      expect(resposta.headers.get("content-type")).toContain("application/json");
      expect(await resposta.json()).toEqual({ message: "API indisponível." });
      expect(fetchFalso).toHaveBeenCalledTimes(1);
    },
  );

  it.each(LIMITES_DA_HOSPEDAGEM)(
    "%s num POST de login: uma única chamada à API, nunca repetida pelo proxy",
    async (_nome, tipo, corpo) => {
      const fetchFalso = vi.fn().mockResolvedValue(resposta429(tipo, corpo));
      const resposta = await encaminharParaApi(
        requisicao("/auth/login", { method: "POST", headers: { origin: ORIGEM, "content-type": "application/json" }, body: "{}" }),
        ["auth", "login"],
        configuracao,
        fetchFalso,
      );
      expect(resposta.status).toBe(502);
      expect(resposta.headers.get("x-agenda-acordar-api")).toBe("https://agenda-api.exemplo.test");
      expect(fetchFalso).toHaveBeenCalledTimes(1);
    },
  );
});

describe("429 da própria API: status, corpo e cabeçalhos de limite preservados", () => {
  it("limitador de login e de conta (HTML padrão do express-rate-limit)", async () => {
    const corpo = "Too many requests, please try again later.";
    const fetchFalso = vi.fn().mockResolvedValue(resposta429("text/html; charset=utf-8", corpo, CABECALHOS_DO_LIMITADOR));
    const resposta = await encaminharParaApi(
      requisicao("/auth/login", { method: "POST", headers: { origin: ORIGEM, "content-type": "application/json" }, body: "{}" }),
      ["auth", "login"],
      configuracao,
      fetchFalso,
    );
    await esperarRepasseSemAlteracao(resposta, corpo, {
      ...CABECALHOS_DO_LIMITADOR,
      "content-type": "text/html; charset=utf-8",
    });
  });

  it("limitador da página pública (JSON)", async () => {
    const corpo = JSON.stringify({ statusCode: 429, message: "Muitas tentativas a partir desta conexão." });
    const fetchFalso = vi
      .fn()
      .mockResolvedValue(resposta429("application/json; charset=utf-8", corpo, CABECALHOS_DO_LIMITADOR));
    const resposta = await encaminharParaApi(requisicao("/public/x"), ["public", "x"], configuracao, fetchFalso);
    await esperarRepasseSemAlteracao(resposta, corpo, CABECALHOS_DO_LIMITADOR);
  });

  it("limite de negócio (JSON do Nest, sem cabeçalhos de limite)", async () => {
    const corpo = JSON.stringify({ statusCode: 429, message: "Limite diário de pedidos atingido." });
    const fetchFalso = vi.fn().mockResolvedValue(resposta429("application/json; charset=utf-8", corpo));
    const resposta = await encaminharParaApi(requisicao("/public/x"), ["public", "x"], configuracao, fetchFalso);
    await esperarRepasseSemAlteracao(resposta, corpo);
  });

  it("os formatos da hospedagem acompanhados de Retry-After ou RateLimit-* passam como vieram", async () => {
    for (const [, tipo, corpo] of LIMITES_DA_HOSPEDAGEM) {
      const variacoes: Record<string, string>[] = [
        { "retry-after": "30" },
        { "ratelimit-remaining": "0" },
        { "ratelimit-policy": "5;w=900" },
      ];
      for (const cabecalhos of variacoes) {
        const fetchFalso = vi.fn().mockResolvedValue(resposta429(tipo, corpo, cabecalhos));
        const resposta = await encaminharParaApi(requisicao("/auth/me"), ["auth", "me"], configuracao, fetchFalso);
        await esperarRepasseSemAlteracao(resposta, corpo, cabecalhos);
      }
    }
  });
});

describe("429 ambíguo: passa como veio, sem pedido de partida", () => {
  it.each([
    ["texto puro com outra frase", "text/plain", "Too many requests"],
    ["texto puro com a frase da borda dentro de outra", "text/plain; charset=utf-8", "429 Too Many Requests (app)"],
    ["HTML sem a marca do desafio", "text/html; charset=utf-8", "<html><body>Too Many Requests</body></html>"],
    ["HTML padrão do limitador sem os cabeçalhos", "text/html; charset=utf-8", "Too many requests, please try again later."],
    ["JSON com o texto da borda", "application/json", '"Too Many Requests"'],
    ["texto da borda sem Content-Type declarado como texto", "application/octet-stream", TEXTO_DA_BORDA],
  ])("%s", async (_nome, tipo, corpo) => {
    const fetchFalso = vi.fn().mockResolvedValue(resposta429(tipo, corpo));
    const resposta = await encaminharParaApi(requisicao("/auth/me"), ["auth", "me"], configuracao, fetchFalso);
    await esperarRepasseSemAlteracao(resposta, corpo, { "content-type": tipo });
  });

  it("corpo vazio", async () => {
    const fetchFalso = vi.fn().mockResolvedValue(resposta429("text/plain", null));
    const resposta = await encaminharParaApi(requisicao("/auth/me"), ["auth", "me"], configuracao, fetchFalso);
    await esperarRepasseSemAlteracao(resposta, "");
  });

  it("página grande demais para ser examinada, mesmo com a marca do desafio", async () => {
    const corpo = PAGINA_DE_DESAFIO + " ".repeat(64 * 1024);
    const fetchFalso = vi.fn().mockResolvedValue(resposta429("text/html; charset=UTF-8", corpo));
    const resposta = await encaminharParaApi(requisicao("/auth/me"), ["auth", "me"], configuracao, fetchFalso);
    await esperarRepasseSemAlteracao(resposta, corpo);
  });

  it.each([403, 503])("página de desafio com status %i não entra na regra do 429", async (status) => {
    const fetchFalso = vi.fn().mockResolvedValue(
      new Response(PAGINA_DE_DESAFIO, { status, headers: { "content-type": "text/html; charset=UTF-8" } }),
    );
    const resposta = await encaminharParaApi(requisicao("/auth/me"), ["auth", "me"], configuracao, fetchFalso);
    // 403 passa como veio; 503 em HTML já era da hospedagem pela regra do 5xx.
    expect(resposta.status).toBe(status === 403 ? 403 : 502);
    expect(resposta.headers.get("x-agenda-acordar-api")).toBe(status === 403 ? null : "https://agenda-api.exemplo.test");
  });
});
