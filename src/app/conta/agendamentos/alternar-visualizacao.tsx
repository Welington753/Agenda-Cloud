"use client";

// Alternância "Lista" / "Por profissional" da agenda do dia. Só troca a
// apresentação: a agenda já carregada, o filtro e as ações continuam os
// mesmos (ver agenda-do-dia.tsx).
import clsx from "clsx";
import { List, Users } from "lucide-react";
import type { VisualizacaoAgenda } from "@/lib/profissionais/agenda-visual";

const OPCOES: { valor: VisualizacaoAgenda; rotulo: string; icone: typeof List }[] = [
  { valor: "lista", rotulo: "Lista", icone: List },
  { valor: "profissional", rotulo: "Por profissional", icone: Users },
];

interface AlternarVisualizacaoProps {
  valor: VisualizacaoAgenda;
  aoMudar: (valor: VisualizacaoAgenda) => void;
}

export function AlternarVisualizacao({ valor, aoMudar }: AlternarVisualizacaoProps) {
  return (
    <div
      role="group"
      aria-label="Visualização da agenda"
      className="inline-flex w-full rounded-[var(--radius-control)] border border-border bg-card p-1 sm:w-auto"
    >
      {OPCOES.map(({ valor: opcao, rotulo, icone: Icone }) => {
        const ativa = opcao === valor;
        return (
          <button
            key={opcao}
            type="button"
            aria-pressed={ativa}
            onClick={() => aoMudar(opcao)}
            className={clsx(
              "inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-[calc(var(--radius-control)-2px)] px-4 text-sm font-medium sm:flex-none",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
              ativa ? "bg-ink text-white" : "text-ink-soft hover:bg-paper-muted hover:text-ink",
            )}
          >
            <Icone size={16} aria-hidden="true" />
            {rotulo}
          </button>
        );
      })}
    </div>
  );
}
