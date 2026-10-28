// Acesso a `push_subscriptions` por SQL explícito (ver o porquê na migration
// 1792713600000-WebPush.ts). Toda consulta leva `tenant_id` ou o hash do
// endpoint; nenhuma devolve o endpoint para fora do executor de envio.
import type { EntityManager } from 'typeorm';
import { generateId } from '../entities/common/generate-id.js';
import { linhasDe } from '../common/linhas-de.js';

export interface NovaInscricao {
  userId: string;
  tenantId: string;
  sessionId: string;
  endpoint: string;
  endpointHash: string;
  p256dh: string;
  auth: string;
}

/**
 * Grava (ou reativa) a inscrição deste aparelho neste estabelecimento para
 * este usuário e esta sessão. Na mesma transação:
 * - o mesmo endpoint registrado por OUTRO usuário (em qualquer
 *   estabelecimento) é revogado: um aparelho avisa uma pessoa só;
 * - a linha `(endpoint_hash, tenant_id)` passa a ser deste usuário/sessão,
 *   com as chaves novas (a de outro usuário é reaproveitada: o histórico de
 *   tentativas continua, mas ela não avisa mais quem a criou).
 */
export async function gravarInscricao(manager: EntityManager, dados: NovaInscricao, agora: Date): Promise<string> {
  await manager.query(
    `UPDATE push_subscriptions
        SET status = 'REVOKED', revoked_reason = 'OUTRO_USUARIO', updated_at = $3
      WHERE endpoint_hash = $1 AND user_id <> $2 AND status = 'ACTIVE'`,
    [dados.endpointHash, dados.userId, agora],
  );
  const [linha] = linhasDe<{ id: string }>(
    await manager.query(
      `INSERT INTO push_subscriptions
         (id, user_id, tenant_id, session_id, endpoint, endpoint_hash, p256dh, auth,
          status, revoked_reason, failure_count, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ACTIVE', NULL, 0, $9, $9)
       ON CONFLICT (endpoint_hash, tenant_id) DO UPDATE SET
         user_id = EXCLUDED.user_id,
         session_id = EXCLUDED.session_id,
         endpoint = EXCLUDED.endpoint,
         p256dh = EXCLUDED.p256dh,
         auth = EXCLUDED.auth,
         status = 'ACTIVE',
         revoked_reason = NULL,
         failure_count = 0,
         updated_at = EXCLUDED.updated_at
       RETURNING id`,
      [
        generateId(),
        dados.userId,
        dados.tenantId,
        dados.sessionId,
        dados.endpoint,
        dados.endpointHash,
        dados.p256dh,
        dados.auth,
        agora,
      ],
    ),
  );
  return linha.id;
}

/** Este aparelho está ATIVO para este usuário, nesta sessão, neste
 * estabelecimento? */
export async function inscricaoAtiva(
  manager: EntityManager,
  alvo: { tenantId: string; userId: string; sessionId: string; endpointHash: string },
): Promise<boolean> {
  const linhas = linhasDe(
    await manager.query(
      `SELECT 1 FROM push_subscriptions
        WHERE tenant_id = $1 AND user_id = $2 AND session_id = $3 AND endpoint_hash = $4
          AND status = 'ACTIVE'`,
      [alvo.tenantId, alvo.userId, alvo.sessionId, alvo.endpointHash],
    ),
  );
  return linhas.length === 1;
}

/** Desativar neste aparelho: só a linha do próprio usuário. */
export async function revogarInscricao(
  manager: EntityManager,
  alvo: { tenantId: string; userId: string; endpointHash: string },
  motivo: string,
  agora: Date,
): Promise<number> {
  return linhasDe(
    await manager.query(
      `UPDATE push_subscriptions
          SET status = 'REVOKED', revoked_reason = $4, updated_at = $5
        WHERE tenant_id = $1 AND user_id = $2 AND endpoint_hash = $3 AND status = 'ACTIVE'
        RETURNING id`,
      [alvo.tenantId, alvo.userId, alvo.endpointHash, motivo, agora],
    ),
  ).length;
}

/** O serviço de push disse que a inscrição não existe mais (404/410). */
export async function marcarExpirada(manager: EntityManager, id: string, agora: Date): Promise<void> {
  await manager.query(
    `UPDATE push_subscriptions
        SET status = 'EXPIRED', revoked_reason = 'SERVICO_DE_PUSH', updated_at = $2
      WHERE id = $1 AND status = 'ACTIVE'`,
    [id, agora],
  );
}

/** Resultado de um envio para a inscrição (sucesso zera as falhas; muitas
 * recusas seguidas revogam). */
export async function registrarResultado(
  manager: EntityManager,
  id: string,
  sucesso: boolean,
  agora: Date,
  limiteDeFalhas: number,
): Promise<void> {
  if (sucesso) {
    await manager.query(
      `UPDATE push_subscriptions SET failure_count = 0, last_success_at = $2, updated_at = $2 WHERE id = $1`,
      [id, agora],
    );
    return;
  }
  await manager.query(
    `UPDATE push_subscriptions
        SET failure_count = failure_count + 1,
            status = CASE WHEN failure_count + 1 >= $3 AND status = 'ACTIVE' THEN 'REVOKED' ELSE status END,
            revoked_reason = CASE WHEN failure_count + 1 >= $3 AND status = 'ACTIVE' THEN 'FALHAS_REPETIDAS' ELSE revoked_reason END,
            updated_at = $2
      WHERE id = $1`,
    [id, agora, limiteDeFalhas],
  );
}
