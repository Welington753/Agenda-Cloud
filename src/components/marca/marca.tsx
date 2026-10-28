// Marca do Agenda Cloud: o símbolo (duas barras inclinadas e um ponto, "//.")
// e o nome. Em SVG inline, na cor do texto ao redor (`currentColor`): nada de
// imagem, e o símbolo acompanha o tema.
import clsx from "clsx";
import { NOME_PRODUTO } from "@/lib/config";

export function SimboloAgendaCloud({ tamanho = 20, className }: { tamanho?: number; className?: string }) {
  return (
    <svg
      width={tamanho}
      height={tamanho}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={clsx("shrink-0", className)}
    >
      <path
        d="M3.5 19 8.5 5M10 19l5-14"
        stroke="currentColor"
        strokeWidth="2.75"
        strokeLinecap="round"
      />
      <circle cx="19.25" cy="17.75" r="1.9" fill="currentColor" />
    </svg>
  );
}

/** Símbolo + nome, na cor herdada. */
export function MarcaAgendaCloud({ className, tamanho = 22 }: { className?: string; tamanho?: number }) {
  return (
    <span className={clsx("inline-flex items-center gap-2 font-bold tracking-tight", className)}>
      <SimboloAgendaCloud tamanho={tamanho} />
      <span>{NOME_PRODUTO}</span>
    </span>
  );
}
