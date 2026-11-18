"use client";

// Detalhe da categoria escolhida: nome e contagens, editar e arquivar, as
// subcategorias (opcionais) e os produtos ativos dela, com o saldo. Escolher
// uma subcategoria na árvore filtra os produtos por ela.
import { useCallback } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Archive, Folder, FolderOpen, List, Package, Pencil, Plus, RotateCcw } from "lucide-react";
import { listarProdutos, type CategoriaEstoque, type ProdutoEstoque, type SubcategoriaEstoque } from "@/lib/api/estoque-api";
import { contar } from "@/lib/estoque/apresentacao";
import { consultaDeProdutos, FILTROS_INICIAIS } from "@/lib/estoque/filtros";
import { formatarQuantidade } from "@/lib/estoque/quantidade";
import { useListaPaginada } from "@/lib/estoque/use-lista-paginada";
import { ROTA_ESTOQUE_PRODUTOS } from "@/lib/conta/rotas";
import { Badge } from "@/components/ui/badge-base";
import { Botao } from "@/components/ui/button";
import { Cartao } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AvisoDeFalha, ErroDoFormulario, MenuDeAcoes, NotaInformativa, RotuloNoCelular, TABELA, type ItemDoMenu } from "@/components/estoque/comum";

export interface ErroDaCategoria {
  mensagem: string;
  comProdutos: boolean;
}

