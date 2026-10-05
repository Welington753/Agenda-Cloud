"use client";

// Lista da agenda de um dia (Lote 6D.5) com as ações de cancelar e remarcar
// por reserva (Lote 6D.6). Extraída de page.tsx quando a página passou do
// limite de linhas do projeto — é bloco de UI, sem regra de negócio própria:
// as decisões continuam em lib/profissionais/agendamentos.ts (puras) e no
// servidor.
//
// Fuso: exibe as horas locais que o backend devolve
// (`localStart`/`localServiceEnd`), nunca converte nada com o relógio do
// navegador.
import { CalendarDays } from "lucide-react";
import type { AgendaDoDiaReal, AgendamentoReal } from "@/lib/api/appointments-api";
import {
  mensagemFalhaAgendamento,
  podeAlterarAgendamento,
  ROTULO_STATUS,
  rotuloDeDuracao,
  rotuloDePreco,
} from "@/lib/profissionais/agendamentos";
import type { EstadoAgenda } from "@/lib/profissionais/use-agendamentos-reais";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AcoesReserva } from "./acoes-reserva";

interface AgendaDoDiaProps {
  tenantId: string;
  estado: EstadoAgenda;
  agenda: AgendaDoDiaReal | null;
  /** `true` enquanto qualquer gravação da agenda está em voo. */
  gravando: boolean;
  /** Erro das ações sobre uma reserva existente — separado do erro do
   * formulário de nova reserva. */
  erroAcao: string | null;
  recarregar: () => void;
  aoCancelar: (appointmentId: string, expectedStartAt: string) => Promise<boolean>;
  aoRemarcar: (
    appointmentId: string,
    dados: { startAt: string; expectedStartAt: string },
  ) => Promise<boolean>;
}

export function AgendaDoDia({
  tenantId,
  estado,
  agenda,
  gravando,
  erroAcao,
  recarregar,
  aoCancelar,
  aoRemarcar,
}: AgendaDoDiaProps) {
  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold text-ink">Agenda do dia</p>

      {estado.status === "carregando" && (
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      )}

      {estado.status === "falha" && (
        <Cartao>
          <CartaoCorpo className="space-y-3">
            <p role="alert" className="text-sm text-ink">
              {mensagemFalhaAgendamento(estado.falha)}
            </p>
            {estado.falha.tipo !== "sem_permissao" && estado.falha.tipo !== "sem_acesso" && (
              <Botao type="button" onClick={recarregar}>
                Tentar novamente
              </Botao>
            )}
          </CartaoCorpo>
        </Cartao>
      )}

      {agenda && agenda.appointments.length === 0 && (
        <Cartao>
          <CartaoCorpo className="flex items-start gap-3">
            <CalendarDays size={18} className="mt-0.5 shrink-0 text-ink-soft" />
            <p data-testid="agenda-vazia" className="text-sm text-ink-soft">
              Nenhum agendamento neste dia.
            </p>
          </CartaoCorpo>
        </Cartao>
      )}

      {erroAcao && (
        <p
          role="alert"
          data-testid="erro-acao-reserva"
          className="text-sm text-[color:var(--color-danger)]"
        >
          {erroAcao}
        </p>
      )}

      {agenda && agenda.appointments.length > 0 && (
        <ul data-testid="agenda-do-dia" className="space-y-2">
          {agenda.appointments.map((agendamento) => (
            <li key={agendamento.id} className="space-y-2">
              <LinhaDaReserva agendamento={agendamento} />

              {/* As ações só aparecem no que o servidor aceitaria alterar.
                  Esconder o botão NÃO é controle de acesso — é para não
                  oferecer uma ação cuja recusa já é conhecida. A decisão é
                  revalidada no servidor, dentro da transação. O relógio aqui é
                  o do navegador (pode estar errado), então isto nunca
                  substitui a checagem de lá. */}
              {podeAlterarAgendamento(agendamento, new Date()) && (
                <AcoesReserva
                  tenantId={tenantId}
                  agendamento={agendamento}
                  gravando={gravando}
                  aoCancelar={aoCancelar}
                  aoRemarcar={aoRemarcar}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LinhaDaReserva({ agendamento }: { agendamento: AgendamentoReal }) {
  return (
    <Cartao>
      <CartaoCorpo className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-ink" data-testid="horario-agendado">
            {agendamento.localStart}–{agendamento.localServiceEnd}
          </p>
          <p className="text-sm text-ink">
            {agendamento.service.name} · com {agendamento.professional.name}
          </p>
          <p className="text-xs text-ink-soft">
            {agendamento.consumer.name} · {agendamento.consumer.whatsapp}
          </p>
        </div>
        <div className="text-right">
          <span
            data-testid="status-agendado"
            className="rounded-full border border-border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-ink-soft"
          >
            {ROTULO_STATUS[agendamento.status]}
          </span>
          <p className="mt-1 text-xs text-ink-soft">
            {rotuloDeDuracao(agendamento.durationMinutes)} ·{" "}
            {rotuloDePreco(agendamento.priceCents)}
          </p>
        </div>
      </CartaoCorpo>
    </Cartao>
  );
}
