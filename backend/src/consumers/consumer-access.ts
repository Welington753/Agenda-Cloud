// Política de acesso aos clientes do estabelecimento (Lote 6D.5) — função
// pura, sem Nest e sem banco, no mesmo molde de availability-access.ts e
// professional-access.ts.
//
// DONO: buscar com `CONSUMIDORES_VISUALIZAR` não negada; cadastrar e editar
// com `CONSUMIDORES_VISUALIZAR` e `CONSUMIDORES_GERENCIAR` não negadas.
// GERENTE: as mesmas permissões concedidas pelo dono (`GRANTED` confirmado).
// RECEPCIONISTA e PROFISSIONAL: nunca, nem com `GRANTED` gravado. A busca
// limitada de clientes da venda é outra regra (`sales/sales.service.ts`,
// `searchConsumers`, com a política de registrar vendas).
//
// UNIFICAR cadastros: SÓ o dono (decisão do responsável, 19/11/2026), nem com
// permissão concedida ao gerente. Um `DENIED` do próprio dono em visualizar
// ou gerenciar clientes tira também a unificação.
//
// BASE COMUM (docs/plans/permissoes-individuais.md, etapa 1): cada política
// decide só pela base comum, sem mudança de regra. Buscar e cadastrar usam
// `accessCan`, porque a lista do dono é igual às dependências exigidas do
// gerente (`CONSUMIDORES_GERENCIAR` exige `CONSUMIDORES_VISUALIZAR`).
// Unificar usa `accessAllows` com a lista literal do dono e nenhuma
// concessão. Equivalência com a regra anterior em
// consumer-access.equivalence.spec.ts.
import { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { Permission } from '../entities/enums/permission.enum.js';
import { accessAllows, accessCan, effectiveAccess, type LegacyAction } from '../common/access-evaluation.js';
import type { PermissionOverrideLike } from '../common/tenant-authorization.js';

export const CONSUMERS_FORBIDDEN_MESSAGE =
  'Você não tem permissão para acessar os clientes deste estabelecimento.';

export function canViewConsumers(
  role: EstablishmentRole,
  overrides: readonly PermissionOverrideLike[] = [],
): boolean {
  return accessCan(effectiveAccess(role, overrides), 'CONSUMIDORES_VISUALIZAR');
}

/** Cadastrar exige as duas: quem não pode nem ver a lista também não cadastra. */
export function canManageConsumers(
  role: EstablishmentRole,
  overrides: readonly PermissionOverrideLike[] = [],
): boolean {
  return accessCan(effectiveAccess(role, overrides), 'CONSUMIDORES_GERENCIAR');
}

export const CONSUMERS_MERGE_FORBIDDEN_MESSAGE = 'Só o dono do estabelecimento unifica cadastros de clientes.';

/** Só o dono, com a lista dele literal; nenhuma concessão unifica. */
const UNIFICAR: LegacyAction = {
  grants: null,
  ownerDenials: [Permission.CONSUMIDORES_VISUALIZAR, Permission.CONSUMIDORES_GERENCIAR],
};

/**
 * Unificar cadastros: SÓ o dono, nem com permissão concedida ao gerente. Um
 * `DENIED` do próprio dono em visualizar ou gerenciar clientes tira também a
 * unificação.
 */
export function canMergeConsumers(
  role: EstablishmentRole,
  overrides: readonly PermissionOverrideLike[] = [],
): boolean {
  return accessAllows(effectiveAccess(role, overrides), UNIFICAR);
}
