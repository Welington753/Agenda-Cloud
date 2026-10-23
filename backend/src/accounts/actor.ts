// Quem está agindo na administração: relido do banco DENTRO da transação de
// cada operação, nunca do navegador nem de uma leitura anterior. Um papel
// retirado no meio do caminho vale na próxima operação.
import { ForbiddenException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { PlatformPermission } from '../entities/enums/platform-permission.enum.js';
import type { PlatformRole } from '../entities/enums/platform-role.enum.js';
import type { UserStatus } from '../entities/enums/user-status.enum.js';
import { platformCapabilities, type PlatformCapabilities } from '../platform/platform-access.js';

export interface Actor {
  id: string;
  name: string;
  status: UserStatus;
  platformRole: PlatformRole | null;
  platformPermissions: PlatformPermission[] | null;
  caps: PlatformCapabilities;
}

export const FORBIDDEN_MESSAGE = 'Sua conta não tem permissão para esta ação na administração da plataforma.';
export const SELF_MESSAGE = 'A administração não altera a própria conta de quem está agindo.';
export const PLATFORM_ACCOUNT_MESSAGE = 'Só a pessoa responsável pela plataforma altera contas com papel de plataforma.';

interface UserRow {
  id: string;
  name: string;
  status: UserStatus;
  platform_role: PlatformRole | null;
  platform_permissions: PlatformPermission[] | null;
}

export async function loadActor(manager: EntityManager, userId: string, lock = false): Promise<Actor> {
  const [row] = await manager.query<UserRow[]>(
    `SELECT id, name, status, platform_role, platform_permissions::text[] AS platform_permissions FROM users WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
    [userId],
  );
  const actor = {
    id: userId,
    name: row?.name ?? '',
    status: row?.status ?? ('SUSPENDED' as UserStatus),
    platformRole: row?.platform_role ?? null,
    platformPermissions: row?.platform_permissions ?? null,
  };
  return {
    ...actor,
    caps: row
      ? platformCapabilities({
          status: actor.status,
          platformRole: actor.platformRole ?? undefined,
          platformPermissions: actor.platformPermissions ?? undefined,
        })
      : platformCapabilities(null),
  };
}

export function requireCapability(actor: Actor, capability: keyof Actor['caps']): void {
  if (!actor.caps[capability]) throw new ForbiddenException(FORBIDDEN_MESSAGE);
}

/** Regra única para agir sobre a conta de outra pessoa: nunca a própria;
 * conta com papel de plataforma só com `managePlatformAccess`; as demais com
 * `manageEstablishments`. */
export function assertCanManageAccount(actor: Actor, target: { id: string; platformRole: PlatformRole | null }): void {
  if (target.id === actor.id) throw new ForbiddenException(SELF_MESSAGE);
  if (target.platformRole) {
    if (!actor.caps.managePlatformAccess) throw new ForbiddenException(PLATFORM_ACCOUNT_MESSAGE);
    return;
  }
  requireCapability(actor, 'manageEstablishments');
}

export function canManageAccount(actor: Actor, target: { id: string; platformRole: PlatformRole | null }): boolean {
  try {
    assertCanManageAccount(actor, target);
    return true;
  } catch {
    return false;
  }
}
