// Quem configura e consulta comissões. Funções puras, no molde de
// payments/payment-access.ts. O recurso do plano (`COMISSOES`) é conferido
// à parte, pela rota (common/tenant-authorization.ts).
//
// DONO: consulta o relatório com a mesma política de VER A AGENDA e de VER
// OS RECEBIMENTOS (o relatório mostra atendimentos, clientes e dinheiro) e
// sem `COMISSOES_VISUALIZAR` negado. Configura as regras se também vê
// profissionais e serviços e não tem `COMISSOES_GERENCIAR` negado.
//
// GERENTE: nada neste lote (não há concessão de gerente para comissões).
//
// FUNCIONÁRIO (e gerente com profissional ligado e permissões confirmadas):
// só as PRÓPRIAS comissões, e só com `COMISSOES_PROPRIAS_VISUALIZAR` concedida
// pelo dono em "Equipe e acessos" (team/staff-access.ts). Nunca as dos colegas,
// nunca o recebimento do cliente.
import { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { Permission } from '../entities/enums/permission.enum.js';
import { algumaNegada, type PermissionOverrideLike } from '../common/tenant-authorization.js';
import { canViewPayments } from '../payments/payment-access.js';
import { canViewProfessionals } from '../professionals/professional-access.js';
import { canViewServices } from '../services/service-access.js';

export const COMMISSIONS_FORBIDDEN_MESSAGE = 'Você não tem permissão para ver as comissões deste estabelecimento.';
export const COMMISSION_RULES_FORBIDDEN_MESSAGE =
  'Você não tem permissão para configurar as comissões deste estabelecimento.';
export const OWN_COMMISSIONS_FORBIDDEN_MESSAGE = 'O estabelecimento não liberou a consulta das suas comissões.';

export function canViewCommissions(role: EstablishmentRole, overrides: readonly PermissionOverrideLike[] = []): boolean {
  if (role !== EstablishmentRole.DONO) return false;
  if (algumaNegada(overrides, [Permission.COMISSOES_VISUALIZAR])) return false;
  return canViewPayments(role, overrides);
}

export function canManageCommissionRules(
  role: EstablishmentRole,
  overrides: readonly PermissionOverrideLike[] = [],
): boolean {
  if (!canViewCommissions(role, overrides)) return false;
  if (algumaNegada(overrides, [Permission.COMISSOES_GERENCIAR])) return false;
  return canViewProfessionals(role, overrides) && canViewServices(role, overrides);
}
