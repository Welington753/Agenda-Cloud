"use client";

// Visualização "Por profissional" da agenda do dia: as MESMAS reservas da
// lista, já carregadas e filtradas por agenda-do-dia.tsx, agrupadas por
// profissional (regra pura em lib/profissionais/agenda-visual.ts). Não busca
// nada, não decide nada: cada cartão é desenhado pela mesma função da lista,
// com as mesmas ações e confirmações.
//
// Computador: grade de duas colunas (os cartões têm ações e não cabem
// estreitos). Celular: grupos empilhados, cada um com o nome em destaque.
//
// "Sem agendamentos neste dia" NÃO quer dizer livre: jornada, bloqueios e o
// resto continuam com o motor de disponibilidade, consultado em "Novo
// agendamento".
import type { ReactNode } from "react";
import type { AgendamentoReal } from "@/lib/api/appointments-api";
import type { GrupoDeProfissional } from "@/lib/profissionais/agenda-visual";

interface AgendaPorProfissionalProps {
  grupos: GrupoDeProfissional[];
  /** `false` quando o backend avisou que a lista do dia veio cortada: as
   * contagens viram "carregados", nunca um total. */
  completa: boolean;
  renderizarReserva: (agendamento: AgendamentoReal) => ReactNode;
}

function rotuloDaContagem(quantidade: number, completa: boolean): string {
  if (!completa) return quantidade === 1 ? "1 carregado" : `${quantidade} carregados`;
  return quantidade === 1 ? "1 agendamento" : `${quantidade} agendamentos`;
}

export function AgendaPorProfissional({
  grupos,
  completa,
  renderizarReserva,
}: AgendaPorProfissionalProps) {
  return (
    <div data-testid="agenda-por-profissional" className="grid gap-4 lg:grid-cols-2 lg:items-start">
      {grupos.map((grupo) => {
        const idTitulo = `grupo-${grupo.professionalId}`;
        return (
          <section
            key={grupo.professionalId}
            aria-labelledby={idTitulo}
            data-testid="grupo-profissional"
            data-professional-id={grupo.professionalId}
            className="min-w-0 space-y-3 rounded-[var(--radius-card)] border border-border bg-paper-muted/40 p-3 sm:p-4"
          >
            <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h3 id={idTitulo} className="min-w-0 text-base font-bold break-words text-ink">
                {grupo.nome}
                {grupo.inativo && (
                  <span className="ml-2 text-xs font-medium text-ink-soft">(inativo)</span>
                )}
              </h3>
              <p className="text-xs text-ink-soft" data-testid="contagem-do-grupo">
                {rotuloDaContagem(grupo.agendamentos.length, completa)}
              </p>
            </header>

            {grupo.agendamentos.length === 0 ? (
              <p className="text-sm text-ink-soft" data-testid="grupo-sem-agendamentos">
                Sem agendamentos neste dia. Para saber se há horário livre, use “Novo agendamento”.
              </p>
            ) : (
              <ul className="space-y-3">
                {grupo.agendamentos.map((agendamento) => (
                  <li
                    key={agendamento.id}
                    data-reserva-id={agendamento.id}
                    className="scroll-mt-24"
                  >
                    {renderizarReserva(agendamento)}
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
