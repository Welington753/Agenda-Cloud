"use client";

// Calendário da agenda (mês, semana e dia), usado pelo dono (agenda geral) e
// pelo funcionário (só a própria agenda). Só APRESENTA: quem lê o período do
// servidor, quem autoriza e quem abre os detalhes é a página que o usa. Não
// há arrastar para remarcar: remarcar continua pelas ações da agenda, com as
// verificações de sempre no servidor.
//
// Celular: sem grade de computador espremida e sem rolagem horizontal. O mês
// vira uma grade compacta de dias com a quantidade de atendimentos, e a lista
// do dia tocado aparece logo abaixo; a semana vira uma lista por dia.
//
// A situação de cada atendimento aparece sempre em TEXTO, além da cor.
import type { ReactNode } from "react";
import clsx from "clsx";
import { AlertTriangle, ChevronLeft, ChevronRight } from "lucide-react";
import { deslocar, porData, tituloDoPeriodo, type VisaoDoCalendario } from "@/lib/profissionais/calendario";
import { ListaDoDia, Mes, Semana, type ItemDoCalendario } from "./calendario-visoes";
import { Botao } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export type { ItemDoCalendario };

const VISOES: { valor: VisaoDoCalendario; rotulo: string }[] = [
  { valor: "mes", rotulo: "Mês" },
  { valor: "semana", rotulo: "Semana" },
  { valor: "dia", rotulo: "Dia" },
];

interface CalendarioAgendaProps {
  visao: VisaoDoCalendario;
  /** Dia de referência do período (e o dia tocado, no mês do celular). */
  data: string;
  /** Hoje no fuso do estabelecimento, quando já conhecido. */
  hoje: string | null;
  itens: readonly ItemDoCalendario[] | null;
  carregando: boolean;
  erro: string | null;
  /** `false`: o período tem mais atendimentos do que a consulta trouxe. */
  completa: boolean;
  aoMudarVisao: (visao: VisaoDoCalendario) => void;
  aoMudarData: (data: string) => void;
  aoHoje: () => void;
  aoRepetir: () => void;
  /** Abre o atendimento com as ações de sempre (lista do dia). */
  aoAbrir: (item: ItemDoCalendario) => void;
  /** Filtros e ações extras da barra (profissional, novo agendamento). */
  extras?: ReactNode;
}

export function CalendarioAgenda(props: CalendarioAgendaProps) {
  const { visao, data, hoje, itens, carregando, erro, completa, aoMudarVisao, aoMudarData, aoHoje, aoRepetir, extras } =
    props;
  const grupos = porData(itens ?? []);

  return (
    <section aria-label="Calendário" data-testid="calendario" data-visao={visao} className="space-y-4">
      <div className="space-y-3 rounded-[var(--radius-card)] border border-border bg-card p-4 shadow-[var(--shadow-soft)]">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div
            role="group"
            aria-label="Período do calendário"
            className="inline-flex w-full rounded-[var(--radius-control)] border border-border bg-card p-1 lg:w-auto"
          >
            {VISOES.map(({ valor, rotulo }) => (
              <button
                key={valor}
                type="button"
                aria-pressed={visao === valor}
                onClick={() => aoMudarVisao(valor)}
                className={clsx(
                  "min-h-11 flex-1 rounded-[calc(var(--radius-control)-2px)] px-4 text-sm font-medium lg:flex-none",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
                  visao === valor ? "bg-accent-soft font-semibold text-ink shadow-[inset_0_0_0_1px_var(--color-border-control)]" : "text-ink-soft hover:text-ink",
                )}
              >
                {rotulo}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Botao
              type="button"
              variante="secundaria"
              aria-label="Período anterior"
              onClick={() => aoMudarData(deslocar(visao, data, -1))}
            >
              <ChevronLeft size={16} aria-hidden="true" />
            </Botao>
            <Botao type="button" variante="secundaria" onClick={aoHoje} data-testid="calendario-hoje">
              Hoje
            </Botao>
            <Botao
              type="button"
              variante="secundaria"
              aria-label="Próximo período"
              onClick={() => aoMudarData(deslocar(visao, data, 1))}
            >
              <ChevronRight size={16} aria-hidden="true" />
            </Botao>
          </div>
        </div>
        <h2 className="text-lg font-bold text-ink first-letter:uppercase" data-testid="calendario-titulo" aria-live="polite">
          {tituloDoPeriodo(visao, data)}
        </h2>
        {extras && <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">{extras}</div>}
      </div>

      {erro && (
        <div className="space-y-3 rounded-[var(--radius-card)] border border-border bg-card p-4" data-testid="calendario-erro">
          <p role="alert" className="text-sm text-ink">
            {erro}
          </p>
          <Botao type="button" onClick={aoRepetir}>
            Tentar novamente
          </Botao>
        </div>
      )}

      {!erro && !completa && (
        <p
          role="note"
          data-testid="calendario-incompleto"
          className="flex items-start gap-2 rounded-[var(--radius-control)] bg-warning-soft px-3 py-2 text-sm text-ink"
        >
          <AlertTriangle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
          Este período tem mais atendimentos do que o calendário consegue trazer de uma vez. Use a visão de semana
          ou de dia para ver todos.
        </p>
      )}

      {!erro && carregando && !itens && <Skeleton className="h-64 w-full" />}

      {!erro && itens && (
        <div aria-busy={carregando}>
          {visao === "mes" && <Mes {...props} grupos={grupos} />}
          {visao === "semana" && <Semana {...props} grupos={grupos} />}
          {visao === "dia" && <ListaDoDia itens={grupos.get(data) ?? []} aoAbrir={props.aoAbrir} data={data} hoje={hoje} />}
        </div>
      )}
    </section>
  );
}
