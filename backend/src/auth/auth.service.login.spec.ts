import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { TenantStatus } from '../entities/enums/tenant-status.enum.js';
import { UserStatus } from '../entities/enums/user-status.enum.js';
import { InvalidCredentialsError } from './auth.errors.js';
import { AuthService } from './auth.service.js';
import * as passwordHasher from './password-hasher.js';
import { DUMMY_PASSWORD_HASH, hashPassword } from './password-hasher.js';
import { hashSessionToken } from './session-token.js';
import { createFakeDataSource, InMemoryStore } from './testing/in-memory-data-source.js';
import type { LoginDto } from './login.dto.js';

const NOW = new Date('2026-09-10T12:00:00.000Z');
const REAL_PASSWORD = 'senha-real-do-usuario-123';

function buildService(store: InMemoryStore): AuthService {
  return new AuthService(createFakeDataSource(store));
}

async function seedFullAccount(
  store: InMemoryStore,
  overrides: {
    userStatus?: UserStatus;
    tenantStatus?: TenantStatus;
    algorithm?: string;
    membershipCount?: 0 | 1 | 2;
  } = {},
) {
  const user = store.seedUser({
    email: 'maria@example.com',
    status: overrides.userStatus ?? UserStatus.ACTIVE,
  });
  await store.seedCredential({
    userId: user.id,
    passwordHash: await hashPassword(REAL_PASSWORD),
    algorithm: overrides.algorithm ?? 'argon2id',
  });
  const plan = store.seedPlan({ code: 'equipe', name: 'Gestão' });
  const tenant = store.seedTenant({
    slug: 'studio-bela',
    status: overrides.tenantStatus ?? TenantStatus.TRIAL,
    planId: plan.id,
  });
  store.seedUnit({ tenantId: tenant.id, isPrimary: true, name: 'Studio Bela' });

  const membershipCount = overrides.membershipCount ?? 1;
  const extraTenants = [];
  for (let i = 0; i < membershipCount; i++) {
    let tenantIdForMembership = tenant.id;
    if (i > 0) {
      const outro = store.seedTenant({ slug: `outro-${i}`, planId: plan.id });
      store.seedUnit({ tenantId: outro.id, isPrimary: true, name: `Outro ${i}` });
      extraTenants.push(outro);
      tenantIdForMembership = outro.id;
    }
    store.seedMembership({
      userId: user.id,
      tenantId: tenantIdForMembership,
      role: EstablishmentRole.DONO,
    });
  }

  return { user, tenant, plan, extraTenants };
}

const VALID_DTO: LoginDto = {
  email: 'maria@example.com',
  password: REAL_PASSWORD,
};

