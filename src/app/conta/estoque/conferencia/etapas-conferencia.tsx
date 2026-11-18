// Etapas da conferência (Contar, Revisar, Confirmar), com o nome de cada uma
// visível também no celular. Só desenha: quem decide a etapa é a página.
import clsx from "clsx";
import { Check } from "lucide-react";

export const ETAPAS_DA_CONFERENCIA = ["Contar", "Revisar", "Confirmar"] as const;

export function EtapasDaConferencia({ atual }: { atual: number }) {
  return (
    <ol className="flex w-full min-w-0 items-center gap-1.5 sm:gap-3" aria-label="Etapas da conferência">
      {ETAPAS_DA_CONFERENCIA.map((etapa, i) => {
        const concluida = i < atual;
        const corrente = i === atual;
        return (
          <li key={etapa} className="flex min-w-0 flex-1 items-center gap-1.5 last:flex-none sm:gap-3">
            <span className="flex items-center gap-1.5 sm:gap-2" aria-current={corrente ? "step" : undefined}>
              <span
                className={clsx(
                  "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold sm:size-8 sm:text-sm",
                  concluida && "bg-[color:var(--color-success)] text-on-accent",
                  corrente && "bg-accent text-on-accent",
                  !concluida && !corrente && "bg-paper-muted text-ink-soft",
                )}
              >
                {concluida ? <Check size={16} aria-hidden="true" /> : i + 1}
              </span>
              <span className={clsx("text-[13px] font-semibold sm:text-sm",corrente ? "text-[color:var(--color-accent-hover)]" : concluida ? "text-ink" : "text-ink-soft")}>
                {etapa}
                {concluida && <span className="sr-only"> (concluída)</span>}
              </span>
            </span>
            {i < ETAPAS_DA_CONFERENCIA.length - 1 && <span aria-hidden="true" className={clsx("h-0.5 min-w-2 flex-1 rounded", concluida ? "bg-accent" : "bg-border")} />}
          </li>
        );
      })}
    </ol>
  );
}
