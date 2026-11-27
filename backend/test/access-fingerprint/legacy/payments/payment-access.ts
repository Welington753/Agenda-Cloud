// Quem consulta, registra e estorna recebimentos de atendimentos.
//
// DONO: as três ações, com a mesma política de VER A AGENDA
// (`canViewAppointments`), a mesma do Início: recebimentos mostram os
// atendimentos (cliente, serviço, profissional, data) e são lançados sobre
// eles. Um dono com a agenda restringida pela administração (`DENIED` em
// `AGENDA_VISUALIZAR`) também não vê nem lança recebimentos.
//
// GERENTE: cada ação só com a permissão própria concedida pelo dono
// (`RECEBIMENTOS_VISUALIZAR`, `_REGISTRAR`, `_ESTORNAR`, ver
// common/manager-permissions.ts). Registrar e estornar exigem consultar.
//
// O funcionário (PROFISSIONAL) nunca vê dinheiro.
import { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { canViewAppointments } from '../appointments/appointment-access.js';
import { managerCan } from '../common/manager-permissions.js';
import type { PermissionOverrideLike } from '../common/tenant-authorization.js';

export const PAYMENTS_FORBIDDEN_MESSAGE =
  'Você não tem permissão para ver ou registrar recebimentos deste estabelecimento.';
/** A mesma mensagem nas três ações: a recusa não detalha qual parte falta. */
export const PAYMENT_RECORD_FORBIDDEN_MESSAGE = PAYMENTS_FORBIDDEN_MESSAGE;
export const PAYMENT_REFUND_FORBIDDEN_MESSAGE = PAYMENTS_FORBIDDEN_MESSAGE;

function doDono(role: EstablishmentRole, overrides: readonly PermissionOverrideLike[]): boolean {
  return role === EstablishmentRole.DONO && canViewAppointments(role, overrides);
}

export function canViewPayments(role: EstablishmentRole, overrides: readonly PermissionOverrideLike[] = []): boolean {
  if (role === EstablishmentRole.GERENTE) return managerCan(role, overrides, 'RECEBIMENTOS_VISUALIZAR');
  return doDono(role, overrides);
}

export function canRecordPayments(role: EstablishmentRole, overrides: readonly PermissionOverrideLike[] = []): boolean {
  if (role === EstablishmentRole.GERENTE) return managerCan(role, overrides, 'RECEBIMENTOS_REGISTRAR');
  return doDono(role, overrides);
}

export function canRefundPayments(role: EstablishmentRole, overrides: readonly PermissionOverrideLike[] = []): boolean {
  if (role === EstablishmentRole.GERENTE) return managerCan(role, overrides, 'RECEBIMENTOS_ESTORNAR');
  return doDono(role, overrides);
}

/** Nome anterior: as três ações do dono. Mantido para quem só pergunta "é o
 * dono que opera recebimentos?" (o Início). */
export function canManagePayments(role: EstablishmentRole, overrides: readonly PermissionOverrideLike[] = []): boolean {
  return doDono(role, overrides);
}
