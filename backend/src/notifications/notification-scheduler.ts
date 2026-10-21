// O que a reserva faz com as notificações, chamado DENTRO da transação que
// muda a reserva (appointments.service.ts). Só grava intenção — nenhuma
// chamada externa acontece aqui, e um rollback da reserva desfaz junto.
//
// Sem estado e sem dependências: recebe o `EntityManager` da transação.
import type { EntityManager } from 'typeorm';
import { planejarNotificacoes, type TipoDeNotificacao } from './notification-policy.js';
import {
  cancelarPendentes,
  programarTarefas,
  reapontarConfirmacao,
} from './notification-jobs.repository.js';

const LEMBRETES: readonly TipoDeNotificacao[] = ['REMINDER_DAY_BEFORE', 'REMINDER_2H'];

export interface ReservaParaNotificar {
  tenantId: string;
  appointmentId: string;
  inicio: Date;
  timezone: string;
}

export class AgendadorDeNotificacoes {
  /** A reserva passou a CONFIRMED (criação já confirmada ou "confirmar"). */
  async aoConfirmar(tx: EntityManager, reserva: ReservaParaNotificar, agora: Date): Promise<void> {
    const tarefas = planejarNotificacoes({
      inicio: reserva.inicio,
      timezone: reserva.timezone,
      agora,
      incluirConfirmacao: true,
    });
    await programarTarefas(tx, reserva, tarefas, agora);
  }

  /** Cancelada, iniciada, concluída ou falta: nada pendente sai mais. */
  async aoEncerrar(
    tx: EntityManager,
    reserva: Pick<ReservaParaNotificar, 'tenantId' | 'appointmentId'>,
    motivo: string,
    agora: Date,
  ): Promise<void> {
    await cancelarPendentes(tx, reserva, motivo, agora);
  }

  /**
   * Horário mudou. Lembretes do horário antigo são invalidados e, se a
   * reserva está CONFIRMED, recalculados a partir de AGORA (a remarcação):
   * mudança feita na véspera não ganha "lembrete de amanhã", e um lembrete
   * de 2 h que já passou não sai atrasado. A confirmação NÃO é repetida — o
   * novo horário acabou de ser combinado com o cliente; uma confirmação
   * ainda não enviada passa a falar do horário novo.
   */
  async aoRemarcar(
    tx: EntityManager,
    reserva: ReservaParaNotificar,
    confirmada: boolean,
    agora: Date,
  ): Promise<void> {
    await cancelarPendentes(tx, reserva, 'REMARCADA', agora, LEMBRETES);
    await reapontarConfirmacao(tx, reserva, agora);
    if (!confirmada) return;
    const tarefas = planejarNotificacoes({
      inicio: reserva.inicio,
      timezone: reserva.timezone,
      agora,
      incluirConfirmacao: false,
    });
    await programarTarefas(tx, reserva, tarefas, agora);
  }
}