export function DetalheDaCategoria({
  tenantId,
  categoria,
  subcategoriaId,
  podeOperar,
  gravando,
  erro,
  aoEditar,
  aoMudarSituacao,
  aoNovaSubcategoria,
  aoRenomearSubcategoria,
  aoMudarSituacaoSub,
  aoEscolherSubcategoria,
}: {
  tenantId: string;
  categoria: CategoriaEstoque;
  subcategoriaId: string | null;
  podeOperar: boolean;
  gravando: boolean;
  erro: ErroDaCategoria | null;
  aoEditar: () => void;
  aoMudarSituacao: () => void;
  aoNovaSubcategoria: () => void;
  aoRenomearSubcategoria: (sub: SubcategoriaEstoque) => void;
  aoMudarSituacaoSub: (sub: SubcategoriaEstoque) => void;
  aoEscolherSubcategoria: (subId: string | null) => void;
}) {
  const filtroSub = categoria.subcategories.find((s) => s.id === subcategoriaId) ?? null;
  const categoriaId = categoria.id;
  const subId = filtroSub?.id ?? null;
  const consulta = consultaDeProdutos({ ...FILTROS_INICIAIS, categoriaId, subcategoriaId: subId });
  const buscar = useCallback(
    (cursor: string | null, signal: AbortSignal) =>
      listarProdutos(tenantId, consultaDeProdutos({ ...FILTROS_INICIAIS, categoriaId, subcategoriaId: subId }, cursor), signal),
    [tenantId, categoriaId, subId],
  );
  const { estado, recarregar, carregarMais } = useListaPaginada<ProdutoEstoque>(`${tenantId}?${consulta}`, buscar);

  const operavel = podeOperar && !categoria.archived;
  const itensDaCategoria: ItemDoMenu[] = [
    { rotulo: "Ver na lista de produtos", icone: List, href: `${ROTA_ESTOQUE_PRODUTOS}?categoria=${encodeURIComponent(categoria.id)}` },
  ];
  if (podeOperar) {
    itensDaCategoria.push(
      categoria.archived
        ? { rotulo: "Reativar categoria", icone: RotateCcw, aoEscolher: aoMudarSituacao, desabilitado: gravando }
        : { rotulo: "Arquivar categoria", icone: Archive, aoEscolher: aoMudarSituacao, desabilitado: gravando, perigo: true },
    );
  }

  return (
    <Cartao data-testid={`categoria-${categoria.id}`} className="min-w-0">
      <div className="flex flex-wrap items-start gap-3 border-b border-border p-4 sm:p-5">
        <FolderOpen size={36} strokeWidth={1.5} className="shrink-0 text-[color:var(--color-accent-hover)]" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-xl font-semibold tracking-tight text-ink">{categoria.name}</h2>
            {categoria.archived && <Badge>Arquivada</Badge>}
          </div>
          <p className="text-sm text-ink-soft">
            {contar(categoria.activeProducts, "produto", "produtos")} · {contar(categoria.subcategories.length, "subcategoria", "subcategorias")}
          </p>
        </div>
        <div className="flex items-center gap-2 max-sm:basis-full max-sm:justify-end">
          {operavel && (
            <Botao variante="secundaria" tamanho="sm" onClick={aoEditar} disabled={gravando}>
              <Pencil size={14} aria-hidden="true" /> Editar categoria
            </Botao>
          )}
          <MenuDeAcoes rotulo={`Mais ações de ${categoria.name}`} itens={itensDaCategoria} />
        </div>
      </div>

      <div className="space-y-6 p-4 sm:p-5">
        {erro && (
          <div className="space-y-1">
            <ErroDoFormulario mensagem={erro.mensagem} />
            {erro.comProdutos && (
              <Link className="text-sm font-medium text-[color:var(--color-accent-hover)] hover:underline" href={`${ROTA_ESTOQUE_PRODUTOS}?categoria=${encodeURIComponent(categoria.id)}`}>
                Ver os produtos desta categoria
              </Link>
            )}
          </div>
        )}

        <section className="space-y-3" aria-labelledby="titulo-subcategorias">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id="titulo-subcategorias" className="text-base font-semibold text-ink">
              Subcategorias
            </h3>
            {operavel && (
              <Botao tamanho="sm" onClick={aoNovaSubcategoria} disabled={gravando}>
                <Plus size={14} aria-hidden="true" /> Nova subcategoria
              </Botao>
            )}
          </div>
          <ul className="space-y-2" aria-label={`Subcategorias de ${categoria.name}`}>
            {categoria.subcategories.length === 0 && <li className="text-sm text-ink-soft">Sem subcategorias.</li>}
            {categoria.subcategories.map((sub) => {
              const itens: ItemDoMenu[] = [];
              if (operavel) {
                itens.push(
                  sub.archived
                    ? { rotulo: "Reativar subcategoria", icone: RotateCcw, aoEscolher: () => aoMudarSituacaoSub(sub), desabilitado: gravando }
                    : { rotulo: "Arquivar subcategoria", icone: Archive, aoEscolher: () => aoMudarSituacaoSub(sub), desabilitado: gravando, perigo: true },
                );
              }
              return (
                <li
                  key={sub.id}
                  data-testid={`subcategoria-${sub.id}`}
                  className={clsx(
                    "flex items-center gap-3 rounded-[var(--radius-control)] border px-3 py-2.5",
                    sub.id === filtroSub?.id ? "border-accent bg-accent-soft" : "border-border",
                  )}
                >
                  <Folder size={18} className="shrink-0 text-ink-soft" aria-hidden="true" />
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => aoEscolherSubcategoria(sub.id === filtroSub?.id ? null : sub.id)}>
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-semibold text-ink">{sub.name}</span>
                      {sub.archived && <Badge>Arquivada</Badge>}
                    </span>
                    <span className="block text-xs text-ink-soft">{contar(sub.activeProducts, "produto", "produtos")}</span>
                  </button>
                  {operavel && !sub.archived && (
                    <button
                      type="button"
                      aria-label={`Renomear ${sub.name}`}
                      onClick={() => aoRenomearSubcategoria(sub)}
                      disabled={gravando}
                      className="inline-flex size-9 items-center justify-center rounded-[var(--radius-control)] text-ink-soft hover:bg-paper-muted hover:text-ink disabled:opacity-50"
                    >
                      <Pencil size={16} aria-hidden="true" />
                    </button>
                  )}
                  <MenuDeAcoes rotulo={`Ações de ${sub.name}`} itens={itens} />
                </li>
              );
            })}
          </ul>
          <NotaInformativa destaque>O produto também pode ficar diretamente na categoria, sem subcategoria.</NotaInformativa>
        </section>

        <section className="space-y-3 border-t border-border pt-5" aria-labelledby="titulo-produtos-categoria">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id="titulo-produtos-categoria" className="text-base font-semibold text-ink">
              {filtroSub ? `Produtos de ${filtroSub.name}` : "Produtos desta categoria"}
            </h3>
            {filtroSub && (
              <Botao variante="fantasma" tamanho="sm" onClick={() => aoEscolherSubcategoria(null)}>
                Ver toda a categoria
              </Botao>
            )}
          </div>
          {estado.status === "carregando" && (
            <div className="space-y-2" aria-busy="true" aria-label="Carregando produtos da categoria">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          )}
          {estado.status === "falha" && <AvisoDeFalha falha={estado.falha} aoTentarDeNovo={() => void recarregar()} />}
          {estado.status === "carregada" && estado.itens.length === 0 && (
            <p className="flex items-center gap-2 text-sm text-ink-soft">
              <Package size={16} aria-hidden="true" /> Nenhum produto ativo aqui.
            </p>
          )}
          {estado.status === "carregada" && estado.itens.length > 0 && (
            <div className="overflow-hidden rounded-[var(--radius-control)] border border-border">
              <table className={TABELA.tabela} aria-label={filtroSub ? `Produtos de ${filtroSub.name}` : `Produtos de ${categoria.name}`}>
                <thead className={TABELA.cabecalho}>
                  <tr>
                    <th scope="col" className={TABELA.th}>Produto</th>
                    <th scope="col" className={TABELA.th}>Subcategoria</th>
                    <th scope="col" className={`${TABELA.th} text-right`}>Saldo</th>
                  </tr>
                </thead>
                <tbody className={TABELA.corpo}>
                  {estado.itens.map((p) => (
                    <tr key={p.id} className={TABELA.linha}>
                      <td className={clsx(TABELA.td, "min-w-0")}>
                        <p className="font-semibold text-ink">{p.name}</p>
                        {p.internalCode && <p className="text-xs text-ink-soft">{p.internalCode}</p>}
                      </td>
                      <td className={clsx(TABELA.td, "text-ink max-md:col-start-1 max-md:row-start-2")}>
                        <RotuloNoCelular>Subcategoria</RotuloNoCelular>
                        {p.subcategoryName ?? <span className="text-ink-soft">Sem subcategoria</span>}
                      </td>
                      <td className={clsx(TABELA.td, "text-right font-semibold text-ink tabular-nums max-md:col-start-2 max-md:row-start-1")}>
                        {formatarQuantidade(p.balanceMilli, p.unit)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {estado.proximo && (
                <div className="border-t border-border px-4 py-3">
                  <Botao variante="secundaria" tamanho="sm" onClick={() => void carregarMais()} disabled={estado.carregandoMais}>
                    {estado.carregandoMais ? "Carregando…" : "Carregar mais"}
                  </Botao>
                </div>
              )}
            </div>
          )}
        </section>

        <p className="text-sm text-ink-soft">Categorias organizam os produtos sem alterar seus saldos.</p>
      </div>
    </Cartao>
  );
}
