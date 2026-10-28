"use client";

// Visões do Calendário (ver calendario-agenda.tsx): mês, semana e a lista de
// um dia. Só apresentação; a situação de cada atendimento sempre em texto.
import clsx from "clsx";
import {
  DIAS_DA_SEMANA,
  DIAS_DA_SEMANA_CURTOS,
  ROTULO_CURTO_DA_SITUACAO,
  diaDaSemana,
  diasDaSemana,
  mesmoMes,
  semanasDoMes,
  tituloDoPeriodo,
  type VisaoDoCalendario,
} from "@/lib/profissionais/calendario";

export interface ItemDoCalendario {
  id: string;
  localDate: string;
  localStart: string;
  status: string;
  /** Nome do cliente. */
  titulo: string;
  /** Serviço e, na agenda geral, o profissional. */
  detalhe: string;
}

const COR_DA_SITUACAO: Record<string, string> = {
  PENDING: "shadow-[inset_3px_0_0_var(--color-warning)] bg-warning-soft/40",
  CONFIRMED: "shadow-[inset_3px_0_0_var(--color-info)] bg-info-soft/40",
  IN_PROGRESS: "shadow-[inset_3px_0_0_var(--color-accent)] bg-accent-soft/50",
  COMPLETED: "shadow-[inset_3px_0_0_var(--color-success)] bg-success-soft/40",
  CANCELED: "shadow-[inset_3px_0_0_var(--color-border)] bg-paper-muted text-ink-soft line-through decoration-1",
  NO_SHOW: "shadow-[inset_3px_0_0_var(--color-danger)] bg-danger-soft/40",
};

/** Quantos atendimentos cabem numa célula do mês no computador. */
const POR_CELULA = 3;

interface PropsDaVisao {
  data: string;
  hoje: string | null;
  grupos: Map<string, ItemDoCalendario[]>;
  aoMudarData: (data: string) => void;
  aoMudarVisao: (visao: VisaoDoCalendario) => void;
  aoAbrir: (item: ItemDoCalendario) => void;
}

function rotuloDoItem(item: ItemDoCalendario): string {
  return `${item.localStart}, ${item.titulo}, ${ROTULO_CURTO_DA_SITUACAO[item.status] ?? item.status}. Abrir na agenda do dia.`;
}

function ItemCompacto({ item, aoAbrir }: { item: ItemDoCalendario; aoAbrir: (item: ItemDoCalendario) => void }) {
  return (
    <button
      type="button"
      onClick={() => aoAbrir(item)}
      aria-label={rotuloDoItem(item)}
      data-testid="calendario-item"
      data-situacao={item.status}
      className={clsx(
        "block w-full min-w-0 rounded-[6px] px-1.5 py-1 text-left text-xs text-ink hover:brightness-95",
        "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus",
        COR_DA_SITUACAO[item.status],
      )}
    >
      <span className="block truncate">
        <span className="font-semibold tabular-nums">{item.localStart}</span> {item.titulo}
      </span>
      <span className="block truncate text-[11px] text-ink-soft no-underline">
        {ROTULO_CURTO_DA_SITUACAO[item.status] ?? item.status}
      </span>
    </button>
  );
}

function ItemDeLista({ item, aoAbrir }: { item: ItemDoCalendario; aoAbrir: (item: ItemDoCalendario) => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={() => aoAbrir(item)}
        aria-label={rotuloDoItem(item)}
        data-testid="calendario-item"
        data-situacao={item.status}
        className={clsx(
          "grid min-h-14 w-full grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-x-3 rounded-[var(--radius-control)] px-3 py-2 text-left",
          "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus",
          COR_DA_SITUACAO[item.status],
        )}
      >
        <span className="text-base font-bold text-ink tabular-nums">{item.localStart}</span>
        <span className="min-w-0">
          <span className="block font-semibold break-words text-ink">{item.titulo}</span>
          <span className="block truncate text-sm text-ink-soft">{item.detalhe}</span>
          <span className="block text-xs font-medium text-ink-soft">
            {ROTULO_CURTO_DA_SITUACAO[item.status] ?? item.status}
          </span>
        </span>
      </button>
    </li>
  );
}

export function ListaDoDia({
  itens,
  aoAbrir,
  data,
  hoje,
}: {
  itens: readonly ItemDoCalendario[];
  aoAbrir: (item: ItemDoCalendario) => void;
  data: string;
  hoje: string | null;
}) {
  if (itens.length === 0) {
    return (
      <p className="rounded-[var(--radius-card)] border border-border bg-card p-4 text-sm text-ink-soft" data-testid="calendario-dia-vazio">
        {data === hoje ? "Nenhum atendimento hoje." : "Nenhum atendimento neste dia."}
      </p>
    );
  }
  return (
    <ul className="space-y-2" data-testid="calendario-lista-do-dia">
      {itens.map((item) => (
        <ItemDeLista key={item.id} item={item} aoAbrir={aoAbrir} />
      ))}
    </ul>
  );
}

/** Quantos atendimentos que continuam valendo (sem cancelados). */
function ativos(itens: readonly ItemDoCalendario[] | undefined): number {
  return (itens ?? []).filter((i) => i.status !== "CANCELED").length;
}

