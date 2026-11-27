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
//
// BASE COMUM (docs/plans/permissoes-individuais.md, etapa 1): cada política
// decide só por `accessAllows(effectiveAccess(role, overrides), AÇÃO)`, sem
// mudança de regra. A lista do dono é a de ver a agenda
// (`PERMISSOES_PARA_VER` em appointments/appointment-access.ts), literal: o
// dono não confere aqui as permissões de recebimentos nem as dependências
// exigidas do gerente. O recurso contratado (`PAGAMENTOS`), a senha
// confirmada há pouco do estorno e o isolamento continuam no serviço e em
// `resolveAuthorizedTenant`. Equivalência com a regra anterior em
// payment-access.equivalence.spec.ts.
import { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { Permission } from '../entities/enums/permission.enum.js';
import { accessAllows, effectiveAccess, type LegacyAction } from '../common/access-evaluation.js';
import type { PermissionOverrideLike } from '../common/tenant-authorization.js';

export const PAYMENTS_FORBIDDEN_MESSAGE =
  'Você não tem permissão para ver ou registrar recebimentos deste estabelecimento.';
/** A mesma mensagem nas três ações: a recusa não detalha qual parte falta. */
export const PAYMENT_RECORD_FORBIDDEN_MESSAGE = PAYMENTS_FORBIDDEN_MESSAGE;
export const PAYMENT_REFUND_FORBIDDEN_MESSAGE = PAYMENTS_FORBIDDEN_MESSAGE;

/** DENIED que barram o DONO nas três ações: a lista de ver a agenda. */
const PERMISSOES_DO_DONO: readonly Permission[] = [Permission.AGENDA_VISUALIZAR];

const CONSULTAR: LegacyAction = { grants: ['RECEBIMENTOS_VISUALIZAR'], ownerDenials: PERMISSOES_DO_DONO };
const REGISTRAR: LegacyAction = { grants: ['RECEBIMENTOS_REGISTRAR'], ownerDenials: PERMISSOES_DO_DONO };
const ESTORNAR: LegacyAction = { grants: ['RECEBIMENTOS_ESTORNAR'], ownerDenials: PERMISSOES_DO_DONO };
/** Só o dono (o Início pergunta "é o dono que opera recebimentos?"). */
const OPERAR_COMO_DONO: LegacyAction = { grants: null, ownerDenials: PERMISSOES_DO_DONO };

function pode(role: EstablishmentRole, overrides: readonly PermissionOverrideLike[], acao: LegacyAction): boolean {
  return accessAllows(effectiveAccess(role, overrides), acao);
}

export function canViewPayments(role: EstablishmentRole, overrides: readonly PermissionOverrideLike[] = []): boolean {
  return pode(role, overrides, CONSULTAR);
}

export function canRecordPayments(role: EstablishmentRole, overrides: readonly PermissionOverrideLike[] = []): boolean {
  return pode(role, overrides, REGISTRAR);
}

export function canRefundPayments(role: EstablishmentRole, overrides: readonly PermissionOverrideLike[] = []): boolean {
  return pode(role, overrides, ESTORNAR);
}

/** Nome anterior: as três ações do dono. Mantido para quem só pergunta "é o
 * dono que opera recebimentos?" (o Início). */
export function canManagePayments(role: EstablishmentRole, overrides: readonly PermissionOverrideLike[] = []): boolean {
  return pode(role, overrides, OPERAR_COMO_DONO);
}
