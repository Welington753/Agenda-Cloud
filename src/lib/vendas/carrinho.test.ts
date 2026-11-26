import { describe, expect, it } from "vitest";
import { formatarQuantidade } from "@/lib/estoque/quantidade";
import { MAXIMO_DE_ITENS } from "./calculo";
import { adicionarProduto, alterarLinha, aplicarRecusa, avaliarCarrinho, corpoDaVenda, novaLinha, removerLinha } from "./carrinho";

const xampu = { id: "p1", name: "Xampu", unit: "UN" as const, salePriceCents: 1999 };
const cera = { id: "p2", name: "Cera a granel", unit: "KG" as const, salePriceCents: 4590 };
const semPreco = { id: "p3", name: "Pomada", unit: "UN" as const, salePriceCents: null };

describe("carrinho da nova venda", () => {
  it("uma linha por produto, com o preço sugerido mostrado", () => {
    const a = adicionarProduto([], xampu);
    expect(a.resultado).toBe("adicionado");
    expect(a.linhas[0]).toMatchObject({ productId: "p1", quantidade: "1", preco: "19,99", sugeridoCentavos: 1999 });
    const b = adicionarProduto(a.linhas, xampu);
    expect(b.resultado).toBe("ja-no-carrinho");
    expect(b.linhas).toHaveLength(1);
  });

  it("no máximo 50 linhas", () => {
    let linhas = Array.from({ length: MAXIMO_DE_ITENS }, (_, i) => novaLinha({ ...xampu, id: `p${i}` }));
    const r = adicionarProduto(linhas, { ...xampu, id: "outro" });
    expect(r.resultado).toBe("limite");
    linhas = removerLinha(linhas, "p0");
    expect(adicionarProduto(linhas, { ...xampu, id: "outro" }).resultado).toBe("adicionado");
  });

  it("prévia com a mesma conta da API (1,250 KG a R$ 45,90 = R$ 57,38)", () => {
    const linhas = alterarLinha(adicionarProduto(adicionarProduto([], xampu).linhas, cera).linhas, "p2", { quantidade: "1,25" });
    const r = avaliarCarrinho(linhas, false);
    expect(r.linhas.map((l) => l.totalCentavos)).toEqual([1999, 5738]);
    expect(r.totalCentavos).toBe(7737);
    expect(r.problema).toBeNull();
  });

  it("sem permissão de preço, o preço é o sugerido mesmo que o campo mude", () => {
    const linhas = alterarLinha([novaLinha(xampu)], "p1", { preco: "1,00" });
    const r = avaliarCarrinho(linhas, false);
    expect(r.linhas[0].precoCentavos).toBe(1999);
    expect(r.linhas[0].precoAlterado).toBe(false);
  });

  it("produto sem preço sugerido: só quem pode alterar o preço vende", () => {
    expect(avaliarCarrinho([novaLinha(semPreco)], false).linhas[0].erro).toMatch(/sem preço sugerido/);
    const comPreco = alterarLinha([novaLinha(semPreco)], "p3", { preco: "12,50" });
    const r = avaliarCarrinho(comPreco, true);
    expect(r.linhas[0]).toMatchObject({ precoCentavos: 1250, precoAlterado: true, erro: null });
    expect(avaliarCarrinho([novaLinha(semPreco)], true).linhas[0].erro).toBe("Informe o preço unitário.");
  });

  it("quem pode alterar o preço aplica outro valor, e a linha diz que mudou", () => {
    const r = avaliarCarrinho(alterarLinha([novaLinha(xampu)], "p1", { preco: "15" }), true);
    expect(r.linhas[0]).toMatchObject({ precoCentavos: 1500, precoAlterado: true, totalCentavos: 1500 });
    expect(avaliarCarrinho(alterarLinha([novaLinha(xampu)], "p1", { preco: "0" }), true).linhas[0].erro).toMatch(/maior que zero/);
  });

  it("quantidade segue as casas da unidade", () => {
    expect(avaliarCarrinho(alterarLinha([novaLinha(xampu)], "p1", { quantidade: "1,5" }), false).linhas[0].erro).toMatch(/não aceita casas/);
    expect(avaliarCarrinho(alterarLinha([novaLinha(cera)], "p2", { quantidade: "0,001" }), false).linhas[0].quantidadeMilli).toBe(1);
  });

  it("total zero não confirma (0,001 KG a R$ 0,01)", () => {
    const linha = alterarLinha([novaLinha({ ...cera, salePriceCents: 1 })], "p2", { quantidade: "0,001" });
    expect(avaliarCarrinho(linha, false).problema).toMatch(/pelo menos R\$ 0,01/);
  });

  it("carrinho vazio ou com erro não gera pedido", () => {
    expect(corpoDaVenda(avaliarCarrinho([], false), null, "k".repeat(32))).toBeNull();
    expect(corpoDaVenda(avaliarCarrinho([novaLinha(semPreco)], false), null, "k".repeat(32))).toBeNull();
  });

  it("o pedido leva o sugerido mostrado e o preço aplicado, nunca total nem linha", () => {
    const linhas = alterarLinha([novaLinha(xampu), novaLinha(semPreco)], "p3", { preco: "10" });
    const corpo = corpoDaVenda(avaliarCarrinho(linhas, true), "c1", "chave-0123456789abcdef");
    expect(corpo).toEqual({
      requestKey: "chave-0123456789abcdef",
      consumerId: "c1",
      items: [
        { productId: "p1", quantityMilli: 1000, expectedUnit: "UN", expectedSuggestedPriceCents: 1999, unitPriceCents: 1999 },
        { productId: "p3", quantityMilli: 1000, expectedUnit: "UN", expectedSuggestedPriceCents: null, unitPriceCents: 1000 },
      ],
    });
    expect(JSON.stringify(corpo)).not.toMatch(/total|lineTotal/i);
  });

  it("venda de balcão: consumerId nulo", () => {
    expect(corpoDaVenda(avaliarCarrinho([novaLinha(xampu)], false), null, "k".repeat(32))?.consumerId).toBeNull();
  });

  describe("recusas do servidor", () => {
    it("PRECO_ALTERADO: quem vende pelo sugerido passa ao preço atual", () => {
      const linhas = aplicarRecusa([novaLinha(xampu)], "PRECO_ALTERADO", [{ productId: "p1", salePriceCents: 2190 }], formatarQuantidade);
      expect(linhas[0]).toMatchObject({ sugeridoCentavos: 2190, preco: "21,90" });
      expect(linhas[0].aviso).toMatch(/R\$\s?21,90/);
    });

    it("PRECO_ALTERADO: o preço digitado por quem pode alterar fica", () => {
      const digitado = alterarLinha([novaLinha(xampu)], "p1", { preco: "15,00" });
      const linhas = aplicarRecusa(digitado, "PRECO_ALTERADO", [{ productId: "p1", salePriceCents: 2190 }], formatarQuantidade);
      expect(linhas[0]).toMatchObject({ sugeridoCentavos: 2190, preco: "15,00" });
    });

    it("SALDO_INSUFICIENTE: o saldo só aparece quando o servidor o mandou", () => {
      const sem = aplicarRecusa([novaLinha(xampu)], "SALDO_INSUFICIENTE", [{ productId: "p1" }], formatarQuantidade);
      expect(sem[0].aviso).toBe("Quantidade acima do disponível.");
      const com = aplicarRecusa([novaLinha(xampu)], "SALDO_INSUFICIENTE", [{ productId: "p1", balanceMilli: 2000 }], formatarQuantidade);
      expect(com[0].aviso).toMatch(/saldo: 2 UN/);
    });

    it("UNIDADE_ALTERADA: a linha passa à unidade atual", () => {
      const linhas = aplicarRecusa([novaLinha(xampu)], "UNIDADE_ALTERADA", [{ productId: "p1", unit: "CX" }], formatarQuantidade);
      expect(linhas[0].unidade).toBe("CX");
      expect(linhas[0].aviso).toMatch(/CX/);
    });

    it("alterar a linha limpa o aviso", () => {
      const linhas = aplicarRecusa([novaLinha(xampu)], "SALDO_INSUFICIENTE", [{ productId: "p1" }], formatarQuantidade);
      expect(alterarLinha(linhas, "p1", { quantidade: "2" })[0].aviso).toBeNull();
    });
  });
});
