"use client";

// Aviso da Visão geral: há solicitações aguardando confirmação. Lê a mesma
// lista persistida da tela de Solicitações; ver o aviso não muda nada.
// Só aparece com número positivo — carregando ou com falha, a Visão geral
// segue sem ele (a tela de Solicitações mostra o erro).
import { Inbox } from "lucide-react";
import { contagemVisivel, useSolicitacoesPendentes } from "@/lib/agendamento-publico/use-solicitacoes";
import { textoPendentes } from "@/lib/agendamento-publico/solicitacoes";
import { LinkBotao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";

export function AvisoSolicitacoes({ tenantId }: { tenantId: string }) {
  const { estado } = useSolicitacoesPendentes(tenantId);
  const total = contagemVisivel(estado);
  if (!total) return null;
  return (
    <Cartao data-testid="aviso-solicitacoes">
      <CartaoCorpo className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-start gap-3 text-sm font-medium text-ink">
          <Inbox size={20} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
          {textoPendentes(total)}
        </p>
        <LinkBotao href="/conta/solicitacoes" variante="secundaria">
          Ver solicitações
        </LinkBotao>
      </CartaoCorpo>
    </Cartao>
  );
}
