"use client";

// Produtos do estoque: cartões de resumo (ativos, estoque baixo, categorias),
// busca, filtros por categoria e subcategoria, abas Ativos e Arquivados,
// "Somente estoque baixo" e a tabela com o saldo atual (no celular, cartões).
// Cadastro (com "Cadastrar e continuar") e edição num painel. Quem só consulta
// (gerente com "Ver estoque") não vê os botões, e a API recusa do mesmo jeito.
import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { AlertTriangle, ArrowLeftRight, FolderTree, Package, Plus, Search } from "lucide-react";
import {
  criarProduto,
  editarProduto,
  listarProdutos,
  novaChaveDeEnvio,
  situacaoDoProduto,
  type ProdutoEstoque,
} from "@/lib/api/estoque-api";
import { contar, resumoDeProdutos } from "@/lib/estoque/apresentacao";
import { consultaDeProdutos, FILTROS_INICIAIS, trocarCategoria, type FiltrosDeProduto } from "@/lib/estoque/filtros";
import { mensagemDaFalha } from "@/lib/estoque/mensagens";
import { formatarQuantidade } from "@/lib/estoque/quantidade";
import { useCategorias } from "@/lib/estoque/use-categorias";
import { useContextoEstoque } from "@/lib/estoque/use-contexto-estoque";
import { useListaPaginada } from "@/lib/estoque/use-lista-paginada";
import { useProdutosParaEscolha } from "@/lib/estoque/use-produtos-para-escolha";
import { ROTA_ESTOQUE_MOVIMENTACOES } from "@/lib/conta/rotas";
import { Botao, LinkBotao } from "@/components/ui/button";
import { Cartao } from "@/components/ui/card";
import { EstadoVazio } from "@/components/ui/empty-state";
import { EstatisticaCard } from "@/components/ui/estatistica-card";
import { Modal } from "@/components/ui/modal";
import { PainelLateral } from "@/components/ui/painel-lateral";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { PaginaConta } from "@/components/conta/pagina-conta";
import { AvisoDeFalha, CLASSE_CAMPO, NotaInformativa, SemEstabelecimento, TABELA, trilhaDoEstoque } from "@/components/estoque/comum";
import { FormularioProduto, type EnvioDoProduto } from "./formulario-produto";
import { LinhaProduto } from "./linha-produto";

const TITULO = "Produtos";
type Edicao = { modo: "fechado" } | { modo: "novo"; chave: string; aviso?: true } | { modo: "editar"; produto: ProdutoEstoque };
const ABAS = [
  { valor: "ACTIVE", rotulo: "Ativos" },
  { valor: "ARCHIVED", rotulo: "Arquivados" },
] as const;

