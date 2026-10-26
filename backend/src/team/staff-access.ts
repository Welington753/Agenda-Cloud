// Política do papel PROFISSIONAL (acesso de funcionário) e da gestão da
// equipe pelo dono — funções puras, sem Nest e sem banco, no molde de
// appointment-access.ts.
//
// FUNCIONÁRIO (`PROFISSIONAL`): enxerga só a PRÓPRIA agenda (a do profissional
// ligado ao vínculo). As três ações sobre os próprios atendimentos são
// opt-in: valem só com `GRANTED` explícito, dado pelo dono, e um `DENIED`
// sempre vence. É o único lugar em que `GRANTED` amplia algo, e amplia só
// isto. Nenhuma política de dono (`*-access.ts`) passa a aceitar
// PROFISSIONAL: agenda geral, clientes, serviços, profissionais,
// configurações e solicitações continuam só do DONO.
//
// O vínculo ATIVO, o estabelecimento utilizável e o profissional ativo são
// conferidos por quem chama (my-agenda.service.ts), no banco, a cada
// requisição. Aqui só se decide com o papel e os ajustes em mãos.
//
// DONO: gerencia a equipe se a permissão `EQUIPE_GERENCIAR` não foi negada a
// ele. Só concede ao funcionário as ações que ele próprio pode fazer: sem
// `canManageAppointmentStatus`, nenhuma.
import { canManageAppointmentStatus } from '../appointments/appointment-access.js';
import { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { Permission } from '../entities/enums/permission.enum.js';
import { PermissionMode } from '../entities/enums/permission-mode.enum.js';
import type { PermissionOverrideLike } from '../common/tenant-authorization.js';
import type { AcaoDeStatus } from '../appointments/appointment-status-transitions.js';

/** Valores novos do enum `permission` (migration TeamAccess1792886400000).
 * Ficam fora do enum TypeScript, que espelha a migration inicial. */
export const STAFF_PERMISSIONS = [
  'ATENDIMENTO_PROPRIO_INICIAR',
  'ATENDIMENTO_PROPRIO_CONCLUIR',
  'ATENDIMENTO_PROPRIO_FALTA',
] as const;
export type StaffPermission = (typeof STAFF_PERMISSIONS)[number];

/** Ações que o funcionário pode receber. Confirmar, cancelar, remarcar e
 * criar reservas continuam com o dono. */
export type StaffAction = Exclude<AcaoDeStatus, 'confirm'>;
export const STAFF_ACTIONS: readonly StaffAction[] = ['start', 'complete', 'no-show'];

export const STAFF_PERMISSION_OF_ACTION: Readonly<Record<StaffAction, StaffPermission>> = {
  start: 'ATENDIMENTO_PROPRIO_INICIAR',
  complete: 'ATENDIMENTO_PROPRIO_CONCLUIR',
  'no-show': 'ATENDIMENTO_PROPRIO_FALTA',
};

export const STAFF_PERMISSION_LABELS: Readonly<Record<StaffPermission, string>> = {
  ATENDIMENTO_PROPRIO_INICIAR: 'Iniciar os próprios atendimentos',
  ATENDIMENTO_PROPRIO_CONCLUIR: 'Concluir os próprios atendimentos',
  ATENDIMENTO_PROPRIO_FALTA: 'Marcar falta nos próprios atendimentos',
};

/** Ajuste lido do banco: a permissão pode ser um valor novo do enum. */
export interface OverrideRow {
  permission: string;
  mode: string;
}

export const OWN_AGENDA_FORBIDDEN_MESSAGE = 'Esta área mostra a agenda de um profissional da equipe.';
export const STAFF_ACTION_FORBIDDEN_MESSAGE = 'O estabelecimento não liberou esta ação para você.';
export const TEAM_FORBIDDEN_MESSAGE = 'Você não tem permissão para gerenciar a equipe deste estabelecimento.';

function tem(overrides: readonly OverrideRow[], permission: string, mode: PermissionMode): boolean {
  return overrides.some((o) => o.permission === permission && o.mode === mode);
}

export function canViewOwnAgenda(role: EstablishmentRole): boolean {
  return role === EstablishmentRole.PROFISSIONAL;
}

export function staffPermissionGranted(
  role: EstablishmentRole,
  overrides: readonly OverrideRow[],
  permission: StaffPermission,
): boolean {
  if (role !== EstablishmentRole.PROFISSIONAL) return false;
  if (tem(overrides, permission, PermissionMode.DENIED)) return false;
  return tem(overrides, permission, PermissionMode.GRANTED);
}

export function staffGrantedPermissions(role: EstablishmentRole, overrides: readonly OverrideRow[]): StaffPermission[] {
  return STAFF_PERMISSIONS.filter((p) => staffPermissionGranted(role, overrides, p));
}

export function canManageTeam(role: EstablishmentRole, overrides: readonly PermissionOverrideLike[] = []): boolean {
  if (role !== EstablishmentRole.DONO) return false;
  return !overrides.some((o) => o.permission === Permission.EQUIPE_GERENCIAR && o.mode === PermissionMode.DENIED);
}

/** O que este dono pode conceder: só o que ele mesmo pode fazer. */
export function grantableStaffPermissions(
  role: EstablishmentRole,
  overrides: readonly PermissionOverrideLike[],
): StaffPermission[] {
  if (!canManageTeam(role, overrides)) return [];
  return canManageAppointmentStatus(role, overrides) ? [...STAFF_PERMISSIONS] : [];
}
