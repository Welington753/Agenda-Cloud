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
// GERENTE com profissional ligado (migration TeamManagerAccess): a mesma
// agenda própria, e as mesmas três ações opt-in, depois que o dono confirmou
// as permissões do vínculo. As áreas do estabelecimento vêm das concessões de
// common/manager-permissions.ts, nunca do nome do papel.
//
// DONO: gerencia a equipe se a permissão `EQUIPE_GERENCIAR` não foi negada a
// ele. Só concede as ações que ele próprio pode fazer: sem
// `canManageAppointmentStatus`, nenhuma das três; uma área do estabelecimento
// só se a política do dono para aquela área o deixa fazê-la. Gerente não
// gerencia equipe, não concede permissões e não mexe em credenciais.
import { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { Permission } from '../entities/enums/permission.enum.js';
import { PermissionMode } from '../entities/enums/permission-mode.enum.js';
import type { PermissionOverrideLike } from '../common/tenant-authorization.js';
import type { AcaoDeStatus } from '../appointments/appointment-status-transitions.js';
import {
  canCancelAppointments,
  canCreateAppointments,
  canManageAppointmentStatus,
  canRescheduleAppointments,
  canViewAppointments,
} from '../appointments/appointment-access.js';
import { canManageConsumers, canViewConsumers } from '../consumers/consumer-access.js';
import { canManageProfessionals, canViewProfessionals } from '../professionals/professional-access.js';
import { canManageServices, canViewServices } from '../services/service-access.js';
import { canViewPayments } from '../payments/payment-access.js';
import { MANAGER_PERMISSIONS, type ManagerPermission } from '../common/manager-permissions.js';

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

/** Papéis de equipe que o dono cria e administra em "Equipe e acessos". */
export const TEAM_ROLES = ['PROFISSIONAL', 'GERENTE'] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

/** Agenda própria: o funcionário sempre; o gerente com profissional ligado só
 * depois de o dono confirmar as permissões dele (`permissionsConfirmed`). O
 * profissional ligado e ativo é conferido por quem chama. */
export function canViewOwnAgenda(role: EstablishmentRole, permissionsConfirmed = false): boolean {
  if (role === EstablishmentRole.PROFISSIONAL) return true;
  return role === EstablishmentRole.GERENTE && permissionsConfirmed;
}

export function staffPermissionGranted(
  role: EstablishmentRole,
  overrides: readonly OverrideRow[],
  permission: StaffPermission,
): boolean {
  if (role !== EstablishmentRole.PROFISSIONAL && role !== EstablishmentRole.GERENTE) return false;
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

type PoliticaDoDono = (role: EstablishmentRole, overrides: readonly PermissionOverrideLike[]) => boolean;

/** Para cada concessão de gerente, a política que o DONO precisa cumprir para
 * poder concedê-la (a mesma que a rota aplica a ele). */
const POLITICA_DO_DONO: Readonly<Record<ManagerPermission, PoliticaDoDono>> = {
  AGENDA_VISUALIZAR: canViewAppointments,
  AGENDA_GERENCIAR: canManageAppointmentStatus,
  AGENDAMENTO_CRIAR: canCreateAppointments,
  AGENDAMENTO_EDITAR: canRescheduleAppointments,
  AGENDAMENTO_CANCELAR: canCancelAppointments,
  SOLICITACOES_VISUALIZAR: canViewAppointments,
  // O dono trata uma solicitação confirmando (andamento) ou recusando
  // (cancelamento): precisa das duas para conceder as duas.
  SOLICITACOES_TRATAR: (r, o) => canManageAppointmentStatus(r, o) && canCancelAppointments(r, o),
  CONSUMIDORES_VISUALIZAR: canViewConsumers,
  CONSUMIDORES_GERENCIAR: canManageConsumers,
  SERVICOS_VISUALIZAR: canViewServices,
  SERVICOS_GERENCIAR: canManageServices,
  PROFISSIONAIS_VISUALIZAR: canViewProfessionals,
  PROFISSIONAIS_GERENCIAR: canManageProfessionals,
  RECEBIMENTOS_VISUALIZAR: canViewPayments,
  RECEBIMENTOS_REGISTRAR: canViewPayments,
  RECEBIMENTOS_ESTORNAR: canViewPayments,
};

/** Concessões de gerente que ESTE dono pode dar. */
export function grantableManagerPermissions(
  role: EstablishmentRole,
  overrides: readonly PermissionOverrideLike[],
): ManagerPermission[] {
  if (!canManageTeam(role, overrides) || role !== EstablishmentRole.DONO) return [];
  return MANAGER_PERMISSIONS.filter((p) => POLITICA_DO_DONO[p](role, overrides));
}
