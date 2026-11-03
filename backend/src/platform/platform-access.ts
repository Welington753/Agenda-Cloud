import { ForbiddenException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { User } from '../entities/user.entity.js';
import { PlatformRole } from '../entities/enums/platform-role.enum.js';
import type { PlatformPermission } from '../entities/enums/platform-permission.enum.js';
import { UserStatus } from '../entities/enums/user-status.enum.js';

type PlatformActor = Pick<User, 'status' | 'platformRole' | 'platformPermissions'> | null;

/**
 * O que uma conta pode fazer no portal da plataforma. Função pura, relida do
 * banco a cada requisição pelos serviços.
 *
 * O portal é EXCLUSIVO dos proprietários da plataforma: conta ativa com
 * `platform_role = MASTER_OWNER` (docs/plans/portal-da-plataforma.md, seção
 * 2.1). Para ela, todas as capacidades; para qualquer outra, nenhuma.
 *
 * - `viewDirectory`: consultar estabelecimentos, contas, convites, preços,
 *   pagamentos das assinaturas e histórico;
 * - `manageEstablishments`: criar estabelecimentos, convidar e desvincular
 *   pessoas, restringir permissões nos vínculos e cuidar das contas;
 * - `managePlatformAccess`: quem é proprietário da plataforma;
 * - `manageEstablishmentLifecycle`: ativar e inativar (suspender, reativar),
 *   arquivar, trocar plano, validade, "sem vencimento" e preços.
 *
 * `MASTER_ADMIN` e `MASTER_SUPPORT` continuam no enum e nas contas que já os
 * têm, mas não abrem nada: o portal não tem papel delegado nesta versão. Ser
 * DONO, GERENTE ou PROFISSIONAL de um estabelecimento (de qualquer plano,
 * inclusive Max) nunca concede nada aqui: a Membership não é lida. Nome,
 * e-mail, plano ou estabelecimento da conta nunca entram na decisão. Conta não
 * ativa não tem capacidade nenhuma.
 */
export interface PlatformCapabilities {
  viewDirectory: boolean;
  manageEstablishments: boolean;
  managePlatformAccess: boolean;
  manageEstablishmentLifecycle: boolean;
}

const NENHUMA: PlatformCapabilities = {
  viewDirectory: false,
  manageEstablishments: false,
  managePlatformAccess: false,
  manageEstablishmentLifecycle: false,
};

/** Permissões de plataforma com efeito real nesta versão: nenhuma. O portal
 * é só do proprietário, que não depende de permissão avulsa; as do enum não
 * liberam rota nenhuma e por isso não podem ser atribuídas. */
export const EFFECTIVE_PLATFORM_PERMISSIONS: readonly PlatformPermission[] = [];

/** Papéis que a administração ainda atribui: só o de proprietário. */
export const ASSIGNABLE_PLATFORM_ROLES: readonly PlatformRole[] = [PlatformRole.MASTER_OWNER];

export function platformCapabilities(user: PlatformActor): PlatformCapabilities {
  if (!user || user.status !== UserStatus.ACTIVE) return NENHUMA;
  if (user.platformRole !== PlatformRole.MASTER_OWNER) return NENHUMA;
  return {
    viewDirectory: true,
    manageEstablishments: true,
    managePlatformAccess: true,
    manageEstablishmentLifecycle: true,
  };
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
