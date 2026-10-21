"use client";

// Topo da agenda: a data em destaque, Anterior/Hoje/Próximo, o campo de dia,
// o filtro de profissional, Atualizar e a ação principal "Novo agendamento".
//
// Só apresentação: quem calcula "hoje" no fuso do estabelecimento e anda os
// dias é page.tsx, com as funções puras de lib/profissionais/agenda-visual.ts.
import clsx from "clsx";
import { CalendarPlus, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { rotuloDaData } from "@/lib/profissionais/agendamentos";
import {
  TODOS_OS_PROFISSIONAIS,
  type OpcaoDeProfissional,
} from "@/lib/profissionais/agenda-visual";
import { Botao } from "@/components/ui/button";

const CLASSE_CAMPO =
  "min-h-11 w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink";

interface BarraAgendaProps {
  date: string;
  /** Fuso do estabelecimento, quando a agenda já respondeu. */
  timezone: string | null;
  ehHoje: boolean;
  resumo: string | null;
  carregando: boolean;
  profissionais: OpcaoDeProfissional[];
  filtroProfissionalId: string;
  aoMudarData: (date: string) => void;
  aoAnterior: () => void;
  aoProximo: () => void;
  aoHoje: () => void;
  aoFiltrar: (professionalId: string) => void;
  aoAtualizar: () => void;
  aoNovoAgendamento: () => void;
}

export function BarraAgenda(props: BarraAgendaProps) {
  const { date, timezone, ehHoje, resumo, carregando, profissionais, filtroProfissionalId } = props;
  const textoDoResumo = resumo ?? (carregando ? "Carregando atendimentos..." : null);

  return (
    <div className="space-y-4 rounded-[var(--radius-card)] border border-border bg-card p-4 shadow-[var(--shadow-soft)] sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-wide text-ink-soft uppercase">
            {ehHoje ? "Hoje" : "Agenda do dia"}
          </p>
          <h2
            data-testid="data-da-agenda"
            className="text-lg font-bold text-ink first-letter:uppercase sm:text-xl"
          >
            {rotuloDaData(date)}
          </h2>
          <p className="min-h-4 text-xs text-ink-soft" aria-live="polite">
            {textoDoResumo && <span data-testid="resumo-do-dia">{textoDoResumo}</span>}
            {textoDoResumo && timezone && " · "}
            {timezone && <span>fuso {timezone}</span>}
          </p>
        </div>
        <Botao
          type="button"
          tamanho="lg"
          data-testid="novo-agendamento"
          className="w-full sm:w-auto"
          onClick={props.aoNovoAgendamento}
        >
          <CalendarPlus size={18} aria-hidden="true" />
          Novo agendamento
        </Botao>
      </div>

      {/* Celular: navegação + Atualizar (só ícone) numa linha, depois o dia e
          o filtro, um por linha. Computador: tudo numa linha só. */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 sm:grid-cols-[auto_minmax(0,11rem)_minmax(0,1fr)_auto] sm:items-end">
        <div
          className="col-start-1 row-start-1 flex items-center gap-1 sm:col-start-auto sm:row-start-auto"
          role="group"
          aria-label="Navegar entre dias"
        >
          <Botao
            type="button"
            variante="secundaria"
            className="min-h-11 px-3"
            aria-label="Dia anterior"
            onClick={props.aoAnterior}
          >
            <ChevronLeft size={18} aria-hidden="true" />
            <span className="hidden lg:inline">Anterior</span>
          </Botao>
          <Botao
            type="button"
            variante="secundaria"
            className={clsx("min-h-11 flex-1 sm:flex-none", ehHoje && "bg-paper-muted")}
            aria-pressed={ehHoje}
            onClick={props.aoHoje}
          >
            Hoje
          </Botao>
          <Botao
            type="button"
            variante="secundaria"
            className="min-h-11 px-3"
            aria-label="Próximo dia"
            onClick={props.aoProximo}
          >
            <span className="hidden lg:inline">Próximo</span>
            <ChevronRight size={18} aria-hidden="true" />
          </Botao>
        </div>

        {/* Celular: dia e filtro em linhas próprias, na largura toda — lado a
            lado, o filtro ficava com ~100 px e cortava "Todos os
            profissionais". */}
        <div className="col-span-2 grid gap-3 sm:contents">
          <div>
            <label htmlFor="data" className="mb-1 block text-xs font-medium text-ink-soft">
              Dia
            </label>
            <input
              id="data"
              type="date"
              value={date}
              onChange={(e) => e.target.value && props.aoMudarData(e.target.value)}
              className={CLASSE_CAMPO}
            />
          </div>

          <div>
            <label
              htmlFor="filtro-profissional"
              className="mb-1 block text-xs font-medium text-ink-soft"
            >
              Filtrar por profissional
            </label>
            <select
              id="filtro-profissional"
              value={filtroProfissionalId}
              onChange={(e) => props.aoFiltrar(e.target.value)}
              className={`${CLASSE_CAMPO} truncate`}
            >
              <option value={TODOS_OS_PROFISSIONAIS}>Todos os profissionais</option>
              {profissionais.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </select>
          </div>
        </div>

        <Botao
          type="button"
          variante="secundaria"
          className="col-start-2 row-start-1 min-h-11 px-3 sm:order-last sm:col-start-auto sm:row-start-auto sm:px-4"
          disabled={carregando}
          aria-busy={carregando}
          onClick={props.aoAtualizar}
        >
          <RefreshCw
            size={16}
            aria-hidden="true"
            className={carregando ? "animate-spin" : undefined}
          />
          <span className="sr-only sm:not-sr-only">Atualizar</span>
        </Botao>
      </div>
    </div>
  );
}