export function Mes({
  data,
  hoje,
  grupos,
  aoMudarData,
  aoMudarVisao,
  aoAbrir,
}: PropsDaVisao) {
  const semanas = semanasDoMes(data);
  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-card">
        <div className="grid grid-cols-7 border-b border-border bg-paper-muted" aria-hidden="true">
          {DIAS_DA_SEMANA_CURTOS.map((d) => (
            <div key={d} className="px-1 py-2 text-center text-xs font-semibold text-ink-soft uppercase">
              {d}
            </div>
          ))}
        </div>
        <div role="grid" aria-label={tituloDoPeriodo("mes", data)}>
          {semanas.map((semana) => (
            <div role="row" key={semana[0]} className="grid grid-cols-7 border-b border-border last:border-b-0">
              {semana.map((dia) => {
                const doDia = grupos.get(dia) ?? [];
                const quantidade = ativos(doDia);
                const foraDoMes = !mesmoMes(dia, data);
                const selecionado = dia === data;
                const ehHoje = dia === hoje;
                const numero = Number(dia.slice(8));
                const nomeDoDia = `${DIAS_DA_SEMANA[diaDaSemana(dia)]}, ${numero}${
                  quantidade ? `, ${quantidade} ${quantidade === 1 ? "atendimento" : "atendimentos"}` : ", sem atendimentos"
                }${ehHoje ? ", hoje" : ""}`;
                return (
                  <div
                    role="gridcell"
                    key={dia}
                    data-testid="calendario-dia"
                    data-dia={dia}
                    className={clsx(
                      "min-w-0 border-r border-border last:border-r-0 md:min-h-28 md:p-1.5",
                      foraDoMes && "bg-paper-muted/60",
                    )}
                  >
                    {/* Celular: o dia inteiro é o toque; abaixo da grade
                        aparece a lista do dia tocado. */}
                    <button
                      type="button"
                      onClick={() => aoMudarData(dia)}
                      aria-label={nomeDoDia}
                      aria-pressed={selecionado}
                      className={clsx(
                        "flex min-h-12 w-full flex-col items-center justify-center gap-0.5 text-sm md:hidden",
                        "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus",
                        selecionado && "bg-accent-soft",
                        foraDoMes ? "text-ink-soft" : "text-ink",
                      )}
                    >
                      <span
                        className={clsx(
                          "inline-flex size-7 items-center justify-center rounded-full tabular-nums",
                          ehHoje && "bg-ink font-bold text-paper",
                        )}
                      >
                        {numero}
                      </span>
                      <span className="h-4 text-[11px] leading-4 font-semibold text-[color:var(--color-accent-hover)]">
                        {quantidade || ""}
                      </span>
                    </button>
                    {/* Computador: número do dia (abre a visão do dia) e até
                        três atendimentos; o resto, em "+N". */}
                    <div className="hidden md:block">
                      <button
                        type="button"
                        onClick={() => {
                          aoMudarData(dia);
                          aoMudarVisao("dia");
                        }}
                        aria-label={`Abrir o dia: ${nomeDoDia}`}
                        className={clsx(
                          "mb-1 inline-flex size-7 items-center justify-center rounded-full text-sm tabular-nums hover:bg-paper-muted",
                          "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus",
                          ehHoje ? "bg-ink font-bold text-paper hover:bg-ink" : foraDoMes ? "text-ink-soft" : "text-ink",
                        )}
                      >
                        {numero}
                      </button>
                      <div className="space-y-1">
                        {doDia.slice(0, POR_CELULA).map((item) => (
                          <ItemCompacto key={item.id} item={item} aoAbrir={aoAbrir} />
                        ))}
                        {doDia.length > POR_CELULA && (
                          <button
                            type="button"
                            onClick={() => {
                              aoMudarData(dia);
                              aoMudarVisao("dia");
                            }}
                            className="min-h-6 text-xs font-medium text-[color:var(--color-accent-hover)] hover:underline"
                          >
                            +{doDia.length - POR_CELULA} mais
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="space-y-2 md:hidden" data-testid="calendario-dia-tocado">
        <h3 className="text-sm font-semibold text-ink first-letter:uppercase">{tituloDoPeriodo("dia", data)}</h3>
        <ListaDoDia itens={grupos.get(data) ?? []} aoAbrir={aoAbrir} data={data} hoje={hoje} />
      </div>
    </div>
  );
}

export function Semana({
  data,
  hoje,
  grupos,
  aoAbrir,
  aoMudarData,
  aoMudarVisao,
}: PropsDaVisao) {
  const dias = diasDaSemana(data);
  return (
    <ol className="grid gap-3 md:grid-cols-7 md:gap-2">
      {dias.map((dia, indice) => {
        const doDia = grupos.get(dia) ?? [];
        return (
          <li
            key={dia}
            data-testid="calendario-dia"
            data-dia={dia}
            className={clsx(
              "min-w-0 rounded-[var(--radius-card)] border border-border bg-card p-2",
              dia === hoje && "ring-2 ring-[color:var(--color-accent)]",
            )}
          >
            <button
              type="button"
              onClick={() => {
                aoMudarData(dia);
                aoMudarVisao("dia");
              }}
              className="mb-2 flex min-h-11 w-full items-baseline gap-1 rounded-[6px] px-1 text-left hover:bg-paper-muted focus-visible:outline-2 focus-visible:outline-focus"
              aria-label={`Abrir o dia: ${DIAS_DA_SEMANA[indice]}, ${Number(dia.slice(8))}${dia === hoje ? ", hoje" : ""}`}
            >
              <span className="text-xs font-semibold text-ink-soft uppercase">{DIAS_DA_SEMANA_CURTOS[indice]}</span>
              <span className="text-lg font-bold text-ink tabular-nums">{Number(dia.slice(8))}</span>
              {dia === hoje && <span className="text-xs font-medium text-[color:var(--color-accent-hover)]">hoje</span>}
            </button>
            {doDia.length === 0 ? (
              <p className="px-1 text-xs text-ink-soft">Sem atendimentos</p>
            ) : (
              <div className="space-y-1">
                {doDia.map((item) => (
                  <ItemCompacto key={item.id} item={item} aoAbrir={aoAbrir} />
                ))}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
