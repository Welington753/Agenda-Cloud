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
import { useEffect, useState } from "react";
import { CalendarDays } from "lucide-react";
import type { AgendaDoDiaReal, AgendamentoReal } from "@/lib/api/appointments-api";
import type { AcaoDeStatusReal } from "@/lib/api/appointment-status-api";
import {
  mensagemFalhaAgendamento,
  ROTULO_STATUS,
  rotuloDeDuracao,
  rotuloDePreco,
} from "@/lib/profissionais/agendamentos";
import {
  acoesDaReserva,
  temAlgumaAcao,
  type AcoesDaReserva,
} from "@/lib/profissionais/andamento";
import type { EstadoAgenda } from "@/lib/profissionais/use-agendamentos-reais";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AcoesReserva } from "./acoes-reserva";
import type { AcaoConfirmada, ConfirmacaoPendente } from "./confirmar-acao";

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
  aoAlterarStatus: (
    appointmentId: string,
    acao: AcaoDeStatusReal,
    expectedStartAt: string,
  ) => Promise<boolean>;
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
  aoAlterarStatus,
  aoRemarcar,
}: AgendaDoDiaProps) {
  // A confirmação (cancelar, concluir, registrar falta) vive AQUI, não na
  // linha da reserva: o reload da agenda (inclusive o que segue um 409) passa
  // por "carregando" e desmonta a lista. Guardada aqui, ela sobrevive e pode
  // avisar que a reserva mudou.
  const [confirmacao, setConfirmacao] = useState<ConfirmacaoPendente | null>(null);

  // Relógio do NAVEGADOR, relido a cada 30 s: a agenda fica aberta o dia todo e
  // "Iniciar", "Concluir" e "Registrar falta" aparecem conforme o horário
  // chega. Só decide o que é OFERECIDO — quem decide o que vale é o servidor.
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setAgora(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Agenda nova chegou: se a reserva da confirmação mudou, a confirmação passa
  // a mostrar os dados novos COM o que mostrava antes — nunca troca o horário
  // em silêncio e nunca reenvia nada. Se ela saiu do dia ou a ação não vale
  // mais para ela, a confirmação fecha (o erro da ação continua explicando).
  useEffect(() => {
    if (!agenda) return;
    setAgora(new Date());
    setConfirmacao((atual) => {
      if (!atual) return atual;
      const atualizada = agenda.appointments.find((a) => a.id === atual.exibida.id);
      if (!atualizada || !acaoAindaVale(atual.acao, acoesDaReserva(atualizada, new Date()))) {
        return null;
      }
      const { exibida } = atual;
      if (exibida.startAt === atualizada.startAt && exibida.status === atualizada.status) {
        return atual;
      }
      return { acao: atual.acao, exibida: atualizada, anterior: exibida };
    });
  }, [agenda]);

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
          {agenda.appointments.map((agendamento) => {
            const acoes = acoesDaReserva(agendamento, agora);
            const daLinha = confirmacao?.exibida.id === agendamento.id ? confirmacao : null;
            return (
              <li key={agendamento.id} className="space-y-2">
                <LinhaDaReserva agendamento={agendamento} />

                {/* As ações só aparecem no que o servidor aceitaria alterar.
                    Esconder o botão NÃO é controle de acesso — é para não
                    oferecer uma ação cuja recusa já é conhecida. A decisão é
                    revalidada no servidor, dentro da transação. O relógio aqui é
                    o do navegador (pode estar errado), então isto nunca
                    substitui a checagem de lá. */}
                {(temAlgumaAcao(acoes) || daLinha) && (
                  <AcoesReserva
                    tenantId={tenantId}
                    agendamento={agendamento}
                    acoes={acoes}
                    gravando={gravando}
                    confirmacao={daLinha}
                    aoAbrirConfirmacao={(acao: AcaoConfirmada) =>
                      setConfirmacao({ acao, exibida: agendamento, anterior: null })
                    }
                    aoFecharConfirmacao={() => setConfirmacao(null)}
                    aoCancelar={aoCancelar}
                    aoAlterarStatus={aoAlterarStatus}
                    aoRemarcar={aoRemarcar}
                  />
                )}
              </li>
            );
          })}
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

/** A ação da confirmação ainda é oferecida para a reserva atualizada? */
function acaoAindaVale(acao: AcaoConfirmada, acoes: AcoesDaReserva): boolean {
  if (acao === "cancel") return acoes.cancelar;
  if (acao === "complete") return acoes.concluir;
  return acoes.registrarFalta;
}
