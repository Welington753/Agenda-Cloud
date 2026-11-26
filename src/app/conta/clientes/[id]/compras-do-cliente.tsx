"use client";

// Compras na ficha do cliente (docs/plans/vendas-v1.md, seção 4): data,
// itens, valor vendido, situação da venda e do recebimento. Só para quem
// consulta todas as vendas e vê clientes; o servidor confere de novo. Uma
// saída manual antiga do estoque não é compra e não aparece aqui.
import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge-base";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest } from "@/lib/api/http-client";
import { useLeituraPlataforma } from "@/lib/administracao/use-leitura-plataforma";
import { caminhoComprasDoCliente, ehComprasDoCliente, type ResumoDeVenda } from "@/lib/api/vendas-api";
import { formatarQuantidade } from "@/lib/estoque/quantidade";
import { formatarMoeda } from "@/lib/format";
import { dataCurta } from "@/lib/conta/inicio";
import { rotaDaVenda } from "@/lib/conta/rotas";
import {
  ROTULO_SITUACAO_DA_VENDA,
  ROTULO_SITUACAO_DO_RECEBIMENTO,
  corDaSituacaoDoRecebimento,
  situacaoDoRecebimento,
} from "@/lib/vendas/apresentacao";

export function ComprasDoCliente({ tenantId, consumerId }: { tenantId: string; consumerId: string }) {
  const { estado, recarregar } = useLeituraPlataforma(caminhoComprasDoCliente(tenantId, consumerId), ehComprasDoCliente);
  const [mais, setMais] = useState<{ itens: ResumoDeVenda[]; cursor: string | null; carregando: boolean; falhou: boolean } | null>(null);
  const dados = estado.status === "pronto" ? estado.dados : null;
  useEffect(() => setMais(null), [dados]);
  const compras = [...(dados?.purchases ?? []), ...(mais?.itens ?? [])];
  const proximo = mais ? mais.cursor : (dados?.nextCursor ?? null);

  async function carregarMais() {
    if (!proximo || mais?.carregando) return;
    setMais((m) => ({ itens: m?.itens ?? [], cursor: proximo, carregando: true, falhou: false }));
    const r = await apiRequest<unknown>(caminhoComprasDoCliente(tenantId, consumerId, proximo));
    if (r.kind === "success" && ehComprasDoCliente(r.data)) {
      const pagina = r.data;
      setMais((m) => ({ itens: [...(m?.itens ?? []), ...pagina.purchases], cursor: pagina.nextCursor, carregando: false, falhou: false }));
    } else setMais((m) => ({ itens: m?.itens ?? [], cursor: proximo, carregando: false, falhou: true }));
  }

  return (
    <Cartao>
      <CartaoCorpo className="space-y-2" data-testid="ficha-compras">
        <h2 className="text-sm font-semibold text-ink">Compras neste cadastro</h2>
        {estado.status === "carregando" && <Skeleton className="h-16 w-full" />}
        {estado.status === "erro" && (
          <div className="space-y-2">
            <p role="alert" className="text-sm text-ink">
              Não foi possível carregar as compras.
            </p>
            <Botao type="button" variante="secundaria" className="min-h-11" onClick={recarregar}>
              Tentar novamente
            </Botao>
          </div>
        )}
        {dados && compras.length === 0 && <p className="text-sm text-ink-soft">Nenhuma compra registrada neste cadastro.</p>}
        {compras.length > 0 && (
          <ul>
            {compras.map((c) => {
              const situacao = situacaoDoRecebimento(c);
              return (
                <li key={c.id} className="flex flex-col gap-1 border-b border-border py-3 last:border-b-0 sm:flex-row sm:items-start sm:justify-between" data-testid="compra">
                  <div className="min-w-0 text-sm">
                    <p className="font-medium text-ink">
                      {dataCurta(c.localDate)} ·{" "}
                      <span className={c.status === "CANCELADA" ? "line-through decoration-1" : undefined}>{formatarMoeda(c.totalCents)}</span>
                    </p>
                    <p className="break-words text-ink-soft">{c.items.map((i) => `${formatarQuantidade(i.quantityMilli, i.unit)} ${i.productName}`).join(", ")}</p>
                    <Link href={rotaDaVenda(c.id)} className="inline-flex min-h-11 items-center text-sm font-semibold text-[color:var(--color-accent-hover)] underline">
                      Ver venda
                    </Link>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Badge cor={c.status === "ATIVA" ? "info" : "neutro"}>{ROTULO_SITUACAO_DA_VENDA[c.status]}</Badge>
                    <Badge cor={corDaSituacaoDoRecebimento(situacao)}>{ROTULO_SITUACAO_DO_RECEBIMENTO[situacao]}</Badge>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {mais?.falhou && (
          <p role="alert" className="text-sm text-ink">
            Não foi possível carregar mais compras.
          </p>
        )}
        {proximo && (
          <Botao type="button" variante="secundaria" className="min-h-11" onClick={() => void carregarMais()} disabled={mais?.carregando} aria-busy={mais?.carregando}>
            {mais?.carregando ? "Carregando..." : "Ver compras mais antigas"}
          </Botao>
        )}
      </CartaoCorpo>
    </Cartao>
  );
}
