import clsx from "clsx";
import type { OpcaoRotulada } from "@/lib/onboarding/onboarding";

interface GrupoOpcoesProps<T extends string> {
  legenda: string;
  opcoes: { valor: T; rotulo: string; descricao?: string }[] | OpcaoRotulada<T>[];
  valor: T | null;
  aoEscolher: (valor: T) => void;
}

/** Grupo de opções em botões, acessível como um `radiogroup` nativo do
 * teclado (Tab até o grupo, Enter/Espaço escolhe) — usado nas etapas de
 * escolha única do onboarding (segmento, estrutura, equipe, objetivo). */
export function GrupoOpcoes<T extends string>({ legenda, opcoes, valor, aoEscolher }: GrupoOpcoesProps<T>) {
  return (
    <fieldset>
      <legend className="mb-3 text-base font-semibold text-ink">{legenda}</legend>
      <div role="radiogroup" aria-label={legenda} className="grid gap-2 sm:grid-cols-2">
        {opcoes.map((opcao) => {
          const selecionado = valor === opcao.valor;
          return (
            <button
              key={opcao.valor}
              type="button"
              role="radio"
              aria-checked={selecionado}
              onClick={() => aoEscolher(opcao.valor)}
              className={clsx(
                "rounded-[var(--radius-card)] border px-4 py-3 text-left text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
                selecionado ? "border-accent bg-accent-soft text-ink" : "border-border bg-card text-ink hover:bg-paper-muted"
              )}
            >
              <span className="font-semibold">{opcao.rotulo}</span>
              {opcao.descricao && <span className="mt-0.5 block text-xs text-ink-soft">{opcao.descricao}</span>}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
