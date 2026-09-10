import { beforeEach, describe, expect, it } from 'vitest';
import { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { AuditAction } from '../entities/enums/audit-action.enum.js';
import { AuthService, MAX_SLUG_SAVE_RETRIES } from './auth.service.js';
import { EmailAlreadyInUseError, PlanUnavailableError } from './auth.errors.js';
import { CREDENTIAL_ALGORITHM, verifyPassword } from './password-hasher.js';
import { hashSessionToken } from './session-token.js';
import { TRIAL_DURATION_DAYS } from './trial-policy.js';
import { createFakeDataSource, InMemoryStore } from './testing/in-memory-data-source.js';
import type { RegisterDto } from './register.dto.js';

const NOW = new Date('2026-09-10T12:00:00.000Z');

const VALID_DTO: RegisterDto = {
  ownerName: 'Maria Souza',
  businessName: 'Studio Bela',
  email: 'maria@example.com',
  phone: '+5511987654321',
  password: 'senha-valida-123',
};

function buildService(store: InMemoryStore): AuthService {
  return new AuthService(createFakeDataSource(store));
}

describe('AuthService.register', () => {
  let store: InMemoryStore;
  let service: AuthService;

  beforeEach(() => {
    store = new InMemoryStore();
    store.seedPlan({ code: 'equipe', name: 'Gestão', priceCents: null });
    service = buildService(store);
  });

  it('seleciona o plano interno equipe e retorna o nome comercial Gestão', async () => {
    const result = await service.register(VALID_DTO, { now: NOW });
    expect(result.plan.code).toBe('equipe');
    expect(result.plan.name).toBe('Gestão');
  });

  it('preço NULL do plano não causa falha', async () => {
    const result = await service.register(VALID_DTO, { now: NOW });
    expect(result.plan.priceCents).toBeNull();
  });

  it('trial começa exatamente no instante controlado', async () => {
    const result = await service.register(VALID_DTO, { now: NOW });
    expect(result.trial.trialStartAt).toEqual(NOW);
  });

  it('trial termina exatamente 14 dias depois', async () => {
    const result = await service.register(VALID_DTO, { now: NOW });
    expect(result.trial.trialEndAt.toISOString()).toBe('2026-09-24T12:00:00.000Z');
    expect(result.trial.durationDays).toBe(TRIAL_DURATION_DAYS);
  });

  it('datas do trial são objetos Date em UTC (ISO)', async () => {
    const result = await service.register(VALID_DTO, { now: NOW });
    expect(result.trial.trialStartAt.toISOString()).toBe(NOW.toISOString());
  });

  it('cria User sem privilégios de plataforma (platformRole indefinido)', async () => {
    await service.register(VALID_DTO, { now: NOW });
    const [user] = [...store.liveUsers()];
    expect(user.platformRole).toBeUndefined();
  });

  it('cria a Unit principal marcada como isPrimary', async () => {
    const result = await service.register(VALID_DTO, { now: NOW });
    expect(result.unit.isPrimary).toBe(true);
    expect(result.unit.name).toBe(VALID_DTO.businessName);
  });

  it('cria Membership com papel DONO (equivalente ao "MASTER_OWNER" do domínio)', async () => {
    const result = await service.register(VALID_DTO, { now: NOW });
    expect(result.membership.role).toBe(EstablishmentRole.DONO);
  });

  it('cria Session com token aleatório e persiste somente o hash', async () => {
    const result = await service.register(VALID_DTO, { now: NOW });
    const [session] = [...store.liveSessions()];
    expect(session.tokenHash).toBe(hashSessionToken(result.token));
    expect((session as unknown as Record<string, unknown>).token).toBeUndefined();
  });

  it('resposta pública nunca inclui passwordHash, tokenHash ou o token de sessão fora do campo dedicado', async () => {
    const result = await service.register(VALID_DTO, { now: NOW });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('passwordHash');
    expect(serialized).not.toContain(hashSessionToken(result.token));
  });

  it('persiste Credential.algorithm como argon2id e nunca a senha em texto puro', async () => {
    await service.register(VALID_DTO, { now: NOW });
    const [credential] = [...store.liveCredentials()];

    expect(credential.algorithm).toBe(CREDENTIAL_ALGORITHM);
    expect(credential.passwordHash).not.toBe(VALID_DTO.password);
    expect(credential.passwordHash.startsWith('$argon2id$')).toBe(true);
    await expect(verifyPassword(credential.passwordHash, VALID_DTO.password)).resolves.toBe(
      true,
    );
  });

  it('cria AuditLog sem senha ou token', async () => {
    await service.register(VALID_DTO, { now: NOW });
    const [auditLog] = [...store.liveAuditLogs()];
    expect(auditLog.action).toBe(AuditAction.TENANT_CREATED);
    const serialized = JSON.stringify(auditLog);
    expect(serialized).not.toContain(VALID_DTO.password);
    expect(serialized.toLowerCase()).not.toContain('passwordhash');
    expect(serialized.toLowerCase()).not.toContain('tokenhash');
  });

  it('rejeita e-mail já cadastrado com EmailAlreadyInUseError e não persiste nada', async () => {
    store.seedUser({ email: VALID_DTO.email });
    const antes = store.countAll();

    await expect(service.register(VALID_DTO, { now: NOW })).rejects.toBeInstanceOf(
      EmailAlreadyInUseError,
    );
    expect(store.countAll()).toBe(antes);
  });

  it('rejeita quando o plano equipe não existe, sem criar nada (rollback)', async () => {
    const storeVazio = new InMemoryStore();
    const servicoSemPlano = buildService(storeVazio);

    await expect(
      servicoSemPlano.register(VALID_DTO, { now: NOW }),
    ).rejects.toBeInstanceOf(PlanUnavailableError);
    expect(storeVazio.countAll()).toBe(0);
  });

  it('falha em etapa intermediária faz rollback total (nada fica parcialmente criado)', async () => {
    store.onAfterSlugCheck = () => {
      throw new Error('falha simulada no meio da transação');
    };

    await expect(service.register(VALID_DTO, { now: NOW })).rejects.toThrow(
      'falha simulada no meio da transação',
    );
    expect(store.countAll()).toBe(0);
  });

  it('slug simples é usado quando não há colisão', async () => {
    const result = await service.register(VALID_DTO, { now: NOW });
    expect(result.tenant.slug).toBe('studio-bela');
  });

  it('resolve colisão de slug com sufixo determinístico', async () => {
    store.seedTenant({ slug: 'studio-bela' });
    const result = await service.register(VALID_DTO, { now: NOW });
    expect(result.tenant.slug).toBe('studio-bela-2');
  });

  it('trata corrida de slug: outro processo cria o mesmo slug entre a checagem e o save', async () => {
    let jaSimulou = false;
    store.onAfterSlugCheck = () => {
      if (!jaSimulou) {
        jaSimulou = true;
        store.seedTenant({ slug: 'studio-bela' });
      }
    };

    const result = await service.register(VALID_DTO, { now: NOW });
    expect(result.tenant.slug).not.toBe('studio-bela');
    expect(store.countAll()).toBeGreaterThan(0);
  });

  it('trata corrida de e-mail: outro processo cadastra o mesmo e-mail entre a checagem e o save', async () => {
    store.onAfterEmailCheck = () => {
      store.seedUser({ email: VALID_DTO.email });
    };

    await expect(service.register(VALID_DTO, { now: NOW })).rejects.toBeInstanceOf(
      EmailAlreadyInUseError,
    );
  });

  describe('retry seguro após violação 23505 (transação abortada)', () => {
    it('colisão real de slug no save (corrida entre checagem e insert) abre uma transação NOVA, sem reaproveitar o EntityManager abortado', async () => {
      let jaColidiu = false;
      store.onBeforeTenantSave = () => {
        if (!jaColidiu) {
          jaColidiu = true;
          // Simula outro processo commitando o mesmo slug depois que o
          // `resolveSlug` desta tentativa já checou (achou livre) — só o
          // `save` real descobre a colisão, igual ao Postgres.
          store.seedTenant({ slug: 'studio-bela' });
        }
      };

      const result = await service.register(VALID_DTO, { now: NOW });

      expect(result.tenant.slug).toBe('studio-bela-2');
      // Prova estrutural: uma segunda transação foi aberta de verdade.
      expect(store.transactionCount).toBe(2);
      // Prova estrutural: nada da tentativa abortada (o primeiro User criado
      // antes da colisão) sobrevive fora da tentativa vencedora.
      const usersComEsseEmail = [...store.liveUsers()].filter(
        (u) => u.email === VALID_DTO.email,
      );
      expect(usersComEsseEmail).toHaveLength(1);
    });

    it('colisão de e-mail nunca reabre transação (não é uma colisão de slug)', async () => {
      store.onAfterEmailCheck = () => {
        store.seedUser({ email: VALID_DTO.email });
      };

      await expect(service.register(VALID_DTO, { now: NOW })).rejects.toBeInstanceOf(
        EmailAlreadyInUseError,
      );
      expect(store.transactionCount).toBe(1);
    });

    it('erro desconhecido no meio da transação nunca reabre transação', async () => {
      store.onAfterSlugCheck = () => {
        throw new Error('falha simulada no meio da transação');
      };

      await expect(service.register(VALID_DTO, { now: NOW })).rejects.toThrow(
        'falha simulada no meio da transação',
      );
      expect(store.transactionCount).toBe(1);
    });

    it('após esgotar as tentativas de colisão real de slug, retorna erro controlado e não deixa dado parcial', async () => {
      store.onBeforeTenantSave = (slug) => {
        // Sempre colide, não importa o candidato — força esgotar o limite.
        store.seedTenant({ slug });
      };

      await expect(service.register(VALID_DTO, { now: NOW })).rejects.toThrow();

      expect(store.transactionCount).toBe(MAX_SLUG_SAVE_RETRIES);
      const usersComEsseEmail = [...store.liveUsers()].filter(
        (u) => u.email === VALID_DTO.email,
      );
      expect(usersComEsseEmail).toHaveLength(0);
    });
  });
});
