import type { HTMLAttributes } from "react";
import clsx from "clsx";

export function Cartao({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx(
        "rounded-[var(--radius-card)] border border-border bg-card shadow-[var(--shadow-soft)]",
        className
      )}
      {...props}
    />
  );
}

export function CartaoCorpo({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={clsx("p-4 sm:p-5", className)} {...props} />;
}

export function CartaoTitulo({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={clsx("text-sm font-semibold text-ink-soft", className)} {...props} />;
}
