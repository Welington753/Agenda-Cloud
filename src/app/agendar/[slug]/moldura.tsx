"use client";

// Moldura da página pública de agendamento: cabeçalho do estabelecimento
// (iniciais, já que o contrato público não traz logo), rodapé e o indicador
// de etapas. Cores só por tokens (globals.css); a aparência é sempre a do
// aparelho, sem seletor (ver layout.tsx).
import { forwardRef, type ReactNode } from "react";
import clsx from "clsx";
import { ArrowLeft } from "lucide-react";
import { iniciaisDoEstabelecimento } from "@/lib/agendamento-publico/agendamento-publico";
import { ETAPAS, type Etapa } from "@/lib/agendamento-publico/fluxo-publico";
import { NOME_PRODUTO } from "@/lib/config";

export function Moldura({
  estabelecimento,
  children,
}: {
  estabelecimento?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <main className="mx-auto w-full max-w-2xl flex-1 space-y-5 px-4 pt-5 pb-8 sm:pt-8">
        {estabelecimento && (
          <header className="flex items-center gap-3">
            <span
              aria-hidden="true"
              data-testid="iniciais-estabelecimento"
              className="grid size-12 shrink-0 place-items-center rounded-full bg-accent-soft text-base font-bold text-ink"
            >
              {iniciaisDoEstabelecimento(estabelecimento)}
            </span>
            <div className="min-w-0">
              <h1 className="text-xl leading-tight font-bold break-words text-ink sm:text-2xl">{estabelecimento}</h1>
              <p className="text-sm text-ink-soft">Agendamento online</p>
            </div>
          </header>
        )}
        {children}
      </main>
      <footer className="mx-auto w-full max-w-2xl space-y-3 px-4 pt-2 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
        <p className="text-xs text-ink-soft">Agendamento por {NOME_PRODUTO}</p>
      </footer>
    </div>
  );
}

// ------------------------------------------------------------ etapas

export function Progresso({ etapa }: { etapa: Etapa }) {
  return (
    <div className="space-y-2" data-testid="progresso-agendamento">
      <p className="text-xs font-medium text-ink-soft">
        Etapa {etapa + 1} de {ETAPAS.length}
      </p>
      <ol className="grid grid-cols-5 gap-1" aria-label="Etapas do agendamento">
        {ETAPAS.map((nome, i) => (
          <li key={nome} aria-current={i === etapa ? "step" : undefined} className="min-w-0">
            <span
              aria-hidden="true"
              className={clsx("block h-1.5 rounded-full", i <= etapa ? "bg-accent" : "bg-border")}
            />
            <span className="sr-only">
              {nome}
              {i < etapa ? " (concluída)" : i === etapa ? " (etapa atual)" : ""}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Voltar, título e o que já foi escolhido. O título recebe o foco ao trocar
 * de etapa (leitor de tela anuncia onde a pessoa está). */
export const CabecalhoEtapa = forwardRef<
  HTMLHeadingElement,
  {
    titulo: string;
    aoVoltar: (() => void) | null;
    travado: boolean;
    servico: string | null;
    profissional: string | null;
    quando: string | null;
  }
>(function CabecalhoEtapa({ titulo, aoVoltar, travado, servico, profissional, quando }, ref) {
  return (
    <div className="space-y-1">
      {aoVoltar && (
        <button
          type="button"
          disabled={travado}
          onClick={aoVoltar}
          data-testid="voltar-etapa"
          className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-[var(--radius-control)] px-2 text-sm font-medium text-[color:var(--color-accent-hover)] hover:underline focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-50"
        >
          <ArrowLeft size={16} aria-hidden="true" /> Voltar
        </button>
      )}
      <h2 ref={ref} tabIndex={-1} className="text-lg font-semibold text-ink focus:outline-none" data-testid="titulo-etapa">
        {titulo}
      </h2>
      {servico && (
        <p className="text-sm text-ink-soft" data-testid="contexto-escolhas">
          <span className="font-medium text-ink">{servico}</span>
          {profissional && <> · com {profissional}</>}
          {quando && <> · {quando}</>}
        </p>
      )}
    </div>
  );
});
