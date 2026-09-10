import { beforeEach, describe, expect, it } from 'vitest';
import { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { TenantStatus } from '../entities/enums/tenant-status.enum.js';
import { UserStatus } from '../entities/enums/user-status.enum.js';
import { TRIAL_DURATION_DAYS } from './trial-policy.js';
import { AuthService } from './auth.service.js';
import { createFakeDataSource, InMemoryStore } from './testing/in-memory-data-source.js';

function buildService(store: InMemoryStore): AuthService {
  return new AuthService(createFakeDataSource(store));
}

describe('AuthService.getSessionContext', () => {
  let store: InMemoryStore;
  let service: AuthService;

  beforeEach(() => {
    store = new InMemoryStore();
    service = buildService(store);
  });

  it('usuário sem nenhuma Membership: 200-shape, hasEstablishmentAccess=false, nunca lança', async () => {
    const user = store.seedUser({ status: UserStatus.ACTIVE });

    const result = await service.getSessionContext(user.id);

    expect(result.activeContext).toBeNull();
    expect(result.contexts).toHaveLength(0);
    expect(result.requiresTenantSelection).toBe(false);
    expect(result.hasEstablishmentAccess).toBe(false);
    expect(result.user.id).toBe(user.id);
  });

  it('exatamente 1 vínculo ativo: activeContext preenchido com todos os campos exigidos', async () => {
    const user = store.seedUser({ status: UserStatus.ACTIVE });
    const plan = store.seedPlan({ code: 'equipe', name: 'Gestão' });
    const tenant = store.seedTenant({ status: TenantStatus.TRIAL, planId: plan.id, slug: 'studio-bela' });
    const unit = store.seedUnit({ tenantId: tenant.id, isPrimary: true, name: 'Studio Bela' });
    const membership = store.seedMembership({
      userId: user.id,
      tenantId: tenant.id,
      role: EstablishmentRole.DONO,
    });

    const result = await service.getSessionContext(user.id);

    expect(result.requiresTenantSelection).toBe(false);
    expect(result.hasEstablishmentAccess).toBe(true);
    expect(result.activeContext).toEqual({
      membershipId: membership.id,
      tenantId: tenant.id,
      tenantName: unit.name,
      tenantSlug: tenant.slug,
      role: EstablishmentRole.DONO,
      unit: { id: unit.id, name: unit.name, isPrimary: true },
      planCode: plan.code,
      planName: plan.name,
      trial: {
        trialStartAt: tenant.createdAt,
        trialEndAt: new Date(tenant.createdAt.getTime() + TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000),
        durationDays: TRIAL_DURATION_DAYS,
      },
      tenantStatus: TenantStatus.TRIAL,
    });
  });

  it('2 vínculos ativos: activeContext=null, requiresTenantSelection=true, lista com os dois, nunca escolhe o primeiro', async () => {
    const user = store.seedUser({ status: UserStatus.ACTIVE });
    const plan = store.seedPlan({ code: 'equipe' });
    const tenantA = store.seedTenant({ status: TenantStatus.TRIAL, planId: plan.id, slug: 'estudio-a' });
    const tenantB = store.seedTenant({ status: TenantStatus.ACTIVE, planId: plan.id, slug: 'estudio-b' });
    store.seedUnit({ tenantId: tenantA.id, isPrimary: true, name: 'Estúdio A' });
    store.seedUnit({ tenantId: tenantB.id, isPrimary: true, name: 'Estúdio B' });
    store.seedMembership({ userId: user.id, tenantId: tenantA.id, role: EstablishmentRole.DONO });
    store.seedMembership({ userId: user.id, tenantId: tenantB.id, role: EstablishmentRole.GERENTE });

    const result = await service.getSessionContext(user.id);

    expect(result.activeContext).toBeNull();
    expect(result.requiresTenantSelection).toBe(true);
    expect(result.hasEstablishmentAccess).toBe(true);
    expect(result.contexts).toHaveLength(2);
    expect(result.contexts.map((c) => c.tenantId).sort()).toEqual([tenantA.id, tenantB.id].sort());
  });

  it('tenant SUSPENDED não aparece na lista de contexts', async () => {
    const user = store.seedUser({ status: UserStatus.ACTIVE });
    const plan = store.seedPlan({ code: 'equipe' });
    const tenantAtivo = store.seedTenant({ status: TenantStatus.TRIAL, planId: plan.id, slug: 'ativo' });
    const tenantSuspenso = store.seedTenant({
      status: TenantStatus.SUSPENDED,
      planId: plan.id,
      slug: 'suspenso',
    });
    store.seedUnit({ tenantId: tenantAtivo.id, isPrimary: true, name: 'Ativo' });
    store.seedUnit({ tenantId: tenantSuspenso.id, isPrimary: true, name: 'Suspenso' });
    store.seedMembership({ userId: user.id, tenantId: tenantAtivo.id, role: EstablishmentRole.DONO });
    store.seedMembership({ userId: user.id, tenantId: tenantSuspenso.id, role: EstablishmentRole.DONO });

    const result = await service.getSessionContext(user.id);

    expect(result.contexts).toHaveLength(1);
    expect(result.contexts[0].tenantId).toBe(tenantAtivo.id);
    expect(result.requiresTenantSelection).toBe(false);
    expect(result.activeContext?.tenantId).toBe(tenantAtivo.id);
  });

  it('resposta nunca inclui passwordHash, tokenHash ou dado de Credential/Session', async () => {
    const user = store.seedUser({ status: UserStatus.ACTIVE });
    const plan = store.seedPlan({ code: 'equipe' });
    const tenant = store.seedTenant({ status: TenantStatus.TRIAL, planId: plan.id });
    store.seedUnit({ tenantId: tenant.id, isPrimary: true });
    store.seedMembership({ userId: user.id, tenantId: tenant.id, role: EstablishmentRole.DONO });

    const result = await service.getSessionContext(user.id);
    const serialized = JSON.stringify(result).toLowerCase();

    expect(serialized).not.toContain('passwordhash');
    expect(serialized).not.toContain('tokenhash');
    expect(serialized).not.toContain('credential');
  });

  it('nunca escreve nada no store (só leitura)', async () => {
    const user = store.seedUser({ status: UserStatus.ACTIVE });
    const antes = store.countAll();

    await service.getSessionContext(user.id);

    expect(store.countAll()).toBe(antes);
  });
});
