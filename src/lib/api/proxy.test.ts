// Proxy da API (lib/api/proxy.ts) contra um servidor HTTP real local no papel
// da API: `fetch` de verdade, `Set-Cookie` múltiplo de verdade, sem rede
// externa. A API real (NestJS) e o navegador entram em
// tests/browser/same-origin-proxy-flow.spec.ts.
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { encaminharParaApi, montarUrlDestino, TAMANHO_MAXIMO_CORPO } from "./proxy";
import type { ConfiguracaoProxy } from "./proxy-config";

const ORIGEM = "https://agenda-web.exemplo.test";
const SEGREDO = "segredo-de-teste-com-tamanho-suficiente-0123456789";

interface Recebida {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: string;
}

let servidor: Server;
let destino: URL;
let recebidas: Recebida[];
let responder: (req: Recebida, res: import("node:http").ServerResponse) => void;

beforeAll(async () => {
  servidor = createServer((req, res) => {
    const partes: Buffer[] = [];
    req.on("data", (parte: Buffer) => partes.push(parte));
    req.on("end", () => {
      const recebida = {
        method: req.method ?? "",
        url: req.url ?? "",
        headers: req.headers,
        body: Buffer.concat(partes).toString("utf8"),
      };
      recebidas.push(recebida);
      responder(recebida, res);
    });
  });
  await new Promise<void>((resolve) => servidor.listen(0, "127.0.0.1", resolve));
  destino = new URL(`http://127.0.0.1:${(servidor.address() as AddressInfo).port}`);
});

afterAll(async () => {
  await new Promise<void>((resolve) => servidor.close(() => resolve()));
});

beforeEach(() => {
  recebidas = [];
  responder = (_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  };
});

function configuracao(parcial: Partial<ConfiguracaoProxy> = {}): ConfiguracaoProxy {
  return { destino, origemPublica: ORIGEM, segredo: SEGREDO, fonteIpCliente: "socket", ...parcial };
}

function requisicao(caminho: string, init: RequestInit = {}): Request {
  return new Request(`${ORIGEM}/agenda_api${caminho}`, init);
}

describe("destino fixo", () => {
  it("encaminha só para a origem configurada, com caminho e query", async () => {
    const resposta = await encaminharParaApi(requisicao("/tenants/t1/services?ativo=true"), ["tenants", "t1", "services"], configuracao());
    expect(resposta.status).toBe(200);
    expect(recebidas[0].url).toBe("/tenants/t1/services?ativo=true");
  });

  it("caminho nunca troca o host nem sobe de diretório", () => {
    const base = new URL("https://api.exemplo.test");
    for (const segmentos of [["..", "x"], ["."], [""], [], ["a", "", "b"]]) {
      expect(montarUrlDestino(base, segmentos, "")).toBeNull();
    }
    expect(montarUrlDestino(base, ["evil.test", "x"], "")?.href).toBe("https://api.exemplo.test/evil.test/x");
    expect(montarUrlDestino(base, ["//evil.test"], "")?.href).toBe("https://api.exemplo.test/%2F%2Fevil.test");
    expect(montarUrlDestino(base, ["a\\..\\b"], "")?.origin).toBe("https://api.exemplo.test");
    expect(montarUrlDestino(base, ["@evil.test"], "")?.origin).toBe("https://api.exemplo.test");
    expect(montarUrlDestino(base, ["a?b#c"], "")?.pathname).toBe("/a%3Fb%23c");
  });

  it("caminho inválido responde 404 sem chamar a API", async () => {
    const fetchFalso = vi.fn();
    const resposta = await encaminharParaApi(requisicao("/x"), [".."], configuracao(), fetchFalso);
    expect(resposta.status).toBe(404);
    expect(fetchFalso).not.toHaveBeenCalled();
  });
});

