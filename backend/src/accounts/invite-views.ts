// Leitura de convites no formato que a administração mostra. Nunca devolve
// `token_hash`. O estado "expirado" é calculado na leitura (um convite
// pendente cujo prazo passou), sem depender de um job.
import type { EntityManager } from 'typeorm';
import { MAX_INVITE_SENDS } from './account-token.js';

export type InviteViewStatus = 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'REVOKED';

export interface InviteView {
  id: string;
  type: 'ESTABLISHMENT' | 'PLATFORM';
  status: InviteViewStatus;
  targetName: string;
  targetEmail: string;
  targetUser: { id: string; status: string; hasCredential: boolean } | null;
  tenant: { id: string; name: string } | null;
  role: string | null;
  platformRole: string | null;
  platformPermissions: string[];
  delivery: { status: string; attempts: number; lastAt: string | null; failure: string | null };
  sendCount: number;
  maxSends: number;
  createdBy: { id: string; name: string };
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
}

export const INVITE_STATUS_SQL = `CASE WHEN i.status = 'PENDING' AND i.expires_at <= now() THEN 'EXPIRED'
  ELSE i.status::text END`;

export const INVITE_FROM = `FROM invites i
  JOIN users creator ON creator.id = i.created_by_user_id
  LEFT JOIN users target ON target.id = i.target_user_id
  LEFT JOIN tenants t ON t.id = i.tenant_id
  LEFT JOIN LATERAL (
    SELECT name FROM units WHERE tenant_id = t.id AND is_primary = true ORDER BY created_at, id LIMIT 1
  ) main_unit ON true`;

export const INVITE_COLUMNS = `json_build_object(
  'id', i.id,
  'type', i.type,
  'status', ${INVITE_STATUS_SQL},
  'targetName', i.target_name,
  'targetEmail', i.target_email,
  'targetUser', CASE WHEN target.id IS NULL THEN NULL ELSE json_build_object(
    'id', target.id, 'status', target.status,
    'hasCredential', EXISTS (SELECT 1 FROM credentials c WHERE c.user_id = target.id)) END,
  'tenant', CASE WHEN t.id IS NULL THEN NULL ELSE json_build_object(
    'id', t.id, 'name', COALESCE(main_unit.name, t.slug::text)) END,
  'role', i.establishment_role,
  'platformRole', i.platform_role,
  'platformPermissions', COALESCE(to_json(i.platform_permissions), '[]'::json),
  'delivery', json_build_object('status', i.delivery_status, 'attempts', i.delivery_attempts,
    'lastAt', i.last_delivery_at, 'failure', i.delivery_failure),
  'sendCount', i.send_count,
  'maxSends', ${MAX_INVITE_SENDS},
  'createdBy', json_build_object('id', creator.id, 'name', creator.name),
  'createdAt', i.created_at,
  'expiresAt', i.expires_at,
  'acceptedAt', i.accepted_at,
  'revokedAt', i.revoked_at
) AS invite`;

export async function loadInviteView(manager: EntityManager, inviteId: string): Promise<InviteView | null> {
  const [row] = await manager.query<{ invite: InviteView }[]>(
    `SELECT ${INVITE_COLUMNS} ${INVITE_FROM} WHERE i.id = $1`,
    [inviteId],
  );
  return row?.invite ?? null;
}
