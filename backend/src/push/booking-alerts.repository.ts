// Acesso a `booking_request_alerts` (o evento "chegou solicitação nova") e
// `push_deliveries` (cada tentativa por aparelho), por SQL explícito.
//
// O evento nasce na transação do pedido público (`registrarAlerta`, com o
// `EntityManager` da transação): rollback = sem evento. O resto é do
// executor de envio (push-dispatcher.ts), sempre condicionado a a linha
// ainda ser dele (`locked_by`).
import type { EntityManager } from 'typeorm';
import { generateId } from '../entities/common/generate-id.js';
import { linhasDe } from '../common/linhas-de.js';

/** Aviso velho não serve mais: depois disto, o evento expira sem envio. */
export const VALIDADE_DO_ALERTA_MS = 24 * 60 * 60_000;

export type StatusDoAlerta = 'PENDING' | 'PROCESSING' | 'DONE' | 'EXPIRED';
export type StatusDaEntrega = 'SENDING' | 'ACCEPTED' | 'RETRY' | 'FAILED' | 'GONE' | 'SKIPPED';

export interface AlertaReservado {
  id: string;
  tenant_id: string;
  appointment_id: string;
  attempts: number;
  not_after: Date;
}

export interface Destinatario {
  subscription_id: string;
  membership_id: string;
  role: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export const chaveDoAlerta = (appointmentId: string) => `NEW_BOOKING_REQUEST:${appointmentId}`;

/**
 * Registra o evento DENTRO da transação do pedido. Repetir é inofensivo
 * (`dedupe_key` UNIQUE). Prazo: o menor entre 24 h e o início do
 * atendimento — depois de começar, avisar não ajuda ninguém.
 */
export async function registrarAlerta(
  tx: EntityManager,
  dados: { tenantId: string; appointmentId: string; inicio: Date },
  agora: Date,
): Promise<void> {
  const prazo = new Date(Math.max(agora.getTime(), Math.min(agora.getTime() + VALIDADE_DO_ALERTA_MS, dados.inicio.getTime())));
  await tx.query(
    `INSERT INTO booking_request_alerts
       (id, tenant_id, appointment_id, dedupe_key, status, attempts, next_attempt_at, not_after,
        created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'PENDING', 0, $5, $6, $5, $5)
     ON CONFLICT (dedupe_key) DO NOTHING`,
    [generateId(), dados.tenantId, dados.appointmentId, chaveDoAlerta(dados.appointmentId), agora, prazo],
  );
}

/** Pendentes (ou largados por um executor morto) com o prazo vencido. */
export async function expirarVencidos(manager: EntityManager, agora: Date): Promise<number> {
  return linhasDe(
    await manager.query(
      `UPDATE booking_request_alerts
          SET status = 'EXPIRED', outcome_reason = 'PRAZO_ESGOTADO', finished_at = $1,
              locked_by = NULL, locked_until = NULL, updated_at = $1
        WHERE not_after <= $1
          AND (status = 'PENDING' OR (status = 'PROCESSING' AND locked_until < $1))
        RETURNING id`,
      [agora],
    ),
  ).length;
}

/**
 * Reserva eventos vencidos para ESTE executor. `FOR UPDATE SKIP LOCKED`:
 * dois executores (duas instâncias, ou o disparo imediato e a retomada)
 * nunca pegam o mesmo evento. `PROCESSING` com concessão vencida = executor
 * que morreu no meio; o evento volta (reenviar é seguro: a notificação usa a
 * mesma etiqueta e o aparelho substitui em vez de duplicar).
 */
export async function reservarAlertas(
  manager: EntityManager,
  executor: string,
  agora: Date,
  limite: number,
  concessaoMs: number,
): Promise<AlertaReservado[]> {
  return linhasDe<AlertaReservado>(
    await manager.query(
      `UPDATE booking_request_alerts AS a
          SET status = 'PROCESSING', locked_by = $1, locked_until = $3,
              attempts = a.attempts + 1, updated_at = $2
        WHERE a.id IN (
          SELECT id FROM booking_request_alerts
           WHERE not_after > $2
             AND ((status = 'PENDING' AND next_attempt_at <= $2)
               OR (status = 'PROCESSING' AND locked_until < $2))
           ORDER BY next_attempt_at, id
           LIMIT $4
           FOR UPDATE SKIP LOCKED)
        RETURNING a.id, a.tenant_id, a.appointment_id, a.attempts, a.not_after`,
      [executor, agora, new Date(agora.getTime() + concessaoMs), limite],
    ),
  );
}

/** Encerra (DONE) ou devolve à fila (PENDING com nova tentativa), se o evento
 * ainda for deste executor. */
export async function concluirAlerta(
  manager: EntityManager,
  alvo: { id: string; executor: string },
  resultado: { status: 'DONE' | 'PENDING'; motivo: string; agora: Date; proximaTentativa?: Date },
): Promise<boolean> {
  return (
    linhasDe(
      await manager.query(
        `UPDATE booking_request_alerts
            SET status = $3::varchar, outcome_reason = $4,
                next_attempt_at = COALESCE($6::timestamptz, next_attempt_at),
                finished_at = CASE WHEN $3::varchar = 'DONE' THEN $5::timestamptz ELSE NULL END,
                locked_by = NULL, locked_until = NULL, updated_at = $5::timestamptz
          WHERE id = $1 AND locked_by = $2 AND status = 'PROCESSING'
          RETURNING id`,
        [alvo.id, alvo.executor, resultado.status, resultado.motivo, resultado.agora, resultado.proximaTentativa ?? null],
      ),
    ).length === 1
  );
}

/** A reserva ainda está aguardando confirmação, num estabelecimento ativo? */
export async function situacaoDaSolicitacao(
  manager: EntityManager,
  tenantId: string,
  appointmentId: string,
): Promise<{ status: string; tenant_status: string } | null> {
  const [linha] = linhasDe<{ status: string; tenant_status: string }>(
    await manager.query(
      `SELECT a.status, t.status AS tenant_status
         FROM appointments a JOIN tenants t ON t.id = a.tenant_id
        WHERE a.tenant_id = $1 AND a.id = $2`,
      [tenantId, appointmentId],
    ),
  );
  return linha ?? null;
}

/**
 * Inscrições que PODEM receber este evento agora: ativas, do
 * estabelecimento do evento, de usuário ativo, com vínculo, criadas por
 * sessão ainda válida, e sem resultado definitivo para este evento. A
 * permissão do papel (e as negações) é conferida por quem chama, com a
 * mesma política da lista de solicitações.
 */
export async function destinatarios(
  manager: EntityManager,
  alerta: { id: string; tenant_id: string },
  agora: Date,
): Promise<Destinatario[]> {
  return linhasDe<Destinatario>(
    await manager.query(
      `SELECT s.id AS subscription_id, m.id AS membership_id, m.role, s.endpoint, s.p256dh, s.auth
         FROM push_subscriptions s
         JOIN memberships m ON m.user_id = s.user_id AND m.tenant_id = s.tenant_id AND m.status = 'ACTIVE'
         JOIN users u ON u.id = s.user_id AND u.status = 'ACTIVE'
         JOIN sessions se ON se.id = s.session_id AND se.user_id = s.user_id
                         AND se.revoked_at IS NULL AND se.expires_at > $3
        WHERE s.tenant_id = $1 AND s.status = 'ACTIVE'
          AND NOT EXISTS (
            SELECT 1 FROM push_deliveries d
             WHERE d.alert_id = $2 AND d.subscription_id = s.id
               AND d.status IN ('ACCEPTED', 'FAILED', 'GONE', 'SKIPPED'))
        ORDER BY s.created_at, s.id`,
      [alerta.tenant_id, alerta.id, agora],
    ),
  );
}

export async function negacoesDoVinculo(
  manager: EntityManager,
  tenantId: string,
  membershipId: string,
): Promise<{ permission: string; mode: string }[]> {
  return linhasDe(
    await manager.query(
      `SELECT permission, mode FROM membership_permission_overrides WHERE tenant_id = $1 AND membership_id = $2`,
      [tenantId, membershipId],
    ),
  );
}

/** Registra a decisão de enviar ANTES da chamada externa (ou de pular). */
export async function iniciarEntrega(
  manager: EntityManager,
  dados: { alertId: string; subscriptionId: string; tenantId: string; status: 'SENDING' | 'SKIPPED'; motivo?: string },
  agora: Date,
): Promise<string> {
  const [linha] = linhasDe<{ id: string }>(
    await manager.query(
      `INSERT INTO push_deliveries
         (id, alert_id, subscription_id, tenant_id, status, attempts, outcome_reason, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 1, $6, $7, $7)
       ON CONFLICT (alert_id, subscription_id) DO UPDATE SET
         status = EXCLUDED.status, attempts = push_deliveries.attempts + 1,
         outcome_reason = EXCLUDED.outcome_reason, http_status = NULL, updated_at = EXCLUDED.updated_at
       RETURNING id`,
      [generateId(), dados.alertId, dados.subscriptionId, dados.tenantId, dados.status, dados.motivo ?? null, agora],
    ),
  );
  return linha.id;
}

export async function concluirEntrega(
  manager: EntityManager,
  id: string,
  resultado: { status: StatusDaEntrega; httpStatus: number | null; motivo: string; agora: Date },
): Promise<void> {
  await manager.query(
    `UPDATE push_deliveries
        SET status = $2::varchar, http_status = $3::int, outcome_reason = $4::varchar,
            accepted_at = CASE WHEN $2::varchar = 'ACCEPTED' THEN $5::timestamptz ELSE accepted_at END,
            updated_at = $5::timestamptz
      WHERE id = $1`,
    [id, resultado.status, resultado.httpStatus, resultado.motivo, resultado.agora],
  );
}
