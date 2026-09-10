import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { TenantStatus } from '../entities/enums/tenant-status.enum.js';
import { UserStatus } from '../entities/enums/user-status.enum.js';
import { SESSION_COOKIE_NAME } from '../config/session-cookie.config.js';
import { AmbiguousSessionContextError } from './auth.errors.js';
import { AUTH_CONTEXT_REQUEST_KEY, type AuthenticatedContext } from './session-context.js';
import { SessionGuard } from './session.guard.js';
import { generateSessionToken } from './session-token.js';
import { createFakeDataSource, InMemoryStore } from './testing/in-memory-data-source.js';

function buildContext(cookies: Record<string, string>) {
  const request: Record<string, unknown> = { cookies };
  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
  return { context, request };
}

async function seedActiveAccount(store: InMemoryStore) {
  const { token, tokenHash } = generateSessionToken();
  const user = store.seedUser({ status: UserStatus.ACTIVE });
  const plan = store.seedPlan({ code: 'equipe', name: 'Gestão' });
  const tenant = store.seedTenant({ status: TenantStatus.TRIAL, planId: plan.id });
  const unit = store.seedUnit({ tenantId: tenant.id, isPrimary: true });
  const membership = store.seedMembership({
    userId: user.id,
    tenantId: tenant.id,
    role: EstablishmentRole.DONO,
  });
  store.seedSession({
    userId: user.id,
    tokenHash,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
  return { token, user, tenant, unit, membership, plan };
}

describe('SessionGuard', () => {
  let store: InMemoryStore;
  let guard: SessionGuard;

  beforeEach(() => {
    store = new InMemoryStore();
    guard = new SessionGuard(createFakeDataSource(store));
  });

  it('sem cookie: 401, sem consultar nada', async () => {
    const { context } = buildContext({});
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('cookie malformado (tamanho/alfabeto errado): 401 sem consultar sessão', async () => {
    const { context } = buildContext({ [SESSION_COOKIE_NAME]: 'nao-e-um-token-valido' });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('token bem formado mas desconhecido: 401', async () => {
    const { token } = generateSessionToken();
    const { context } = buildContext({ [SESSION_COOKIE_NAME]: token });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('sessão expirada: 401', async () => {
    const { token, tokenHash } = generateSessionToken();
    store.seedSession({ tokenHash, expiresAt: new Date(Date.now() - 1000) });
    const { context } = buildContext({ [SESSION_COOKIE_NAME]: token });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('sessão revogada: 401', async () => {
    const { token, tokenHash } = generateSessionToken();
    store.seedSession({
      tokenHash,
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: new Date(),
    });
    const { context } = buildContext({ [SESSION_COOKIE_NAME]: token });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('usuário inativo: 401', async () => {
    const { token, tokenHash } = generateSessionToken();
    const user = store.seedUser({ status: UserStatus.SUSPENDED });
    store.seedSession({
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const { context } = buildContext({ [SESSION_COOKIE_NAME]: token });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('tenant inativo: 401', async () => {
    const { token, tokenHash } = generateSessionToken();
    const user = store.seedUser({ status: UserStatus.ACTIVE });
    const plan = store.seedPlan({ code: 'equipe' });
    const tenant = store.seedTenant({ status: TenantStatus.SUSPENDED, planId: plan.id });
    store.seedMembership({ userId: user.id, tenantId: tenant.id, role: EstablishmentRole.DONO });
    store.seedSession({ userId: user.id, tokenHash, expiresAt: new Date(Date.now() + 60_000) });
    const { context } = buildContext({ [SESSION_COOKIE_NAME]: token });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('contexto correto: retorna true e anexa AuthenticatedContext sanitizado à request', async () => {
    const { token, user, tenant, unit, membership, plan } = await seedActiveAccount(store);
    const { context, request } = buildContext({ [SESSION_COOKIE_NAME]: token });

    const allowed = await guard.canActivate(context);

    expect(allowed).toBe(true);
    const auth = request[AUTH_CONTEXT_REQUEST_KEY] as AuthenticatedContext;
    expect(auth.user.id).toBe(user.id);
    expect(auth.tenant.id).toBe(tenant.id);
    expect(auth.unit?.id).toBe(unit.id);
    expect(auth.membership.id).toBe(membership.id);
    expect(auth.plan.code).toBe(plan.code);
  });

  it('nunca anexa a entidade Credential à request', async () => {
    const { token } = await seedActiveAccount(store);
    const { context, request } = buildContext({ [SESSION_COOKIE_NAME]: token });

    await guard.canActivate(context);

    const auth = request[AUTH_CONTEXT_REQUEST_KEY] as Record<string, unknown>;
    expect(JSON.stringify(auth)).not.toContain('passwordHash');
    expect(JSON.stringify(auth)).not.toContain('credential');
  });

  it('múltiplos memberships: erro controlado (AmbiguousSessionContextError), nunca 401 nem escolha arbitrária', async () => {
    const { token, user } = await seedActiveAccount(store);
    const outroTenant = store.seedTenant({ status: TenantStatus.TRIAL });
    store.seedMembership({ userId: user.id, tenantId: outroTenant.id, role: EstablishmentRole.DONO });
    const { context } = buildContext({ [SESSION_COOKIE_NAME]: token });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(AmbiguousSessionContextError);
  });
});
