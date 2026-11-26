"use client";

// Recebimentos de vendas do período (pela data do recebimento ou do estorno),
// no molde de Recebimentos de atendimentos: recebido, estornado e líquido,
// só de VENDAS. Os próprios (`mine`, em Minhas operações) ou todos (`all`,
// com a consulta geral). O estorno fica no detalhe da venda.
import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge-base";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useLeituraPlataforma } from "@/lib/administracao/use-leitura-plataforma";
import { ROTULO_FORMA } from "@/lib/api/recebimentos-api";
import { caminhoRecebimentosDeVendas, ehListaDeRecebimentosDeVendas, type EscopoDeVendas } from "@/lib/api/vendas-api";
import { formatarMoeda } from "@/lib/format";
import { dataCurta, mesDe, rotuloDoPeriodo, type PeriodoLocal } from "@/lib/conta/inicio";
import { rotaDaVenda } from "@/lib/conta/rotas";
import { deslocar } from "@/lib/profissionais/calendario";
import { Numero } from "./lista-de-vendas";

export function RecebimentosDeVendas({ tenantId, escopo, versao }: { tenantId: string; escopo: EscopoDeVendas; versao: number }) {
  const [periodo, setPeriodo] = useState<PeriodoLocal | null>(null);
  const { estado, recarregar, anterior } = useLeituraPlataforma(caminhoRecebimentosDeVendas(tenantId, { scope: escopo, periodo }), ehListaDeRecebimentosDeVendas);
  const dados = estado.status === "pronto" ? estado.dados : anterior;
  useEffect(() => {
    if (versao > 0) recarregar();
  }, [versao, recarregar]);
  const atual = periodo ?? dados?.period ?? null;

  return (
    <section className="space-y-4" aria-label={escopo === "mine" ? "Recebimentos que você registrou" : "Recebimentos de vendas"} data-testid={`recebimentos-vendas-${escopo}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Botao type="button" variante="secundaria" className="min-h-11 min-w-11" aria-label="Mês anterior" disabled={!atual} onClick={() => atual && setPeriodo(mesDe(deslocar("mes", atual.from, -1)))}>
          <ChevronLeft size={16} aria-hidden="true" />
        </Botao>
        <p className="min-w-0 text-sm font-semibold text-ink">{atual ? rotuloDoPeriodo(atual) : "Mês atual"}</p>
        <Botao type="button" variante="secundaria" className="min-h-11 min-w-11" aria-label="Próximo mês" disabled={!atual} onClick={() => atual && setPeriodo(mesDe(deslocar("mes", atual.from, 1)))}>
          <ChevronRight size={16} aria-hidden="true" />
        </Botao>
      </div>

      {!dados && estado.status === "carregando" && <Skeleton className="h-32 w-full" />}
      {!dados && estado.status === "erro" && (
        <Cartao>
          <CartaoCorpo className="space-y-3">
            <p role="alert" className="text-sm text-ink">
              Não foi possível carregar os recebimentos de vendas.
            </p>
            <Botao type="button" className="min-h-11" onClick={recarregar}>
              Tentar novamente
            </Botao>
          </CartaoCorpo>
        </Cartao>
      )}

      {dados && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" data-testid="resumo-recebimentos-vendas">
            <Numero rotulo="Recebido em vendas" valor={formatarMoeda(dados.summary.receivedCents)} testId="resumo-recebido-vendas" />
            <Numero rotulo="Estornado em vendas" valor={formatarMoeda(dados.summary.refundedCents)} testId="resumo-estornado-vendas" />
            <Numero rotulo="Líquido de vendas" valor={formatarMoeda(dados.summary.netCents)} testId="resumo-liquido-vendas" />
          </div>
          {dados.payments.length === 0 ? (
            <p className="rounded-[var(--radius-card)] border border-border bg-card p-4 text-sm text-ink-soft" data-testid="sem-recebimentos-vendas">
              Nenhum recebimento de venda neste período.
            </p>
          ) : (
            <ul className="space-y-2" data-testid="lista-recebimentos-vendas">
              {dados.payments.map((p) => (
                <li key={p.id} className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-card p-4 sm:flex-row sm:items-start sm:justify-between" data-testid="recebimento-venda">
                  <div className="min-w-0 space-y-0.5 text-sm">
                    <p className="font-semibold text-ink tabular-nums">
                      <span className={p.refund ? "line-through decoration-1" : undefined}>{formatarMoeda(p.amountCents)}</span> · {ROTULO_FORMA[p.method]}
                    </p>
                    <p className="text-ink-soft">
                      Recebido em {dataCurta(p.receivedOn)}
                      {escopo === "all" ? ` · registrado por ${p.recordedBy.name}` : ""}
                    </p>
                    {p.notes && <p className="break-words text-ink-soft">{p.notes}</p>}
                    {p.refund && (
                      <p className="break-words text-ink-soft">
                        Estornado em {dataCurta(p.refund.refundedOn)} por {p.refund.refundedBy.name}: {p.refund.reason}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <Badge cor={p.refund ? "neutro" : "sucesso"}>{p.refund ? "Estornado" : "Recebido"}</Badge>
                    <Link href={rotaDaVenda(p.saleId)} className="inline-flex min-h-11 items-center px-1 text-sm font-semibold text-[color:var(--color-accent-hover)] underline">
                      Ver venda
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {!dados.complete && <p className="text-xs text-ink-soft">Mostrando os mais recentes: o período tem mais registros.</p>}
          <p className="text-xs text-ink-soft">
            Recebido: o que entrou em vendas no período (pela data do recebimento). Estornado: o que saiu no período (pela data do
            estorno). Os recebimentos de atendimentos ficam em Recebimentos de atendimentos.
          </p>
        </>
      )}
    </section>
  );
}
