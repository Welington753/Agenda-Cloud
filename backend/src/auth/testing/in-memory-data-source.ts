// Infraestrutura de teste (não é código de produção) — simula `DataSource` e
// `EntityManager` do TypeORM em memória, sem rede, para testar `AuthService`
// isoladamente. Reproduz só o subconjunto de comportamento que o serviço usa:
// `transaction` (com rollback real — nada é commitado no `InMemoryStore` até
// o callback terminar sem lançar), `findOne`, `create`, `save` — incluindo
// violação de UNIQUE CONSTRAINT (email/slug/tokenHash) lançando o mesmo
// `QueryFailedError` real do TypeORM, para o serviço ser testado contra o
// mesmo tipo de erro que veria em produção.
import { QueryFailedError, type DataSource, type EntityManager } from 'typeorm';
import { Credential } from '../../entities/credential.entity.js';
import { Membership } from '../../entities/membership.entity.js';
import { Plan } from '../../entities/plan.entity.js';
import { Session } from '../../entities/session.entity.js';
import { Tenant } from '../../entities/tenant.entity.js';
import { Unit } from '../../entities/unit.entity.js';
import { User } from '../../entities/user.entity.js';
import { AuditLog } from '../../entities/audit-log.entity.js';
import { generateId } from '../../entities/common/generate-id.js';

type EntityCtor = new () => object;

interface UniqueRule {
  constraintName: string;
  fields: string[];
}

const UNIQUE_RULES = new Map<EntityCtor, UniqueRule[]>([
  [User, [{ constraintName: 'uq_users_email', fields: ['email'] }]],
  [Tenant, [{ constraintName: 'uq_tenants_slug', fields: ['slug'] }]],
  [Session, [{ constraintName: 'uq_sessions_token_hash', fields: ['tokenHash'] }]],
]);

function buildUniqueViolation(constraintName: string): QueryFailedError {
  const driverError = { code: '23505', constraint: constraintName } as unknown as Error;
  return new QueryFailedError('INSERT ...', [], driverError);
}

type EntityMapName =
  | 'users'
  | 'credentials'
  | 'tenants'
  | 'units'
  | 'memberships'
  | 'sessions'
  | 'auditLogs'
  | 'plans';

function mapNameFor(entity: object): EntityMapName | undefined {
  if (entity instanceof User) return 'users';
  if (entity instanceof Credential) return 'credentials';
  if (entity instanceof Tenant) return 'tenants';
  if (entity instanceof Unit) return 'units';
  if (entity instanceof Membership) return 'memberships';
  if (entity instanceof Session) return 'sessions';
  if (entity instanceof AuditLog) return 'auditLogs';
  if (entity instanceof Plan) return 'plans';
  return undefined;
}

class Snapshot {
  users = new Map<string, User>();
  credentials = new Map<string, Credential>();
  tenants = new Map<string, Tenant>();
  units = new Map<string, Unit>();
  memberships = new Map<string, Membership>();
  sessions = new Map<string, Session>();
  auditLogs = new Map<string, AuditLog>();
  plans = new Map<string, Plan>();

  mapFor(name: EntityMapName): Map<string, object> {
    return this[name];
  }
}

export class InMemoryStore {
  private committed = new Snapshot();

  /** Incrementado a cada `beginTransaction()` — prova estrutural de que uma
   * colisão de slug abre uma transação NOVA (contador sobe), nunca reaproveita
   * a mesma (ver `auth.service.ts`, retry via `DataSource.transaction`). */
  transactionCount = 0;

  /** Executado logo após o `findOne` de verificação de e-mail dentro do
   * serviço, antes do `save` — permite simular outro processo inserindo uma
   * linha concorrente entre a checagem e a escrita (corrida real). */
  onAfterEmailCheck?: () => void;
  /** Mesma ideia, para a corrida de slug — dispara na checagem
   * (`resolveSlug`), antes do `save` do Tenant. */
  onAfterSlugCheck?: () => void;
  /** Dispara dentro de `TransactionScope.save` para `Tenant`, IMEDIATAMENTE
   * antes da checagem de unicidade que antecede o INSERT — simula um processo
   * concorrente commitando entre a checagem de `resolveSlug` e o `save` desta
   * transação (janela diferente de `onAfterSlugCheck`), forçando uma violação
   * 23505 real na hora do `save`, não na checagem prévia. */
  onBeforeTenantSave?: (candidateSlug: string) => void;

