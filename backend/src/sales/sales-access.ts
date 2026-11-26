// Quem registra, recebe, consulta, cancela e estorna vendas
// (docs/plans/vendas-v1.md, seção 3). Funções puras, sem Nest e sem banco.
//
// DONO: tudo, salvo `DENIED` gravado pela administração (cada ação exige não
// ter negada nenhuma das permissões dela nem as dependências).
// GERENTE: só com o que o dono concedeu e confirmou em "Equipe e acessos"
// (`managerCan`, com as dependências de MANAGER_PERMISSION_REQUIRES).
// RECEPCIONISTA: só `VENDAS_REGISTRAR`, `VENDAS_RECEBER` e
// `VENDAS_ALTERAR_PRECO`, cada uma concedida pelo dono (`receptionistCan`).
// Nunca consulta todas as vendas, cancela nem estorna.
// PROFISSIONAL (funcionário): nunca.
//
// RECEBER: a venda que a própria pessoa registrou, com `VENDAS_RECEBER`; a
// venda de outra pessoa, só com `VENDAS_RECEBER` E `VENDAS_VISUALIZAR`. A
// consulta geral sozinha não recebe.
//
// RECURSO DO ADICIONAL (seção 3.1), conferido pela rota antes da política:
// - nova venda (catálogo, busca de cliente, confirmar): VENDAS e ESTOQUE
//   (`SALES_NEW_SALE_FEATURES`);
// - manutenção das vendas já registradas (consultar, receber, estornar,
//   cancelar): nenhum recurso (`SALES_MAINTENANCE_FEATURES`), só a validade
//   do acesso. Retirar VENDAS bloqueia novas vendas sem prender as antigas.
import { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { FeatureKey } from '../entities/enums/feature-key.enum.js';
import { accessCan, effectiveAccess } from '../common/access-evaluation.js';
import type { PermissionOverrideLike } from '../common/tenant-authorization.js';
import type { ManagerPermission } from '../common/manager-permissions.js';

export const SALES_NEW_SALE_FEATURES: readonly FeatureKey[] = [FeatureKey.VENDAS, FeatureKey.ESTOQUE];
export const SALES_MAINTENANCE_FEATURES = null;

export const SALES_FORBIDDEN_MESSAGE = 'Você não tem permissão para esta operação de vendas neste estabelecimento.';

type SalesPermission = Extract<ManagerPermission, `VENDAS_${string}`>;

// Toda decisão passa pela base comum (common/access-evaluation.ts), que
// calcula o acesso efetivo pelo modelo LEGADO: as mesmas regras por papel de
// antes (managerCan, receptionistCan e algumaNegada do dono).
function pode(role: EstablishmentRole, overrides: readonly PermissionOverrideLike[], permissao: SalesPermission): boolean {
  return accessCan(effectiveAccess(role, overrides), permissao);
}

/** Abrir o catálogo de venda, procurar o cliente, confirmar a venda e
 * consultar as próprias operações. */
export function canRegisterSales(role: EstablishmentRole, overrides: readonly PermissionOverrideLike[] = []): boolean {
  return pode(role, overrides, 'VENDAS_REGISTRAR');
}

/** Preço diferente do sugerido (ou produto sem sugerido) numa venda NOVA. */
export function canOverrideSalePrice(role: EstablishmentRole, overrides: readonly PermissionOverrideLike[] = []): boolean {
  return pode(role, overrides, 'VENDAS_ALTERAR_PRECO');
}

/** Todas as vendas, os recebimentos de vendas e as compras na ficha. */
export function canViewAllSales(role: EstablishmentRole, overrides: readonly PermissionOverrideLike[] = []): boolean {
  return pode(role, overrides, 'VENDAS_VISUALIZAR');
}

/** Receber a venda: a própria com `VENDAS_RECEBER`; a de outra pessoa,
 * também com a consulta geral. */
export function canReceiveSale(
  role: EstablishmentRole,
  overrides: readonly PermissionOverrideLike[],
  venda: { ownSale: boolean },
): boolean {
  if (!pode(role, overrides, 'VENDAS_RECEBER')) return false;
  return venda.ownSale || canViewAllSales(role, overrides);
}

/** Alguma venda pode ser recebida por esta pessoa (a rota confere a venda). */
export function canReceiveSales(role: EstablishmentRole, overrides: readonly PermissionOverrideLike[] = []): boolean {
  return pode(role, overrides, 'VENDAS_RECEBER');
}

export function canCancelSales(role: EstablishmentRole, overrides: readonly PermissionOverrideLike[] = []): boolean {
  return pode(role, overrides, 'VENDAS_CANCELAR');
}

export function canRefundSalePayments(role: EstablishmentRole, overrides: readonly PermissionOverrideLike[] = []): boolean {
  return pode(role, overrides, 'VENDAS_ESTORNAR_RECEBIMENTO');
}

/** Consultar alguma coisa de vendas: as próprias operações ou todas. */
export function canAccessSalesHistory(role: EstablishmentRole, overrides: readonly PermissionOverrideLike[] = []): boolean {
  return canRegisterSales(role, overrides) || canViewAllSales(role, overrides);
}
