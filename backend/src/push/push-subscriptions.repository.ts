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

/** Linhas de OUTRO usuário que esta gravação alteraria (as ativas, em
 * qualquer estabelecimento, e a deste estabelecimento, em qualquer situação)
 * e cujas chaves não são as recebidas. */
const CHAVES_DIVERGENTES_SQL = `SELECT 1 FROM push_subscriptions
      WHERE endpoint_hash = $1 AND user_id <> $2
        AND (status = 'ACTIVE' OR tenant_id = $3)
        AND (p256dh <> $4 OR auth <> $5)
      LIMIT 1`;

/**
 * Grava (ou reativa) a inscrição deste aparelho neste estabelecimento para
 * este usuário e esta sessão. Exige transação (a trava é da transação).
 *
 * - A trava consultiva por endpoint serializa as gravações do mesmo aparelho:
 *   a conferência e as alterações abaixo não intercalam com outra gravação.
 * - Transferência entre usuários só com as MESMAS chaves (`p256dh` e `auth`):
 *   é o mesmo navegador, agora com outra pessoa. Se alguma linha de outro
 *   usuário que seria alterada tem chaves diferentes, nada é gravado e a
 *   função devolve `null` (quem conhece só o endpoint de um aparelho alheio
 *   não revoga nem toma a inscrição dele).
 * - Com as chaves conferidas: o mesmo endpoint registrado por OUTRO usuário
 *   (em qualquer estabelecimento) é revogado, porque um aparelho avisa uma
 *   pessoa só; e a linha `(endpoint_hash, tenant_id)` passa a ser deste
 *   usuário/sessão (a de outro usuário é reaproveitada: o histórico de
 *   tentativas continua, mas ela não avisa mais quem a criou).
 * - A linha do próprio usuário aceita chaves novas (atualização legítima da
 *   própria inscrição).
 *
 * Limitações conhecidas (sem bypass nem limpeza, de propósito):
 * - Linha ATIVA de outro usuário com outras chaves no mesmo endpoint (dado
 *   anterior a esta conferência, ou chaves trocadas sem trocar o endpoint)
 *   recusa também a atualização da própria linha, porque a gravação teria de
 *   revogá-la.
 * - Linha desativada de outro usuário com outras chaves neste
 *   estabelecimento recusa a inscrição neste estabelecimento, porque seria
 *   ela a linha reaproveitada.
 */
export async function gravarInscricao(
  manager: EntityManager,
  dados: NovaInscricao,
  agora: Date,
): Promise<string | null> {
  await manager.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
    `push_subscriptions.endpoint:${dados.endpointHash}`,
  ]);
  const divergentes = linhasDe(
    await manager.query(CHAVES_DIVERGENTES_SQL, [
      dados.endpointHash,
      dados.userId,
      dados.tenantId,
      dados.p256dh,
      dados.auth,
    ]),
  );
  if (divergentes.length > 0) return null;

  // As condições de chave abaixo repetem a conferência (defesa em
  // profundidade): nenhuma linha alheia com outras chaves é tocada.
  await manager.query(
    `UPDATE push_subscriptions
        SET status = 'REVOKED', revoked_reason = 'OUTRO_USUARIO', updated_at = $3
      WHERE endpoint_hash = $1 AND user_id <> $2 AND status = 'ACTIVE'
        AND p256dh = $4 AND auth = $5`,
    [dados.endpointHash, dados.userId, agora, dados.p256dh, dados.auth],
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
       WHERE push_subscriptions.user_id = EXCLUDED.user_id
          OR (push_subscriptions.p256dh = EXCLUDED.p256dh AND push_subscriptions.auth = EXCLUDED.auth)
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
  // Sem linha: a guarda do ON CONFLICT recusou (não deveria acontecer com a
  // trava). Lançar desfaz a revogação acima junto com a transação.
  if (!linha) throw new Error('Inscrição de push não gravada: a linha pertence a outro aparelho.');
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
