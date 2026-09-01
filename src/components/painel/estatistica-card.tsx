import type { LucideIcon } from "lucide-react";
import { Cartao, CartaoCorpo } from "@/components/ui/card";

export function EstatisticaCard({
  icone: Icone,
  rotulo,
  valor,
  corIcone = "accent",
}: {
  icone: LucideIcon;
  rotulo: string;
  valor: string;
  corIcone?: "accent" | "success" | "danger" | "warning" | "info";
}) {
  const classeIcone: Record<string, string> = {
    accent: "bg-accent-soft text-[color:var(--color-accent-hover)]",
    success: "bg-success-soft text-[color:var(--color-success)]",
    danger: "bg-danger-soft text-[color:var(--color-danger)]",
    warning: "bg-warning-soft text-[color:var(--color-warning)]",
    info: "bg-info-soft text-[color:var(--color-info)]",
  };
  return (
    <Cartao>
      <CartaoCorpo className="flex items-center gap-3">
        <div className={`flex size-10 shrink-0 items-center justify-center rounded-full ${classeIcone[corIcone]}`}>
          <Icone size={18} />
        </div>
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-ink-soft">{rotulo}</p>
          <p className="text-xl font-bold text-ink">{valor}</p>
        </div>
      </CartaoCorpo>
    </Cartao>
  );
}
