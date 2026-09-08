import { Check } from "lucide-react";
import clsx from "clsx";

export function BarraDeEtapas({
  etapas,
  etapaAtual,
  ariaLabel = "Progresso do agendamento",
}: {
  etapas: string[];
  etapaAtual: number;
  ariaLabel?: string;
}) {
  return (
    <ol className="flex w-full items-center" aria-label={ariaLabel}>
      {etapas.map((etapa, indice) => {
        const concluida = indice < etapaAtual;
        const atual = indice === etapaAtual;
        return (
          <li key={etapa} className="flex flex-1 items-center last:flex-none">
            <div className="flex flex-col items-center gap-1.5">
              <div
                aria-current={atual ? "step" : undefined}
                className={clsx(
                  "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors",
                  concluida && "bg-accent text-white",
                  atual && !concluida && "border-2 border-accent text-accent",
                  !atual && !concluida && "border border-border text-ink-soft"
                )}
              >
                {concluida ? <Check size={14} /> : indice + 1}
              </div>
              <span
                className={clsx(
                  "hidden text-[11px] font-medium sm:block",
                  atual || concluida ? "text-ink" : "text-ink-soft"
                )}
              >
                {etapa}
              </span>
            </div>
            {indice < etapas.length - 1 && (
              <div className={clsx("mx-2 h-0.5 flex-1 rounded", concluida ? "bg-accent" : "bg-border")} />
            )}
          </li>
        );
      })}
    </ol>
  );
}
