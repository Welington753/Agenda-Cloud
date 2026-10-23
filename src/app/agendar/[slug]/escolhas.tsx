"use client";

// Opções da página pública de agendamento: cartões de serviço e de
// profissional, dias e horários. Escolhido = borda e fundo de destaque +
// ícone + `aria-pressed`, nunca só a cor; cores só por tokens, então a
// seleção aparece igual no claro e no escuro.
import clsx from "clsx";
import { Check, ChevronRight, Clock, Loader2, RefreshCw, WifiOff } from "lucide-react";
import type { FaseRecuperacao } from "@/lib/api/leitura-com-recuperacao";
import type { FalhaPublica, HorariosPublicos, PaginaPublica } from "@/lib/api/public-booking-api";
import {
  agruparPorPeriodo,
  mensagemFalhaPublica,
  mensagemSemHorario,
  precoPublico,
  type DiaOferecido,
} from "@/lib/agendamento-publico/agendamento-publico";
import { Botao } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

const FOCO = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/** Opção selecionável (serviço, profissional, dia, horário). */
export const CLASSE_OPCAO = clsx(
  "relative min-h-11 rounded-[var(--radius-control)] border text-left text-sm text-ink transition-colors",
  FOCO,
);
export const OPCAO_ATIVA = "border-accent bg-accent-soft ring-1 ring-accent font-semibold";
/** Dia e horário escolhidos: fundo cheio no tom mais forte do destaque
 * (texto 5,7:1 no claro e 9,7:1 no escuro), mais o ícone de confirmação. */
const ESCOLHIDO_CHEIO = "border-accent-hover bg-accent-hover text-on-accent";
export const OPCAO_INATIVA = "border-border bg-card hover:border-border-strong hover:bg-paper-muted";

export type EstadoHorarios =
  | { status: "ocioso" }
  | { status: "carregando"; fase?: FaseRecuperacao }
  | { status: "falha"; falha: FalhaPublica }
  | { status: "pronto"; horarios: HorariosPublicos };

type Servico = PaginaPublica["services"][number];
type Profissional = PaginaPublica["professionals"][number];

function MarcaEscolhido({ ativo }: { ativo: boolean }) {
  if (!ativo) return null;
  return (
    <span
      aria-hidden="true"
      className="absolute top-2 right-2 grid size-6 place-items-center rounded-full bg-accent text-on-accent"
    >
      <Check size={14} strokeWidth={3} />
    </span>
  );
}

export function CartaoServico({ servico: s, ativo, aoEscolher }: { servico: Servico; ativo: boolean; aoEscolher: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={ativo}
      onClick={aoEscolher}
      className={clsx(CLASSE_OPCAO, "flex w-full flex-col gap-1 p-4 pr-10", ativo ? OPCAO_ATIVA : OPCAO_INATIVA)}
    >
      <span className="text-base leading-snug font-semibold break-words">{s.name}</span>
      {s.description && <span className="line-clamp-2 text-sm font-normal text-ink-soft">{s.description}</span>}
      <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-normal">
        <span className="inline-flex items-center gap-1 text-ink-soft">
          <Clock size={14} aria-hidden="true" /> {s.durationMinutes} min
        </span>
        <span className="font-semibold text-ink">{precoPublico(s.priceCents, s.priceVisible)}</span>
      </span>
      <MarcaEscolhido ativo={ativo} />
    </button>
  );
}

export function CartaoProfissional({
  profissional: p,
  ativo,
  aoEscolher,
}: {
  profissional: Profissional;
  ativo: boolean;
  aoEscolher: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={ativo}
      onClick={aoEscolher}
      className={clsx(CLASSE_OPCAO, "flex w-full items-center gap-3 p-3 pr-10", ativo ? OPCAO_ATIVA : OPCAO_INATIVA)}
    >
      <span
        aria-hidden="true"
        className="grid size-10 shrink-0 place-items-center rounded-full bg-paper-muted text-sm font-semibold text-ink"
      >
        {p.initials}
      </span>
      <span className="min-w-0 text-base break-words">{p.name}</span>
      <MarcaEscolhido ativo={ativo} />
    </button>
  );
}

/** Etapa "Profissional", sempre mostrada. Vários: a pessoa escolhe (tocar
 * já avança). Um: vem pré-selecionado, com o nome escrito, e a pessoa
 * confirma em "Continuar". Nenhum: a etapa diz isso e não deixa seguir —
 * diferente de "sem horários no dia", que é da etapa seguinte. */
