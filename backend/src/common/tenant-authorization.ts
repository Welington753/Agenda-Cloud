// Prova de acesso a um estabelecimento (Lote 6D.4) — extraída de
// `professionals/professional-tenant-access.ts` SEM mudança de comportamento,
// para que a consulta de disponibilidade não ganhasse uma segunda cópia da
// mesma checagem. Autorização duplicada é exatamente o que desanda com o
// tempo: uma cópia recebe a correção e a outra não.
//
// A POLÍTICA (quais papéis, quais DENIED) continua fora daqui, em função pura
// por módulo (`professional-access.ts`, `availability-access.ts`). Este
// arquivo resolve só o fato: existe `Membership` deste usuário neste tenant,
// o tenant está utilizável, e os overrides são carregados e entregues à
// política.
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { isTenantUsableForSession } from '../auth/tenant-access.js';
import { Membership } from '../entities/membership.entity.js';
import { MembershipPermissionOverride } from '../entities/membership-permission-override.entity.js';
import { Tenant } from '../entities/tenant.entity.js';
import type { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import type { Permission } from '../entities/enums/permission.enum.js';
import { PermissionMode } from '../entities/enums/permission-mode.enum.js';

/** Mensagem única para "não existe" e "você não tem vínculo com ele" — nunca
 * distinguir os dois revelaria a existência de estabelecimentos de terceiros. */
export const TENANT_NOT_FOUND_MESSAGE = 'Estabelecimento não encontrado.';

export const MEMBERSHIP_SUSPENDED_MESSAGE = 'Seu acesso a este estabelecimento está suspenso.';

/** Só `ACTIVE` opera. Qualquer outro valor (ou ausente) não dá acesso. */
export function isMembershipActive(membership: { status?: string | null }): boolean {
  return membership.status === 'ACTIVE';
}

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
  return overrides.some((override) => override.mode === PermissionMode.DENIED && permissoes.includes(override.permission));
}

/** Vínculo já PROVADO no servidor: existe Membership deste usuário neste
 * tenant, e o tenant está utilizável. Única origem aceitável de `tenantId`. */
export interface AuthorizedTenant {
  tenantId: string;
  membershipId: string;
  role: EstablishmentRole;
  /** Os ajustes que valem (ver `effectiveOverrides`), para quem precisa
   * decidir, depois da prova, o que a resposta mostra. */
  overrides?: readonly PermissionOverrideLike[];
}

/**
 * Os ajustes que de fato valem para o vínculo.
 *
 * GERENTE só recebe área por `GRANTED` dado pelo dono na tela de equipe, e
 * isso só vale depois que o dono CONFIRMOU as permissões daquele vínculo
 * (`memberships.permissions_confirmed_at`, migration TeamManagerAccess). Um
 * GERENTE antigo, de antes dessa tela, continua sem área nenhuma mesmo que
 * tenha `GRANTED` gravado: os `DENIED` ficam (só restringem), os `GRANTED`
 * somem. Para os demais papéis nada muda.
 */
export function effectiveOverrides<T extends { mode: string }>(
  role: EstablishmentRole | string,
  permissionsConfirmed: boolean,
  overrides: readonly T[],
): T[] {
  if (role === 'GERENTE' && !permissionsConfirmed) return overrides.filter((o) => o.mode !== 'GRANTED');
  return [...overrides];
}

/** A confirmação do dono para um vínculo GERENTE. A coluna é da migration
 * TeamManagerAccess e fica fora da entidade (SQL explícito). */
export async function permissionsConfirmed(manager: EntityManager, membershipId: string): Promise<boolean> {
  const [linha] = await manager.query<{ confirmed: boolean }[]>(
    'SELECT permissions_confirmed_at IS NOT NULL AS confirmed FROM memberships WHERE id = $1',
    [membershipId],
  );
  return linha?.confirmed === true;
}

export interface PoliticaDeAcesso {
  /** Função pura do módulo: decide com o papel e os overrides em mãos. */
  permitido: (role: EstablishmentRole, overrides: readonly PermissionOverrideLike[]) => boolean;
  /** Mensagem do 403 — cada módulo fala da sua área. */
  mensagemProibido: string;
}

/**
 * Prova, no servidor e a cada requisição, que este usuário pode operar neste
 * tenant.
 *
 * `NotFoundException` (não 403) quando não há vínculo ou o tenant está
 * inativo: um 403 confirmaria que o estabelecimento existe.
 */
export async function resolveAuthorizedTenant(
  manager: EntityManager,
  userId: string,
  tenantId: string,
  politica: PoliticaDeAcesso,
): Promise<AuthorizedTenant> {
  const membership = await manager.findOne(Membership, { where: { userId, tenantId } });
  if (!membership) {
    throw new NotFoundException(TENANT_NOT_FOUND_MESSAGE);
  }
  // Acesso suspenso pelo dono: o vínculo existe, mas não opera. Relido a cada
  // requisição, então vale já na próxima, mesmo com a sessão aberta.
  if (!isMembershipActive(membership)) {
    throw new ForbiddenException(MEMBERSHIP_SUSPENDED_MESSAGE);
  }

  const tenant = await manager.findOne(Tenant, { where: { id: tenantId } });
  if (!tenant || !isTenantUsableForSession(tenant.status)) {
    throw new NotFoundException(TENANT_NOT_FOUND_MESSAGE);
  }

  const gravados = await manager.find(MembershipPermissionOverride, {
    where: { tenantId, membershipId: membership.id },
  });
  // Só o GERENTE com alguma concessão depende da confirmação; os demais
  // papéis (e o gerente sem nenhum GRANTED) não leem a coluna.
  const precisaConfirmacao = membership.role === 'GERENTE' && gravados.some((o) => o.mode === 'GRANTED');
  const confirmado = precisaConfirmacao ? await permissionsConfirmed(manager, membership.id) : false;
  const overrides = effectiveOverrides(membership.role, confirmado, gravados);

  if (!politica.permitido(membership.role, overrides)) {
    throw new ForbiddenException(politica.mensagemProibido);
  }

  return { tenantId, membershipId: membership.id, role: membership.role, overrides };
}
