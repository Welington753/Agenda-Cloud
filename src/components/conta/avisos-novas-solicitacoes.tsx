"use client";

// Avisos de NOVAS solicitações do agendamento online, em qualquer página de
// `/conta`. Vêm do SolicitacoesProvider (consulta periódica com a página
// visível); aparecem só para pedido que chegou DEPOIS de a pessoa entrar, e
// uma vez por solicitação nesta sessão.
//
// "Ver solicitação" só NAVEGA até o cartão na tela de Solicitações, onde
// estão as ações reais (confirmar, recusar, combinar outro horário). Abrir ou
// fechar um aviso nunca chama a API nem muda a reserva.
//
// Funciona com o sistema aberto neste navegador; não é push.
import Link from "next/link";
import { BellRing, X } from "lucide-react";
import { useAvisosDeSolicitacoes } from "@/lib/agendamento-publico/use-solicitacoes";
import { descricaoDoAviso } from "@/lib/agendamento-publico/novas-solicitacoes";
import { dataLocalDoInstante } from "@/lib/agendamento-publico/solicitacoes";
import { dataBr } from "@/lib/agendamento-publico/agendamento-publico";
import { LinkBotao } from "@/components/ui/button";

/** Mais que isso empilhado cobriria a tela do celular. */
const MAXIMO_VISIVEL = 3;

export function AvisosNovasSolicitacoes() {
  const { avisos, dispensarAviso, abrirSolicitacao } = useAvisosDeSolicitacoes();
  const visiveis = avisos.slice(-MAXIMO_VISIVEL);
  const ocultos = avisos.length - visiveis.length;

  return (
    // Região viva sempre montada: leitores de tela anunciam o que entra nela.
    <div
      aria-live="polite"
      aria-label="Avisos de novas solicitações"
      data-testid="avisos-novas-solicitacoes"
      className="pointer-events-none fixed inset-x-4 top-[4.5rem] z-50 flex flex-col gap-2 md:inset-x-auto md:top-4 md:right-4 md:w-[22rem]"
    >
      {visiveis.map((s) => {
        const data = dataLocalDoInstante(s.startAt, s.timezone);
        return (
          <div
            key={s.id}
            data-testid="aviso-nova-solicitacao"
            data-appointment-id={s.id}
            className="animar-toast pointer-events-auto rounded-[var(--radius-control)] border border-border bg-card p-4 shadow-lg"
          >
            <div className="flex items-start gap-3">
              <BellRing size={18} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-sm font-semibold text-ink">Nova solicitação</p>
                <p className="text-sm text-ink" data-testid="aviso-nova-solicitacao-texto">
                  {descricaoDoAviso(s, data ? dataBr(data) : null)}
                </p>
              </div>
              <button
                type="button"
                aria-label={`Fechar aviso do pedido de ${s.consumer.name}`}
                onClick={() => dispensarAviso(s.id)}
                data-testid="fechar-aviso-solicitacao"
                className="-m-2 inline-flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-ink-soft hover:text-ink focus-visible:outline-2 focus-visible:outline-focus"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <LinkBotao
              href={`/conta/agendamentos/solicitacoes#solicitacao-${s.id}`}
              onClick={() => abrirSolicitacao(s.id)}
              data-testid="ver-solicitacao"
              className="mt-3 min-h-11"
            >
              Ver solicitação
              <span className="sr-only"> de {s.consumer.name}</span>
            </LinkBotao>
          </div>
        );
      })}
      {ocultos > 0 && (
        <Link
          href="/conta/agendamentos/solicitacoes"
          data-testid="avisos-ocultos"
          className="pointer-events-auto rounded-[var(--radius-control)] border border-border bg-card px-4 py-2 text-sm font-medium text-ink shadow-lg hover:bg-paper-muted"
        >
          E mais {ocultos} {ocultos === 1 ? "nova solicitação" : "novas solicitações"} na lista
        </Link>
      )}
    </div>
  );
}