export function EtapaProfissional({
  opcoes,
  escolhido,
  aoEscolher,
  aoContinuar,
}: {
  opcoes: PaginaPublica["professionals"];
  escolhido: string | null;
  aoEscolher: (professionalId: string) => void;
  aoContinuar: () => void;
}) {
  if (opcoes.length === 0) {
    return (
      <p
        role="status"
        data-testid="sem-profissional"
        className="rounded-[var(--radius-control)] bg-paper-muted p-3 text-sm text-ink"
      >
        Nenhum profissional disponível para este serviço no agendamento online. Volte e escolha outro serviço.
      </p>
    );
  }
  const unico = opcoes.length === 1 ? opcoes[0] : null;
  return (
    <section className="space-y-3" aria-label="Profissional">
      {unico && (
        <p className="text-sm text-ink-soft" data-testid="profissional-unico">
          Este serviço é feito por <span className="font-medium text-ink">{unico.name}</span>.
        </p>
      )}
      <div className="grid gap-2 sm:grid-cols-2" data-testid="lista-profissionais-publicos">
        {opcoes.map((p) => (
          <CartaoProfissional key={p.id} profissional={p} ativo={escolhido === p.id} aoEscolher={() => aoEscolher(p.id)} />
        ))}
      </div>
      {escolhido && (
        <Botao type="button" tamanho="lg" className="w-full sm:w-auto" onClick={aoContinuar} data-testid="continuar-profissional">
          Continuar <ChevronRight size={18} aria-hidden="true" />
        </Botao>
      )}
    </section>
  );
}

export function Dias({
  dias,
  selecionado,
  aoEscolher,
}: {
  dias: DiaOferecido[];
  selecionado: string | null;
  aoEscolher: (date: string) => void;
}) {
  // Grade de sete colunas, sem rolagem lateral: duas semanas cabem em 360 px.
  return (
    <div className="grid grid-cols-7 gap-1 sm:gap-2" data-testid="lista-dias">
      {dias.map((d) => {
        const [semana, diaMes] = d.rotulo.split(" ");
        const ativo = selecionado === d.date;
        return (
          <button
            key={d.date}
            type="button"
            aria-pressed={ativo}
            onClick={() => aoEscolher(d.date)}
            className={clsx(
              CLASSE_OPCAO,
              "flex min-h-14 flex-col items-center justify-center px-0.5 text-center",
              ativo ? clsx(ESCOLHIDO_CHEIO, "font-semibold") : OPCAO_INATIVA,
            )}
          >
            <span className="block text-[11px] leading-tight">{semana}</span>{" "}
            <span className="block text-sm leading-tight font-semibold">{diaMes}</span>
          </button>
        );
      })}
    </div>
  );
}

export function Horarios({
  estado,
  selecionado,
  aoEscolher,
  aoTentarDeNovo,
}: {
  estado: EstadoHorarios;
  selecionado: string | null;
  aoEscolher: (slot: { startAt: string; localStart: string }) => void;
  aoTentarDeNovo: () => void;
}) {
  if (estado.status === "ocioso") return null;
  if (estado.status === "carregando") {
    if (estado.fase === "sem_internet") {
      return (
        <p role="status" data-testid="horarios-sem-internet" className="flex items-center gap-2 text-sm text-ink-soft">
          <WifiOff size={16} aria-hidden="true" /> Sem conexão com a internet. Assim que ela voltar, os horários aparecem.
        </p>
      );
    }
    if (estado.fase === "acordando") {
      return (
        <p role="status" data-testid="horarios-conectando" className="flex items-center gap-2 text-sm text-ink-soft">
          <Loader2 size={16} className="animate-spin" aria-hidden="true" /> Conectando ao servidor… pode levar cerca de
          um minuto.
        </p>
      );
    }
    return <Skeleton className="h-24 w-full" />;
  }
  if (estado.status === "falha") {
    return (
      <div role="alert" data-testid="horarios-falha" className="space-y-2 text-sm text-ink">
        <p>{mensagemFalhaPublica(estado.falha)}</p>
        <Botao type="button" variante="secundaria" onClick={aoTentarDeNovo}>
          <RefreshCw size={16} aria-hidden="true" /> Tentar de novo
        </Botao>
      </div>
    );
  }
  const { slots, emptyReason } = estado.horarios;
  if (slots.length === 0) {
    return (
      <p data-testid="sem-horarios" className="rounded-[var(--radius-control)] bg-paper-muted p-3 text-sm text-ink-soft">
        {mensagemSemHorario(emptyReason)}
      </p>
    );
  }
  return (
    <div className="space-y-4" data-testid="lista-horarios-publicos">
      {agruparPorPeriodo(slots).map((grupo) => (
        <div key={grupo.periodo} className="space-y-2">
          <h3 className="text-xs font-semibold tracking-wide text-ink-soft uppercase">{grupo.periodo}</h3>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {grupo.slots.map((s) => {
              const ativo = selecionado === s.startAt;
              return (
                <button
                  key={s.startAt}
                  type="button"
                  aria-pressed={ativo}
                  data-start-at={s.startAt}
                  onClick={() => aoEscolher({ startAt: s.startAt, localStart: s.localStart })}
                  className={clsx(
                    CLASSE_OPCAO,
                    "inline-flex min-h-12 items-center justify-center gap-1 px-2 text-center text-base tabular-nums",
                    ativo ? clsx(ESCOLHIDO_CHEIO, "font-bold ring-2 ring-accent-hover ring-offset-2 ring-offset-paper") : OPCAO_INATIVA,
                  )}
                >
                  {ativo && <Check size={16} strokeWidth={3} aria-hidden="true" />}
                  {s.localStart}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

