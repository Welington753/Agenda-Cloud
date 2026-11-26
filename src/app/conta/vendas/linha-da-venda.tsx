"use client";

// Uma linha da nova venda: quantidade (com + e − nas unidades inteiras),
// preço unitário (editável só por quem pode alterar o preço) e a prévia do
// total da linha, com a mesma conta da API (lib/vendas/calculo.ts).
import { Minus, Plus, Trash2 } from "lucide-react";
import { Botao } from "@/components/ui/button";
import { CLASSE_CAMPO } from "@/components/estoque/comum";
import { casasDaUnidade, quantidadeParaCampo } from "@/lib/estoque/quantidade";
import { formatarMoeda } from "@/lib/format";
import type { LinhaAvaliada } from "@/lib/vendas/carrinho";

export function LinhaDaVenda({
  linha,
  desativado,
  podeAlterarPreco,
  aoMudar,
  aoRemover,
}: {
  linha: LinhaAvaliada;
  desativado: boolean;
  podeAlterarPreco: boolean;
  aoMudar: (m: { quantidade?: string; preco?: string }) => void;
  aoRemover: () => void;
}) {
  const passo = casasDaUnidade(linha.unidade) === 0 ? 1000 : 0;
  const ajustar = (delta: number) => {
    if (linha.quantidadeMilli === null || passo === 0) return;
    const nova = linha.quantidadeMilli + delta;
    if (nova >= 1000) aoMudar({ quantidade: quantidadeParaCampo(nova) });
  };
  const idQuantidade = `qtd-${linha.productId}`;
  const idPreco = `preco-${linha.productId}`;
  return (
    <li className="space-y-3 rounded-[var(--radius-card)] border border-border bg-card p-4" data-testid="linha-venda">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold break-words text-ink">{linha.nome}</p>
          <p className="text-xs text-ink-soft">
            {linha.sugeridoCentavos === null ? "Sem preço sugerido" : `Preço sugerido: ${formatarMoeda(linha.sugeridoCentavos)} / ${linha.unidade}`}
          </p>
        </div>
        <Botao type="button" variante="fantasma" className="min-h-11 min-w-11 shrink-0" onClick={aoRemover} disabled={desativado} aria-label={`Remover ${linha.nome}`}>
          <Trash2 size={16} aria-hidden="true" />
        </Botao>
      </div>
      <fieldset disabled={desativado} className="grid gap-3 sm:grid-cols-3">
        <div className="min-w-0">
          <label htmlFor={idQuantidade} className="block text-sm font-medium text-ink">
            Quantidade ({linha.unidade})
          </label>
          <div className="mt-1 flex items-center gap-1">
            {passo > 0 && (
              <Botao type="button" variante="secundaria" className="min-h-11 min-w-11 shrink-0 px-0" onClick={() => ajustar(-passo)} aria-label={`Diminuir ${linha.nome}`}>
                <Minus size={16} aria-hidden="true" />
              </Botao>
            )}
            <input
              id={idQuantidade}
              inputMode="decimal"
              className={`min-h-11 min-w-0 text-center ${CLASSE_CAMPO}`}
              value={linha.quantidade}
              onChange={(e) => aoMudar({ quantidade: e.target.value })}
              data-testid="quantidade-linha"
            />
            {passo > 0 && (
              <Botao type="button" variante="secundaria" className="min-h-11 min-w-11 shrink-0 px-0" onClick={() => ajustar(passo)} aria-label={`Aumentar ${linha.nome}`}>
                <Plus size={16} aria-hidden="true" />
              </Botao>
            )}
          </div>
        </div>
        <div className="min-w-0">
          <label htmlFor={idPreco} className="block text-sm font-medium text-ink">
            Preço unitário (R$)
          </label>
          {podeAlterarPreco ? (
            <input
              id={idPreco}
              inputMode="decimal"
              className={`mt-1 min-h-11 ${CLASSE_CAMPO}`}
              value={linha.preco}
              onChange={(e) => aoMudar({ preco: e.target.value })}
              placeholder="0,00"
              data-testid="preco-linha"
            />
          ) : (
            <p id={idPreco} className="mt-1 flex min-h-11 items-center text-sm text-ink tabular-nums">
              {linha.sugeridoCentavos === null ? "—" : formatarMoeda(linha.sugeridoCentavos)}
            </p>
          )}
          {linha.precoAlterado && linha.sugeridoCentavos !== null && <p className="mt-1 text-xs text-ink-soft">Diferente do sugerido.</p>}
        </div>
        <div className="min-w-0">
          <p className="block text-sm font-medium text-ink">Total da linha</p>
          <p className="mt-1 flex min-h-11 items-center text-sm font-semibold text-ink tabular-nums" data-testid="total-linha">
            {linha.totalCentavos === null ? "—" : formatarMoeda(linha.totalCentavos)}
          </p>
        </div>
      </fieldset>
      {(linha.erro || linha.aviso) && (
        <p role="alert" className="text-sm text-ink" data-testid="aviso-linha">
          {linha.aviso ?? linha.erro}
        </p>
      )}
    </li>
  );
}
