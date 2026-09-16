// Prova de acesso ao tenant para o módulo de profissionais — extraído no
// Lote 6D.3 de `ProfessionalsService`, sem mudança de comportamento, para as
// rotas de profissionais e as de horários semanais usarem EXATAMENTE a mesma
// checagem.
//
// No Lote 6D.4 a MECÂNICA (buscar membership, conferir tenant, carregar
// overrides, traduzir em 404/403) subiu para `common/tenant-authorization.ts`,
// porque a consulta de disponibilidade precisava dela com outra política.
// Aqui ficou só o que é deste módulo: qual política aplicar e o que dizer no
// 403. Comportamento e mensagens continuam idênticos.
//
// A política em si continua em professional-access.ts (função pura, sem
// banco).
import type { EntityManager } from 'typeorm';
import {
  resolveAuthorizedTenant,
  TENANT_NOT_FOUND_MESSAGE,
  type AuthorizedTenant,
  type PermissionOverrideLike,
} from '../common/tenant-authorization.js';
import type { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { canManageProfessionals, canViewProfessionals } from './professional-access.js';

export { TENANT_NOT_FOUND_MESSAGE };
export type { AuthorizedTenant };

export const PROFESSIONALS_FORBIDDEN_MESSAGE =
  'Você não tem permissão para gerenciar os profissionais deste estabelecimento.';

export async function resolveAuthorizedProfessionalsTenant(
  manager: EntityManager,
  userId: string,
  tenantId: string,
  operation: 'view' | 'manage',
): Promise<AuthorizedTenant> {
  return resolveAuthorizedTenant(manager, userId, tenantId, {
    permitido: (role: EstablishmentRole, overrides: readonly PermissionOverrideLike[]) =>
      operation === 'manage'
        ? canManageProfessionals(role, overrides)
        : canViewProfessionals(role, overrides),
    mensagemProibido: PROFESSIONALS_FORBIDDEN_MESSAGE,
  });
}
