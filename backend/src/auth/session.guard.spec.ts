import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { TenantStatus } from '../entities/enums/tenant-status.enum.js';
import { UserStatus } from '../entities/enums/user-status.enum.js';
import { SESSION_COOKIE_NAME } from '../config/session-cookie.config.js';
import { AUTH_CONTEXT_REQUEST_KEY, type IdentityContext } from './session-context.js';
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

  it('sessão válida SEM nenhuma Membership: autentica normalmente (não é erro)', async () => {
    const { token, tokenHash } = generateSessionToken();
    const user = store.seedUser({ status: UserStatus.ACTIVE });
    store.seedSession({ userId: user.id, tokenHash, expiresAt: new Date(Date.now() + 60_000) });
    const { context, request } = buildContext({ [SESSION_COOKIE_NAME]: token });

    const allowed = await guard.canActivate(context);

    expect(allowed).toBe(true);
    const identity = request[AUTH_CONTEXT_REQUEST_KEY] as IdentityContext;
    expect(identity.userId).toBe(user.id);
  });

  it('sessão válida com MÚLTIPLAS memberships: autentica normalmente, nunca 500', async () => {
    const { token, tokenHash } = generateSessionToken();
    const user = store.seedUser({ status: UserStatus.ACTIVE });
    const plan = store.seedPlan({ code: 'equipe' });
    const tenantA = store.seedTenant({ status: TenantStatus.TRIAL, planId: plan.id, slug: 'a' });
    const tenantB = store.seedTenant({ status: TenantStatus.TRIAL, planId: plan.id, slug: 'b' });
    store.seedMembership({ userId: user.id, tenantId: tenantA.id, role: EstablishmentRole.DONO });
    store.seedMembership({ userId: user.id, tenantId: tenantB.id, role: EstablishmentRole.DONO });
    store.seedSession({ userId: user.id, tokenHash, expiresAt: new Date(Date.now() + 60_000) });
    const { context, request } = buildContext({ [SESSION_COOKIE_NAME]: token });

    const allowed = await guard.canActivate(context);

    expect(allowed).toBe(true);
    const identity = request[AUTH_CONTEXT_REQUEST_KEY] as IdentityContext;
    expect(identity.userId).toBe(user.id);
    expect(identity.sessionId).toBeTruthy();
  });

  it('anexa exatamente {userId, sessionId} — nunca tenant/membership/plan', async () => {
    const { token, tokenHash } = generateSessionToken();
    const user = store.seedUser({ status: UserStatus.ACTIVE });
    const session = store.seedSession({
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const { context, request } = buildContext({ [SESSION_COOKIE_NAME]: token });

    await guard.canActivate(context);

    const identity = request[AUTH_CONTEXT_REQUEST_KEY] as Record<string, unknown>;
    expect(Object.keys(identity).sort()).toEqual(['sessionId', 'userId']);
    expect(identity.sessionId).toBe(session.id);
  });

  it('nunca anexa nem consulta a entidade Credential', async () => {
    const { token, tokenHash } = generateSessionToken();
    const user = store.seedUser({ status: UserStatus.ACTIVE });
    store.seedCredential({ userId: user.id, passwordHash: '$argon2id$deveria-ficar-fora-da-request$' });
    store.seedSession({ userId: user.id, tokenHash, expiresAt: new Date(Date.now() + 60_000) });
    const { context, request } = buildContext({ [SESSION_COOKIE_NAME]: token });

    await guard.canActivate(context);

    expect(JSON.stringify(request)).not.toContain('argon2id');
  });
});
