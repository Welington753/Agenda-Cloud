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
  OWN_COMMISSIONS_PERMISSION,
  type StaffPermission,
} from './staff-access.js';
import { MANAGER_PERMISSION_FEATURE, type ManagerPermission } from '../common/manager-permissions.js';
import { FeatureKey } from '../entities/enums/feature-key.enum.js';
import { featureEnabled } from '../commercial/commercial-gate.js';

export interface TeamManager extends AuthorizedTenant {
  /** O que este dono pode conceder (só o que ele próprio pode fazer). */
  grantable: StaffPermission[];
  /** As áreas que este dono pode conceder a um gerente. */
  grantableManager: ManagerPermission[];
  /** Áreas que dependem de um adicional que o estabelecimento não tem: não
   * entram em `grantableManager`, e conceder recebe `RECURSO_NAO_CONTRATADO`. */
  managerWithoutFeature: ManagerPermission[];
}

export async function resolveTeamManager(manager: EntityManager, userId: string, tenantId: string): Promise<TeamManager> {
  const authorized = await resolveAuthorizedTenant(manager, userId, tenantId, {
    permitido: canManageTeam,
    mensagemProibido: TEAM_FORBIDDEN_MESSAGE,
    recurso: FeatureKey.EQUIPE,
  });
  const overrides = await manager.find(MembershipPermissionOverride, {
    where: { tenantId: authorized.tenantId, membershipId: authorized.membershipId },
  });
  // Sem o recurso de comissões no plano, a consulta das próprias comissões
  // não é oferecida (retirar continua possível: validarConcessoes confere só
  // o que entra).
  const comissoes = await featureEnabled(manager, authorized.tenantId, FeatureKey.COMISSOES);
  // As áreas que dependem de adicional (estoque) só são concedíveis com ele.
  const semRecurso: ManagerPermission[] = [];
  const recursosConferidos = new Map<string, boolean>();
  for (const [permissao, recurso] of Object.entries(MANAGER_PERMISSION_FEATURE) as [ManagerPermission, FeatureKey][]) {
    if (!recursosConferidos.has(recurso)) {
      recursosConferidos.set(recurso, await featureEnabled(manager, authorized.tenantId, recurso));
    }
    if (!recursosConferidos.get(recurso)) semRecurso.push(permissao);
  }
  return {
    ...authorized,
    grantable: grantableStaffPermissions(authorized.role, overrides).filter(
      (p) => p !== OWN_COMMISSIONS_PERMISSION || comissoes,
    ),
    grantableManager: grantableManagerPermissions(authorized.role, overrides).filter((p) => !semRecurso.includes(p)),
    managerWithoutFeature: semRecurso,
  };
}
