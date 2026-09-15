// Política de acesso à gestão de serviços (Lote 6D.1) — função pura, sem
// Nest, sem banco, para a regra ser testável isolada e nunca ser
// reimplementada por controller nenhum.
//
// POR QUE SÓ DONO: o schema já tem `Permission.SERVICOS_VISUALIZAR` /
// `SERVICOS_GERENCIAR` e `MembershipPermissionOverride`, mas o backend NÃO
// tem (ainda) uma política que mapeie papel -> permissões padrão. A única que
// existe é a da demonstração (`src/lib/access/access-control.ts` no
// frontend), que pertence ao domínio simulado e nunca se mistura com o real
// (mesma disciplina de auth-api.ts). Inferir aqui o que GERENTE ou
// RECEPCIONISTA podem fazer seria inventar autorização por suposição — então
// este lote libera a gestão apenas ao DONO com vínculo ativo.
//
// Overrides SÃO respeitados, mas só no sentido que RESTRINGE: um `DENIED`
// explícito em `SERVICOS_VISUALIZAR`/`SERVICOS_GERENCIAR` tira o acesso do
// DONO (é a semântica já documentada da tabela: DENIED sempre vence). Um
// `GRANTED` para outro papel NÃO amplia nada neste lote — ampliar exigiria a
// tabela de padrões por papel que ainda não existe no backend.
//
// DONO é dono DESTE estabelecimento, nunca administrador global: esta função
// nunca é consultada sem um `Membership` do próprio tenant em mãos (ver
// services.service.ts, `resolveAuthorizedTenant`).
import { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { Permission } from '../entities/enums/permission.enum.js';
import { PermissionMode } from '../entities/enums/permission-mode.enum.js';

/** Papéis com acesso padrão à gestão de serviços neste lote. */
const ROLES_WITH_SERVICES_ACCESS: ReadonlySet<EstablishmentRole> = new Set([
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

export function canViewServices(
  role: EstablishmentRole,
  overrides: readonly PermissionOverrideLike[] = [],
): boolean {
  if (!ROLES_WITH_SERVICES_ACCESS.has(role)) return false;
  return !isDeniedByOverride(overrides, Permission.SERVICOS_VISUALIZAR);
}

export function canManageServices(
  role: EstablishmentRole,
  overrides: readonly PermissionOverrideLike[] = [],
): boolean {
  if (!ROLES_WITH_SERVICES_ACCESS.has(role)) return false;
  // Gerenciar exige também poder visualizar: um DENIED em VISUALIZAR sem
  // DENIED em GERENCIAR nunca pode resultar em "edita o que não pode ver".
  if (isDeniedByOverride(overrides, Permission.SERVICOS_VISUALIZAR)) return false;
  return !isDeniedByOverride(overrides, Permission.SERVICOS_GERENCIAR);
}
