"use client";

// Aviso da reserva que acabou de ser criada, no topo da agenda: o que foi
// marcado (horário, cliente, serviço, profissional) e o status em português.
// O identificador técnico fica pequeno, no fim — serve para suporte, não para
// a leitura do dia.
import { CheckCircle2, X } from "lucide-react";
import type { AgendamentoReal } from "@/lib/api/appointments-api";
import { ROTULO_STATUS, rotuloDaData } from "@/lib/profissionais/agendamentos";

interface ReservaCriadaProps {
  reserva: AgendamentoReal;
  /** Data (`YYYY-MM-DD`) em que a reserva foi criada, no fuso do
   * estabelecimento — a data da agenda no momento da criação. */
  date: string;
  aoDispensar: () => void;
}

export function ReservaCriada({ reserva, date, aoDispensar }: ReservaCriadaProps) {
  return (
    <div
      data-testid="confirmacao"
      role="status"
      className="flex items-start gap-3 rounded-[var(--radius-card)] border border-border bg-success-soft p-4"
    >
      <CheckCircle2
        size={22}
        aria-hidden="true"
        className="mt-0.5 shrink-0 text-[color:var(--color-success)]"
      />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-sm font-semibold text-ink">Agendamento criado</p>
        <p className="text-sm text-ink">
          <span className="font-semibold tabular-nums">
            {reserva.localStart}–{reserva.localServiceEnd}
          </span>{" "}
          · {reserva.consumer.name} · {reserva.service.name} · com {reserva.professional.name}
        </p>
        <p className="text-xs text-ink-soft">
          Dia: {rotuloDaData(date)} · Status: {ROTULO_STATUS[reserva.status]}
        </p>
        <p className="text-[11px] text-ink-soft">
          Código: <span data-testid="id-reserva">{reserva.id}</span>
        </p>
      </div>
      <button
        type="button"
        aria-label="Dispensar aviso"
        onClick={aoDispensar}
        className="flex size-9 shrink-0 items-center justify-center rounded-full text-ink-soft hover:bg-card/60"
      >
        <X size={18} />
      </button>
    </div>
  );
}
