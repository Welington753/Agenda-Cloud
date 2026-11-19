import { describe, expect, it } from "vitest";
import type { CategoriaEstoque, ProdutoEstoque } from "@/lib/api/estoque-api";
import { modeloDaCopia, subcategoriaCriada } from "./atalhos-produto";

function categoria(id: string, subs: { id: string; name: string; archived?: boolean }[], archived = false): CategoriaEstoque {
  return {
    id,
    name: id,
    archived,
    createdAt: "",
    updatedAt: "",
    activeProducts: 0,
    subcategories: subs.map((s) => ({ categoryId: id, activeProducts: 0, archived: false, ...s })),
  };
}

const produto: ProdutoEstoque = {
  id: "p1",
  name: "Pomada",
  description: "Fixação forte",
  internalCode: "POM-1",
  categoryId: "cabelo",
  categoryName: "Cabelo",
  subcategoryId: "pomadas",
  subcategoryName: "Pomadas",
  purpose: "VENDA",
  unit: "FR",
  minQuantityMilli: 2000,
  balanceMilli: 9000,
  balanceVersion: 3,
  low: false,
  archived: false,
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-02T00:00:00Z",
};

describe("atalhos do formulário de produto", () => {
  it("a cópia leva só dados de cadastro, sem código, saldo, id ou versão", () => {
    const modelo = modeloDaCopia(produto, [categoria("cabelo", [{ id: "pomadas", name: "Pomadas" }])]);
    expect(modelo).toEqual({
      name: "Pomada",
      description: "Fixação forte",
      categoryId: "cabelo",
      subcategoryId: "pomadas",
      purpose: "VENDA",
      unit: "FR",
      minQuantityMilli: 2000,
    });
  });

  it("não herda categoria ou subcategoria arquivada", () => {
    expect(modeloDaCopia(produto, [categoria("cabelo", [{ id: "pomadas", name: "Pomadas", archived: true }])])).toMatchObject({
      categoryId: "cabelo",
      subcategoryId: "",
    });
    expect(modeloDaCopia(produto, [categoria("cabelo", [{ id: "pomadas", name: "Pomadas" }], true)])).toMatchObject({ categoryId: "", subcategoryId: "" });
    expect(modeloDaCopia(produto, [])).toMatchObject({ categoryId: "", subcategoryId: "" });
  });

  it("acha a subcategoria criada pela diferença, ou pelo nome sem a lista anterior", () => {
    const antes = categoria("cabelo", [{ id: "pomadas", name: "Pomadas" }]);
    const depois = categoria("cabelo", [
      { id: "pomadas", name: "Pomadas" },
      { id: "ceras", name: "Ceras" },
    ]);
    expect(subcategoriaCriada(antes, depois, "Ceras")).toBe("ceras");
    expect(subcategoriaCriada(undefined, depois, " ceras ")).toBe("ceras");
    expect(subcategoriaCriada(depois, depois, "Outra")).toBeNull();
  });
});
