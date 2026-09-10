import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { TenantStatus } from '../entities/enums/tenant-status.enum.js';
import { UserStatus } from '../entities/enums/user-status.enum.js';
import { AmbiguousSessionContextError, InvalidCredentialsError } from './auth.errors.js';
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
  for (let i = 0; i < membershipCount; i++) {
    store.seedMembership({
      userId: user.id,
      tenantId: i === 0 ? tenant.id : store.seedTenant({ slug: `outro-${i}` }).id,
      role: EstablishmentRole.DONO,
    });
  }

  return { user, tenant, plan };
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

  it('credenciais válidas: cria sessão nova e retorna contexto completo', async () => {
    const { tenant, plan } = await seedFullAccount(store);

    const result = await service.login(VALID_DTO, { now: NOW });

    expect(result.user.email).toBe(VALID_DTO.email);
    expect(result.tenant.id).toBe(tenant.id);
    expect(result.plan.code).toBe(plan.code);
    expect(result.membership.role).toBe(EstablishmentRole.DONO);
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

  it('tenant inativo (SUSPENDED) é recusado com o mesmo erro genérico', async () => {
    await seedFullAccount(store, { tenantStatus: TenantStatus.SUSPENDED });
    await expect(service.login(VALID_DTO, { now: NOW })).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
  });

  it('nenhuma sessão é criada quando o login é recusado', async () => {
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

  it('usuário com zero memberships: erro controlado (AmbiguousSessionContextError), nunca 401 disfarçado de sucesso', async () => {
    await seedFullAccount(store, { membershipCount: 0 });
    await expect(service.login(VALID_DTO, { now: NOW })).rejects.toBeInstanceOf(
      AmbiguousSessionContextError,
    );
  });

  it('usuário com múltiplos memberships: erro controlado, nunca escolhe um tenant arbitrário', async () => {
    await seedFullAccount(store, { membershipCount: 2 });
    await expect(service.login(VALID_DTO, { now: NOW })).rejects.toBeInstanceOf(
      AmbiguousSessionContextError,
    );
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
