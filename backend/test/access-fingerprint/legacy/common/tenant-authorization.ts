// Parte pura de common/tenant-authorization.ts em 8f71335 (o piloto), copiada
// literalmente: o tipo dos ajustes, `algumaNegada`, `effectiveOverrides` e
// `permissionsConfirmed` (uma leitura; na impressão, respondida pelo
// gerenciador simulado). A prova do vínculo, a situação do estabelecimento e
// o gate comercial ficam fora: não mudaram na refatoração e as rotas reais
// os conferem nos testes com banco.
import type { EntityManager } from 'typeorm';
import { Permission } from '../entities/enums/permission.enum.js';
import { PermissionMode } from '../entities/enums/permission-mode.enum.js';

export interface PermissionOverrideLike {
  permission: Permission;
  mode: PermissionMode;
}

/** Algum `DENIED` gravado atinge uma destas permissões. Nas políticas do
 * dono, os ajustes só restringem: quem chama decide o resto. */
export function algumaNegada(
  overrides: readonly PermissionOverrideLike[],
  permissoes: readonly Permission[],
): boolean {
  return overrides.some(
    (override) =>
      override.mode === PermissionMode.DENIED && permissoes.includes(override.permission),
  );
}

export function effectiveOverrides<T extends { mode: string }>(
  role: string,
  permissionsConfirmed: boolean,
  overrides: readonly T[],
): T[] {
  if (role === 'GERENTE' && !permissionsConfirmed) return overrides.filter((o) => o.mode !== 'GRANTED');
  return [...overrides];
}

export async function permissionsConfirmed(manager: EntityManager, membershipId: string): Promise<boolean> {
  const [linha] = await manager.query<{ confirmed: boolean }[]>(
    'SELECT permissions_confirmed_at IS NOT NULL AS confirmed FROM memberships WHERE id = $1',
    [membershipId],
  );
  return linha?.confirmed === true;
}
