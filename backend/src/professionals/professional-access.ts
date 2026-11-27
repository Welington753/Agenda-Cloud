// Política de acesso à gestão de profissionais (Lote 6D.2) — espelho de
// services/service-access.ts: função pura, sem Nest, sem banco, para a regra
// ser testável isolada e nunca reimplementada por controller nenhum. Vale
// também para os horários semanais (professional-tenant-access.ts).
//
// DONO: ver com `PROFISSIONAIS_VISUALIZAR` não negada; gerenciar com
// `PROFISSIONAIS_VISUALIZAR` e `PROFISSIONAIS_GERENCIAR` não negadas.
// GERENTE: as mesmas permissões concedidas pelo dono (`GRANTED` confirmado).
// RECEPCIONISTA e PROFISSIONAL: nunca, nem com `GRANTED` gravado.
//
// BASE COMUM (docs/plans/permissoes-individuais.md, etapa 1): as duas
// políticas decidem só por `accessCan`, porque a lista do dono é igual às
// dependências exigidas do gerente (`PROFISSIONAIS_GERENCIAR` exige
// `PROFISSIONAIS_VISUALIZAR`). Sem mudança de regra; equivalência com a regra
// anterior em services/services-professionals-access.equivalence.spec.ts.
//
// DONO é dono DESTE estabelecimento, nunca administrador global: esta função
// nunca é consultada sem um `Membership` do próprio tenant em mãos (ver
// professional-tenant-access.ts, `resolveAuthorizedTenant`).
import type { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { accessCan, effectiveAccess } from '../common/access-evaluation.js';
import type { PermissionOverrideLike } from '../common/tenant-authorization.js';

export function canViewProfessionals(
  role: EstablishmentRole,
  overrides: readonly PermissionOverrideLike[] = [],
): boolean {
  return accessCan(effectiveAccess(role, overrides), 'PROFISSIONAIS_VISUALIZAR');
}

/** Gerenciar exige também poder visualizar: um DENIED em VISUALIZAR sem
 * DENIED em GERENCIAR nunca pode resultar em "edita o que não pode ver". */
export function canManageProfessionals(
  role: EstablishmentRole,
  overrides: readonly PermissionOverrideLike[] = [],
): boolean {
  return accessCan(effectiveAccess(role, overrides), 'PROFISSIONAIS_GERENCIAR');
}