export default function ProdutosDoEstoquePage() {
  const ctx = useContextoEstoque();
  const { notificar } = useToast();
  const { estado: categorias, recarregar: recarregarCategorias } = useCategorias(ctx.tenantId);
  // Todos os ativos, para os cartões de resumo (independem dos filtros).
  const { estado: ativos, recarregar: recarregarResumo } = useProdutosParaEscolha(ctx.tenantId, "ACTIVE");
  const [filtros, setFiltros] = useState<FiltrosDeProduto>(FILTROS_INICIAIS);
  const [busca, setBusca] = useState("");
  const [edicao, setEdicao] = useState<Edicao>({ modo: "fechado" });
  const [arquivando, setArquivando] = useState<ProdutoEstoque | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [gravando, setGravando] = useState(false);
  const travado = useRef(false);

  // Filtro vindo de Categorias ("Ver produtos").
  useEffect(() => {
    const categoria = new URLSearchParams(window.location.search).get("categoria");
    if (categoria) setFiltros((f) => ({ ...f, categoriaId: categoria, situacao: "ACTIVE" }));
  }, []);

  // Busca enquanto digita, com uma pausa curta (Enter aplica na hora).
  useEffect(() => {
    const espera = setTimeout(() => setFiltros((f) => (f.busca === busca ? f : { ...f, busca })), 350);
    return () => clearTimeout(espera);
  }, [busca]);

  useEffect(() => {
    setEdicao({ modo: "fechado" });
    setArquivando(null);
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
  const resumo = ativos.status === "carregada" ? resumoDeProdutos(ativos.produtos) : null;
  const categoriasAtivas = categorias.status === "carregada" ? listaDeCategorias.filter((c) => !c.archived).length : null;

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

  /** Depois de gravar: cartões de resumo e contagens das categorias. */
  function atualizarResumo() {
    void recarregarResumo();
    void recarregarCategorias();
  }

  function aoSalvar({ dados, initialQuantityMilli }: EnvioDoProduto, continuar: boolean) {
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
      atualizarResumo();
      if (continuar && edicao.modo === "novo") return setEdicao({ modo: "novo", chave: novaChaveDeEnvio(), aviso: true });
      notificar(edicao.modo === "novo" ? "Produto cadastrado." : "Produto atualizado.", "sucesso");
      setEdicao({ modo: "fechado" });
    });
  }

  function aoMudarSituacao(produto: ProdutoEstoque, acao: "archive" | "reactivate") {
    void comTrava(async () => {
      const r = await situacaoDoProduto(tenantId!, produto.id, acao);
      setArquivando(null);
      if (!r.ok) {
        notificar(mensagemDaFalha(r.falha), "erro");
        return;
      }
      substituir(r.dados);
      atualizarResumo();
      notificar(acao === "archive" ? "Produto arquivado. Saldo e histórico preservados." : "Produto reativado.", "sucesso");
    });
  }

  const semCategorias = categorias.status === "carregada" && !listaDeCategorias.some((c) => !c.archived);
  /** Abre o painel (novo ou edição) sem o erro do envio anterior. */
  const abrirPainel = (nova: Edicao) => {
    setErro(null);
    setEdicao(nova);
  };

  return (
    <PaginaConta
      trilha={trilhaDoEstoque(TITULO)}
      titulo={TITULO}
      descricao="Organize seus produtos e acompanhe o saldo de cada item."
      acoes={
        ctx.podeOperar && (
          <>
            <LinkBotao variante="secundaria" href={`${ROTA_ESTOQUE_MOVIMENTACOES}?novo=1`}>
              <ArrowLeftRight size={16} aria-hidden="true" /> Registrar movimentação
            </LinkBotao>
            <Botao onClick={() => abrirPainel({ modo: "novo", chave: novaChaveDeEnvio() })} disabled={semCategorias}>
              <Plus size={16} aria-hidden="true" /> Novo produto
            </Botao>
          </>
        )
      }
    >
      {semCategorias && ctx.podeOperar && <NotaInformativa destaque>Crie uma categoria antes de cadastrar produtos.</NotaInformativa>}

      <div className="grid gap-3 sm:grid-cols-3">
        <EstatisticaCard icone={Package} rotulo="Produtos ativos" valor={resumo ? String(resumo.ativos) : "–"} testId="resumo-ativos" />
        <EstatisticaCard icone={AlertTriangle} corIcone="warning" rotulo="Estoque baixo" valor={resumo ? String(resumo.baixo) : "–"} testId="resumo-baixo" />
        <EstatisticaCard icone={FolderTree} corIcone="neutro" rotulo="Categorias" valor={categoriasAtivas === null ? "–" : String(categoriasAtivas)} testId="resumo-categorias" />
      </div>

      <Cartao>
        <div className="space-y-3 border-b border-border p-4">
          <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <form
              role="search"
              className="relative"
              onSubmit={(e) => {
                e.preventDefault();
                setFiltros((f) => ({ ...f, busca }));
              }}
            >
              <label htmlFor="busca-produto" className="sr-only">
                Buscar produto por nome ou código
              </label>
              <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-soft" aria-hidden="true" />
              <input id="busca-produto" type="search" className={`${CLASSE_CAMPO} pl-10`} placeholder="Buscar por nome ou código" value={busca} onChange={(e) => setBusca(e.target.value)} />
            </form>
            <select aria-label="Categoria" className={CLASSE_CAMPO} value={filtros.categoriaId ?? ""} onChange={(e) => setFiltros((f) => trocarCategoria(f, e.target.value || null, listaDeCategorias))}>
              <option value="">Todas as categorias</option>
              {listaDeCategorias.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.archived ? " (arquivada)" : ""}
                </option>
              ))}
            </select>
            <select aria-label="Subcategoria" className={CLASSE_CAMPO} value={filtros.subcategoriaId ?? ""} disabled={subcategorias.length === 0} onChange={(e) => setFiltros((f) => ({ ...f, subcategoriaId: e.target.value || null }))}>
              <option value="">Todas as subcategorias</option>
              {subcategorias.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div role="group" aria-label="Situação" className="inline-flex rounded-[var(--radius-control)] border border-border p-0.5">
              {ABAS.map((aba) => (
                <button
                  key={aba.valor}
                  type="button"
                  aria-pressed={filtros.situacao === aba.valor}
                  onClick={() => setFiltros((f) => ({ ...f, situacao: aba.valor }))}
                  className={clsx(
                    "min-h-9 rounded-[calc(var(--radius-control)-2px)] px-4 text-sm font-semibold transition-colors",
                    filtros.situacao === aba.valor ? "bg-accent text-on-accent" : "text-ink-soft hover:bg-paper-muted hover:text-ink",
                  )}
                >
                  {aba.rotulo}
                </button>
              ))}
            </div>
            <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
              <input type="checkbox" className="size-4" checked={filtros.soEstoqueBaixo} onChange={(e) => setFiltros((f) => ({ ...f, soEstoqueBaixo: e.target.checked }))} />
              Somente estoque baixo
            </label>
          </div>
        </div>

        {estado.status === "carregando" && (
          <div className="space-y-3 p-4" aria-busy="true" aria-label="Carregando produtos">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        )}
        {estado.status === "falha" && (
          <div className="p-4">
            <AvisoDeFalha falha={estado.falha} aoTentarDeNovo={() => void recarregar()} />
          </div>
        )}
        {estado.status === "carregada" && estado.itens.length === 0 && (
          <div className="p-4">
            <EstadoVazio icone={Package} titulo="Nenhum produto encontrado" descricao="Ajuste os filtros ou cadastre um produto." />
          </div>
        )}
        {estado.status === "carregada" && estado.itens.length > 0 && (
          <>
            <table className={TABELA.tabela} aria-label="Produtos do estoque">
              <thead className={TABELA.cabecalho}>
                <tr>
                  <th scope="col" className={TABELA.th}>Produto</th>
                  <th scope="col" className={TABELA.th}>Finalidade</th>
                  <th scope="col" className={`${TABELA.th} text-right`}>Saldo</th>
                  <th scope="col" className={`${TABELA.th} text-right`}>Mínimo</th>
                  <th scope="col" className={TABELA.th}>Situação</th>
                  <th scope="col" className={TABELA.th}>
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody className={TABELA.corpo}>
                {estado.itens.map((p) => (
                  <LinhaProduto
                    key={p.id}
                    produto={p}
                    podeOperar={ctx.podeOperar}
                    gravando={gravando}
                    aoEditar={() => abrirPainel({ modo: "editar", produto: p })}
                    aoArquivar={() => setArquivando(p)}
                    aoReativar={() => aoMudarSituacao(p, "reactivate")}
                  />
                ))}
              </tbody>
            </table>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3 text-sm text-ink-soft">
              <span data-testid="total-produtos">
                {contar(estado.itens.length, "produto", "produtos")}
                {estado.proximo ? " exibidos" : ""}
              </span>
              {estado.proximo && (
                <Botao variante="secundaria" tamanho="sm" onClick={() => void carregarMais()} disabled={estado.carregandoMais}>
                  {estado.carregandoMais ? "Carregando…" : "Carregar mais"}
                </Botao>
              )}
            </div>
          </>
        )}
      </Cartao>

      <NotaInformativa>As quantidades são atualizadas por movimentações manuais e pela conferência de estoque.</NotaInformativa>

      <Modal
        aberto={arquivando !== null}
        aoFechar={() => !gravando && setArquivando(null)}
        titulo="Arquivar produto"
        rodape={
          <>
            <Botao variante="secundaria" onClick={() => setArquivando(null)} disabled={gravando}>
              Cancelar
            </Botao>
            <Botao variante="perigo" onClick={() => arquivando && aoMudarSituacao(arquivando, "archive")} disabled={gravando}>
              Arquivar
            </Botao>
          </>
        }
      >
        {arquivando && (
          <p className="text-ink">
            Arquivar &quot;{arquivando.name}&quot;? O saldo de {formatarQuantidade(arquivando.balanceMilli, arquivando.unit)} e o histórico ficam preservados. Produto
            arquivado não recebe movimentação nem entra na conferência.
          </p>
        )}
      </Modal>

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
            aviso={edicao.modo === "novo" && edicao.aviso}
            aoEnviar={aoSalvar}
            aoCancelar={() => setEdicao({ modo: "fechado" })}
          />
        )}
      </PainelLateral>
    </PaginaConta>
  );
}
