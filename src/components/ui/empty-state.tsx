import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface EstadoVazioProps {
  icone: LucideIcon;
  titulo: string;
  descricao?: string;
  acao?: ReactNode;
}

export function EstadoVazio({ icone: Icone, titulo, descricao, acao }: EstadoVazioProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-[var(--radius-card)] border border-dashed border-border px-6 py-12 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-paper-muted text-ink-soft">
        <Icone size={22} />
      </div>
      <div className="space-y-1">
        <p className="font-semibold text-ink">{titulo}</p>
        {descricao && <p className="text-sm text-ink-soft">{descricao}</p>}
      </div>
      {acao}
    </div>
  );
}
