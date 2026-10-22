import { ForbiddenException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { User } from '../entities/user.entity.js';
import { PlatformRole } from '../entities/enums/platform-role.enum.js';
import { PlatformPermission } from '../entities/enums/platform-permission.enum.js';
import { UserStatus } from '../entities/enums/user-status.enum.js';

/** Um DONO de estabelecimento nunca herda acesso global pela Membership. */
export function canViewEstablishments(
  user: Pick<User, 'status' | 'platformRole' | 'platformPermissions'> | null,
): boolean {
  if (!user || user.status !== UserStatus.ACTIVE) return false;
  if (user.platformRole === PlatformRole.MASTER_OWNER) return true;
  return (
    (user.platformRole === PlatformRole.MASTER_ADMIN ||
      user.platformRole === PlatformRole.MASTER_SUPPORT) &&
    !!user.platformPermissions?.includes(
      PlatformPermission.ESTABLISHMENTS_MANAGE,
    )
  );
}

export async function requirePlatformAccess(
  manager: EntityManager,
  userId: string,
): Promise<void> {
  const user = await manager.findOne(User, { where: { id: userId } });
  if (!canViewEstablishments(user))
    throw new ForbiddenException('Sem acesso à administração da plataforma.');
}
