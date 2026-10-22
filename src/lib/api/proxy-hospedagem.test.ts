// Proxy da API quando a HOSPEDAGEM responde no lugar dela: com a API
// hibernada, o Render devolve ao servidor do web uma página HTML 502 em
// menos de 1 s e não acorda a API (piloto, 2026-10-22). Ver
// docs/plans/recuperacao-apos-hibernacao-continuidade.md.
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
