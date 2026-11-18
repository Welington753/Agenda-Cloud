// Filtros das listas do estoque: a subcategoria sempre pertence à categoria
// escolhida (trocar a categoria limpa a subcategoria que não é dela), e a
// busca vira a consulta que a API espera.

export interface CategoriaParaFiltro {
  id: string;
  subcategories: readonly { id: string }[];
}

export interface FiltrosDeProduto {
  busca: string;
  categoriaId: string | null;
  subcategoriaId: string | null;
  situacao: "ACTIVE" | "ARCHIVED" | "ALL";
  soEstoqueBaixo: boolean;
}

export const FILTROS_INICIAIS: FiltrosDeProduto = {
  busca: "",
  categoriaId: null,
  subcategoriaId: null,
  situacao: "ACTIVE",
  soEstoqueBaixo: false,
};

/** Subcategoria compatível com a categoria (ou `null`). */
export function subcategoriaCompativel(
  categorias: readonly CategoriaParaFiltro[],
  categoriaId: string | null,
  subcategoriaId: string | null,
): string | null {
  if (!categoriaId || !subcategoriaId) return null;
  const categoria = categorias.find((c) => c.id === categoriaId);
  return categoria?.subcategories.some((s) => s.id === subcategoriaId) ? subcategoriaId : null;
}

/** Troca a categoria e limpa a subcategoria que não é dela. */
export function trocarCategoria<T extends { categoriaId: string | null; subcategoriaId: string | null }>(
  atual: T,
  categoriaId: string | null,
  categorias: readonly CategoriaParaFiltro[],
): T {
  return { ...atual, categoriaId, subcategoriaId: subcategoriaCompativel(categorias, categoriaId, atual.subcategoriaId) };
}

export function consultaDeProdutos(filtros: FiltrosDeProduto, cursor?: string | null): string {
  const p = new URLSearchParams();
  const busca = filtros.busca.trim();
  if (busca) p.set("q", busca.slice(0, 80));
  if (filtros.categoriaId) p.set("categoryId", filtros.categoriaId);
  if (filtros.categoriaId && filtros.subcategoriaId) p.set("subcategoryId", filtros.subcategoriaId);
  p.set("status", filtros.situacao);
  if (filtros.soEstoqueBaixo) p.set("low", "true");
  if (cursor) p.set("cursor", cursor);
  return p.toString();
}

export interface FiltrosDeMovimentacao {
  produtoId: string | null;
  tipo: string | null;
  de: string;
  ate: string;
}

export function consultaDeMovimentacoes(filtros: FiltrosDeMovimentacao, cursor?: string | null): string {
  const p = new URLSearchParams();
  if (filtros.produtoId) p.set("productId", filtros.produtoId);
  if (filtros.tipo) p.set("kind", filtros.tipo);
  if (/^\d{4}-\d{2}-\d{2}$/.test(filtros.de)) p.set("from", filtros.de);
  if (/^\d{4}-\d{2}-\d{2}$/.test(filtros.ate)) p.set("to", filtros.ate);
  if (cursor) p.set("cursor", cursor);
  return p.toString();
}
