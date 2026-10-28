// Acesso a `notification_jobs` por SQL explícito (ver o porquê na migration
// 1792540800000-NotificationJobs.ts). Toda função recebe o `EntityManager` de
// quem chama: dentro da transação da reserva, a tarefa nasce e morre junto
// com a mudança — rollback nunca deixa tarefa órfã.
//
// Todas as consultas levam `tenant_id` (ou o id de uma linha já reservada
// por este executor); nenhuma atravessa estabelecimentos.
import type { EntityManager } from 'typeorm';
import { linhasDe } from '../common/linhas-de.js';
import { generateId } from '../entities/common/generate-id.js';
import {
  chaveDeDeduplicacao,
  type TarefaPlanejada,
  type TipoDeNotificacao,
} from './notification-policy.js';

export type StatusDaTarefa =
  | 'SCHEDULED'
  | 'PROCESSING'
  | 'SENDING'
  | 'SENT'
  | 'DELIVERED'
  | 'UNCERTAIN'
  | 'FAILED'
  | 'SKIPPED'
  | 'CANCELED';

export interface TarefaDeNotificacao {
  id: string;
  tenant_id: string;
  appointment_id: string;
  kind: TipoDeNotificacao;
  appointment_start_at: Date;
  scheduled_for: Date;
  not_after: Date;
  dedupe_key: string;
  status: StatusDaTarefa;
  attempts: number;
  locked_by: string | null;
  locked_until: Date | null;
  provider_message_id: string | null;
  outcome_reason: string | null;
  last_error: string | null;
}

/** Estados em que a tarefa ainda pode ser invalidada por uma mudança na
 * reserva. `SENDING` não entra: a decisão de enviar já foi tomada e
 * gravada (ver notification-dispatcher.ts). */
const PENDENTES = `('SCHEDULED', 'PROCESSING')`;

/**
 * Programa as tarefas. Repetir é inofensivo: a chave de deduplicação é
 * UNIQUE e a linha existente não é tocada — exceto se ela tiver sido
 * CANCELADA (reserva remarcada de volta ao horário anterior), caso em que
 * volta a valer. Uma tarefa já enviada nunca é reaberta.
 */
export async function programarTarefas(
  manager: EntityManager,
  alvo: { tenantId: string; appointmentId: string; inicio: Date },
  tarefas: readonly TarefaPlanejada[],
  agora: Date,
): Promise<void> {
  for (const tarefa of tarefas) {
    await manager.query(
      `INSERT INTO notification_jobs
         (id, tenant_id, appointment_id, kind, appointment_start_at, scheduled_for, not_after,
          dedupe_key, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
       ON CONFLICT (dedupe_key) DO UPDATE SET
         status = 'SCHEDULED',
         appointment_start_at = EXCLUDED.appointment_start_at,
         scheduled_for = EXCLUDED.scheduled_for,
         not_after = EXCLUDED.not_after,
         attempts = 0,
         locked_by = NULL,
         locked_until = NULL,
         outcome_reason = NULL,
         last_error = NULL,
         finished_at = NULL,
         updated_at = EXCLUDED.updated_at
       WHERE notification_jobs.status = 'CANCELED'`,
      [
        generateId(),
        alvo.tenantId,
        alvo.appointmentId,
        tarefa.tipo,
        alvo.inicio,
        tarefa.programadaPara,
        tarefa.prazo,
        chaveDeDeduplicacao(alvo.appointmentId, tarefa.tipo, alvo.inicio),
        agora,
      ],
    );
  }
}

/** Invalida o que ainda não saiu. `tipos` vazio = todos os tipos. */
export async function cancelarPendentes(
  manager: EntityManager,
  alvo: { tenantId: string; appointmentId: string },
  motivo: string,
  agora: Date,
  tipos: readonly TipoDeNotificacao[] = [],
): Promise<number> {
  const filtroDeTipo = tipos.length > 0 ? `AND kind = ANY($5::varchar[])` : '';
  const resultado = await manager.query(
    `UPDATE notification_jobs
        SET status = 'CANCELED', outcome_reason = $3, finished_at = $4, updated_at = $4,
            locked_by = NULL, locked_until = NULL
      WHERE tenant_id = $1 AND appointment_id = $2 AND status IN ${PENDENTES} ${filtroDeTipo}
      RETURNING id`,
    tipos.length > 0
      ? [alvo.tenantId, alvo.appointmentId, motivo, agora, tipos]
      : [alvo.tenantId, alvo.appointmentId, motivo, agora],
  );
  return linhasDe(resultado).length;
}

/** A confirmação ainda não enviada passa a falar do horário novo. */
export async function reapontarConfirmacao(
  manager: EntityManager,
  alvo: { tenantId: string; appointmentId: string; inicio: Date },
  agora: Date,
): Promise<void> {
  await manager.query(
    `UPDATE notification_jobs
        SET appointment_start_at = $3, not_after = GREATEST($3, scheduled_for), updated_at = $4
      WHERE tenant_id = $1 AND appointment_id = $2 AND kind = 'CONFIRMATION'
        AND status IN ${PENDENTES}`,
    [alvo.tenantId, alvo.appointmentId, alvo.inicio, agora],
  );
}

