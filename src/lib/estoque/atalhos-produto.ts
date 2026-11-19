// Atalhos do formulário de produto.
//
// "Duplicar cadastro": o que um produto novo herda de outro. Só dados de
// cadastro; código interno e saldo inicial ficam vazios, e nada de id,
// saldo, versão ou histórico passa para a cópia. Categoria ou subcategoria
// arquivada não é herdada: a API recusaria, então a pessoa escolhe outra.
import type { CategoriaEstoque, ProdutoEstoque } from "@/lib/api/estoque-api";
import type { UnidadeEstoque } from "./quantidade";
import type { FinalidadeEstoque } from "./rotulos";

export interface ModeloDeProduto {
  name: string;
  description: string | null;
  categoryId: string;
  subcategoryId: string;
  purpose: FinalidadeEstoque;
  unit: UnidadeEstoque;
  minQuantityMilli: number;
}

export function modeloDaCopia(produto: ProdutoEstoque, categorias: readonly CategoriaEstoque[]): ModeloDeProduto {
  const categoria = categorias.find((c) => c.id === produto.categoryId && !c.archived);
  const sub = categoria?.subcategories.find((s) => s.id === produto.subcategoryId && !s.archived);
  return {
    name: produto.name,
    description: produto.description,
    categoryId: categoria?.id ?? "",
    subcategoryId: sub?.id ?? "",
    purpose: produto.purpose,
    unit: produto.unit,
    minQuantityMilli: produto.minQuantityMilli,
  };
}

/**
 * Subcategoria que acabou de ser criada: a API devolve a categoria inteira,
 * então é a que não existia antes (ou, se a lista anterior faltar, a de
 * mesmo nome). Nunca devolve subcategoria de outra categoria.
 */
export function subcategoriaCriada(antes: CategoriaEstoque | undefined, depois: CategoriaEstoque, nome: string): string | null {
  if (antes) {
    const conhecidas = new Set(antes.subcategories.map((s) => s.id));
    const nova = depois.subcategories.find((s) => !conhecidas.has(s.id) && s.categoryId === depois.id);
    if (nova) return nova.id;
  }
  const alvo = nome.trim().toLocaleLowerCase("pt-BR");
  return depois.subcategories.find((s) => s.categoryId === depois.id && s.name.trim().toLocaleLowerCase("pt-BR") === alvo)?.id ?? null;
}
