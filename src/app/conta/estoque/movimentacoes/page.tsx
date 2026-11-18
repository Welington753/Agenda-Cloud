"use client";

// Histórico de movimentações do estoque, com filtros por produto, tipo e
// período, e o registro manual de entradas e saídas. O histórico nunca é
// editado: corrigir é estornar (novo registro, com referência e motivo).
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import { listarMovimentacoes, type MovimentacaoEstoque } from "@/lib/api/estoque-api";
import { contar } from "@/lib/estoque/apresentacao";
import { consultaDeMovimentacoes, type FiltrosDeMovimentacao } from "@/lib/estoque/filtros";
import { ROTULO_TIPO, type TipoMovimentacao } from "@/lib/estoque/rotulos";
import { useContextoEstoque } from "@/lib/estoque/use-contexto-estoque";
import { useListaPaginada } from "@/lib/estoque/use-lista-paginada";
import { useProdutosParaEscolha } from "@/lib/estoque/use-produtos-para-escolha";
import { Botao } from "@/components/ui/button";
import { Cartao } from "@/components/ui/card";
import { EstadoVazio } from "@/components/ui/empty-state";
import { PainelLateral } from "@/components/ui/painel-lateral";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { PaginaConta } from "@/components/conta/pagina-conta";
import { AvisoDeFalha, CLASSE_CAMPO, NotaInformativa, SemEstabelecimento, TABELA, trilhaDoEstoque } from "@/components/estoque/comum";
import { FormularioMovimentacao } from "./formulario-movimentacao";
import { JanelaDeEstorno, LinhaMovimentacao } from "./linha-movimentacao";

const TITULO = "Movimentações";
const FILTROS_VAZIOS: FiltrosDeMovimentacao = { produtoId: null, tipo: null, de: "", ate: "" };

