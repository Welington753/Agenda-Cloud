// Política de acesso à gestão de profissionais (Lote 6D.2) — espelho exato
// de services/service-access.ts: função pura, sem Nest, sem banco, para a
// regra ser testável isolada e nunca reimplementada por controller nenhum.
//
// POR QUE SÓ DONO: mesma justificativa do Lote 6D.1. O schema já tem
// `Permission.PROFISSIONAIS_VISUALIZAR`/`PROFISSIONAIS_GERENCIAR`, mas o
// backend ainda não tem uma tabela de permissões padrão por papel. Inferir
// aqui o que GERENTE ou RECEPCIONISTA podem fazer seria inventar autorização
// por suposição — este lote libera a gestão apenas ao DONO com vínculo
// ativo, exatamente como serviços.
//
// Overrides SÃO respeitados, mas só no sentido que RESTRINGE: um `DENIED`
// explícito em `PROFISSIONAIS_VISUALIZAR`/`PROFISSIONAIS_GERENCIAR` tira o
// acesso do DONO. Um `GRANTED` para outro papel NÃO amplia nada neste lote.
//
// DONO é dono DESTE estabelecimento, nunca administrador global: esta função
// nunca é consultada sem um `Membership` do próprio tenant em mãos (ver
// professionals.service.ts, `resolveAuthorizedTenant`).
import { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { Permission } from '../entities/enums/permission.enum.js';
import { PermissionMode } from '../entities/enums/permission-mode.enum.js';

/** Papéis com acesso padrão à gestão de profissionais neste lote. */
const ROLES_WITH_PROFESSIONALS_ACCESS: ReadonlySet<EstablishmentRole> = new Set([
  EstablishmentRole.DONO,
]);

export interface PermissionOverrideLike {
  permission: Permission;
  mode: PermissionMode;
}

/** Um override só pode tirar acesso aqui, nunca dar (ver cabeçalho). */
function isDeniedByOverride(
  overrides: readonly PermissionOverrideLike[],
  permission: Permission,
): boolean {
  return overrides.some(
    (override) => override.permission === permission && override.mode === PermissionMode.DENIED,
  );
}

export function canViewProfessionals(
  role: EstablishmentRole,
  overrides: readonly PermissionOverrideLike[] = [],
): boolean {
  if (!ROLES_WITH_PROFESSIONALS_ACCESS.has(role)) return false;
  return !isDeniedByOverride(overrides, Permission.PROFISSIONAIS_VISUALIZAR);
}

export function canManageProfessionals(
  role: EstablishmentRole,
  overrides: readonly PermissionOverrideLike[] = [],
): boolean {
  if (!ROLES_WITH_PROFESSIONALS_ACCESS.has(role)) return false;
  // Gerenciar exige também poder visualizar: um DENIED em VISUALIZAR sem
  // DENIED em GERENCIAR nunca pode resultar em "edita o que não pode ver".
  if (isDeniedByOverride(overrides, Permission.PROFISSIONAIS_VISUALIZAR)) return false;
  return !isDeniedByOverride(overrides, Permission.PROFISSIONAIS_GERENCIAR);
}
