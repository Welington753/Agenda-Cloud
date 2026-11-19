// Regras de apresentação das telas do estoque: situação de cada produto,
// resumos dos cartões, cor da diferença da conferência e o filtro da árvore
// de categorias. Só mostram o que a API devolveu; nenhuma decide acesso.
import type { FiltrosDeProduto } from "./filtros";
import type { TipoMovimentacao } from "./rotulos";

export type SituacaoVisual = "arquivado" | "baixo" | "regular";

export const ROTULO_SITUACAO: Record<SituacaoVisual, string> = {
  arquivado: "Arquivado",
  baixo: "Estoque baixo",
  regular: "Regular",
};

/** Arquivado vence estoque baixo (produto arquivado não recebe movimentação). */
export function situacaoVisual(produto: { archived: boolean; low: boolean }): SituacaoVisual {
  if (produto.archived) return "arquivado";
  return produto.low ? "baixo" : "regular";
}

/** "Cabelos / Finalizadores", ou só a categoria quando não há subcategoria. */
export function caminhoDaCategoria(produto: { categoryName: string; subcategoryName: string | null }): string {
  return produto.subcategoryName ? `${produto.categoryName} / ${produto.subcategoryName}` : produto.categoryName;
}

/** Linha de apoio do produto: código interno (se houver) e categoria. */
export function detalheDoProduto(produto: { internalCode: string | null; categoryName: string; subcategoryName: string | null }): string {
  return [produto.internalCode, caminhoDaCategoria(produto)].filter(Boolean).join(" · ");
}

/** Números dos cartões de Produtos: ativos e, deles, os com estoque baixo. */
export function resumoDeProdutos(produtos: readonly { archived: boolean; low: boolean }[]): { ativos: number; baixo: number } {
  const ativos = produtos.filter((p) => !p.archived);
  return { ativos: ativos.length, baixo: ativos.filter((p) => p.low).length };
}

export function contar(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/** Diferença da conferência: falta em aviso, sobra em sucesso, zero neutro. */
export function corDaDiferenca(diferencaMilli: number): "aviso" | "sucesso" | "neutro" {
  if (diferencaMilli < 0) return "aviso";
  return diferencaMilli > 0 ? "sucesso" : "neutro";
}

/** Resumo da revisão: contados, com diferença (viram ajuste) e sem diferença. */
export function resumoDaRevisao(linhas: readonly { diferencaMilli: number }[]): { contados: number; comDiferenca: number; semDiferenca: number } {
  const comDiferenca = linhas.filter((l) => l.diferencaMilli !== 0).length;
  return { contados: linhas.length, comDiferenca, semDiferenca: linhas.length - comDiferenca };
}

/** Cor da etiqueta do tipo de movimentação. */
export function corDoTipo(tipo: TipoMovimentacao): "sucesso" | "neutro" | "erro" | "info" | "destaque" {
  switch (tipo) {
    case "ENTRADA_COMPRA":
      return "sucesso";
    case "SAIDA_PERDA":
      return "erro";
    case "AJUSTE_CONFERENCIA":
      return "info";
    case "SALDO_INICIAL":
      return "destaque";
    default:
      return "neutro";
  }
}

interface CategoriaDaArvore<S extends { name: string; archived: boolean }> {
  name: string;
  archived: boolean;
  subcategories: readonly S[];
}

const normalizar = (texto: string) =>
  texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

/**
 * Árvore de categorias filtrada pela busca e pela opção "Mostrar arquivadas".
 * A categoria cujo nome casa com a busca aparece com todas as subcategorias;
 * senão, aparece só se alguma subcategoria casar, e só com essas.
 */
export function filtrarCategorias<S extends { name: string; archived: boolean }, C extends CategoriaDaArvore<S>>(
  categorias: readonly C[],
  busca: string,
  mostrarArquivadas: boolean,
): C[] {
  const termo = normalizar(busca);
  const resultado: C[] = [];
  for (const categoria of categorias) {
    if (!mostrarArquivadas && categoria.archived) continue;
    const subs = categoria.subcategories.filter((s) => mostrarArquivadas || !s.archived);
    if (!termo || normalizar(categoria.name).includes(termo)) {
      resultado.push({ ...categoria, subcategories: subs });
      continue;
    }
    const casadas = subs.filter((s) => normalizar(s.name).includes(termo));
    if (casadas.length > 0) resultado.push({ ...categoria, subcategories: casadas });
  }
  return resultado;
}

/** Prévia do saldo no formulário de movimentação manual: entrada soma, as
 * saídas subtraem. Negativo indica que a API vai recusar (saldo insuficiente). */
export function saldoDepoisDaMovimentacao(tipo: TipoMovimentacao, saldoMilli: number, quantidadeMilli: number): number {
  return tipo === "ENTRADA_COMPRA" ? saldoMilli + quantidadeMilli : saldoMilli - quantidadeMilli;
}

export interface ListaVaziaDeProdutos {
  titulo: string;
  descricao: string;
  /** Mostra "Cadastrar primeiro produto" (só para quem opera o estoque). */
  primeiroCadastro: boolean;
}

/**
 * Lista de produtos vazia. Sem filtro nenhum na aba Ativos, ainda não há
 * produto: quem opera recebe a orientação e "Cadastrar primeiro produto"
 * (a categoria pode nascer dentro do formulário, então nada depende de já
 * existir categoria). Com filtro ou na aba Arquivados, só o motivo.
 */
export function listaVaziaDeProdutos(filtros: FiltrosDeProduto, podeOperar: boolean): ListaVaziaDeProdutos {
  const semFiltro = !filtros.busca.trim() && !filtros.categoriaId && !filtros.soEstoqueBaixo;
  if (semFiltro && filtros.situacao === "ACTIVE") {
    return podeOperar
      ? { titulo: "Nenhum produto cadastrado", descricao: "Cadastre o primeiro produto. Se ainda não houver categoria, crie no próprio cadastro.", primeiroCadastro: true }
      : { titulo: "Nenhum produto cadastrado", descricao: "Os produtos do estoque aparecem aqui.", primeiroCadastro: false };
  }
  if (semFiltro && filtros.situacao === "ARCHIVED") return { titulo: "Nenhum produto arquivado", descricao: "Produtos arquivados aparecem aqui.", primeiroCadastro: false };
  return { titulo: "Nenhum produto encontrado", descricao: "Ajuste a busca ou os filtros.", primeiroCadastro: false };
}