describe("cabeçalhos enviados à API", () => {
  it("lista fechada: cookie e content-type passam; IP, Origin e X-Agenda-* do navegador não", async () => {
    await encaminharParaApi(
      requisicao("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: "a@b.test" }),
        headers: {
          origin: ORIGEM,
          "content-type": "application/json",
          cookie: "session_token=abc",
          "x-forwarded-for": "203.0.113.1",
          "x-real-ip": "203.0.113.2",
          "cf-connecting-ip": "203.0.113.3",
          "x-agenda-client-ip": "203.0.113.4",
          "x-agenda-proxy-secret": "forjado",
          authorization: "Bearer x",
        },
      }),
      ["auth", "login"],
      configuracao(),
    );
    const { headers, body, method } = recebidas[0];
    expect(method).toBe("POST");
    expect(body).toBe(JSON.stringify({ email: "a@b.test" }));
    expect(headers.cookie).toBe("session_token=abc");
    expect(headers["content-type"]).toBe("application/json");
    expect(headers["x-agenda-proxy-secret"]).toBe(SEGREDO);
    for (const nome of ["x-forwarded-for", "x-real-ip", "cf-connecting-ip", "x-agenda-client-ip", "origin", "authorization"]) {
      expect(headers[nome], nome).toBeUndefined();
    }
  });

  it("cf-connecting-ip: repassa UM IP válido como X-Agenda-Client-IP, junto com o segredo", async () => {
    await encaminharParaApi(
      requisicao("/auth/me", { headers: { "cf-connecting-ip": "198.51.100.7" } }),
      ["auth", "me"],
      configuracao({ fonteIpCliente: "cf-connecting-ip" }),
    );
    expect(recebidas[0].headers["x-agenda-client-ip"]).toBe("198.51.100.7");
    expect(recebidas[0].headers["cf-connecting-ip"]).toBeUndefined();
  });

  it("cf-connecting-ip inválido, em lista, ou sem segredo: nenhum IP é repassado", async () => {
    for (const valor of ["nao-e-ip", "198.51.100.7, 203.0.113.1", "198.51.100.7:80"]) {
      await encaminharParaApi(
        requisicao("/auth/me", { headers: { "cf-connecting-ip": valor } }),
        ["auth", "me"],
        configuracao({ fonteIpCliente: "cf-connecting-ip" }),
      );
    }
    await encaminharParaApi(
      requisicao("/auth/me", { headers: { "cf-connecting-ip": "198.51.100.7" } }),
      ["auth", "me"],
      configuracao({ fonteIpCliente: "cf-connecting-ip", segredo: undefined }),
    );
    for (const recebida of recebidas) expect(recebida.headers["x-agenda-client-ip"]).toBeUndefined();
    expect(recebidas.at(-1)?.headers["x-agenda-proxy-secret"]).toBeUndefined();
  });

  it("socket: nunca repassa IP, nem com CF-Connecting-IP ou X-Forwarded-For presentes", async () => {
    await encaminharParaApi(
      requisicao("/auth/me", { headers: { "cf-connecting-ip": "198.51.100.7", "x-forwarded-for": "198.51.100.8" } }),
      ["auth", "me"],
      configuracao(),
    );
    expect(recebidas[0].headers["x-agenda-client-ip"]).toBeUndefined();
  });
});

describe("verificação de origem nas escritas", () => {
  it.each(["POST", "PUT", "PATCH", "DELETE"])("%s sem Origin ou com outra origem: 403 sem chamar a API", async (method) => {
    for (const origin of [undefined, "https://outro-site.test", "null", `${ORIGEM}/`]) {
      const resposta = await encaminharParaApi(
        requisicao("/auth/logout", { method, headers: origin ? { origin } : {} }),
        ["auth", "logout"],
        configuracao(),
      );
      expect(resposta.status).toBe(403);
    }
    expect(recebidas).toHaveLength(0);
  });

  it("GET não exige Origin (leitura não muda estado)", async () => {
    const resposta = await encaminharParaApi(requisicao("/auth/me"), ["auth", "me"], configuracao());
    expect(resposta.status).toBe(200);
  });
});

