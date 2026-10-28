"use client";

// Um atendimento da agenda do dia, desenhado para ser lido de relance durante
// o trabalho: horário (início e fim) à esquerda, em números alinhados e com
// peso; o cliente logo depois; serviço, profissional, duração, telefone e
// preço com menos destaque. Status em português com ícone próprio, em tons
// neutros: o rótulo e o ícone distinguem um do outro, nunca só a cor.
//
// É uma LINHA: a borda, o fundo e os separadores entre atendimentos são da
// lista que a contém (agenda-do-dia.tsx e agenda-por-profissional.tsx).
//
// Bloco de apresentação: não decide nada. As ações (quando há) chegam prontas
// como `children` e ficam embaixo, alinhadas com o texto.
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
import { Badge } from "@/components/ui/badge-base";

const APARENCIA_STATUS: Record<StatusAgendamentoReal, { classe: string; icone: LucideIcon }> = {
  PENDING: { classe: "border border-dashed border-border-strong text-ink-soft", icone: CircleDashed },
  CONFIRMED: { classe: "border border-border-control text-ink", icone: CalendarCheck },
  IN_PROGRESS: { classe: "border border-transparent bg-ink text-paper", icone: PlayCircle },
  COMPLETED: { classe: "border border-transparent bg-paper-muted text-ink-soft", icone: CheckCircle2 },
  CANCELED: { classe: "border border-border text-ink-muted", icone: XCircle },
  NO_SHOW: { classe: "border border-transparent bg-paper-muted text-ink", icone: UserX },
};

/** Status sempre com TEXTO e ícone, nunca só a cor. */
export function StatusDoAtendimento({ status }: { status: StatusAgendamentoReal }) {
  const { classe, icone: Icone } = APARENCIA_STATUS[status];
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-[var(--radius-control)] px-2 py-0.5 text-xs font-semibold whitespace-nowrap",
        classe,
      )}
    >
      <Icone size={13} aria-hidden="true" />
      <span data-testid="status-agendado">{ROTULO_STATUS[status]}</span>
    </span>
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

  const selecionada = recemCriada || destacada;

  return (
    <article
      data-em-atendimento={emAtendimento || undefined}
      data-recem-criada={recemCriada || undefined}
      data-destacada={destacada || undefined}
      aria-label={`${agendamento.localStart} ${agendamento.consumer.name}`}
      className={clsx(
        "px-4 py-3.5 sm:px-5 sm:py-4",
        // Linha de 3 px à esquerda por sombra interna (a regra global de
        // `border-color` venceria uma borda utilitária). Selecionado é o
        // atendimento recém-criado ou aberto pelo Calendário; em atendimento e
        // "no horário agora" ganham só a linha, mais discreta.
        selecionada
          ? "bg-accent-soft shadow-[inset_3px_0_0_var(--color-ink)]"
          : emAtendimento
            ? "shadow-[inset_3px_0_0_var(--color-ink-soft)]"
            : noHorario && "shadow-[inset_3px_0_0_var(--color-border-strong)]",
      )}
    >
      <div className="flex gap-3 sm:gap-5">
        <p
          data-testid="horario-agendado"
          className={clsx("flex w-12 shrink-0 flex-col tabular-nums sm:w-14", encerrado && "opacity-60")}
        >
          <span className="text-base leading-tight font-semibold tracking-tight text-ink sm:text-lg">
            {agendamento.localStart}
          </span>
          <span className="sr-only">–</span>
          <span className="text-xs text-ink-muted">{agendamento.localServiceEnd}</span>
        </p>

        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
            <p
              data-testid="cliente-agendado"
              className={clsx(
                "min-w-0 text-[15px] leading-snug font-semibold break-words text-ink sm:text-base",
                agendamento.status === "CANCELED" && "text-ink-soft line-through decoration-1",
              )}
            >
              {agendamento.consumer.name}
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              {recemCriada && <Badge cor="sucesso">Novo</Badge>}
              {noHorario && !emAtendimento && (
                <Badge cor="neutro">
                  <Clock size={13} aria-hidden="true" />
                  No horário agora
                </Badge>
              )}
              <StatusDoAtendimento status={agendamento.status} />
            </div>
          </div>
          <p className="text-sm text-ink-soft">
            <span>{agendamento.service.name}</span>
            <span> · </span>
            <span className="tabular-nums">{rotuloDeDuracao(agendamento.durationMinutes)}</span>
            <span> · com {agendamento.professional.name}</span>
          </p>
          <p className="text-xs text-ink-muted tabular-nums">
            {agendamento.consumer.whatsapp} · {rotuloDePreco(agendamento.priceCents)}
          </p>
        </div>
      </div>

      {/* Ações alinhadas com o texto (depois da coluna do horário). */}
      {children && <div className="mt-3 sm:pl-[4.75rem]">{children}</div>}
    </article>
  );
}
