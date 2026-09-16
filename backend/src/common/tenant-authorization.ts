// Prova de acesso a um estabelecimento (Lote 6D.4) — extraída de
// `professionals/professional-tenant-access.ts` SEM mudança de comportamento,
// para que a consulta de disponibilidade não ganhasse uma segunda cópia da
// mesma checagem. Autorização duplicada é exatamente o que desanda com o
// tempo: uma cópia recebe a correção e a outra não.
//
// A POLÍTICA (quais papéis, quais DENIED) continua fora daqui, em função pura
// por módulo (`professional-access.ts`, `availability-access.ts`). Este
// arquivo resolve só o fato: existe `Membership` deste usuário neste tenant,
// o tenant está utilizável, e os overrides são carregados e entregues à
// política.
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { isTenantUsableForSession } from '../auth/tenant-access.js';
import { Membership } from '../entities/membership.entity.js';
import { MembershipPermissionOverride } from '../entities/membership-permission-override.entity.js';
import { Tenant } from '../entities/tenant.entity.js';
import type { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import type { Permission } from '../entities/enums/permission.enum.js';
import type { PermissionMode } from '../entities/enums/permission-mode.enum.js';

/** Mensagem única para "não existe" e "você não tem vínculo com ele" — nunca
 * distinguir os dois revelaria a existência de estabelecimentos de terceiros. */
export const TENANT_NOT_FOUND_MESSAGE = 'Estabelecimento não encontrado.';

export interface PermissionOverrideLike {
  permission: Permission;
  mode: PermissionMode;
}

/** Vínculo já PROVADO no servidor: existe Membership deste usuário neste
 * tenant, e o tenant está utilizável. Única origem aceitável de `tenantId`. */
export interface AuthorizedTenant {
  tenantId: string;
  membershipId: string;
  role: EstablishmentRole;
}

export interface PoliticaDeAcesso {
  /** Função pura do módulo: decide com o papel e os overrides em mãos. */
  permitido: (role: EstablishmentRole, overrides: readonly PermissionOverrideLike[]) => boolean;
  /** Mensagem do 403 — cada módulo fala da sua área. */
  mensagemProibido: string;
}

/**
 * Prova, no servidor e a cada requisição, que este usuário pode operar neste
 * tenant.
 *
 * `NotFoundException` (não 403) quando não há vínculo ou o tenant está
 * inativo: um 403 confirmaria que o estabelecimento existe.
 */
export async function resolveAuthorizedTenant(
  manager: EntityManager,
  userId: string,
  tenantId: string,
  politica: PoliticaDeAcesso,
): Promise<AuthorizedTenant> {
  const membership = await manager.findOne(Membership, { where: { userId, tenantId } });
  if (!membership) {
    throw new NotFoundException(TENANT_NOT_FOUND_MESSAGE);
  }

  const tenant = await manager.findOne(Tenant, { where: { id: tenantId } });
  if (!tenant || !isTenantUsableForSession(tenant.status)) {
    throw new NotFoundException(TENANT_NOT_FOUND_MESSAGE);
  }

  const overrides = await manager.find(MembershipPermissionOverride, {
    where: { tenantId, membershipId: membership.id },
  });

  if (!politica.permitido(membership.role, overrides)) {
    throw new ForbiddenException(politica.mensagemProibido);
  }

  return { tenantId, membershipId: membership.id, role: membership.role };
}
