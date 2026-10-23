import { ForbiddenException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { User } from '../entities/user.entity.js';
import { PlatformRole } from '../entities/enums/platform-role.enum.js';
import { PlatformPermission } from '../entities/enums/platform-permission.enum.js';
import { UserStatus } from '../entities/enums/user-status.enum.js';

type PlatformActor = Pick<User, 'status' | 'platformRole' | 'platformPermissions'> | null;

/**
 * O que uma conta pode fazer na administração da plataforma. Função pura,
 * relida do banco a cada requisição pelos serviços.
 *
 * - `viewDirectory`: consultar estabelecimentos, usuários, convites e
 *   histórico. `MASTER_OWNER`, ou `MASTER_ADMIN`/`MASTER_SUPPORT` com
 *   `ESTABLISHMENTS_MANAGE` (a regra que já valia para a consulta).
 * - `manageEstablishments`: criar estabelecimentos, convidar e desvincular
 *   pessoas, restringir permissões nos vínculos e cuidar das contas SEM papel
 *   de plataforma (dados básicos, bloqueio, redefinição de senha).
 *   `MASTER_OWNER`, ou `MASTER_ADMIN` com `ESTABLISHMENTS_MANAGE`. O suporte
 *   só consulta, mesmo com a permissão: o papel limita.
 * - `managePlatformAccess`: papéis e permissões da plataforma e as contas que
 *   têm papel de plataforma. Só `MASTER_OWNER`.
 *
 * Ser DONO de um estabelecimento nunca concede nada aqui: a Membership não é
 * lida. Conta não ativa não tem capacidade nenhuma.
 */
export interface PlatformCapabilities {
  viewDirectory: boolean;
  manageEstablishments: boolean;
  managePlatformAccess: boolean;
}

const NENHUMA: PlatformCapabilities = {
  viewDirectory: false,
  manageEstablishments: false,
  managePlatformAccess: false,
};

/** Permissões de plataforma com efeito real nesta versão. As demais do enum
 * (`ADMINISTRATORS_MANAGE`, `PLANS_MANAGE`, `SUPPORT_ACCESS`) não liberam
 * rota nenhuma e por isso não podem ser atribuídas. */
export const EFFECTIVE_PLATFORM_PERMISSIONS: readonly PlatformPermission[] = [
  PlatformPermission.ESTABLISHMENTS_MANAGE,
];

export function platformCapabilities(user: PlatformActor): PlatformCapabilities {
  if (!user || user.status !== UserStatus.ACTIVE) return NENHUMA;
  if (user.platformRole === PlatformRole.MASTER_OWNER) {
    return { viewDirectory: true, manageEstablishments: true, managePlatformAccess: true };
  }
  const gerencia = !!user.platformPermissions?.includes(PlatformPermission.ESTABLISHMENTS_MANAGE);
  if (user.platformRole === PlatformRole.MASTER_ADMIN) {
    return { viewDirectory: gerencia, manageEstablishments: gerencia, managePlatformAccess: false };
  }
  if (user.platformRole === PlatformRole.MASTER_SUPPORT) {
    return { viewDirectory: gerencia, manageEstablishments: false, managePlatformAccess: false };
  }
  return NENHUMA;
}

/** Um DONO de estabelecimento nunca herda acesso global pela Membership. */
export function canViewEstablishments(user: PlatformActor): boolean {
  return platformCapabilities(user).viewDirectory;
}

export async function requirePlatformAccess(
  manager: EntityManager,
  userId: string,
): Promise<void> {
  const user = await manager.findOne(User, { where: { id: userId } });
  if (!canViewEstablishments(user))
    throw new ForbiddenException('Sem acesso à administração da plataforma.');
}
