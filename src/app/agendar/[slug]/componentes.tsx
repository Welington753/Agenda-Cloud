"use client";

// Peças visuais da página pública de agendamento (page.tsx): moldura,
// seção numerada, lista de horários e recibo do pedido.
import type { ReactNode } from "react";
import clsx from "clsx";
import { Clock, RefreshCw, Store } from "lucide-react";
import type { FalhaPublica, HorariosPublicos, ReciboPedido } from "@/lib/api/public-booking-api";
import {
  dataBr,
  estadoDoRecibo,
  mensagemFalhaPublica,
  mensagemSemHorario,
} from "@/lib/agendamento-publico/agendamento-publico";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export const CLASSE_OPCAO =
  "min-h-11 rounded-[var(--radius-control)] border px-3 py-2 text-left text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
export const OPCAO_ATIVA = "border-accent bg-accent/10 font-semibold text-ink";
export const OPCAO_INATIVA = "border-border bg-card text-ink hover:bg-paper-muted";

export type EstadoHorarios =
  | { status: "ocioso" }
  | { status: "carregando" }
  | { status: "falha"; falha: FalhaPublica }
  | { status: "pronto"; horarios: HorariosPublicos };

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
  if (estado.status === "carregando") return <Skeleton className="h-24 w-full" />;
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
      <p data-testid="sem-horarios" className="text-sm text-ink-soft">
        {mensagemSemHorario(emptyReason)}
      </p>
    );
  }
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-6" data-testid="lista-horarios-publicos">
      {slots.map((s) => (
        <button
          key={s.startAt}
          type="button"
          aria-pressed={selecionado === s.startAt}
          data-start-at={s.startAt}
          onClick={() => aoEscolher({ startAt: s.startAt, localStart: s.localStart })}
          className={clsx(CLASSE_OPCAO, "text-center", selecionado === s.startAt ? OPCAO_ATIVA : OPCAO_INATIVA)}
        >
          {s.localStart}
        </button>
      ))}
    </div>
  );
}

export function Secao({ numero, titulo, children }: { numero: number; titulo: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold text-ink">
        <span className="mr-2 text-ink-soft">{numero}.</span>
        {titulo}
      </h2>
      {children}
    </section>
  );
}

export function Moldura({
  titulo,
  subtitulo,
  children,
}: {
  titulo?: string;
  subtitulo?: string;
  children: ReactNode;
}) {
  return (
    <main className="min-h-screen bg-paper px-4 py-8">
      <div className="mx-auto w-full max-w-2xl space-y-6">
        {titulo && (
          <header className="flex items-center gap-3">
            <Store size={24} className="shrink-0 text-accent" aria-hidden="true" />
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-bold text-ink">{titulo}</h1>
              {subtitulo && <p className="text-sm text-ink-soft">{subtitulo}</p>}
            </div>
          </header>
        )}
        {children}
      </div>
    </main>
  );
}

export function Recibo({ recibo: r }: { recibo: ReciboPedido }) {
  return (
    <Cartao data-testid="recibo-pedido">
          <CartaoCorpo className="space-y-4">
            <div className="flex items-start gap-3">
              <Clock size={22} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
              <div>
                <h2 className="text-lg font-semibold text-ink">
                  {r.replayed ? "Este pedido já tinha sido recebido" : "Pedido recebido"}
                </h2>
                <p className="text-sm font-medium text-ink" data-testid="recibo-status">
                  {estadoDoRecibo(r.status)}
                </p>
              </div>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-ink-soft">Serviço</dt>
              <dd className="text-ink">{r.serviceName}</dd>
              <dt className="text-ink-soft">Profissional</dt>
              <dd className="text-ink">{r.professionalName}</dd>
              <dt className="text-ink-soft">Data</dt>
              <dd className="text-ink" data-testid="recibo-data">{dataBr(r.localDate)}</dd>
              <dt className="text-ink-soft">Horário</dt>
              <dd className="text-ink" data-testid="recibo-hora">{r.localStart}</dd>
            </dl>
            {r.status === "PENDING" && (
              <p className="text-sm text-ink-soft">
                Este pedido ainda não é um agendamento confirmado. O estabelecimento vai analisar e
                responder pelo contato informado. O horário fica reservado para você enquanto isso.
              </p>
            )}
            <p className="text-xs text-ink-soft">Horários no fuso {r.timezone}.</p>
          </CartaoCorpo>
        </Cartao>
  );
}