export default function MovimentacoesDoEstoquePage() {
  const ctx = useContextoEstoque();
  const { notificar } = useToast();
  const [filtros, setFiltros] = useState<FiltrosDeMovimentacao>(FILTROS_VAZIOS);
  const [formulario, setFormulario] = useState<{ aberto: boolean; versao: number }>({ aberto: false, versao: 0 });
  const [estornando, setEstornando] = useState<MovimentacaoEstoque | null>(null);
  const pediuNovo = useRef(false);
  const tenantId = ctx.tenantId;
  const { estado: produtos, atualizarSaldo, recarregar: recarregarProdutos } = useProdutosParaEscolha(tenantId, "ALL");

  // Vindo de Produtos: "Ver histórico" (?produto=) ou "Registrar movimentação" (?novo=1).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const produto = params.get("produto");
    if (produto) setFiltros((f) => ({ ...f, produtoId: produto }));
    pediuNovo.current = params.get("novo") === "1";
  }, []);

  useEffect(() => {
    setFormulario((f) => ({ aberto: false, versao: f.versao + 1 }));
    setEstornando(null);
  }, [tenantId]);

  const listaDeProdutos = produtos.status === "carregada" ? produtos.produtos : [];
  const ativos = listaDeProdutos.filter((p) => !p.archived);

  // "?novo=1" abre o formulário uma vez, quando os produtos chegam.
  useEffect(() => {
    if (!pediuNovo.current || !ctx.podeOperar || produtos.status !== "carregada") return;
    pediuNovo.current = false;
    if (produtos.produtos.some((p) => !p.archived)) setFormulario((f) => ({ aberto: true, versao: f.versao + 1 }));
  }, [ctx.podeOperar, produtos]);

  const consulta = consultaDeMovimentacoes(filtros);
  const buscar = useCallback(
    (cursor: string | null, signal: AbortSignal) => listarMovimentacoes(tenantId!, consultaDeMovimentacoes(filtros, cursor), signal),
    [tenantId, filtros],
  );
  const { estado, recarregar, carregarMais, substituir } = useListaPaginada<MovimentacaoEstoque>(tenantId ? `${tenantId}?${consulta}` : null, buscar);

  if (!ctx.pronto) return null;
  if (!tenantId) return <SemEstabelecimento titulo={TITULO} />;

  function aoRegistrar(m: MovimentacaoEstoque) {
    substituir(m, true);
    atualizarSaldo(m.productId, m.balanceAfterMilli);
    setFormulario((f) => ({ aberto: false, versao: f.versao + 1 }));
    notificar("Movimentação registrada.", "sucesso");
  }

  function aoEstornar(original: MovimentacaoEstoque, estorno: MovimentacaoEstoque) {
    substituir({ ...original, reversedByMovementId: estorno.id });
    substituir(estorno, true);
    atualizarSaldo(estorno.productId, estorno.balanceAfterMilli);
    setEstornando(null);
    notificar("Estorno registrado. O lançamento original foi preservado.", "sucesso");
  }

  const filtrando = filtros.produtoId || filtros.tipo || filtros.de || filtros.ate;

  return (
    <PaginaConta
      trilha={trilhaDoEstoque(TITULO)}
      titulo={TITULO}
      descricao="Entradas, saídas, ajustes de conferência e estornos, com o saldo antes e depois de cada lançamento."
      acoes={
        ctx.podeOperar && (
          <Botao
            onClick={() => {
              void recarregarProdutos();
              setFormulario((f) => ({ aberto: true, versao: f.versao + 1 }));
            }}
            disabled={produtos.status !== "carregada" || ativos.length === 0}
          >
            <ArrowLeftRight size={16} aria-hidden="true" /> Registrar movimentação
          </Botao>
        )
      }
    >
      <Cartao>
        <div className="grid gap-3 border-b border-border p-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <select aria-label="Produto" className={CLASSE_CAMPO} value={filtros.produtoId ?? ""} onChange={(e) => setFiltros((f) => ({ ...f, produtoId: e.target.value || null }))}>
            <option value="">Todos os produtos</option>
            {listaDeProdutos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.archived ? " (arquivado)" : ""}
              </option>
            ))}
          </select>
          <select aria-label="Tipo" className={CLASSE_CAMPO} value={filtros.tipo ?? ""} onChange={(e) => setFiltros((f) => ({ ...f, tipo: e.target.value || null }))}>
            <option value="">Todos os tipos</option>
            {(Object.keys(ROTULO_TIPO) as TipoMovimentacao[]).map((t) => (
              <option key={t} value={t}>
                {ROTULO_TIPO[t]}
              </option>
            ))}
          </select>
          <input type="date" aria-label="De" className={CLASSE_CAMPO} value={filtros.de} onChange={(e) => setFiltros((f) => ({ ...f, de: e.target.value }))} />
          <input type="date" aria-label="Até" className={CLASSE_CAMPO} value={filtros.ate} onChange={(e) => setFiltros((f) => ({ ...f, ate: e.target.value }))} />
        </div>

        {estado.status === "carregando" && (
          <div className="space-y-3 p-4" aria-busy="true" aria-label="Carregando movimentações">
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
            <EstadoVazio
              icone={ArrowLeftRight}
              titulo="Nenhuma movimentação"
              descricao={filtrando ? "Nenhum lançamento com esses filtros." : "As entradas, saídas e ajustes aparecem aqui."}
            />
          </div>
        )}
        {estado.status === "carregada" && estado.itens.length > 0 && (
          <>
            <table className={TABELA.tabela} aria-label="Histórico de movimentações">
              <thead className={TABELA.cabecalho}>
                <tr>
                  <th scope="col" className={TABELA.th}>Data</th>
                  <th scope="col" className={TABELA.th}>Produto</th>
                  <th scope="col" className={TABELA.th}>Tipo</th>
                  <th scope="col" className={`${TABELA.th} text-right`}>Quantidade</th>
                  <th scope="col" className={`${TABELA.th} whitespace-nowrap text-right`}>Saldo antes → depois</th>
                  <th scope="col" className={TABELA.th}>
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody className={TABELA.corpo}>
                {estado.itens.map((m) => (
                  <LinhaMovimentacao key={m.id} movimentacao={m} podeOperar={ctx.podeOperar} aoPedirEstorno={setEstornando} />
                ))}
              </tbody>
            </table>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3 text-sm text-ink-soft">
              <span>
                {contar(estado.itens.length, "movimentação", "movimentações")}
                {estado.proximo ? " exibidas" : ""}
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

      <NotaInformativa>O histórico não é editado. Para corrigir um lançamento, use “Estornar”: o original fica registrado.</NotaInformativa>

      <JanelaDeEstorno key={estornando?.id ?? "fechada"} tenantId={tenantId} movimentacao={estornando} aoFechar={() => setEstornando(null)} aoEstornar={aoEstornar} />

      <PainelLateral aberto={formulario.aberto} aoFechar={() => setFormulario((f) => ({ ...f, aberto: false }))} titulo="Registrar movimentação" data-testid="painel-movimentacao">
        {formulario.aberto && (
          <FormularioMovimentacao
            key={formulario.versao}
            tenantId={tenantId}
            produtos={ativos}
            produtoInicial={filtros.produtoId}
            aoRegistrar={aoRegistrar}
            aoCancelar={() => setFormulario((f) => ({ ...f, aberto: false }))}
          />
        )}
      </PainelLateral>
    </PaginaConta>
  );
}
