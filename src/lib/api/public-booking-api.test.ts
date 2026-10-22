import { afterEach, describe, expect, it, vi } from "vitest";
import { consultarHorariosPublicos, enviarPedidoPublico, obterPaginaPublica } from "./public-booking-api";

afterEach(() => {
  vi.unstubAllGlobals();
});

function responder(status: number, corpo: string | null, contentType?: string) {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(corpo, { status, headers: contentType ? { "content-type": contentType } : undefined }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const BORDA = ["<html><body>Bad Gateway</body></html>", "text/html; charset=utf-8"] as const;
const PEDIDO = {
  serviceId: "s",
  professionalId: "p",
  startAt: "2026-10-22T12:00:00.000Z",
  name: "Ana",
  whatsapp: "11999998888",
  idempotencyKey: "k".repeat(32),
};

describe("leituras públicas: só 'a API não respondeu' é falha de comunicação", () => {
  it("página HTML da hospedagem (API acordando) vira falha_comunicacao", async () => {
    responder(502, ...BORDA);
    expect(await obterPaginaPublica("studio")).toEqual({ ok: false, falha: { tipo: "falha_comunicacao" } });
    responder(502, ...BORDA);
    expect(await consultarHorariosPublicos("studio", { serviceId: "s", professionalId: "p", date: "2026-10-22" })).toEqual({
      ok: false,
      falha: { tipo: "falha_comunicacao" },
    });
  });

  it("erro da própria API (500 JSON) vira indisponivel, nunca 'acordando'", async () => {
    responder(500, JSON.stringify({ message: "Erro interno." }), "application/json");
    expect(await obterPaginaPublica("studio")).toEqual({ ok: false, falha: { tipo: "indisponivel" } });
  });

  it("resposta 200 ilegível vira indisponivel", async () => {
    responder(200, JSON.stringify({ outra: "coisa" }), "application/json");
    expect(await obterPaginaPublica("studio")).toEqual({ ok: false, falha: { tipo: "indisponivel" } });
  });

  it("404 e 429 continuam conclusivos", async () => {
    responder(404, JSON.stringify({ message: "x" }), "application/json");
    expect(await obterPaginaPublica("studio")).toEqual({ ok: false, falha: { tipo: "nao_encontrada" } });
    responder(429, JSON.stringify({ message: "Muitas." }), "application/json");
    expect(await obterPaginaPublica("studio")).toEqual({ ok: false, falha: { tipo: "limite", mensagem: "Muitas." } });
  });
});

describe("envio do pedido", () => {
  it("borda da hospedagem no envio é 'incerto' (nunca afirma que não gravou) e só UMA requisição sai", async () => {
    const fetchMock = responder(502, ...BORDA);
    expect(await enviarPedidoPublico("studio", PEDIDO)).toEqual({ ok: false, falha: { tipo: "incerto" } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
