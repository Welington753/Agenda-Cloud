// Política de acesso à gestão de serviços (Lote 6D.1) — função pura, sem
// Nest, sem banco, para a regra ser testável isolada e nunca ser
// reimplementada por controller nenhum.
//
// DONO: ver com `SERVICOS_VISUALIZAR` não negada; gerenciar com
// `SERVICOS_VISUALIZAR` e `SERVICOS_GERENCIAR` não negadas (quem não pode ver
// também não edita). GERENTE: as mesmas permissões concedidas pelo dono
// (`GRANTED`). RECEPCIONISTA e PROFISSIONAL: nunca, nem com `GRANTED` gravado.
//
// BASE COMUM (docs/plans/permissoes-individuais.md, etapa 1): as duas
// políticas decidem só por `accessCan`, porque a lista do dono é igual às
// dependências exigidas do gerente (`SERVICOS_GERENCIAR` exige
// `SERVICOS_VISUALIZAR`). Sem mudança de regra; equivalência com a regra
// anterior em services-professionals-access.equivalence.spec.ts.
//
// DONO é dono DESTE estabelecimento, nunca administrador global: esta função
// nunca é consultada sem um `Membership` do próprio tenant em mãos (ver
// services.service.ts, que entrega os ajustes gravados do vínculo).
import type { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { accessCan, effectiveAccess } from '../common/access-evaluation.js';
import type { PermissionOverrideLike } from '../common/tenant-authorization.js';

export function canViewServices(
  role: EstablishmentRole,
  overrides: readonly PermissionOverrideLike[] = [],
): boolean {
  return accessCan(effectiveAccess(role, overrides), 'SERVICOS_VISUALIZAR');
}

/** Gerenciar exige também poder visualizar: um DENIED em VISUALIZAR sem
 * DENIED em GERENCIAR nunca pode resultar em "edita o que não pode ver". */
export function canManageServices(
  role: EstablishmentRole,
  overrides: readonly PermissionOverrideLike[] = [],
): boolean {
  return accessCan(effectiveAccess(role, overrides), 'SERVICOS_GERENCIAR');
}
