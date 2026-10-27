"use client";

// Um atendimento da agenda do dia, desenhado para ser lido de relance durante
// o trabalho: horário (início e fim) à esquerda, cliente em destaque, serviço
// e profissional logo abaixo, status em português com ícone e cor. Telefone,
// duração e preço ficam numa linha secundária, menor.
//
// Bloco de apresentação: não decide nada. As ações (quando há) chegam prontas
// como `children` e ficam no rodapé do cartão.
import type { ReactNode } from "react";
import clsx from "clsx";
import {
  CalendarCheck,
  CheckCircle2,
  CircleDashed,
  Clock,
  PlayCircle,
  UserX,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import type { AgendamentoReal, StatusAgendamentoReal } from "@/lib/api/appointments-api";
import { ROTULO_STATUS, rotuloDeDuracao, rotuloDePreco } from "@/lib/profissionais/agendamentos";
import { Badge, type CorBadge } from "@/components/ui/badge-base";

const APARENCIA_STATUS: Record<StatusAgendamentoReal, { cor: CorBadge; icone: LucideIcon }> = {
  PENDING: { cor: "aviso", icone: CircleDashed },
  CONFIRMED: { cor: "info", icone: CalendarCheck },
  IN_PROGRESS: { cor: "destaque", icone: PlayCircle },
  COMPLETED: { cor: "sucesso", icone: CheckCircle2 },
  CANCELED: { cor: "neutro", icone: XCircle },
  NO_SHOW: { cor: "erro", icone: UserX },
};

/** Status sempre com TEXTO, nunca só a cor. */
export function StatusDoAtendimento({ status }: { status: StatusAgendamentoReal }) {
  const { cor, icone: Icone } = APARENCIA_STATUS[status];
  return (
    <Badge cor={cor}>
      <Icone size={13} aria-hidden="true" />
      <span data-testid="status-agendado">{ROTULO_STATUS[status]}</span>
    </Badge>
  );
}

interface CartaoAtendimentoProps {
  agendamento: AgendamentoReal;
  /** Entre o início e o fim do atendimento pelo relógio do navegador (só
   * destaque visual; não decide ação nenhuma). */
  noHorario: boolean;
  /** A reserva que acabou de ser criada por esta tela. */
  recemCriada: boolean;
  /** A reserva aberta a partir do Calendário. */
  destacada?: boolean;
  children?: ReactNode;
}

export function CartaoAtendimento({
  agendamento,
  noHorario,
  recemCriada,
  destacada = false,
  children,
}: CartaoAtendimentoProps) {
  const emAtendimento = agendamento.status === "IN_PROGRESS";
  const encerrado =
    agendamento.status === "CANCELED" ||
    agendamento.status === "NO_SHOW" ||
    agendamento.status === "COMPLETED";

  return (
    <article
      data-em-atendimento={emAtendimento || undefined}
      data-recem-criada={recemCriada || undefined}
      data-destacada={destacada || undefined}
      aria-label={`${agendamento.localStart} ${agendamento.consumer.name}`}
      className={clsx(
        "overflow-hidden rounded-[var(--radius-card)] border border-border",
        emAtendimento ? "bg-accent-soft/40" : "bg-card",
        // Faixa à esquerda por sombra interna, não por borda: a regra global de
        // `border-color` em globals.css venceria uma cor de borda utilitária.
        // Uma sombra só por cartão — duas utilidades de sombra brigariam.
        emAtendimento
          ? "shadow-[inset_5px_0_0_var(--color-accent)]"
          : noHorario
            ? "shadow-[inset_5px_0_0_var(--color-info)]"
            : "shadow-[var(--shadow-soft)]",
        recemCriada && "ring-2 ring-[color:var(--color-success)]",
        destacada && !recemCriada && "ring-2 ring-[color:var(--color-accent)]",
      )}
    >
      <div className="flex gap-3 p-4 sm:gap-5 sm:p-5">
        <p
          data-testid="horario-agendado"
          className={clsx(
            "flex w-14 shrink-0 flex-col tabular-nums sm:w-16",
            encerrado && "opacity-60",
          )}
        >
          <span className="text-lg leading-tight font-bold text-ink sm:text-xl">
            {agendamento.localStart}
          </span>
          <span className="sr-only">–</span>
          <span className="text-sm text-ink-soft">{agendamento.localServiceEnd}</span>
        </p>

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
            <p
              data-testid="cliente-agendado"
              className={clsx(
                "min-w-0 text-base font-semibold break-words text-ink sm:text-lg",
                agendamento.status === "CANCELED" && "line-through decoration-1",
              )}
            >
              {agendamento.consumer.name}
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              {recemCriada && <Badge cor="sucesso">Novo</Badge>}
              {noHorario && !emAtendimento && (
                <Badge cor="info">
                  <Clock size={13} aria-hidden="true" />
                  No horário agora
                </Badge>
              )}
              <StatusDoAtendimento status={agendamento.status} />
            </div>
          </div>
          <p className="text-sm text-ink">
            <span className="font-medium">{agendamento.service.name}</span>
            <span className="text-ink-soft"> · com </span>
            <span className="font-medium">{agendamento.professional.name}</span>
          </p>
          <p className="text-xs text-ink-soft">
            {agendamento.consumer.whatsapp} · {rotuloDeDuracao(agendamento.durationMinutes)} ·{" "}
            {rotuloDePreco(agendamento.priceCents)}
          </p>
        </div>
      </div>

      {children && (
        <div className="border-t border-border bg-paper/60 px-4 py-3 sm:px-5">{children}</div>
      )}
    </article>
  );
}
