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
import { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import type { TenantStatus } from '../entities/enums/tenant-status.enum.js';
import type { AccessPeriodKind, AccessSituation, AccessState } from '../commercial/access-periods.js';

/** Validade do acesso como a sessão mostra. Só o DONO recebe a situação
 * comercial (tipo, até quando, o que venceu): é ele quem regulariza. Os
 * outros papéis recebem só se o estabelecimento está bloqueado. */
export function sessionAccess(situacao: AccessSituation, role: EstablishmentRole): TenantContext['access'] {
  if (role === EstablishmentRole.DONO) {
    const { state, blocked, validUntil, expiredAt, expiredKind } = situacao;
    return { state, blocked, validUntil, expiredAt, expiredKind };
  }
  return { state: null, blocked: situacao.blocked, validUntil: null, expiredAt: null, expiredKind: null };
}

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
  /** Validade do acesso (commercial/access-periods.ts). Com `blocked`, o
   * estabelecimento continua na lista, sem áreas, para a tela mostrar o
   * motivo e o caminho de regularização. Fora do DONO, só `blocked` vem
   * preenchido (ver `sessionAccess`). */
  access: {
    state: AccessState | null;
    blocked: boolean;
    validUntil: Date | null;
    expiredAt: Date | null;
    expiredKind: AccessPeriodKind | null;
  };
  /** Só os dois valores que tornam um tenant utilizável para sessão (ver
   * tenant-access.ts) — nunca SUSPENDED/PAST_DUE/CANCELED aqui, porque esses
   * tenants nunca viram TenantContext (ver `loadTenantContexts`). */
  tenantStatus: TenantStatus;
  /** Áreas que este vínculo opera agora (ver session-areas.ts). Só para a
   * tela: as rotas refazem a prova a cada requisição. */
  areas: string[];
}

export interface SessionContextResult {
  /** `email` é `null` na conta de funcionário criada com usuário e senha;
   * `username` é `null` nas contas que entram por e-mail.
   * `mustChangePassword`: senha temporária — só a troca de senha, a sessão e
   * a saída funcionam até a pessoa escolher a dela (ver session.guard.ts). */
  user: {
    id: string;
    name: string;
    email: string | null;
    username: string | null;
    mustChangePassword: boolean;
  };
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
