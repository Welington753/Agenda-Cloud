// Etiqueta genérica de apresentação: cor + texto, sem conhecer domínio
// nenhum. Separada de badge.tsx (que mapeia os status da demonstração) para a
// área real poder reutilizá-la sem depender dos tipos da simulação.
import clsx from "clsx";

export type CorBadge = "neutro" | "sucesso" | "erro" | "aviso" | "info" | "destaque";

const CLASSE_COR: Record<CorBadge, string> = {
  neutro: "bg-paper-muted text-ink-soft",
  sucesso: "bg-success-soft text-[color:var(--color-success)]",
  erro: "bg-danger-soft text-[color:var(--color-danger)]",
  aviso: "bg-warning-soft text-[color:var(--color-warning)]",
  info: "bg-info-soft text-[color:var(--color-info)]",
  destaque: "bg-accent-soft text-[color:var(--color-accent-hover)]",
};

export function Badge({
  cor = "neutro",
  children,
  ...props
}: {
  cor?: CorBadge;
  children: React.ReactNode;
} & Omit<React.HTMLAttributes<HTMLSpanElement>, "className">) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap",
        CLASSE_COR[cor],
      )}
      {...props}
    >
      {children}
    </span>
  );
}
