// Dois contextos bem separados (Lote 6B.6 — correção multi-tenant):
//
// `IdentityContext` — só o que SessionGuard prova: sessão válida + usuário
// ativo. Nunca inclui tenant/membership nenhum; um usuário com 0, 1 ou N
// vínculos de estabelecimento tem exatamente a mesma IdentityContext.
//
// `TenantContext` — um vínculo utilizável (Membership + Tenant ativo) do
// usuário. GET /auth/me pode devolver zero, um ou vários — nunca escolhe um
// automaticamente quando há mais de um (ver auth.service.ts,
// `getSessionContext`). Um futuro endpoint autenticado (não implementado
// neste lote) vai deixar o usuário selecionar/trocar de contexto ativo;
// nenhuma rota de negócio pode aceitar tenantId arbitrário do cliente sem
// validar que existe uma Membership correspondente — isso é responsabilidade
// de cada rota de negócio, nunca do SessionGuard.
import type { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import type { TenantStatus } from '../entities/enums/tenant-status.enum.js';

export interface IdentityContext {
  userId: string;
  sessionId: string;
}

export interface TenantContext {
  membershipId: string;
  tenantId: string;
  /** Tenant não tem coluna própria de nome — deriva do nome da Unit
   * principal (`Unit.isPrimary`); cai para `tenantSlug` só se, por algum
   * motivo, o tenant não tiver unit principal (não deveria acontecer no
   * fluxo de cadastro atual). */
  tenantName: string;
  tenantSlug: string;
  role: EstablishmentRole;
  unit: { id: string; name: string; isPrimary: boolean } | null;
  planCode: string;
  planName: string;
  /** Derivado (nunca persistido) — `trialStartAt = Tenant.createdAt`,
   * `trialEndAt = trialStartAt + 14 dias`, sempre UTC. Ver trial-policy.ts:
   * política temporária, centralizada ali para trocar por assinatura
   * persistida sem reescrever cada chamador. */
  trial: { trialStartAt: Date; trialEndAt: Date; durationDays: number };
  /** Só os dois valores que tornam um tenant utilizável para sessão (ver
   * tenant-access.ts) — nunca SUSPENDED/PAST_DUE/CANCELED aqui, porque esses
   * tenants nunca viram TenantContext (ver `loadTenantContexts`). */
  tenantStatus: TenantStatus;
}

export interface SessionContextResult {
  user: { id: string; name: string; email: string };
  contexts: TenantContext[];
  /** Preenchido só quando `contexts.length === 1` — nunca o primeiro de uma
   * lista maior escolhido arbitrariamente. */
  activeContext: TenantContext | null;
  /** `true` só quando `contexts.length > 1` — cliente precisa perguntar ao
   * usuário qual estabelecimento usar. */
  requiresTenantSelection: boolean;
  /** `true` quando `contexts.length >= 1` — distingue "autenticado sem
   * nenhum estabelecimento utilizável" (false) de qualquer outro caso. */
  hasEstablishmentAccess: boolean;
}

// Nome da propriedade em `Request` onde o guard anexa a IdentityContext —
// uma única fonte de verdade para guard/controller nunca divergirem.
export const AUTH_CONTEXT_REQUEST_KEY = 'auth' as const;
