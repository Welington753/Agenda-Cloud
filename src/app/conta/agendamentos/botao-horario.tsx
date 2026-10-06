"use client";

import { Check } from "lucide-react";

// Botão de um horário livre, usado na criação e na remarcação. O escolhido se
// distingue por mais do que cor: ícone de confirmação, anel de destaque, peso
// da fonte e `aria-pressed` para leitor de tela. O foco de teclado continua o
// `:focus-visible` global, fora do anel.
export function BotaoHorario({
  selecionado,
  className = "",
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { selecionado: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={selecionado}
      className={`inline-flex items-center gap-1 rounded-[var(--radius-control)] border px-3 py-1.5 text-sm ${
        selecionado
          ? "border-accent bg-accent-soft font-semibold text-ink ring-1 ring-accent"
          : "border-border bg-card text-ink"
      } ${className}`}
      {...props}
    >
      {selecionado && <Check size={14} aria-hidden="true" />}
      {children}
    </button>
  );
}
