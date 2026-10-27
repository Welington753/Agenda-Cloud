"use client";

// Alternância "Lista" / "Por profissional" / "Calendário" da agenda. As duas
// primeiras só trocam a apresentação do dia já carregado (ver
// agenda-do-dia.tsx); o Calendário mostra mês, semana ou dia
// (components/conta/calendario-agenda.tsx) e abre cada atendimento na lista
// do dia, onde ficam as ações.
import clsx from "clsx";
import { CalendarRange, List, Users } from "lucide-react";
import type { VisualizacaoAgenda } from "@/lib/profissionais/agenda-visual";

const OPCOES: { valor: VisualizacaoAgenda; rotulo: string; icone: typeof List }[] = [
  { valor: "lista", rotulo: "Lista", icone: List },
  { valor: "profissional", rotulo: "Por profissional", icone: Users },
  { valor: "calendario", rotulo: "Calendário", icone: CalendarRange },
];

interface AlternarVisualizacaoProps {
  valor: VisualizacaoAgenda;
  aoMudar: (valor: VisualizacaoAgenda) => void;
}

export function AlternarVisualizacao({ valor, aoMudar }: AlternarVisualizacaoProps) {
  return (
    <div
      role="group"
      aria-label="Visualização da agenda"
      className="inline-flex w-full rounded-[var(--radius-control)] border border-border bg-card p-1 sm:w-auto"
    >
      {OPCOES.map(({ valor: opcao, rotulo, icone: Icone }) => {
        const ativa = opcao === valor;
        return (
          <button
            key={opcao}
            type="button"
            aria-pressed={ativa}
            onClick={() => aoMudar(opcao)}
            className={clsx(
              "inline-flex min-h-11 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[calc(var(--radius-control)-2px)] px-2 text-sm font-medium sm:flex-none sm:gap-2 sm:px-4",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
              ativa ? "bg-ink text-paper" : "text-ink-soft hover:bg-paper-muted hover:text-ink",
            )}
          >
            <Icone size={16} aria-hidden="true" className="hidden shrink-0 min-[400px]:block" />
            <span className="truncate">{rotulo}</span>
          </button>
        );
      })}
    </div>
  );
}
