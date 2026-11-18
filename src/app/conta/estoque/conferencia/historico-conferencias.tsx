"use client";

// Conferências já confirmadas, com os itens de cada uma sob pedido.
import { useCallback, useState } from "react";
import { ClipboardCheck } from "lucide-react";
import { buscarConferencia, listarConferencias, type ConferenciaEstoque } from "@/lib/api/estoque-api";
import { formatarDiferenca, formatarQuantidade } from "@/lib/estoque/quantidade";
import { mensagemDaFalha } from "@/lib/estoque/mensagens";
import { useListaPaginada } from "@/lib/estoque/use-lista-paginada";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { EstadoVazio } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { AvisoDeFalha } from "@/components/estoque/comum";

const DATA_HORA = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

export function HistoricoConferencias({ tenantId, versao }: { tenantId: string; versao: number }) {
  const buscar = useCallback((cursor: string | null, signal: AbortSignal) => listarConferencias(tenantId, cursor, signal), [tenantId]);
  const { estado, recarregar, carregarMais } = useListaPaginada<ConferenciaEstoque>(`${tenantId}:${versao}`, buscar);
  const [aberta, setAberta] = useState<{ id: string; detalhe: ConferenciaEstoque | null; erro: string | null } | null>(null);

  async function abrir(id: string) {
    if (aberta?.id === id) return setAberta(null);
    setAberta({ id, detalhe: null, erro: null });
    const r = await buscarConferencia(tenantId, id);
    setAberta((a) => (a?.id === id ? { id, detalhe: r.ok ? r.dados : null, erro: r.ok ? null : mensagemDaFalha(r.falha) } : a));
  }

  return (
    <section className="space-y-3" aria-labelledby="titulo-historico-conferencias">
      <h2 id="titulo-historico-conferencias" className="text-lg font-semibold text-ink">
        Conferências anteriores
      </h2>
      {estado.status === "carregando" && <Skeleton className="h-20 w-full" />}
      {estado.status === "falha" && <AvisoDeFalha falha={estado.falha} aoTentarDeNovo={() => void recarregar()} />}
      {estado.status === "carregada" && estado.itens.length === 0 && (
        <EstadoVazio icone={ClipboardCheck} titulo="Nenhuma conferência confirmada ainda" />
      )}
      {estado.status === "carregada" &&
        estado.itens.map((c) => (
          <Cartao key={c.id}>
            <CartaoCorpo className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-ink">{DATA_HORA.format(new Date(c.recordedAt))} · {c.recordedBy.name}</p>
                  <p className="text-xs text-ink-soft">
                    {c.itemCount} conferidos, {c.adjustedCount} com ajuste{c.note ? ` · ${c.note}` : ""}
                  </p>
                </div>
                <Botao variante="fantasma" tamanho="sm" onClick={() => void abrir(c.id)} aria-expanded={aberta?.id === c.id}>
                  {aberta?.id === c.id ? "Ocultar itens" : "Ver itens"}
                </Botao>
              </div>
              {aberta?.id === c.id && (
                <div>
                  {aberta.erro && <p className="text-sm text-[color:var(--color-danger)]">{aberta.erro}</p>}
                  {!aberta.detalhe && !aberta.erro && <Skeleton className="h-10 w-full" />}
                  {aberta.detalhe?.items && (
                    <ul className="divide-y divide-border text-sm">
                      {aberta.detalhe.items.map((i) => (
                        <li key={i.productId} className="flex flex-wrap justify-between gap-2 py-1.5">
                          <span className="text-ink">{i.productName}</span>
                          <span className="text-ink-soft">
                            {formatarQuantidade(i.expectedMilli, i.expectedUnit)} → {formatarQuantidade(i.countedMilli, i.expectedUnit)} ({formatarDiferenca(i.differenceMilli, i.expectedUnit)})
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </CartaoCorpo>
          </Cartao>
        ))}
      {estado.status === "carregada" && estado.proximo && (
        <Botao variante="secundaria" onClick={() => void carregarMais()} disabled={estado.carregandoMais}>
          Carregar mais
        </Botao>
      )}
    </section>
  );
}
