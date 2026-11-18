"use client";

// Histórico de movimentações do estoque, com filtros por produto, tipo e
// período, e o registro manual de entradas e saídas. O histórico nunca é
// editado: corrigir é estornar (novo registro, com referência e motivo).
import { useCallback, useEffect, useState } from "react";
import { ArrowLeftRight, Plus } from "lucide-react";
import { listarMovimentacoes, type MovimentacaoEstoque } from "@/lib/api/estoque-api";
import { consultaDeMovimentacoes, type FiltrosDeMovimentacao } from "@/lib/estoque/filtros";
import { ROTULO_TIPO, type TipoMovimentacao } from "@/lib/estoque/rotulos";
import { useContextoEstoque } from "@/lib/estoque/use-contexto-estoque";
import { useListaPaginada } from "@/lib/estoque/use-lista-paginada";
import { useProdutosParaEscolha } from "@/lib/estoque/use-produtos-para-escolha";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { EstadoVazio } from "@/components/ui/empty-state";
import { PainelLateral } from "@/components/ui/painel-lateral";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { PaginaConta } from "@/components/conta/pagina-conta";
import { AvisoDeFalha, CLASSE_CAMPO, SemEstabelecimento } from "@/components/estoque/comum";
import { FormularioMovimentacao } from "./formulario-movimentacao";
import { LinhaMovimentacao } from "./linha-movimentacao";

const TITULO = "Movimentações";
const FILTROS_VAZIOS: FiltrosDeMovimentacao = { produtoId: null, tipo: null, de: "", ate: "" };

export default function MovimentacoesDoEstoquePage() {
  const ctx = useContextoEstoque();
  const { notificar } = useToast();
  const [filtros, setFiltros] = useState<FiltrosDeMovimentacao>(FILTROS_VAZIOS);
  const [formulario, setFormulario] = useState<{ aberto: boolean; versao: number }>({ aberto: false, versao: 0 });
  const tenantId = ctx.tenantId;
  const { estado: produtos, atualizarSaldo, recarregar: recarregarProdutos } = useProdutosParaEscolha(tenantId, "ALL");

  // Filtro vindo de Produtos ("Histórico").
  useEffect(() => {
    const produto = new URLSearchParams(window.location.search).get("produto");
    if (produto) setFiltros((f) => ({ ...f, produtoId: produto }));
  }, []);

  useEffect(() => setFormulario((f) => ({ aberto: false, versao: f.versao + 1 })), [tenantId]);

  const consulta = consultaDeMovimentacoes(filtros);
  const buscar = useCallback(
    (cursor: string | null, signal: AbortSignal) => listarMovimentacoes(tenantId!, consultaDeMovimentacoes(filtros, cursor), signal),
    [tenantId, filtros],
  );
  const { estado, recarregar, carregarMais, substituir } = useListaPaginada<MovimentacaoEstoque>(tenantId ? `${tenantId}?${consulta}` : null, buscar);

  if (!ctx.pronto) return null;
  if (!tenantId) return <SemEstabelecimento titulo={TITULO} />;
  const listaDeProdutos = produtos.status === "carregada" ? produtos.produtos : [];
  const ativos = listaDeProdutos.filter((p) => !p.archived);

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
    notificar("Estorno registrado. O lançamento original foi preservado.", "sucesso");
  }

  return (
    <PaginaConta
      titulo={TITULO}
      descricao="Entradas, saídas, ajustes de conferência e estornos, com saldo anterior e posterior."
      acoes={
        ctx.podeOperar && (
          <Botao onClick={() => { void recarregarProdutos(); setFormulario((f) => ({ aberto: true, versao: f.versao + 1 })); }} disabled={produtos.status !== "carregada" || ativos.length === 0}>
            <Plus size={16} aria-hidden="true" /> Nova movimentação
          </Botao>
        )
      }
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <select aria-label="Produto" className={CLASSE_CAMPO} value={filtros.produtoId ?? ""} onChange={(e) => setFiltros((f) => ({ ...f, produtoId: e.target.value || null }))}>
          <option value="">Todos os produtos</option>
          {listaDeProdutos.map((p) => <option key={p.id} value={p.id}>{p.name}{p.archived ? " (arquivado)" : ""}</option>)}
        </select>
        <select aria-label="Tipo" className={CLASSE_CAMPO} value={filtros.tipo ?? ""} onChange={(e) => setFiltros((f) => ({ ...f, tipo: e.target.value || null }))}>
          <option value="">Todos os tipos</option>
          {(Object.keys(ROTULO_TIPO) as TipoMovimentacao[]).map((t) => <option key={t} value={t}>{ROTULO_TIPO[t]}</option>)}
        </select>
        <label className="text-sm text-ink">
          <span className="sr-only">De</span>
          <input type="date" aria-label="De" className={CLASSE_CAMPO} value={filtros.de} onChange={(e) => setFiltros((f) => ({ ...f, de: e.target.value }))} />
        </label>
        <label className="text-sm text-ink">
          <span className="sr-only">Até</span>
          <input type="date" aria-label="Até" className={CLASSE_CAMPO} value={filtros.ate} onChange={(e) => setFiltros((f) => ({ ...f, ate: e.target.value }))} />
        </label>
      </div>

      {estado.status === "carregando" && (
        <div className="space-y-3" aria-busy="true" aria-label="Carregando movimentações">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      )}
      {estado.status === "falha" && <AvisoDeFalha falha={estado.falha} aoTentarDeNovo={() => void recarregar()} />}
      {estado.status === "carregada" && estado.itens.length === 0 && (
        <EstadoVazio icone={ArrowLeftRight} titulo="Nenhuma movimentação" descricao="As entradas, saídas e ajustes aparecem aqui." />
      )}
      {estado.status === "carregada" && estado.itens.length > 0 && (
        <Cartao>
          <CartaoCorpo>
            <ul className="divide-y divide-border" aria-label="Histórico de movimentações">
              {estado.itens.map((m) => (
                <LinhaMovimentacao key={m.id} tenantId={tenantId} movimentacao={m} podeOperar={ctx.podeOperar} aoEstornar={aoEstornar} />
              ))}
            </ul>
            {estado.proximo && (
              <Botao className="mt-3" variante="secundaria" onClick={() => void carregarMais()} disabled={estado.carregandoMais}>
                {estado.carregandoMais ? "Carregando…" : "Carregar mais"}
              </Botao>
            )}
          </CartaoCorpo>
        </Cartao>
      )}

      <PainelLateral aberto={formulario.aberto} aoFechar={() => setFormulario((f) => ({ ...f, aberto: false }))} titulo="Nova movimentação" data-testid="painel-movimentacao">
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
