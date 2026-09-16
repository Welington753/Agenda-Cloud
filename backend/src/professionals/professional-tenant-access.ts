// Prova de acesso ao tenant para o módulo de profissionais — extraído no
// Lote 6D.3 de `ProfessionalsService`, sem mudança de comportamento, para as
// rotas de profissionais e as de horários semanais usarem EXATAMENTE a mesma
// checagem. Uma segunda cópia da mesma regra de autorização dentro do mesmo
// módulo é justamente o tipo de duplicação que desanda com o tempo.
//
// A política em si continua em professional-access.ts (função pura, sem
// banco); aqui só se resolve, a cada requisição, o vínculo do usuário com o
// tenant pedido.
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { isTenantUsableForSession } from '../auth/tenant-access.js';
import { Membership } from '../entities/membership.entity.js';
import { MembershipPermissionOverride } from '../entities/membership-permission-override.entity.js';
import { Tenant } from '../entities/tenant.entity.js';
import type { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { canManageProfessionals, canViewProfessionals } from './professional-access.js';

/** Mensagem única para "não existe" e "você não tem vínculo com ele" — nunca
 * distinguir os dois revelaria a existência de estabelecimentos de terceiros. */
export const TENANT_NOT_FOUND_MESSAGE = 'Estabelecimento não encontrado.';
export const PROFESSIONALS_FORBIDDEN_MESSAGE =
  'Você não tem permissão para gerenciar os profissionais deste estabelecimento.';

/** Vínculo já PROVADO no servidor: existe Membership deste usuário neste
 * tenant, e o tenant está utilizável. Única origem aceitável de `tenantId`. */
export interface AuthorizedTenant {
  tenantId: string;
  membershipId: string;
  role: EstablishmentRole;
}

/**
 * Prova, no servidor e a cada requisição, que este usuário pode operar neste
 * tenant.
 *
 * `NotFoundException` (não 403) quando não há vínculo ou o tenant está
 * inativo: um 403 confirmaria que o estabelecimento existe.
 */
export async function resolveAuthorizedProfessionalsTenant(
  manager: EntityManager,
  userId: string,
  tenantId: string,
  operation: 'view' | 'manage',
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

  const permitted =
    operation === 'manage'
      ? canManageProfessionals(membership.role, overrides)
      : canViewProfessionals(membership.role, overrides);
  if (!permitted) {
    throw new ForbiddenException(PROFESSIONALS_FORBIDDEN_MESSAGE);
  }

  return { tenantId, membershipId: membership.id, role: membership.role };
}
