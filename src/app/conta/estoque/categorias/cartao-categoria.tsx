"use client";

// Uma categoria com as subcategorias dela: renomear, arquivar e reativar, e
// criar subcategoria. Categoria com produto ativo não arquiva (a API recusa
// com a contagem, e a tela oferece ver esses produtos).
import { useState } from "react";
import Link from "next/link";
import { Archive, FolderOpen, Pencil, Plus, RotateCcw } from "lucide-react";
import type { CategoriaEstoque, ResultadoEstoque, SubcategoriaEstoque } from "@/lib/api/estoque-api";
import { mensagemDaFalha } from "@/lib/estoque/mensagens";
import { ROTA_ESTOQUE_PRODUTOS } from "@/lib/conta/rotas";
import { Badge } from "@/components/ui/badge-base";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { CLASSE_CAMPO, ErroDoFormulario } from "@/components/estoque/comum";

type Gravar = (acao: () => Promise<ResultadoEstoque<CategoriaEstoque>>) => Promise<boolean | string>;

export interface AcoesDaCategoria {
  renomear: (id: string, nome: string) => Promise<ResultadoEstoque<CategoriaEstoque>>;
  situacao: (id: string, acao: "archive" | "reactivate") => Promise<ResultadoEstoque<CategoriaEstoque>>;
  criarSub: (categoriaId: string, nome: string) => Promise<ResultadoEstoque<CategoriaEstoque>>;
  renomearSub: (id: string, nome: string) => Promise<ResultadoEstoque<CategoriaEstoque>>;
  situacaoSub: (id: string, acao: "archive" | "reactivate") => Promise<ResultadoEstoque<CategoriaEstoque>>;
}

function NomeEditavel({ inicial, rotulo, aoSalvar, aoCancelar, gravando }: { inicial: string; rotulo: string; aoSalvar: (n: string) => void; aoCancelar: () => void; gravando: boolean }) {
  const [nome, setNome] = useState(inicial);
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (nome.trim()) aoSalvar(nome.trim());
      }}
    >
      <input aria-label={rotulo} className={`${CLASSE_CAMPO} max-w-xs`} value={nome} maxLength={60} onChange={(e) => setNome(e.target.value)} autoFocus />
      <Botao type="submit" tamanho="sm" disabled={gravando || !nome.trim()}>
        Salvar
      </Botao>
      <Botao type="button" tamanho="sm" variante="fantasma" onClick={aoCancelar} disabled={gravando}>
        Cancelar
      </Botao>
    </form>
  );
}

export function CartaoCategoria({ categoria, podeOperar, acoes, gravando, gravar }: { categoria: CategoriaEstoque; podeOperar: boolean; acoes: AcoesDaCategoria; gravando: boolean; gravar: Gravar }) {
  const [editando, setEditando] = useState<string | null>(null);
  const [novaSub, setNovaSub] = useState(false);
  const [erro, setErro] = useState<{ mensagem: string; comProdutos: boolean } | null>(null);

  async function executar(acao: () => Promise<ResultadoEstoque<CategoriaEstoque>>) {
    setErro(null);
    const r = await gravar(async () => {
      const resultado = await acao();
      if (!resultado.ok) {
        const comProdutos = resultado.falha.tipo === "conflito" && resultado.falha.code === "CATEGORIA_COM_PRODUTOS";
        setErro({ mensagem: mensagemDaFalha(resultado.falha), comProdutos });
      }
      return resultado;
    });
    if (r === true) {
      setEditando(null);
      setNovaSub(false);
    }
  }

  const situacao = (sub: SubcategoriaEstoque | null) => {
    const arquivada = sub ? sub.archived : categoria.archived;
    const acao = arquivada ? "reactivate" : "archive";
    return () => void executar(() => (sub ? acoes.situacaoSub(sub.id, acao) : acoes.situacao(categoria.id, acao)));
  };

  return (
    <Cartao data-testid={`categoria-${categoria.id}`}>
      <CartaoCorpo className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {editando === categoria.id ? (
            <NomeEditavel inicial={categoria.name} rotulo="Nome da categoria" gravando={gravando} aoCancelar={() => setEditando(null)} aoSalvar={(n) => void executar(() => acoes.renomear(categoria.id, n))} />
          ) : (
            <div className="flex min-w-0 items-center gap-2">
              <FolderOpen size={18} className="shrink-0 text-ink-soft" aria-hidden="true" />
              <h2 className="truncate font-semibold text-ink">{categoria.name}</h2>
              {categoria.archived && <Badge>Arquivada</Badge>}
              <span className="text-xs text-ink-soft">
                {categoria.activeProducts === 1 ? "1 produto ativo" : `${categoria.activeProducts} produtos ativos`}
              </span>
            </div>
          )}
          {podeOperar && editando !== categoria.id && (
            <div className="flex flex-wrap gap-1">
              {!categoria.archived && (
                <Botao variante="fantasma" tamanho="sm" onClick={() => setEditando(categoria.id)} disabled={gravando}>
                  <Pencil size={14} aria-hidden="true" /> Renomear
                </Botao>
              )}
              <Botao variante="fantasma" tamanho="sm" onClick={situacao(null)} disabled={gravando}>
                {categoria.archived ? <RotateCcw size={14} aria-hidden="true" /> : <Archive size={14} aria-hidden="true" />}
                {categoria.archived ? "Reativar" : "Arquivar"}
              </Botao>
            </div>
          )}
        </div>

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

        <ul className="space-y-1 border-l border-border pl-4" aria-label={`Subcategorias de ${categoria.name}`}>
          {categoria.subcategories.length === 0 && <li className="text-sm text-ink-soft">Sem subcategorias.</li>}
          {categoria.subcategories.map((sub) => (
            <li key={sub.id} className="flex flex-wrap items-center justify-between gap-2 py-1">
              {editando === sub.id ? (
                <NomeEditavel inicial={sub.name} rotulo="Nome da subcategoria" gravando={gravando} aoCancelar={() => setEditando(null)} aoSalvar={(n) => void executar(() => acoes.renomearSub(sub.id, n))} />
              ) : (
                <span className="flex items-center gap-2 text-sm text-ink">
                  {sub.name}
                  {sub.archived && <Badge>Arquivada</Badge>}
                  <span className="text-xs text-ink-soft">{sub.activeProducts} ativos</span>
                </span>
              )}
              {podeOperar && editando !== sub.id && !categoria.archived && (
                <span className="flex gap-1">
                  {!sub.archived && (
                    <Botao variante="fantasma" tamanho="sm" onClick={() => setEditando(sub.id)} disabled={gravando}>
                      Renomear
                    </Botao>
                  )}
                  <Botao variante="fantasma" tamanho="sm" onClick={situacao(sub)} disabled={gravando}>
                    {sub.archived ? "Reativar" : "Arquivar"}
                  </Botao>
                </span>
              )}
            </li>
          ))}
        </ul>

        {podeOperar && !categoria.archived &&
          (novaSub ? (
            <NomeEditavel inicial="" rotulo="Nome da nova subcategoria" gravando={gravando} aoCancelar={() => setNovaSub(false)} aoSalvar={(n) => void executar(() => acoes.criarSub(categoria.id, n))} />
          ) : (
            <Botao variante="secundaria" tamanho="sm" onClick={() => setNovaSub(true)} disabled={gravando}>
              <Plus size={14} aria-hidden="true" /> Nova subcategoria
            </Botao>
          ))}
      </CartaoCorpo>
    </Cartao>
  );
}