  get plans() {
    return this.committed.plans;
  }

  countAll(): number {
    return (
      this.committed.users.size +
      this.committed.credentials.size +
      this.committed.tenants.size +
      this.committed.units.size +
      this.committed.memberships.size +
      this.committed.sessions.size +
      this.committed.auditLogs.size
    );
  }

  liveUsers(): IterableIterator<User> {
    return this.committed.users.values();
  }

  liveCredentials(): IterableIterator<Credential> {
    return this.committed.credentials.values();
  }

  liveSessions(): IterableIterator<Session> {
    return this.committed.sessions.values();
  }

  liveAuditLogs(): IterableIterator<AuditLog> {
    return this.committed.auditLogs.values();
  }

  liveMemberships(): IterableIterator<Membership> {
    return this.committed.memberships.values();
  }

  liveTenants(): IterableIterator<Tenant> {
    return this.committed.tenants.values();
  }

  liveUnits(): IterableIterator<Unit> {
    return this.committed.units.values();
  }

  seedPlan(overrides: Partial<Plan> = {}): Plan {
    const plan = Object.assign(new Plan(), {
      id: generateId(),
      code: 'equipe',
      name: 'Gestão',
      priceCents: null,
      shortDescription: 'Plano Gestão',
      maxProfessionals: 5,
      maxUnits: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    });
    this.committed.plans.set(plan.id, plan);
    return plan;
  }

  seedUser(overrides: Partial<User> = {}): User {
    const user = Object.assign(new User(), {
      id: generateId(),
      name: 'Existente',
      email: 'existente@example.com',
      emailVerified: false,
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    });
    this.committed.users.set(user.id, user as User);
    return user as User;
  }

  seedTenant(overrides: Partial<Tenant> = {}): Tenant {
    const tenant = Object.assign(new Tenant(), {
      id: generateId(),
      slug: 'existente',
      category: 'OTHER',
      timezone: 'America/Sao_Paulo',
      planId: 'plan_x',
      status: 'TRIAL',
      professionalCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    });
    this.committed.tenants.set(tenant.id, tenant as Tenant);
    return tenant as Tenant;
  }

  seedCredential(overrides: Partial<Credential> = {}): Credential {
    const credential = Object.assign(new Credential(), {
      id: generateId(),
      userId: 'user_x',
      passwordHash: '$argon2id$fake$',
      algorithm: 'argon2id',
      updatedAt: new Date(),
      ...overrides,
    });
    this.committed.credentials.set(credential.id, credential as Credential);
    return credential as Credential;
  }

  seedMembership(overrides: Partial<Membership> = {}): Membership {
    const membership = Object.assign(new Membership(), {
      id: generateId(),
      userId: 'user_x',
      tenantId: 'tenant_x',
      role: 'DONO',
      createdAt: new Date(),
      ...overrides,
    });
    this.committed.memberships.set(membership.id, membership as Membership);
    return membership as Membership;
  }

  seedUnit(overrides: Partial<Unit> = {}): Unit {
    const unit = Object.assign(new Unit(), {
      id: generateId(),
      tenantId: 'tenant_x',
      name: 'Unidade Principal',
      address: '',
      timezone: 'America/Sao_Paulo',
      isPrimary: true,
      createdAt: new Date(),
      ...overrides,
    });
    this.committed.units.set(unit.id, unit as Unit);
    return unit as Unit;
  }

  seedSession(overrides: Partial<Session> = {}): Session {
    const session = Object.assign(new Session(), {
      id: generateId(),
      userId: 'user_x',
      tokenHash: 'hash-fake',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      ...overrides,
    });
    this.committed.sessions.set(session.id, session as Session);
    return session as Session;
  }

  /** Instância isolada de trabalho para uma transação — começa como cópia do
   * estado commitado; escritas ficam só aqui até `merge()`. */
  beginTransaction(): TransactionScope {
    this.transactionCount++;
    const working = new Snapshot();
    for (const key of Object.keys(this.committed) as EntityMapName[]) {
      working[key] = new Map(this.committed[key]);
    }
    return new TransactionScope(working, this);
  }

