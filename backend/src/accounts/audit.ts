// Gravação do histórico administrativo em `audit_logs`, SEMPRE com o mesmo
// `manager` da mudança: mudança e registro entram (ou saem) juntos na mesma
// transação. Nunca grava senha, hash, token ou link: quem chama monta
// `previousData`/`newData` só com campos de negócio.
import type { EntityManager } from 'typeorm';
import { generateId } from '../entities/common/generate-id.js';

export type AdminAuditAction =
  | 'TENANT_CREATED'
  | 'USER_INVITED'
  | 'USER_PERMISSION_CHANGED'
  | 'USER_UPDATED'
  | 'USER_BLOCKED'
  | 'USER_REACTIVATED'
  | 'INVITE_RESENT'
  | 'INVITE_REVOKED'
  | 'INVITE_ACCEPTED'
  | 'MEMBERSHIP_REMOVED'
  | 'PASSWORD_RESET_REQUESTED'
  | 'PASSWORD_RESET_COMPLETED'
  | 'PLATFORM_ACCESS_CHANGED'
  | 'TENANT_UPDATED'
  | 'TENANT_SUSPENDED'
  | 'TENANT_REACTIVATED'
  | 'TENANT_ARCHIVED'
  | 'TENANT_PLAN_CHANGED'
  | 'MEMBERSHIP_SUSPENDED'
  | 'MEMBERSHIP_REACTIVATED'
  | 'STAFF_ACCESS_CREATED'
  | 'STAFF_PASSWORD_RESET'
  | 'PASSWORD_CHANGED'
  | 'PAYMENT_RECORDED'
  | 'PAYMENT_REFUNDED';

export interface AuditEntry {
  action: AdminAuditAction;
  actor: { id: string; name: string };
  tenantId?: string | null;
  targetUserId?: string | null;
  summary: string;
  previousData?: Record<string, unknown> | null;
  newData?: Record<string, unknown> | null;
}

export async function recordAudit(manager: EntityManager, entry: AuditEntry, now: Date): Promise<void> {
  await manager.query(
    `INSERT INTO audit_logs
       (id, occurred_at, action, actor_user_id, actor_name, tenant_id, target_user_id, summary, previous_data, new_data)
     VALUES ($1, $2, $3::audit_action, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb)`,
    [
      generateId(),
      now,
      entry.action,
      entry.actor.id,
      entry.actor.name,
      entry.tenantId ?? null,
      entry.targetUserId ?? null,
      entry.summary,
      entry.previousData ? JSON.stringify(entry.previousData) : null,
      entry.newData ? JSON.stringify(entry.newData) : null,
    ],
  );
}
