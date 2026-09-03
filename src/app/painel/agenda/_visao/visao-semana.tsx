import { isSameDay } from "date-fns";
import clsx from "clsx";
import { formatarMoeda } from "@/lib/format";
import type { Agendamento, Profissional, StatusAgendamento } from "@/lib/types";
import type { Terminologia } from "@/lib/verticals/terminologia";
import { agendamentosDoDia } from "../selecao-do-dia";

interface VisaoSemanaProps {
  diasDaSemana: Date[];
  profissionaisExibidos: Profissional[];
  agendamentos: Agendamento[];
  filtroStatus: StatusAgendamento | "todos";
  terminologia: Terminologia;
  aoSelecionarDia: (dia: Date) => void;
}

export function VisaoSemana({ diasDaSemana, profissionaisExibidos, agendamentos, filtroStatus, terminologia, aoSelecionarDia }: VisaoSemanaProps) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
      {diasDaSemana.map((dia) => {
        const itensDoDiaPorProfissional = profissionaisExibidos.map((p) => agendamentosDoDia(agendamentos, p.id, dia, filtroStatus));
        const totalDia = itensDoDiaPorProfissional.reduce((soma, itens) => soma + itens.length, 0);
        const faturamentoDia = itensDoDiaPorProfissional.reduce(
          (soma, itens) =>
            soma + itens.filter((a) => a.status !== "cancelado" && a.status !== "nao_compareceu").reduce((s, a) => s + (a.precoCentavos ?? 0), 0),
          0
        );
        return (
          <button
            key={dia.toISOString()}
            type="button"
            onClick={() => aoSelecionarDia(dia)}
            className={clsx(
              "rounded-[var(--radius-card)] border p-3 text-left transition-colors hover:border-accent",
              isSameDay(dia, new Date()) ? "border-accent bg-accent-soft/40" : "border-border bg-card"
            )}
          >
            <p className="text-xs font-semibold uppercase text-ink-soft">
              {dia.toLocaleDateString("pt-BR", { weekday: "short" })}
            </p>
            <p className="text-lg font-bold text-ink">{dia.getDate()}</p>
            <p className="mt-1 text-xs text-ink-soft">
              {totalDia} {totalDia === 1 ? terminologia.agendamento.singular.toLowerCase() : terminologia.agendamento.plural.toLowerCase()}
            </p>
            <p className="text-xs font-semibold text-accent">{formatarMoeda(faturamentoDia)}</p>
          </button>
        );
      })}
    </div>
  );
}
