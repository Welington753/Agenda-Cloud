"use client";

// Produtos do estoque: busca, filtros por categoria, subcategoria, situação e
// estoque baixo; saldo atual; cadastro e edição num painel. Quem só consulta
// (gerente com "Ver estoque") não vê os botões, e a API recusa do mesmo jeito.
import { useCallback, useEffect, useRef, useState } from "react";
import { Package, Plus, Search } from "lucide-react";
import {
  criarProduto,
  editarProduto,
  listarProdutos,
  novaChaveDeEnvio,
  situacaoDoProduto,
  type ProdutoEstoque,
} from "@/lib/api/estoque-api";
import { consultaDeProdutos, FILTROS_INICIAIS, trocarCategoria, type FiltrosDeProduto } from "@/lib/estoque/filtros";
import { mensagemDaFalha } from "@/lib/estoque/mensagens";
import { useCategorias } from "@/lib/estoque/use-categorias";
import { useContextoEstoque } from "@/lib/estoque/use-contexto-estoque";
import { useListaPaginada } from "@/lib/estoque/use-lista-paginada";
import { Botao } from "@/components/ui/button";
import { EstadoVazio } from "@/components/ui/empty-state";
import { PainelLateral } from "@/components/ui/painel-lateral";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { PaginaConta } from "@/components/conta/pagina-conta";
import { AvisoDeFalha, CLASSE_CAMPO, SemEstabelecimento } from "@/components/estoque/comum";
import { FormularioProduto, type EnvioDoProduto } from "./formulario-produto";
import { LinhaProduto } from "./linha-produto";

const TITULO = "Produtos";
type Edicao = { modo: "fechado" } | { modo: "novo"; chave: string } | { modo: "editar"; produto: ProdutoEstoque };