describe("resposta ao navegador", () => {
  it("repassa status, corpo e TODOS os Set-Cookie sem alterar atributos", async () => {
    responder = (_req, res) => {
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "set-cookie": [
          "session_token=novo; Max-Age=2592000; Path=/; Expires=Thu, 01 Jan 2099 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax",
          "outro=1; Path=/; HttpOnly",
        ],
        "access-control-allow-origin": "https://outro-site.test",
        "access-control-allow-credentials": "true",
        location: "https://evil.test/",
        "x-powered-by": "Express",
      });
      res.end(JSON.stringify({ user: { id: "u1" } }));
    };
    const resposta = await encaminharParaApi(
      requisicao("/auth/login", { method: "POST", headers: { origin: ORIGEM } }),
      ["auth", "login"],
      configuracao(),
    );
    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({ user: { id: "u1" } });
    expect(resposta.headers.getSetCookie()).toEqual([
      "session_token=novo; Max-Age=2592000; Path=/; Expires=Thu, 01 Jan 2099 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax",
      "outro=1; Path=/; HttpOnly",
    ]);
    expect(resposta.headers.get("cache-control")).toBe("no-store");
    for (const nome of ["access-control-allow-origin", "access-control-allow-credentials", "location", "x-powered-by"]) {
      expect(resposta.headers.get(nome), nome).toBeNull();
    }
  });

  it("logout: 204 sem corpo e o cookie de remoção chega ao navegador", async () => {
    responder = (_req, res) => {
      res.writeHead(204, {
        "set-cookie": "session_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax",
      });
      res.end();
    };
    const resposta = await encaminharParaApi(
      requisicao("/auth/logout", { method: "POST", headers: { origin: ORIGEM, cookie: "session_token=abc" } }),
      ["auth", "logout"],
      configuracao(),
    );
    expect(resposta.status).toBe(204);
    expect(await resposta.text()).toBe("");
    expect(resposta.headers.getSetCookie()).toEqual([
      "session_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax",
    ]);
  });

  it.each([400, 401, 403, 404, 409, 422, 500])("erro %i da API: mesmo status e mesmo corpo", async (status) => {
    responder = (_req, res) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ statusCode: status, message: "detalhe" }));
    };
    const resposta = await encaminharParaApi(requisicao("/x"), ["x"], configuracao());
    expect(resposta.status).toBe(status);
    expect(await resposta.json()).toEqual({ statusCode: status, message: "detalhe" });
    expect(resposta.headers.get("x-agenda-proxy-error")).toBeNull();
  });

  it("429 do rate limit: repassa Retry-After e RateLimit-*", async () => {
    responder = (_req, res) => {
      res.writeHead(429, { "content-type": "text/plain", "retry-after": "900", "ratelimit-remaining": "0" });
      res.end("Too many requests");
    };
    const resposta = await encaminharParaApi(
      requisicao("/auth/login", { method: "POST", headers: { origin: ORIGEM } }),
      ["auth", "login"],
      configuracao(),
    );
    expect(resposta.status).toBe(429);
    expect(resposta.headers.get("retry-after")).toBe("900");
    expect(resposta.headers.get("ratelimit-remaining")).toBe("0");
    expect(await resposta.text()).toBe("Too many requests");
  });
});

describe("falhas, sem nova tentativa", () => {
  it("API fora do ar: 502 marcado como indisponível, uma única tentativa", async () => {
    const fetchFalso = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    const resposta = await encaminharParaApi(
      requisicao("/tenants/t1/services", { method: "POST", headers: { origin: ORIGEM }, body: "{}" }),
      ["tenants", "t1", "services"],
      configuracao(),
      fetchFalso,
    );
    expect(resposta.status).toBe(502);
    expect(resposta.headers.get("x-agenda-proxy-error")).toBe("upstream-unavailable");
    expect(fetchFalso).toHaveBeenCalledTimes(1);
  });

  it("tempo esgotado: 504 marcado como indisponível", async () => {
    const fetchFalso = vi.fn().mockRejectedValue(new DOMException("tempo", "TimeoutError"));
    const resposta = await encaminharParaApi(requisicao("/auth/me"), ["auth", "me"], configuracao(), fetchFalso);
    expect(resposta.status).toBe(504);
    expect(resposta.headers.get("x-agenda-proxy-error")).toBe("upstream-unavailable");
  });

  it("chamada à API sem cache e sem seguir redirecionamento", async () => {
    const fetchFalso = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    await encaminharParaApi(requisicao("/auth/me"), ["auth", "me"], configuracao(), fetchFalso);
    const [, init] = fetchFalso.mock.calls[0] as [URL, RequestInit];
    expect(init.cache).toBe("no-store");
    expect(init.redirect).toBe("manual");
  });

  it("corpo acima do limite: 413 sem chamar a API", async () => {
    const resposta = await encaminharParaApi(
      requisicao("/x", { method: "POST", headers: { origin: ORIGEM }, body: "a".repeat(TAMANHO_MAXIMO_CORPO + 1) }),
      ["x"],
      configuracao(),
    );
    expect(resposta.status).toBe(413);
    expect(recebidas).toHaveLength(0);
  });
});
