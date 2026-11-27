// Quem configura e consulta comissões. Funções puras, no molde de
// payments/payment-access.ts. O recurso do plano (`COMISSOES`) é conferido
// à parte, pela rota (common/tenant-authorization.ts e
// team/my-agenda.service.ts).
//
// DONO: consulta o relatório de todos com a mesma política de VER A AGENDA e
// de VER OS RECEBIMENTOS (o relatório mostra atendimentos, clientes e
// dinheiro) e sem `COMISSOES_VISUALIZAR` negado. Configura as regras se
// também vê profissionais e serviços e não tem `COMISSOES_GERENCIAR` negado.
//
// GERENTE: nada neste lote (não há concessão de gerente para comissões).
//
// FUNCIONÁRIO (e gerente com profissional ligado e permissões confirmadas):
// só as PRÓPRIAS comissões, e só com `COMISSOES_PROPRIAS_VISUALIZAR` concedida
// pelo dono em "Equipe e acessos". Nunca as dos colegas, nunca o recebimento
// do cliente. O vínculo com profissional ligado e ativo e a agenda própria
// (`canViewOwnAgenda`) são conferidos por quem chama
// (team/my-agenda.service.ts, `resolveStaffAccess`).
//
// BASE COMUM (docs/plans/permissoes-individuais.md, etapa 1): a consulta de
// todos e a configuração decidem só por `accessAllows`, com a lista do dono
// literal, como estava (a agenda e os recebimentos do dono olham só
// `AGENDA_VISUALIZAR`; profissionais e serviços, só a própria consulta) e sem
// concessão para os demais papéis. A consulta das próprias decide por
// `accessCanOwn`. Sem mudança de regra; equivalência com a regra anterior em
// commission-access.equivalence.spec.ts.
import type { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { Permission } from '../entities/enums/permission.enum.js';
import { accessAllows, accessCanOwn, effectiveAccess, type LegacyAction } from '../common/access-evaluation.js';
import { OWN_COMMISSIONS_PERMISSION } from '../common/staff-permissions.js';
import type { PermissionOverrideLike } from '../common/tenant-authorization.js';

export const COMMISSIONS_FORBIDDEN_MESSAGE = 'Você não tem permissão para ver as comissões deste estabelecimento.';
export const COMMISSION_RULES_FORBIDDEN_MESSAGE =
  'Você não tem permissão para configurar as comissões deste estabelecimento.';
export const OWN_COMMISSIONS_FORBIDDEN_MESSAGE = 'O estabelecimento não liberou a consulta das suas comissões.';

/** Só o dono: a consulta, a agenda e os recebimentos dele. */
const VER_TODAS: LegacyAction = {
  grants: null,
  ownerDenials: [Permission.COMISSOES_VISUALIZAR, Permission.AGENDA_VISUALIZAR],
};

/** Só o dono: o que ele precisa para ver, mais configurar e ver profissionais
 * e serviços. */
const CONFIGURAR: LegacyAction = {
  grants: null,
  ownerDenials: [
    Permission.COMISSOES_VISUALIZAR,
    Permission.AGENDA_VISUALIZAR,
    Permission.COMISSOES_GERENCIAR,
    Permission.PROFISSIONAIS_VISUALIZAR,
    Permission.SERVICOS_VISUALIZAR,
  ],
};

export function canViewCommissions(role: EstablishmentRole, overrides: readonly PermissionOverrideLike[] = []): boolean {
  return accessAllows(effectiveAccess(role, overrides), VER_TODAS);
}

export function canManageCommissionRules(
  role: EstablishmentRole,
  overrides: readonly PermissionOverrideLike[] = [],
): boolean {
  return accessAllows(effectiveAccess(role, overrides), CONFIGURAR);
}

/** As PRÓPRIAS comissões: a concessão do dono, com `DENIED` vencendo. Quem
 * chama confere antes a agenda própria e o profissional ligado e ativo. */
export function canViewOwnCommissions(
  role: EstablishmentRole,
  overrides: readonly PermissionOverrideLike[] = [],
): boolean {
  return accessCanOwn(effectiveAccess(role, overrides), OWN_COMMISSIONS_PERMISSION);
}
