// Política de acesso aos clientes do estabelecimento (Lote 6D.5) — função
// pura, sem Nest e sem banco, no mesmo molde de availability-access.ts e
// professional-access.ts.
//
// POR QUE SÓ DONO: mesma justificativa dos lotes anteriores — o backend ainda
// não tem tabela de permissões padrão por papel, e inferir daqui o que
// RECEPCIONISTA enxerga seria inventar autorização por suposição. Ampliar é
// decisão de um lote de papéis.
//
// QUAIS `DENIED` SÃO PERTINENTES: `CONSUMIDORES_VISUALIZAR` para buscar e,
// além dela, `CONSUMIDORES_GERENCIAR` para cadastrar. Os dois valores já
// existem no enum real — nenhuma permissão nova é criada aqui, e nenhum
// `GRANTED` amplia nada.
import { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { Permission } from '../entities/enums/permission.enum.js';
import { PermissionMode } from '../entities/enums/permission-mode.enum.js';
import type { PermissionOverrideLike } from '../common/tenant-authorization.js';

export const CONSUMERS_FORBIDDEN_MESSAGE =
  'Você não tem permissão para acessar os clientes deste estabelecimento.';

const ROLES_WITH_CONSUMER_ACCESS: ReadonlySet<EstablishmentRole> = new Set([
  EstablishmentRole.DONO,
]);

function negado(
  overrides: readonly PermissionOverrideLike[],
  permissoes: readonly Permission[],
): boolean {
  return overrides.some(
    (override) =>
      override.mode === PermissionMode.DENIED && permissoes.includes(override.permission),
  );
}

export function canViewConsumers(
  role: EstablishmentRole,
  overrides: readonly PermissionOverrideLike[] = [],
): boolean {
  if (!ROLES_WITH_CONSUMER_ACCESS.has(role)) return false;
  return !negado(overrides, [Permission.CONSUMIDORES_VISUALIZAR]);
}

/** Cadastrar exige as duas: quem não pode nem ver a lista também não cadastra. */
export function canManageConsumers(
  role: EstablishmentRole,
  overrides: readonly PermissionOverrideLike[] = [],
): boolean {
  if (!ROLES_WITH_CONSUMER_ACCESS.has(role)) return false;
  return !negado(overrides, [
    Permission.CONSUMIDORES_VISUALIZAR,
    Permission.CONSUMIDORES_GERENCIAR,
  ]);
}
