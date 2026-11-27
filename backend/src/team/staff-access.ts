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
//
// BASE COMUM (docs/plans/permissoes-individuais.md, etapa 1): a agenda
// própria decide por `accessHasOwnAgenda`, as permissões de funcionário por
// `staffCan` (alcance próprio) e a gestão da equipe por `accessAllows`, só do
// dono, com `EQUIPE_GERENCIAR` como única negada que barra. O que o dono pode
// conceder continua composto pelas políticas de cada área (já na base comum).
// Sem mudança de regra; equivalência com a regra anterior em
// staff-access.equivalence.spec.ts.
import { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { Permission } from '../entities/enums/permission.enum.js';
import type { PermissionOverrideLike } from '../common/tenant-authorization.js';
import {
  accessAllows,
  accessHasOwnAgenda,
  effectiveAccess,
  staffCan,
  type LegacyAction,
} from '../common/access-evaluation.js';
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
import { canViewCommissions } from '../commissions/commission-access.js';
import { canManageStock, canViewStock } from '../stock/stock-access.js';
import {
  canCancelSales,
  canOverrideSalePrice,
  canReceiveSales,
  canRefundSalePayments,
  canRegisterSales,
  canViewAllSales,
} from '../sales/sales-access.js';
import { MANAGER_PERMISSIONS, type ManagerPermission } from '../common/manager-permissions.js';
import { OWN_COMMISSIONS_PERMISSION, STAFF_PERMISSIONS, type StaffPermission } from '../common/staff-permissions.js';

// A lista das permissões de funcionário fica em common/staff-permissions.ts,
// para a base comum usá-la sem importar esta política; reexportada aqui.
export { OWN_COMMISSIONS_PERMISSION, STAFF_PERMISSIONS, type StaffPermission };

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
  COMISSOES_PROPRIAS_VISUALIZAR: 'Ver as próprias comissões',
};

/** Ajuste lido do banco: a permissão pode ser um valor novo do enum. */
export interface OverrideRow {
  permission: string;
  mode: string;
}

export const OWN_AGENDA_FORBIDDEN_MESSAGE = 'Esta área mostra a agenda de um profissional da equipe.';
export const STAFF_ACTION_FORBIDDEN_MESSAGE = 'O estabelecimento não liberou esta ação para você.';
export const TEAM_FORBIDDEN_MESSAGE = 'Você não tem permissão para gerenciar a equipe deste estabelecimento.';

/** Ajustes lidos do banco, para a base comum: ela compara só os textos de
 * permissão e modo, então um valor novo do enum passa igual. */
function comoAjustes(overrides: readonly OverrideRow[]): readonly PermissionOverrideLike[] {
  return overrides as readonly PermissionOverrideLike[];
}

/** Só o dono, e só sem `EQUIPE_GERENCIAR` negada. */
const GERENCIAR_EQUIPE: LegacyAction = { grants: null, ownerDenials: [Permission.EQUIPE_GERENCIAR] };

/** Papéis de equipe que o dono cria e administra em "Equipe e acessos".
 * RECEPCIONISTA (docs/plans/vendas-v1.md): sem profissional ligado, só com
 * as concessões de vendas da lista dela; ocupa vaga como os demais. */
export const TEAM_ROLES = ['PROFISSIONAL', 'GERENTE', 'RECEPCIONISTA'] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

/** Agenda própria: o funcionário sempre; o gerente com profissional ligado só
 * depois de o dono confirmar as permissões dele (`permissionsConfirmed`). O
 * profissional ligado e ativo é conferido por quem chama. */
export function canViewOwnAgenda(role: EstablishmentRole, permissionsConfirmed = false): boolean {
  return accessHasOwnAgenda(effectiveAccess(role, [], { permissionsConfirmed }));
}

/** Permissão de funcionário (ações sobre os próprios atendimentos, próprias
 * comissões): PROFISSIONAL ou GERENTE com `GRANTED` e sem `DENIED`. */
export function staffPermissionGranted(
  role: EstablishmentRole,
  overrides: readonly OverrideRow[],
  permission: StaffPermission,
): boolean {
  return staffCan(effectiveAccess(role, comoAjustes(overrides)), permission);
}

export function staffGrantedPermissions(role: EstablishmentRole, overrides: readonly OverrideRow[]): StaffPermission[] {
  const acesso = effectiveAccess(role, comoAjustes(overrides));
  return STAFF_PERMISSIONS.filter((p) => staffCan(acesso, p));
}

export function canManageTeam(role: EstablishmentRole, overrides: readonly PermissionOverrideLike[] = []): boolean {
  return accessAllows(effectiveAccess(role, overrides), GERENCIAR_EQUIPE);
}

/** O que este dono pode conceder: só o que ele mesmo pode fazer. As ações
 * pedem o andamento da agenda; as próprias comissões, ver as comissões. O
 * recurso do plano é conferido por quem chama (team-authorization.ts). */
export function grantableStaffPermissions(
  role: EstablishmentRole,
  overrides: readonly PermissionOverrideLike[],
): StaffPermission[] {
  if (!canManageTeam(role, overrides)) return [];
  return STAFF_PERMISSIONS.filter((p) =>
    p === OWN_COMMISSIONS_PERMISSION ? canViewCommissions(role, overrides) : canManageAppointmentStatus(role, overrides),
  );
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
  ESTOQUE_VISUALIZAR: canViewStock,
  ESTOQUE_GERENCIAR: canManageStock,
  VENDAS_REGISTRAR: canRegisterSales,
  VENDAS_RECEBER: canReceiveSales,
  VENDAS_ALTERAR_PRECO: canOverrideSalePrice,
  VENDAS_VISUALIZAR: canViewAllSales,
  VENDAS_CANCELAR: canCancelSales,
  VENDAS_ESTORNAR_RECEBIMENTO: canRefundSalePayments,
};

/** Concessões de gerente que ESTE dono pode dar. */
export function grantableManagerPermissions(
  role: EstablishmentRole,
  overrides: readonly PermissionOverrideLike[],
): ManagerPermission[] {
  if (!canManageTeam(role, overrides) || role !== EstablishmentRole.DONO) return [];
  return MANAGER_PERMISSIONS.filter((p) => POLITICA_DO_DONO[p](role, overrides));
}
