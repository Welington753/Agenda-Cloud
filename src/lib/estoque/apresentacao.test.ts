import { describe, expect, it } from "vitest";
import {
  caminhoDaCategoria,
  contar,
  corDaDiferenca,
  corDoTipo,
  detalheDoProduto,
  filtrarCategorias,
  resumoDaRevisao,
  resumoDeProdutos,
  saldoDepoisDaMovimentacao,
  situacaoVisual,
} from "./apresentacao";

describe("apresentação do estoque", () => {
  it("situação: arquivado vence estoque baixo", () => {
    expect(situacaoVisual({ archived: true, low: true })).toBe("arquivado");
    expect(situacaoVisual({ archived: false, low: true })).toBe("baixo");
    expect(situacaoVisual({ archived: false, low: false })).toBe("regular");
  });

  it("caminho e detalhe do produto", () => {
    expect(caminhoDaCategoria({ categoryName: "Cabelos", subcategoryName: "Finalizadores" })).toBe("Cabelos / Finalizadores");
    expect(caminhoDaCategoria({ categoryName: "Descartáveis", subcategoryName: null })).toBe("Descartáveis");
    expect(detalheDoProduto({ internalCode: "CAB-001", categoryName: "Cabelos", subcategoryName: "Finalizadores" })).toBe("CAB-001 · Cabelos / Finalizadores");
    expect(detalheDoProduto({ internalCode: null, categoryName: "Descartáveis", subcategoryName: null })).toBe("Descartáveis");
  });

  it("resumo conta só os ativos", () => {
    expect(
      resumoDeProdutos([
        { archived: false, low: true },
        { archived: false, low: false },
        { archived: true, low: true },
      ]),
    ).toEqual({ ativos: 2, baixo: 1 });
  });

  it("contar no singular e no plural", () => {
    expect(contar(1, "produto", "produtos")).toBe("1 produto");
    expect(contar(0, "produto", "produtos")).toBe("0 produtos");
  });

  it("cor da diferença e resumo da revisão", () => {
    expect(corDaDiferenca(-2000)).toBe("aviso");
    expect(corDaDiferenca(0)).toBe("neutro");
    expect(corDaDiferenca(200)).toBe("sucesso");
    expect(resumoDaRevisao([{ diferencaMilli: -1 }, { diferencaMilli: 0 }, { diferencaMilli: 5 }])).toEqual({ contados: 3, comDiferenca: 2, semDiferenca: 1 });
  });

  it("cor do tipo de movimentação", () => {
    expect(corDoTipo("ENTRADA_COMPRA")).toBe("sucesso");
    expect(corDoTipo("SAIDA_PERDA")).toBe("erro");
    expect(corDoTipo("SAIDA_VENDA")).toBe("neutro");
    expect(corDoTipo("AJUSTE_CONFERENCIA")).toBe("info");
  });

  describe("filtro da árvore de categorias", () => {
    const categorias = [
      { id: "c1", name: "Cabelos", archived: false, subcategories: [{ name: "Finalizadores", archived: false }, { name: "Antigos", archived: true }] },
      { id: "c2", name: "Barba", archived: false, subcategories: [{ name: "Cuidados", archived: false }] },
      { id: "c3", name: "Velha", archived: true, subcategories: [] },
    ];

    it("sem busca: esconde arquivadas, a menos que peça", () => {
      expect(filtrarCategorias(categorias, "", false).map((c) => [c.name, c.subcategories.length])).toEqual([
        ["Cabelos", 1],
        ["Barba", 1],
      ]);
      expect(filtrarCategorias(categorias, "", true)).toHaveLength(3);
    });

    it("busca pelo nome da categoria mostra todas as subcategorias dela", () => {
      expect(filtrarCategorias(categorias, "cabe", false).map((c) => c.subcategories.map((s) => s.name))).toEqual([["Finalizadores"]]);
    });

    it("busca pela subcategoria mostra só as que casam, sem diferenciar acento", () => {
      const r = filtrarCategorias(categorias, "CUIDADOS", false);
      expect(r.map((c) => c.name)).toEqual(["Barba"]);
      expect(filtrarCategorias([{ name: "Descartáveis", archived: false, subcategories: [] }], "descartaveis", false)).toHaveLength(1);
    });
  });

  it("prévia do saldo: entrada soma, saídas subtraem", () => {
    expect(saldoDepoisDaMovimentacao("ENTRADA_COMPRA", 10_000, 5_000)).toBe(15_000);
    expect(saldoDepoisDaMovimentacao("SAIDA_VENDA", 10_000, 3_000)).toBe(7_000);
    expect(saldoDepoisDaMovimentacao("SAIDA_PERDA", 2_000, 3_000)).toBe(-1_000);
  });
});