describe('AuthService.login', () => {
  let store: InMemoryStore;
  let service: AuthService;

  beforeEach(() => {
    store = new InMemoryStore();
    service = buildService(store);
    vi.restoreAllMocks();
  });

  it('credenciais válidas com 1 vínculo: cria sessão e devolve activeContext preenchido', async () => {
    const { tenant, plan } = await seedFullAccount(store);

    const result = await service.login(VALID_DTO, { now: NOW });

    expect(result.user.email).toBe(VALID_DTO.email);
    expect(result.activeContext?.tenantId).toBe(tenant.id);
    expect(result.activeContext?.planCode).toBe(plan.code);
    expect(result.activeContext?.role).toBe(EstablishmentRole.DONO);
    expect(result.requiresTenantSelection).toBe(false);
    expect(result.hasEstablishmentAccess).toBe(true);
  });

  it('persiste só o tokenHash da nova sessão, nunca o token puro', async () => {
    await seedFullAccount(store);

    const result = await service.login(VALID_DTO, { now: NOW });
    const sessions = [...store.liveSessions()];

    expect(sessions).toHaveLength(1);
    expect(sessions[0].tokenHash).toBe(hashSessionToken(result.token));
    expect((sessions[0] as unknown as Record<string, unknown>).token).toBeUndefined();
  });

  it('resposta pública nunca inclui passwordHash, tokenHash ou o token fora do campo dedicado', async () => {
    await seedFullAccount(store);
    const result = await service.login(VALID_DTO, { now: NOW });
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain('passwordHash');
    expect(serialized).not.toContain(hashSessionToken(result.token));
  });

  it('e-mail inexistente é rejeitado com a MESMA InvalidCredentialsError da senha errada', async () => {
    await seedFullAccount(store);

    const [semUsuario, senhaErrada] = await Promise.allSettled([
      service.login({ email: 'nao-cadastrado@example.com', password: REAL_PASSWORD }, { now: NOW }),
      service.login({ ...VALID_DTO, password: 'senha-errada-mas-valida' }, { now: NOW }),
    ]);

    expect(semUsuario.status).toBe('rejected');
    expect(senhaErrada.status).toBe('rejected');
    const reasonA = semUsuario.status === 'rejected' ? semUsuario.reason : undefined;
    const reasonB = senhaErrada.status === 'rejected' ? senhaErrada.reason : undefined;
    expect(reasonA).toBeInstanceOf(InvalidCredentialsError);
    expect(reasonB).toBeInstanceOf(InvalidCredentialsError);
    expect((reasonA as Error).message).toBe((reasonB as Error).message);
  });

  it('nunca inclui a senha enviada na mensagem de erro', async () => {
    await seedFullAccount(store);
    try {
      await service.login({ ...VALID_DTO, password: 'senha-errada-mas-valida' }, { now: NOW });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain('senha-errada-mas-valida');
    }
  });

  it('e-mail inexistente ainda executa verify() contra o hash fictício (mitiga timing)', async () => {
    const verifySpy = vi.spyOn(passwordHasher, 'verifyPassword');

    await expect(
      service.login({ email: 'nunca-existiu@example.com', password: REAL_PASSWORD }, { now: NOW }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);

    expect(verifySpy).toHaveBeenCalledTimes(1);
    expect(verifySpy).toHaveBeenCalledWith(DUMMY_PASSWORD_HASH, REAL_PASSWORD);
  });

  it('algoritmo de credencial desconhecido usa o hash fictício e é recusado genericamente', async () => {
    await seedFullAccount(store, { algorithm: 'bcrypt' });
    const verifySpy = vi.spyOn(passwordHasher, 'verifyPassword');

    await expect(service.login(VALID_DTO, { now: NOW })).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
    expect(verifySpy).toHaveBeenCalledWith(DUMMY_PASSWORD_HASH, REAL_PASSWORD);
  });

  it('usuário inativo (SUSPENDED) é recusado com o mesmo erro genérico', async () => {
    await seedFullAccount(store, { userStatus: UserStatus.SUSPENDED });
    await expect(service.login(VALID_DTO, { now: NOW })).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
  });

  it('tenant inativo (SUSPENDED) NÃO invalida a identidade: login sucede sem contexto ativo', async () => {
    await seedFullAccount(store, { tenantStatus: TenantStatus.SUSPENDED });

    const result = await service.login(VALID_DTO, { now: NOW });

    expect(result.activeContext).toBeNull();
    expect(result.contexts).toHaveLength(0);
    expect(result.hasEstablishmentAccess).toBe(false);
    expect(result.requiresTenantSelection).toBe(false);
  });

  it('nenhuma sessão é criada quando o login é recusado (identidade inválida)', async () => {
    await seedFullAccount(store, { userStatus: UserStatus.SUSPENDED });
    await expect(service.login(VALID_DTO, { now: NOW })).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
    expect([...store.liveSessions()]).toHaveLength(0);
  });

  it('rollback (falha inesperada) nunca deixa sessão parcial persistida', async () => {
    await seedFullAccount(store);
    store.onAfterEmailCheck = () => {
      throw new Error('falha simulada');
    };
    await expect(service.login(VALID_DTO, { now: NOW })).rejects.toThrow('falha simulada');
    expect([...store.liveSessions()]).toHaveLength(0);
  });

  it('usuário com zero memberships: login SUCEDE (identidade válida), sem contexto ativo', async () => {
    await seedFullAccount(store, { membershipCount: 0 });

    const result = await service.login(VALID_DTO, { now: NOW });

    expect(result.activeContext).toBeNull();
    expect(result.contexts).toHaveLength(0);
    expect(result.hasEstablishmentAccess).toBe(false);
    expect(result.requiresTenantSelection).toBe(false);
    expect([...store.liveSessions()]).toHaveLength(1);
  });

  it('usuário com múltiplos memberships: login SUCEDE, requiresTenantSelection=true, nunca escolhe um tenant arbitrário', async () => {
    const { tenant, extraTenants } = await seedFullAccount(store, { membershipCount: 2 });

    const result = await service.login(VALID_DTO, { now: NOW });

    expect(result.activeContext).toBeNull();
    expect(result.requiresTenantSelection).toBe(true);
    expect(result.hasEstablishmentAccess).toBe(true);
    expect(result.contexts).toHaveLength(2);
    const tenantIds = result.contexts.map((c) => c.tenantId).sort();
    expect(tenantIds).toEqual([tenant.id, extraTenants[0].id].sort());
  });

  it('cada login gera um token novo — nunca fixação (dois logins seguidos nunca compartilham token)', async () => {
    await seedFullAccount(store);
    const first = await service.login(VALID_DTO, { now: NOW });
    const second = await service.login(VALID_DTO, { now: NOW });

    expect(first.token).not.toBe(second.token);
    const sessions = [...store.liveSessions()];
    expect(sessions).toHaveLength(2);
  });
});
