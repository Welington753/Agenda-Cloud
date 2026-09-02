import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes } from "react";
import Link from "next/link";
import clsx from "clsx";

type Variante = "primaria" | "secundaria" | "fantasma" | "perigo";
type Tamanho = "sm" | "md" | "lg";

interface BotaoProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: Variante;
  tamanho?: Tamanho;
}

const CLASSE_BASE =
  "inline-flex items-center justify-center rounded-[var(--radius-control)] font-semibold transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50";

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
      className={clsx(CLASSE_BASE, CLASSE_VARIANTE[variante], CLASSE_TAMANHO[tamanho], className)}
      {...props}
    />
  );
});

interface LinkBotaoProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  variante?: Variante;
  tamanho?: Tamanho;
}

/** Link estilizado como botão — para CTAs de navegação. Nunca envolva um
 * `<Botao>` (que renderiza `<button>`) num `<Link>`: isso aninha
 * `<a><button></button></a>`, HTML inválido e ruim para leitor de tela. Use
 * este componente no lugar. */
export const LinkBotao = forwardRef<HTMLAnchorElement, LinkBotaoProps>(function LinkBotao(
  { variante = "primaria", tamanho = "md", className, href, ...props },
  ref
) {
  return (
    <Link
      ref={ref}
      href={href}
      className={clsx(CLASSE_BASE, CLASSE_VARIANTE[variante], CLASSE_TAMANHO[tamanho], className)}
      {...props}
    />
  );
});
