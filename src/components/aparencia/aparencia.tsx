"use client";

// Peças da aparência (ver lib/aparencia/tema.ts):
// - MarcadorAparencia: declara a página como ADAPTÁVEL. Só com ele na página
//   o CSS aplica o tema escuro (globals.css, `:has([data-aparencia-adaptavel])`);
//   a demonstração não o usa e continua clara.
// - MarcadorTemaAzul: declara que a página DESENHA o tema "Azul e branco"
//   (por ora, só o portal da plataforma). Sem ele, quem escolheu o azul vê o
//   Claro.
// - MarcadorAparelho: a página segue SEMPRE o aparelho (agendamento público).
//   Não lê nem grava a escolha salva: o `data-tema` do dono fica intacto no
//   <html> e volta a valer assim que ele entra de novo na área privada.
// - SeletorAparencia: Claro / Escuro / Seguir aparelho (+ Azul e branco onde
//   o tema existe). Rádios nativos, então setas do teclado, foco e leitor de
//   tela funcionam sem código extra.
import { useId, useLayoutEffect } from "react";
import clsx from "clsx";
import { Monitor, Moon, PanelsTopLeft, Sun, type LucideIcon } from "lucide-react";
import { opcoesAparencia, type PreferenciaAparencia } from "@/lib/aparencia/tema";
import { reaplicarAparenciaSalva, useAparencia } from "@/lib/aparencia/use-aparencia";

export function MarcadorAparencia() {
  useLayoutEffect(() => reaplicarAparenciaSalva(), []);
  return <span data-aparencia-adaptavel="" hidden />;
}

export function MarcadorTemaAzul() {
  return <span data-tema-azul-disponivel="" hidden />;
}

export function MarcadorAparelho() {
  return <span data-aparencia-aparelho="" hidden />;
}

const ICONE: Record<PreferenciaAparencia, LucideIcon> = {
  claro: Sun,
  escuro: Moon,
  sistema: Monitor,
  azul: PanelsTopLeft,
};

export function SeletorAparencia({
  className,
  temaAzulDisponivel = false,
}: {
  className?: string;
  /** A página desenha o tema "Azul e branco" (portal da plataforma). */
  temaAzulDisponivel?: boolean;
}) {
  const { preferencia, escolher } = useAparencia();
  const nome = useId();
  const opcoes = opcoesAparencia(temaAzulDisponivel, preferencia);
  return (
    <fieldset className={clsx("min-w-0", className)} data-testid="seletor-aparencia">
      <legend className="mb-1.5 text-xs font-semibold text-ink-soft">Aparência</legend>
      <div
        className={clsx(
          "grid gap-1 rounded-[var(--radius-control)] border border-border bg-paper-muted p-1",
          opcoes.length > 3 ? "grid-cols-2" : "grid-cols-3",
        )}
      >
        {opcoes.map(({ valor, rotulo }) => {
          const Icone = ICONE[valor];
          const ativa = preferencia === valor;
          return (
            <label
              key={valor}
              className={clsx(
                "flex min-h-11 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-[calc(var(--radius-control)-2px)] px-1 text-center text-[11px] leading-tight font-medium",
                "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-focus",
                ativa ? "bg-card text-ink shadow-[var(--shadow-soft)]" : "text-ink-soft hover:text-ink",
              )}
            >
              <input
                type="radio"
                name={nome}
                value={valor}
                checked={ativa}
                onChange={() => escolher(valor)}
                className="sr-only"
              />
              <Icone size={16} aria-hidden="true" />
              {rotulo}
            </label>
          );
        })}
      </div>
      {!temaAzulDisponivel && preferencia === "azul" && (
        <p className="mt-1.5 text-xs text-ink-soft" data-testid="aviso-azul-indisponivel">
          Nesta área, Azul e branco ainda aparece como Claro.
        </p>
      )}
    </fieldset>
  );
}
