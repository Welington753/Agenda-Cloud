// Marca do Agenda Cloud: o símbolo (o mesmo calendário do ícone do
// aplicativo, lib/pwa/icone.tsx, redesenhado em traço) e o nome. Em SVG
// inline, na cor do texto ao redor (`currentColor`): nada de imagem, e o
// símbolo acompanha o tema.
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
      {/* Moldura e faixa do topo do calendário. */}
      <rect x="2.75" y="3.75" width="18.5" height="17.5" rx="3.25" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2.75 8.75h18.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7.5 2v3.5M16.5 2v3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      {/* Seis dias; o horário marcado é o único cheio. */}
      <g fill="currentColor">
        <rect x="6" y="11.5" width="2.5" height="2.5" rx="0.6" opacity="0.45" />
        <rect x="10.75" y="11.5" width="2.5" height="2.5" rx="0.6" opacity="0.45" />
        <rect x="15.5" y="11.5" width="2.5" height="2.5" rx="0.6" opacity="0.45" />
        <rect x="6" y="16" width="2.5" height="2.5" rx="0.6" opacity="0.45" />
        <rect x="10.75" y="16" width="2.5" height="2.5" rx="0.6" />
        <rect x="15.5" y="16" width="2.5" height="2.5" rx="0.6" opacity="0.45" />
      </g>
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