  /** Só chamado por `TransactionScope.commit()` — nunca diretamente. */
  replaceCommitted(snapshot: Snapshot): void {
    this.committed = snapshot;
  }

  /** Estado commitado "ao vivo" (não a foto tirada no início da transação) —
   * usado só pela checagem de UNIQUE CONSTRAINT em `TransactionScope.save`,
   * pelo mesmo motivo do Postgres real: o índice único é checado contra o
   * dado commitado no instante do INSERT, não contra uma foto de início de
   * transação. É assim que o teste de corrida (outro processo commita entre a
   * checagem e o `save` desta transação) consegue provar que o serviço trata
   * a violação em vez de deixar dois registros conflitantes passarem. */
  liveCommittedMapFor(name: EntityMapName): ReadonlyMap<string, object> {
    return this.committed.mapFor(name);
  }
}

/** Mesmo texto do Postgres real (`25P02`) para uma transação que já sofreu
 * erro e não recebeu `ROLLBACK`/`ROLLBACK TO SAVEPOINT` — qualquer comando
 * novo nela é recusado até o fim da transação. */
const ABORTED_TRANSACTION_MESSAGE =
  'current transaction is aborted, commands ignored until end of transaction block';

export class TransactionScope {
  /** Vira `true` assim que este scope lança uma violação de UNIQUE CONSTRAINT
   * — a partir daí, qualquer novo `findOne`/`save`/`commit` nele falha, igual
   * ao Postgres real. Prova estrutural de que o serviço nunca reaproveita o
   * `EntityManager` de uma transação já abortada (ver auth.service.spec.ts). */
  private aborted = false;

  constructor(
    private readonly working: Snapshot,
    private readonly store: InMemoryStore,
  ) {}

  private assertNotAborted(): void {
    if (this.aborted) {
      throw new Error(ABORTED_TRANSACTION_MESSAGE);
    }
  }

  findOne<T extends object>(
    EntityClass: EntityCtor,
    options: { where: Record<string, unknown> },
  ): T | null {
    this.assertNotAborted();
    const name = mapNameFor(new EntityClass());
    if (!name) throw new Error(`Fake findOne não suporta ${EntityClass.name}`);

    if (EntityClass === User && 'email' in options.where) {
      this.store.onAfterEmailCheck?.();
    }
    if (EntityClass === Tenant && 'slug' in options.where) {
      this.store.onAfterSlugCheck?.();
    }

    // Lê o overlay da transação e o commitado "ao vivo" (não a foto do início
    // da transação) — mesmo motivo do `save`: READ COMMITTED real enxerga
    // linhas já commitadas por outra transação a qualquer momento.
    const candidates = [
      ...this.working.mapFor(name).values(),
      ...this.store.liveCommittedMapFor(name).values(),
    ];
    for (const entity of candidates) {
      const matches = Object.entries(options.where).every(
        ([key, value]) => (entity as Record<string, unknown>)[key] === value,
      );
      if (matches) return entity as T;
    }
    return null;
  }

  find<T extends object>(
    EntityClass: EntityCtor,
    options: { where: Record<string, unknown> },
  ): T[] {
    this.assertNotAborted();
    const name = mapNameFor(new EntityClass());
    if (!name) throw new Error(`Fake find não suporta ${EntityClass.name}`);

    // Dedup por id: linhas não tocadas nesta transação existem tanto em
    // `working` (cópia feita no início da transação) quanto no commitado "ao
    // vivo" — sem isto, `find` devolveria cada uma duas vezes. `working`
    // ganha (é a versão mais atual desta transação); só entra do commitado o
    // que `working` ainda não tem (linha só visível por corrida — outro
    // processo commitou depois do início desta transação).
    const byId = new Map<string, object>();
    for (const entity of this.store.liveCommittedMapFor(name).values()) {
      byId.set((entity as Record<string, unknown>).id as string, entity);
    }
    for (const entity of this.working.mapFor(name).values()) {
      byId.set((entity as Record<string, unknown>).id as string, entity);
    }

    return [...byId.values()].filter((entity) =>
      Object.entries(options.where).every(
        ([key, value]) => (entity as Record<string, unknown>)[key] === value,
      ),
    ) as T[];
  }