/**
 * Reserva até `limite` tarefas vencidas para ESTE executor.
 *
 * Um único UPDATE com `FOR UPDATE SKIP LOCKED` no subselect: dois executores
 * rodando ao mesmo tempo nunca pegam a mesma linha — o segundo pula o que o
 * primeiro travou. Também recupera `PROCESSING` cuja concessão venceu
 * (executor que morreu ANTES de chamar o provedor: reenviar é seguro).
 */
export async function reservarTarefasVencidas(
  manager: EntityManager,
  executor: string,
  agora: Date,
  limite: number,
  concessaoMs: number,
): Promise<TarefaDeNotificacao[]> {
  const resultado = await manager.query(
    `UPDATE notification_jobs AS j
        SET status = 'PROCESSING', locked_by = $1, locked_until = $3,
            attempts = j.attempts + 1, updated_at = $2
      WHERE j.id IN (
        SELECT id FROM notification_jobs
         WHERE (status = 'SCHEDULED' AND scheduled_for <= $2)
            OR (status = 'PROCESSING' AND locked_until < $2)
         ORDER BY scheduled_for, id
         LIMIT $4
         FOR UPDATE SKIP LOCKED)
      RETURNING j.*`,
    [executor, agora, new Date(agora.getTime() + concessaoMs), limite],
  );
  return linhasDe<TarefaDeNotificacao>(resultado);
}

/**
 * `SENDING` com concessão vencida: o executor morreu DEPOIS de decidir
 * enviar e não registrou o resultado. Não dá para saber se o provedor
 * recebeu. Com provedor idempotente (que descarta a mesma chave repetida),
 * volta para a fila; sem isso, vira `UNCERTAIN` — reenviar poderia duplicar
 * a mensagem para o cliente.
 */
export async function resolverEnviosAbandonados(
  manager: EntityManager,
  agora: Date,
  provedorIdempotente: boolean,
  maximoDeTentativas: number,
): Promise<number> {
  const resultado = await manager.query(
    `UPDATE notification_jobs
        SET status = CASE WHEN $2::boolean AND attempts < $3::int AND not_after > $1::timestamptz THEN 'SCHEDULED' ELSE 'UNCERTAIN' END,
            outcome_reason = CASE WHEN $2::boolean AND attempts < $3::int AND not_after > $1::timestamptz THEN outcome_reason ELSE 'EXECUTOR_INTERROMPIDO' END,
            finished_at = CASE WHEN $2::boolean AND attempts < $3::int AND not_after > $1::timestamptz THEN NULL ELSE $1::timestamptz END,
            locked_by = NULL, locked_until = NULL, updated_at = $1::timestamptz
      WHERE status = 'SENDING' AND locked_until < $1::timestamptz
      RETURNING id`,
    [agora, provedorIdempotente, maximoDeTentativas],
  );
  return linhasDe(resultado).length;
}

/**
 * Transição condicionada a AINDA ser deste executor e estar no estado
 * esperado. Devolve `false` quando outra coisa mudou a linha no meio (ex.: a
 * reserva foi cancelada e invalidou a tarefa) — quem chama desiste.
 */
export async function transicionar(
  manager: EntityManager,
  tarefa: { id: string; executor: string; de: StatusDaTarefa },
  para: {
    status: StatusDaTarefa;
    agora: Date;
    motivo?: string | null;
    erro?: string | null;
    idDaMensagem?: string | null;
    reprogramarPara?: Date | null;
    concessaoAte?: Date | null;
  },
): Promise<boolean> {
  const final = !['SCHEDULED', 'PROCESSING', 'SENDING'].includes(para.status);
  const resultado = await manager.query(
    `UPDATE notification_jobs
        SET status = $4::varchar,
            outcome_reason = COALESCE($5::varchar, outcome_reason),
            last_error = COALESCE($6::varchar, last_error),
            provider_message_id = COALESCE($7::varchar, provider_message_id),
            scheduled_for = COALESCE($8::timestamptz, scheduled_for),
            sent_at = CASE WHEN $4::varchar = 'SENT' THEN $3::timestamptz ELSE sent_at END,
            finished_at = CASE WHEN $9::boolean THEN $3::timestamptz ELSE NULL END,
            locked_by = CASE WHEN $4::varchar IN ('PROCESSING', 'SENDING') THEN locked_by ELSE NULL END,
            locked_until = CASE WHEN $4::varchar IN ('PROCESSING', 'SENDING') THEN COALESCE($10::timestamptz, locked_until) ELSE NULL END,
            updated_at = $3::timestamptz
      WHERE id = $1 AND locked_by = $2 AND status = $11::varchar
      RETURNING id`,
    [
      tarefa.id,
      tarefa.executor,
      para.agora,
      para.status,
      para.motivo ?? null,
      para.erro ? para.erro.slice(0, 500) : null,
      para.idDaMensagem ?? null,
      para.reprogramarPara ?? null,
      final,
      para.concessaoAte ?? null,
      tarefa.de,
    ],
  );
  return linhasDe(resultado).length === 1;
}

/** Retorno do provedor (webhook futuro): entrega confirmada. */
export async function registrarEntrega(
  manager: EntityManager,
  idDaMensagem: string,
  quando: Date,
): Promise<boolean> {
  const resultado = await manager.query(
    `UPDATE notification_jobs
        SET status = 'DELIVERED', delivered_at = $2, updated_at = $2
      WHERE provider_message_id = $1 AND status = 'SENT'
      RETURNING id`,
    [idDaMensagem, quando],
  );
  return linhasDe(resultado).length === 1;
}
