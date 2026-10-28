// Prova, no servidor e dentro da transação de cada operação, que quem age
// gerencia a equipe DESTE estabelecimento: vínculo ativo de DONO, sem
// `EQUIPE_GERENCIAR` negado, estabelecimento utilizável. Nenhum id do
// navegador decide isso.
import type { EntityManager } from 'typeorm';
import { resolveAuthorizedTenant, type AuthorizedTenant } from '../common/tenant-authorization.js';
import { MembershipPermissionOverride } from '../entities/membership-permission-override.entity.js';
import {
  TEAM_FORBIDDEN_MESSAGE,
  canManageTeam,
  grantableManagerPermissions,
  grantableStaffPermissions,
  type StaffPermission,
} from './staff-access.js';
import type { ManagerPermission } from '../common/manager-permissions.js';

export interface TeamManager extends AuthorizedTenant {
  /** O que este dono pode conceder (só o que ele próprio pode fazer). */
  grantable: StaffPermission[];
  /** As áreas que este dono pode conceder a um gerente. */
  grantableManager: ManagerPermission[];
}

export async function resolveTeamManager(manager: EntityManager, userId: string, tenantId: string): Promise<TeamManager> {
  const authorized = await resolveAuthorizedTenant(manager, userId, tenantId, {
    permitido: canManageTeam,
    mensagemProibido: TEAM_FORBIDDEN_MESSAGE,
  });
  const overrides = await manager.find(MembershipPermissionOverride, {
    where: { tenantId: authorized.tenantId, membershipId: authorized.membershipId },
  });
  return {
    ...authorized,
    grantable: grantableStaffPermissions(authorized.role, overrides),
    grantableManager: grantableManagerPermissions(authorized.role, overrides),
  };
}
