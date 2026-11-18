"use client";

// Árvore de categorias (um nível de subcategoria): busca, abrir e fechar cada
// categoria, contagem de produtos ativos e "Mostrar arquivadas". Escolher uma
// categoria ou subcategoria mostra o detalhe ao lado.
import { useState } from "react";
import clsx from "clsx";
import { ChevronDown, ChevronRight, Folder, FolderOpen, Search } from "lucide-react";
import type { CategoriaEstoque } from "@/lib/api/estoque-api";
import { filtrarCategorias } from "@/lib/estoque/apresentacao";
import { Cartao } from "@/components/ui/card";
import { CLASSE_CAMPO } from "@/components/estoque/comum";

export interface Selecao {
  categoriaId: string;
  subcategoriaId: string | null;
}

function Contagem({ n, ativo }: { n: number; ativo: boolean }) {
  return (
    <span
      className={clsx(
        "ml-auto inline-flex min-w-7 shrink-0 justify-center rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums",
        ativo ? "bg-card text-[color:var(--color-accent-hover)]" : "bg-paper-muted text-ink-soft",
      )}
    >
      {n}
    </span>
  );
}

export function ArvoreDeCategorias({
  categorias,
  selecao,
  mostrarArquivadas,
  aoMostrarArquivadas,
  aoEscolher,
}: {
  categorias: readonly CategoriaEstoque[];
  selecao: Selecao | null;
  mostrarArquivadas: boolean;
  aoMostrarArquivadas: (v: boolean) => void;
  aoEscolher: (s: Selecao) => void;
}) {
  const [busca, setBusca] = useState("");
  const [fechadas, setFechadas] = useState<ReadonlySet<string>>(new Set());
  const visiveis = filtrarCategorias(categorias, busca, mostrarArquivadas);
  const buscando = busca.trim().length > 0;

  const alternar = (id: string) =>
    setFechadas((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });

  return (
    <Cartao className="flex flex-col">
      <div className="space-y-3 p-4">
        <h2 className="text-lg font-semibold text-ink">Categorias</h2>
        <div className="relative">
          <label htmlFor="busca-categoria" className="sr-only">
            Buscar categoria
          </label>
          <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-soft" aria-hidden="true" />
          <input id="busca-categoria" type="search" className={`${CLASSE_CAMPO} pl-10`} placeholder="Buscar categoria" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
      </div>

      <div className="flex-1 px-2 pb-2">
        {visiveis.length === 0 ? (
          <p className="px-2 py-3 text-sm text-ink-soft">{buscando ? "Nenhuma categoria encontrada." : "Nenhuma categoria para mostrar."}</p>
        ) : (
          <ul aria-label="Árvore de categorias" className="space-y-0.5">
            {visiveis.map((categoria) => {
              const aberta = buscando || !fechadas.has(categoria.id);
              const escolhida = selecao?.categoriaId === categoria.id && selecao.subcategoriaId === null;
              const temSubs = categoria.subcategories.length > 0;
              return (
                <li key={categoria.id}>
                  <div className={clsx("flex items-center rounded-[var(--radius-control)]", escolhida ? "bg-accent-soft" : "hover:bg-paper-muted")}>
                    <button
                      type="button"
                      onClick={() => alternar(categoria.id)}
                      disabled={!temSubs}
                      aria-expanded={temSubs ? aberta : undefined}
                      aria-label={aberta ? `Fechar ${categoria.name}` : `Abrir ${categoria.name}`}
                      className="inline-flex size-9 shrink-0 items-center justify-center text-ink-soft disabled:invisible"
                    >
                      {aberta ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => aoEscolher({ categoriaId: categoria.id, subcategoriaId: null })}
                      aria-current={escolhida ? "true" : undefined}
                      data-testid={`arvore-categoria-${categoria.id}`}
                      className="flex min-h-10 min-w-0 flex-1 items-center gap-2 pr-2 text-left"
                    >
                      {escolhida ? (
                        <FolderOpen size={18} className="shrink-0 text-[color:var(--color-accent-hover)]" aria-hidden="true" />
                      ) : (
                        <Folder size={18} className="shrink-0 text-ink-soft" aria-hidden="true" />
                      )}
                      <span className={clsx("truncate text-sm font-semibold", categoria.archived ? "text-ink-soft line-through" : "text-ink")}>{categoria.name}</span>
                      <Contagem n={categoria.activeProducts} ativo={escolhida} />
                    </button>
                  </div>
                  {temSubs && aberta && (
                    <ul className="ml-[1.1rem] border-l border-border pl-3">
                      {categoria.subcategories.map((sub) => {
                        const subEscolhida = selecao?.subcategoriaId === sub.id;
                        return (
                          <li key={sub.id}>
                            <button
                              type="button"
                              onClick={() => aoEscolher({ categoriaId: categoria.id, subcategoriaId: sub.id })}
                              aria-current={subEscolhida ? "true" : undefined}
                              className={clsx(
                                "flex min-h-9 w-full min-w-0 items-center gap-2 rounded-[var(--radius-control)] px-2 text-left",
                                subEscolhida ? "bg-accent-soft" : "hover:bg-paper-muted",
                              )}
                            >
                              <Folder size={16} className="shrink-0 text-ink-soft" aria-hidden="true" />
                              <span className={clsx("truncate text-sm", sub.archived ? "text-ink-soft line-through" : "text-ink")}>{sub.name}</span>
                              <Contagem n={sub.activeProducts} ativo={subEscolhida} />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <label className="flex min-h-12 items-center gap-2 border-t border-border px-4 text-sm text-ink">
        <input type="checkbox" className="size-4" checked={mostrarArquivadas} onChange={(e) => aoMostrarArquivadas(e.target.checked)} />
        Mostrar arquivadas
      </label>
    </Cartao>
  );
}