  save<T extends object>(entity: T): T {
    this.assertNotAborted();
    const name = mapNameFor(entity);
    if (!name) throw new Error(`Fake store não conhece a entidade ${entity.constructor.name}`);
    const map = this.working.mapFor(name);

    if (entity instanceof Tenant) {
      this.store.onBeforeTenantSave?.((entity as unknown as Tenant).slug);
    }

    const rules = UNIQUE_RULES.get(entity.constructor as EntityCtor) ?? [];
    for (const rule of rules) {
      const value = rule.fields.map((f) => (entity as Record<string, unknown>)[f]).join('|');
      const candidates = [...map.values(), ...this.store.liveCommittedMapFor(name).values()];
      for (const existing of candidates) {
        if (existing === (entity as unknown)) continue;
        const existingValue = rule.fields
          .map((f) => (existing as Record<string, unknown>)[f])
          .join('|');
        if (existingValue === value) {
          // Igual ao Postgres real: o erro deixa a transação inteira
          // inutilizável até um ROLLBACK — nenhum comando novo é aceito nela.
          this.aborted = true;
          throw buildUniqueViolation(rule.constraintName);
        }
      }
    }

    const record = entity as Record<string, unknown>;
    record.id ??= generateId();
    if ('createdAt' in record && !record.createdAt) record.createdAt = new Date();
    if ('updatedAt' in record) record.updatedAt = new Date();

    map.set(record.id as string, entity);
    return entity;
  }

  commit(): void {
    this.assertNotAborted();
    this.store.replaceCommitted(this.working);
  }
}

export function createFakeEntityManager(scope: TransactionScope): EntityManager {
  return {
    create<T extends object>(EntityClass: new () => T, partial: Partial<T>): T {
      return Object.assign(new EntityClass(), partial);
    },
    async findOne<T extends object>(
      EntityClass: EntityCtor,
      options: { where: Record<string, unknown> },
    ): Promise<T | null> {
      return scope.findOne<T>(EntityClass, options);
    },
    async find<T extends object>(
      EntityClass: EntityCtor,
      options: { where: Record<string, unknown> },
    ): Promise<T[]> {
      return scope.find<T>(EntityClass, options);
    },
    async save<T extends object>(entity: T): Promise<T> {
      return scope.save(entity);
    },
  } as unknown as EntityManager;
}

/** Manager só-leitura, sem transação — equivalente a `DataSource.manager` no
 * TypeORM real (auto-commit por consulta). Usado pelo guard de sessão, que
 * nunca escreve nada (ver session.guard.ts): ler direto do estado commitado,
 * sem o overhead/estado de uma `TransactionScope`. */
function createReadOnlyFakeEntityManager(store: InMemoryStore): EntityManager {
  return {
    async findOne<T extends object>(
      EntityClass: EntityCtor,
      options: { where: Record<string, unknown> },
    ): Promise<T | null> {
      const name = mapNameFor(new EntityClass());
      if (!name) throw new Error(`Fake findOne não suporta ${EntityClass.name}`);
      for (const entity of store.liveCommittedMapFor(name).values()) {
        const matches = Object.entries(options.where).every(
          ([key, value]) => (entity as Record<string, unknown>)[key] === value,
        );
        if (matches) return entity as T;
      }
      return null;
    },
    async find<T extends object>(
      EntityClass: EntityCtor,
      options: { where: Record<string, unknown> },
    ): Promise<T[]> {
      const name = mapNameFor(new EntityClass());
      if (!name) throw new Error(`Fake find não suporta ${EntityClass.name}`);
      return [...store.liveCommittedMapFor(name).values()].filter((entity) =>
        Object.entries(options.where).every(
          ([key, value]) => (entity as Record<string, unknown>)[key] === value,
        ),
      ) as T[];
    },
  } as unknown as EntityManager;
}

export function createFakeDataSource(store: InMemoryStore): DataSource {
  return {
    get manager(): EntityManager {
      return createReadOnlyFakeEntityManager(store);
    },
    async transaction<T>(runInTransaction: (manager: EntityManager) => Promise<T>): Promise<T> {
      const scope = store.beginTransaction();
      const result = await runInTransaction(createFakeEntityManager(scope));
      scope.commit();
      return result;
    },
  } as unknown as DataSource;
}
