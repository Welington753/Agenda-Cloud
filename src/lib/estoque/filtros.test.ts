import { describe, expect, it } from "vitest";
import { consultaDeMovimentacoes, consultaDeProdutos, FILTROS_INICIAIS, subcategoriaCompativel, trocarCategoria } from "./filtros";

const categorias = [
  { id: "cabelo", subcategories: [{ id: "pomadas" }, { id: "shampoos" }] },
  { id: "barba", subcategories: [{ id: "oleos" }] },
];

describe("filtros do estoque", () => {
  it("trocar a categoria limpa a subcategoria que não é dela e mantém a que é", () => {
    const atual = { ...FILTROS_INICIAIS, categoriaId: "cabelo", subcategoriaId: "pomadas" };
    expect(trocarCategoria(atual, "barba", categorias)).toMatchObject({ categoriaId: "barba", subcategoriaId: null });
    expect(trocarCategoria(atual, "cabelo", categorias)).toMatchObject({ subcategoriaId: "pomadas" });
    expect(trocarCategoria(atual, null, categorias)).toMatchObject({ categoriaId: null, subcategoriaId: null });
    expect(subcategoriaCompativel(categorias, "barba", "pomadas")).toBeNull();
  });

  it("monta a consulta de produtos sem subcategoria solta", () => {
    expect(consultaDeProdutos({ busca: " pomada ", categoriaId: "cabelo", subcategoriaId: "pomadas", situacao: "ACTIVE", soEstoqueBaixo: true })).toBe(
      "q=pomada&categoryId=cabelo&subcategoryId=pomadas&status=ACTIVE&low=true",
    );
    expect(consultaDeProdutos({ ...FILTROS_INICIAIS, subcategoriaId: "pomadas" }, "c1")).toBe("status=ACTIVE&cursor=c1");
  });

  it("monta a consulta de movimentações e ignora datas inválidas", () => {
    expect(consultaDeMovimentacoes({ produtoId: "p1", tipo: "SAIDA_VENDA", de: "2026-11-01", ate: "x" })).toBe(
      "productId=p1&kind=SAIDA_VENDA&from=2026-11-01",
    );
  });
});
