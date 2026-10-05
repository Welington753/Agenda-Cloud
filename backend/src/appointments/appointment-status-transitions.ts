// Ciclo básico do atendimento (Lote 6D.7) — regras PURAS das quatro ações de
// status: sem Nest, sem banco, sem relógio implícito (o "agora" é sempre
// parâmetro). O service aplica estas regras DEPOIS de travar e reler a
// reserva, dentro da transação; a tela usa uma cópia de apresentação delas
// (src/lib/profissionais/agendamentos.ts) só para não oferecer botão inútil.
//
// REGRAS ADOTADAS
//
// - Confirmar:        PENDING -> CONFIRMED, só ANTES do início marcado.
// - Iniciar:          PENDING ou CONFIRMED -> IN_PROGRESS, a partir de 30 min
//                     antes do início, sem limite final.
// - Concluir:         IN_PROGRESS -> COMPLETED, a qualquer momento;
//                     CONFIRMED -> COMPLETED, só a partir do início marcado.
// - Registrar falta:  PENDING ou CONFIRMED -> NO_SHOW, só DEPOIS do início.
//
// COMPLETED, NO_SHOW e CANCELED são finais neste lote: nenhuma ação sai deles.
//
// O histórico registra SÓ a transição realizada. Iniciar a partir de PENDING
// grava PENDING -> IN_PROGRESS (sem uma confirmação intermediária), e
// concluir direto de CONFIRMED grava CONFIRMED -> COMPLETED (sem um início
// fictício).
//
// "Início marcado" é `start_at`, o instante UTC gravado — nunca a hora local
// exibida.
import { AppointmentStatus } from '../entities/enums/appointment-status.enum.js';

export type AcaoDeStatus = 'confirm' | 'start' | 'complete' | 'no-show';

export const ACOES_DE_STATUS: readonly AcaoDeStatus[] = ['confirm', 'start', 'complete', 'no-show'];

/** Quanto antes do início marcado o atendimento já pode ser iniciado. */
export const ANTECEDENCIA_PARA_INICIAR_MINUTOS = 30;

export const DESTINO_DA_ACAO: Readonly<Record<AcaoDeStatus, AppointmentStatus>> = {
  confirm: AppointmentStatus.CONFIRMED,
  start: AppointmentStatus.IN_PROGRESS,
  complete: AppointmentStatus.COMPLETED,
  'no-show': AppointmentStatus.NO_SHOW,
};

const RECUSA: Readonly<Record<AcaoDeStatus, string>> = {
  confirm: 'Só é possível confirmar uma reserva aguardando confirmação que ainda não começou.',
  start:
    'Só é possível iniciar uma reserva aguardando confirmação ou confirmada, a partir de 30 minutos antes do horário marcado.',
  complete:
    'Só é possível concluir um atendimento em andamento, ou uma reserva confirmada a partir do horário marcado.',
  'no-show':
    'Só é possível registrar falta de uma reserva aguardando confirmação ou confirmada, depois do horário marcado.',
};

/**
 * A ação pode sair do estado atual, neste instante?
 *
 * Não trata a repetição (estado atual já é o destino): isso é decidido antes,
 * pelo service, e não grava nada.
 */
export function transicaoPermitida(
  acao: AcaoDeStatus,
  status: AppointmentStatus,
  startAt: Date,
  agora: Date,
): boolean {
  const inicio = startAt.getTime();
  const instante = agora.getTime();

  switch (acao) {
    case 'confirm':
      return status === AppointmentStatus.PENDING && instante < inicio;
    case 'start':
      return (
        (status === AppointmentStatus.PENDING || status === AppointmentStatus.CONFIRMED) &&
        instante >= inicio - ANTECEDENCIA_PARA_INICIAR_MINUTOS * 60_000
      );
    case 'complete':
      if (status === AppointmentStatus.IN_PROGRESS) return true;
      return status === AppointmentStatus.CONFIRMED && instante >= inicio;
    case 'no-show':
      return (
        (status === AppointmentStatus.PENDING || status === AppointmentStatus.CONFIRMED) &&
        instante > inicio
      );
  }
}

export function mensagemDeRecusa(acao: AcaoDeStatus): string {
  return RECUSA[acao];
}
