// Cartão de indicador (ícone, rótulo e valor). Genérico de apresentação: veio
// da demonstração (components/painel) e é usado também pela Visão geral real
// — não conhece dado nenhum, só o que recebe.
import type { LucideIcon } from "lucide-react";
import { Cartao, CartaoCorpo } from "@/components/ui/card";

const CLASSE_ICONE = {
  accent: "bg-accent-soft text-[color:var(--color-accent-hover)]",
  success: "bg-success-soft text-[color:var(--color-success)]",
  danger: "bg-danger-soft text-[color:var(--color-danger)]",
  warning: "bg-warning-soft text-[color:var(--color-warning)]",
  info: "bg-info-soft text-[color:var(--color-info)]",
} as const;

export function EstatisticaCard({
  icone: Icone,
  rotulo,
  valor,
  corIcone = "accent",
  testId,
}: {
  icone: LucideIcon;
  rotulo: string;
  valor: string;
  corIcone?: keyof typeof CLASSE_ICONE;
  testId?: string;
}) {
  return (
    <Cartao data-testid={testId}>
      <CartaoCorpo className="flex items-center gap-3">
        <div
          className={`flex size-10 shrink-0 items-center justify-center rounded-full ${CLASSE_ICONE[corIcone]}`}
        >
          <Icone size={18} aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-medium text-ink-soft">{rotulo}</p>
          <p
            className="text-2xl font-bold text-ink"
            data-testid={testId ? `${testId}-valor` : undefined}
          >
            {valor}
          </p>
        </div>
      </CartaoCorpo>
    </Cartao>
  );
}