export default function ProdutosDoEstoquePage() {
  const ctx = useContextoEstoque();
  const { notificar } = useToast();
  const { estado: categorias } = useCategorias(ctx.tenantId);
  const [filtros, setFiltros] = useState<FiltrosDeProduto>(FILTROS_INICIAIS);
  const [busca, setBusca] = useState("");
  const [edicao, setEdicao] = useState<Edicao>({ modo: "fechado" });
  const [erro, setErro] = useState<string | null>(null);
  const [gravando, setGravando] = useState(false);
  const travado = useRef(false);

  // Filtro vindo de Categorias ("Ver os produtos desta categoria").
  useEffect(() => {
    const categoria = new URLSearchParams(window.location.search).get("categoria");
    if (categoria) setFiltros((f) => ({ ...f, categoriaId: categoria, situacao: "ACTIVE" }));
  }, []);

  useEffect(() => {
    setEdicao({ modo: "fechado" });
    setErro(null);
  }, [ctx.tenantId]);

  const consulta = consultaDeProdutos(filtros);
  const tenantId = ctx.tenantId;
  const buscar = useCallback(
    (cursor: string | null, signal: AbortSignal) => listarProdutos(tenantId!, consultaDeProdutos(filtros, cursor), signal),
    [tenantId, filtros],
  );
  const { estado, recarregar, carregarMais, substituir } = useListaPaginada<ProdutoEstoque>(tenantId ? `${tenantId}?${consulta}` : null, buscar);

  if (!ctx.pronto) return null;
  if (!tenantId) return <SemEstabelecimento titulo={TITULO} />;
  const listaDeCategorias = categorias.status === "carregada" ? categorias.categorias : [];
  const subcategorias = listaDeCategorias.find((c) => c.id === filtros.categoriaId)?.subcategories ?? [];

  async function comTrava(acao: () => Promise<void>) {
    if (travado.current) return;
    travado.current = true;
    setGravando(true);
    try {
      await acao();
    } finally {
      travado.current = false;
      setGravando(false);
    }
  }

  function aoSalvar({ dados, initialQuantityMilli }: EnvioDoProduto) {
    void comTrava(async () => {
      setErro(null);
      if (edicao.modo === "fechado") return;
      const r =
        edicao.modo === "novo"
          ? await criarProduto(tenantId!, { ...dados, requestKey: edicao.chave, initialQuantityMilli })
          : await editarProduto(tenantId!, edicao.produto.id, { ...dados, expectedUpdatedAt: edicao.produto.updatedAt });
      if (!r.ok) {
        // Falha de rede: a mesma chave fica, e repetir não duplica.
        setErro(mensagemDaFalha(r.falha));
        return;
      }
      substituir(r.dados, true);
      notificar(edicao.modo === "novo" ? "Produto cadastrado." : "Produto atualizado.", "sucesso");
      setEdicao({ modo: "fechado" });
    });
  }

  function aoMudarSituacao(produto: ProdutoEstoque, acao: "archive" | "reactivate") {
    void comTrava(async () => {
      const r = await situacaoDoProduto(tenantId!, produto.id, acao);
      if (!r.ok) {
        notificar(mensagemDaFalha(r.falha), "erro");
        return;
      }
      substituir(r.dados);
      notificar(acao === "archive" ? "Produto arquivado. Saldo e histórico preservados." : "Produto reativado.", "sucesso");
    });
  }

  const semCategorias = categorias.status === "carregada" && !listaDeCategorias.some((c) => !c.archived);

  return (
    <PaginaConta
      titulo={TITULO}
      descricao="Produtos vendidos e materiais de consumo interno, com o saldo atual."
      acoes={
        ctx.podeOperar && (
          <Botao onClick={() => { setErro(null); setEdicao({ modo: "novo", chave: novaChaveDeEnvio() }); }} disabled={semCategorias}>
            <Plus size={16} aria-hidden="true" /> Novo produto
          </Botao>
        )
      }
    >
      {semCategorias && ctx.podeOperar && <p className="text-sm text-ink-soft">Crie uma categoria antes de cadastrar produtos.</p>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <form role="search" className="flex gap-2 sm:col-span-2" onSubmit={(e) => { e.preventDefault(); setFiltros((f) => ({ ...f, busca })); }}>
          <label htmlFor="busca-produto" className="sr-only">Buscar produto por nome ou código</label>
          <input id="busca-produto" className={CLASSE_CAMPO} placeholder="Nome ou código" value={busca} onChange={(e) => setBusca(e.target.value)} />
          <Botao type="submit" variante="secundaria" aria-label="Buscar"><Search size={16} aria-hidden="true" /></Botao>
        </form>
        <select aria-label="Categoria" className={CLASSE_CAMPO} value={filtros.categoriaId ?? ""} onChange={(e) => setFiltros((f) => trocarCategoria(f, e.target.value || null, listaDeCategorias))}>
          <option value="">Todas as categorias</option>
          {listaDeCategorias.map((c) => <option key={c.id} value={c.id}>{c.name}{c.archived ? " (arquivada)" : ""}</option>)}
        </select>
        <select aria-label="Subcategoria" className={CLASSE_CAMPO} value={filtros.subcategoriaId ?? ""} disabled={subcategorias.length === 0} onChange={(e) => setFiltros((f) => ({ ...f, subcategoriaId: e.target.value || null }))}>
          <option value="">Todas as subcategorias</option>
          {subcategorias.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select aria-label="Situação" className={CLASSE_CAMPO} value={filtros.situacao} onChange={(e) => setFiltros((f) => ({ ...f, situacao: e.target.value as FiltrosDeProduto["situacao"] }))}>
          <option value="ACTIVE">Ativos</option>
          <option value="ARCHIVED">Arquivados</option>
          <option value="ALL">Todos</option>
        </select>
        <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={filtros.soEstoqueBaixo} onChange={(e) => setFiltros((f) => ({ ...f, soEstoqueBaixo: e.target.checked }))} />
          Só estoque baixo
        </label>
      </div>

      {estado.status === "carregando" && (
        <div className="space-y-3" aria-busy="true" aria-label="Carregando produtos">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      )}
      {estado.status === "falha" && <AvisoDeFalha falha={estado.falha} aoTentarDeNovo={() => void recarregar()} />}
      {estado.status === "carregada" && estado.itens.length === 0 && (
        <EstadoVazio icone={Package} titulo="Nenhum produto encontrado" descricao="Ajuste os filtros ou cadastre um produto." />
      )}
      {estado.status === "carregada" && estado.itens.length > 0 && (
        <div className="space-y-3">
          {estado.itens.map((p) => (
            <LinhaProduto key={p.id} produto={p} podeOperar={ctx.podeOperar} gravando={gravando} aoEditar={() => { setErro(null); setEdicao({ modo: "editar", produto: p }); }} aoMudarSituacao={(a) => aoMudarSituacao(p, a)} />
          ))}
          {estado.proximo && (
            <Botao variante="secundaria" onClick={() => void carregarMais()} disabled={estado.carregandoMais}>
              {estado.carregandoMais ? "Carregando…" : "Carregar mais"}
            </Botao>
          )}
        </div>
      )}

      <PainelLateral
        aberto={edicao.modo !== "fechado"}
        aoFechar={() => setEdicao({ modo: "fechado" })}
        podeFechar={!gravando}
        titulo={edicao.modo === "editar" ? "Editar produto" : "Novo produto"}
        data-testid="painel-produto"
      >
        {edicao.modo !== "fechado" && (
          <FormularioProduto
            key={edicao.modo === "editar" ? edicao.produto.id : edicao.chave}
            produto={edicao.modo === "editar" ? edicao.produto : null}
            categorias={listaDeCategorias}
            enviando={gravando}
            erro={erro}
            aoEnviar={aoSalvar}
            aoCancelar={() => setEdicao({ modo: "fechado" })}
          />
        )}
      </PainelLateral>
    </PaginaConta>
  );
}
