import { afterEach, describe, expect, it, vi } from "vitest";
import { ehProduto, falhaDaResposta, itensDesatualizados, listarProdutos, registrarMovimentacao } from "./estoque-api";

const produto = {
  id: "p1",
  name: "Pomada",
  description: null,
  internalCode: null,
  categoryId: "c1",
  categoryName: "Cabelo",
  subcategoryId: null,
  subcategoryName: null,
  purpose: "VENDA",
  unit: "UN",
  minQuantityMilli: 0,
  balanceMilli: 5000,
  balanceVersion: 1,
  low: false,
  archived: false,
  createdAt: "2026-11-18T10:00:00.000Z",
  updatedAt: "2026-11-18T10:00:00.000Z",
};

function respostaJson(status: number, corpo: unknown) {
  return new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
}

afterEach(() => vi.unstubAllGlobals());

describe("cliente do estoque", () => {
  it("classifica pelo status e pelo code, nunca pelo texto", () => {
    expect(falhaDaResposta(403, { code: "RECURSO_NAO_CONTRATADO", message: "x" })).toEqual({ tipo: "nao_contratado" });
    expect(falhaDaResposta(403, { message: "Você não tem permissão." })).toEqual({ tipo: "sem_permissao", mensagem: "Você não tem permissão." });
    expect(falhaDaResposta(404, { message: "Estabelecimento não encontrado." })).toMatchObject({ tipo: "nao_encontrado" });
    expect(falhaDaResposta(409, { code: "SALDO_INSUFICIENTE", message: "Saldo insuficiente." })).toMatchObject({ tipo: "conflito", code: "SALDO_INSUFICIENTE" });
    expect(falhaDaResposta(401, null)).toEqual({ tipo: "nao_autenticado" });
    expect(falhaDaResposta(500, null)).toEqual({ tipo: "indisponivel" });
  });

  it("valida a forma do produto (quantidade em milésimos inteiros)", () => {
    expect(ehProduto(produto)).toBe(true);
    expect(ehProduto({ ...produto, balanceMilli: 1.5 })).toBe(false);
    expect(ehProduto({ ...produto, balanceMilli: "5000" })).toBe(false);
  });

  it("lê os itens do 409 de conferência desatualizada", () => {
    const falha = falhaDaResposta(409, {
      code: "CONFERENCIA_DESATUALIZADA",
      message: "Mudou.",
      items: [{ productId: "p1", balanceMilli: 0, balanceVersion: 2, unit: "CX", archived: false }, { lixo: true }],
    });
    expect(itensDesatualizados(falha)).toEqual([{ productId: "p1", balanceMilli: 0, balanceVersion: 2, unit: "CX", archived: false }]);
    expect(itensDesatualizados({ tipo: "falha_comunicacao" })).toBeNull();
  });

  it("listar devolve itens e cursor; resposta fora da forma vira indisponível", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(respostaJson(200, { products: [produto], nextCursor: "abc" })));
    expect(await listarProdutos("t1", "status=ACTIVE")).toEqual({ ok: true, dados: { itens: [produto], proximo: "abc" } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(respostaJson(200, { products: [{ id: 1 }] })));
    expect(await listarProdutos("t1", "status=ACTIVE")).toEqual({ ok: false, falha: { tipo: "indisponivel" } });
  });

  it("registrar movimentação envia a chave e a unidade esperada; rede caída é falha de comunicação", async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError("offline"));
    vi.stubGlobal("fetch", fetch);
    const corpo = { requestKey: "a".repeat(32), productId: "p1", kind: "SAIDA_VENDA" as const, quantityMilli: 1000, expectedUnit: "UN" as const, reason: null };
    expect(await registrarMovimentacao("t 1", corpo)).toEqual({ ok: false, falha: { tipo: "falha_comunicacao" } });
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/tenants/t%201/stock/movements");
    expect(JSON.parse(String(init.body))).toEqual(corpo);
  });
});
