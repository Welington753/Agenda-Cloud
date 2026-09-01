import { forwardRef, type ButtonHTMLAttributes } from "react";
import clsx from "clsx";

type Variante = "primaria" | "secundaria" | "fantasma" | "perigo";
type Tamanho = "sm" | "md" | "lg";

interface BotaoProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: Variante;
  tamanho?: Tamanho;
}

const CLASSE_VARIANTE: Record<Variante, string> = {
  primaria: "bg-accent text-white hover:bg-[color:var(--color-accent-hover)] shadow-sm",
  secundaria: "bg-transparent text-ink border border-border hover:bg-paper-muted",
  fantasma: "bg-transparent text-ink hover:bg-paper-muted",
  perigo: "bg-danger text-white hover:opacity-90",
};

const CLASSE_TAMANHO: Record<Tamanho, string> = {
  sm: "text-sm px-3 py-1.5 gap-1.5",
  md: "text-sm px-4 py-2.5 gap-2",
  lg: "text-base px-5 py-3 gap-2",
};

export const Botao = forwardRef<HTMLButtonElement, BotaoProps>(function Botao(
  { variante = "primaria", tamanho = "md", className, disabled, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      disabled={disabled}
      className={clsx(
        "inline-flex items-center justify-center rounded-[var(--radius-control)] font-semibold transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50",
        CLASSE_VARIANTE[variante],
        CLASSE_TAMANHO[tamanho],
        className
      )}
      {...props}
    />
  );
});
