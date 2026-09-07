// Metadata puro de arquitetura — nenhum DataSource é inicializado, nenhuma
// rede é usada. `getMetadataArgsStorage()` é o registro de decorators do
// TypeORM (preenchido só por `import` das classes, nunca por conexão real) —
// ver docs/plans/migracao-nestjs-typeorm-neon.md, seção 13 (Lote 3).
import { describe, expect, it } from 'vitest';
import { getMetadataArgsStorage } from 'typeorm';

import { AppointmentItem } from './appointment-item.entity.js';
import { AppointmentResource } from './appointment-resource.entity.js';
import { AppointmentStatusChange } from './appointment-status-change.entity.js';
import { Appointment } from './appointment.entity.js';
import { AuditLog } from './audit-log.entity.js';
import { BookingPolicy } from './booking-policy.entity.js';
import { BrandIdentity } from './brand-identity.entity.js';
import { CommissionEntry } from './commission-entry.entity.js';
import { CommissionRule } from './commission-rule.entity.js';
import { Consumer } from './consumer.entity.js';
import { Credential } from './credential.entity.js';
import { Feature } from './feature.entity.js';
import { Invite } from './invite.entity.js';
import { MembershipPermissionOverride } from './membership-permission-override.entity.js';
import { Membership } from './membership.entity.js';
import { PlanFeature } from './plan-feature.entity.js';
import { Plan } from './plan.entity.js';
import { ProfessionalSchedule } from './professional-schedule.entity.js';
import { ProfessionalService } from './professional-service.entity.js';
import { Professional } from './professional.entity.js';
import { PublicSettings } from './public-settings.entity.js';
import { Resource } from './resource.entity.js';
import { Service } from './service.entity.js';
import { Session } from './session.entity.js';
import { SupportSession } from './support-session.entity.js';
import { TenantFeatureOverride } from './tenant-feature-override.entity.js';
import { Tenant } from './tenant.entity.js';
import { TimeBlock } from './time-block.entity.js';
import { Unit } from './unit.entity.js';
import { User } from './user.entity.js';

const storage = getMetadataArgsStorage();

function tableNameOf(target: Function): string | undefined {
  return storage.tables.find((t) => t.target === target)?.name;
}

function columnPropertyNamesOf(target: Function): string[] {
  return storage.columns
    .filter((c) => c.target === target)
    .map((c) => c.propertyName);
}

function columnOptionsOf(target: Function, propertyName: string) {
  return storage.columns.find(
    (c) => c.target === target && c.propertyName === propertyName,
  )?.options;
}

function relationsOf(target: Function) {
  return storage.relations.filter((r) => r.target === target);
}

function relationOnDelete(target: Function, propertyName: string): string | undefined {
  return relationsOf(target).find((r) => r.propertyName === propertyName)
    ?.options.onDelete as string | undefined;
}

function indicesOf(target: Function) {
  return storage.indices.filter((i) => i.target === target);
}

function uniquesOf(target: Function) {
  return storage.uniques.filter((u) => u.target === target);
}

function hasIndexOnColumns(
  target: Function,
  columns: string[],
  onlyUnique = false,
): boolean {
  const wanted = [...columns].sort().join(',');
  return indicesOf(target).some((index) => {
    if (onlyUnique && !index.unique) return false;
    const cols = Array.isArray(index.columns) ? index.columns : undefined;
    if (!cols) return false;
    return [...cols].sort().join(',') === wanted;
  });
}

function hasUniqueOnColumns(target: Function, columns: string[]): boolean {
  const wanted = [...columns].sort().join(',');
  return uniquesOf(target).some((unique) => {
    const cols = Array.isArray(unique.columns) ? unique.columns : undefined;
    if (!cols) return false;
    return [...cols].sort().join(',') === wanted;
  });
}

interface EntitySpec {
  name: string;
  ctor: Function;
  table: string;
  /** `true` = deve ter coluna `tenantId` (nullable ou não). `false` = nunca
   * deve ter `tenantId`. */
  tenantId: boolean;
}

// As 30 entidades esperadas pelo Lote 3 (seção 3.2 do plano), classificadas
// entre globais (sem tenantId), a raiz do tenant (Tenant, também sem
// tenantId) e tenant-owned (com tenantId, nullable em Invite/AuditLog por
// design dual-purpose já documentado nesses arquivos).
const ENTITIES: EntitySpec[] = [
  // Globais (6) — nunca tenantId.
  { name: 'User', ctor: User, table: 'users', tenantId: false },
  { name: 'Plan', ctor: Plan, table: 'plans', tenantId: false },
  { name: 'Feature', ctor: Feature, table: 'features', tenantId: false },
  { name: 'PlanFeature', ctor: PlanFeature, table: 'plan_features', tenantId: false },
  { name: 'Credential', ctor: Credential, table: 'credentials', tenantId: false },
  { name: 'Session', ctor: Session, table: 'sessions', tenantId: false },
  // Raiz do tenant (1) — nunca recebe tenantId nela mesma.
  { name: 'Tenant', ctor: Tenant, table: 'tenants', tenantId: false },
  // Configuração do tenant (4).
  {
    name: 'TenantFeatureOverride',
    ctor: TenantFeatureOverride,
    table: 'tenant_feature_overrides',
    tenantId: true,
  },
  { name: 'BrandIdentity', ctor: BrandIdentity, table: 'brand_identities', tenantId: true },
  { name: 'BookingPolicy', ctor: BookingPolicy, table: 'booking_policies', tenantId: true },
  { name: 'PublicSettings', ctor: PublicSettings, table: 'public_settings', tenantId: true },
  // Operação do tenant (16).
  { name: 'Unit', ctor: Unit, table: 'units', tenantId: true },
  { name: 'Membership', ctor: Membership, table: 'memberships', tenantId: true },
  {
    name: 'MembershipPermissionOverride',
    ctor: MembershipPermissionOverride,
    table: 'membership_permission_overrides',
    tenantId: true,
  },
  { name: 'Invite', ctor: Invite, table: 'invites', tenantId: true },
  { name: 'AuditLog', ctor: AuditLog, table: 'audit_logs', tenantId: true },
  { name: 'Professional', ctor: Professional, table: 'professionals', tenantId: true },
  {
    name: 'ProfessionalSchedule',
    ctor: ProfessionalSchedule,
    table: 'professional_schedules',
    tenantId: true,
  },
  { name: 'Service', ctor: Service, table: 'services', tenantId: true },
  {
    name: 'ProfessionalService',
    ctor: ProfessionalService,
    table: 'professional_services',
    tenantId: true,
  },
  { name: 'Consumer', ctor: Consumer, table: 'consumers', tenantId: true },
  { name: 'TimeBlock', ctor: TimeBlock, table: 'time_blocks', tenantId: true },
  { name: 'Resource', ctor: Resource, table: 'resources', tenantId: true },
  { name: 'Appointment', ctor: Appointment, table: 'appointments', tenantId: true },
  {
    name: 'AppointmentItem',
    ctor: AppointmentItem,
    table: 'appointment_items',
    tenantId: true,
  },
  {
    name: 'AppointmentResource',
    ctor: AppointmentResource,
    table: 'appointment_resources',
    tenantId: true,
  },
  {
    name: 'AppointmentStatusChange',
    ctor: AppointmentStatusChange,
    table: 'appointment_status_changes',
    tenantId: true,
  },
  // Novas (5): administração/autenticação (3) + comissão (2).
  { name: 'Credential', ctor: Credential, table: 'credentials', tenantId: false },
  { name: 'Session', ctor: Session, table: 'sessions', tenantId: false },
  { name: 'SupportSession', ctor: SupportSession, table: 'support_sessions', tenantId: true },
  { name: 'CommissionRule', ctor: CommissionRule, table: 'commission_rules', tenantId: true },
  {
    name: 'CommissionEntry',
    ctor: CommissionEntry,
    table: 'commission_entries',
    tenantId: true,
  },
];

// Credential/Session aparecem 2x em ENTITIES (globais e "novas", ver seção
// 3.2 do plano) — deduplicado por classe para os testes que iteram por
// entidade única, usado por vários blocos `describe` abaixo.
const entidadesUnicas = Array.from(new Set(ENTITIES.map((e) => e.ctor))).map(
  (ctor) => ENTITIES.find((e) => e.ctor === ctor)!,
);

describe('entidades — contagem e nomes de tabela', () => {
  it('registra exatamente 30 entidades (sem duplicata de classe)', () => {
    const unicas = new Set(ENTITIES.map((e) => e.ctor));
    expect(unicas.size).toBe(30);
  });

  it.each(ENTITIES.map((e) => [e.name, e.ctor, e.table] as const))(
    '%s mapeia para a tabela snake_case "%s"',
    (_name, ctor, table) => {
      expect(tableNameOf(ctor)).toBe(table);
    },
  );

  it('nenhuma tabela é repetida entre entidades diferentes (exceto Credential/Session, listadas 2x de propósito — ver seção 3.2 do plano: são ao mesmo tempo "globais" e "novas")', () => {
    const nomes = ENTITIES.map((e) => e.table);
    const contagem = new Map<string, number>();
    for (const nome of nomes) contagem.set(nome, (contagem.get(nome) ?? 0) + 1);
    for (const [tabela, vezes] of contagem) {
      if (tabela === 'credentials' || tabela === 'sessions') {
        expect(vezes).toBe(2);
      } else {
        expect(vezes, `tabela "${tabela}" repetida`).toBe(1);
      }
    }
  });
});

describe('isolamento multi-tenant — tenantId', () => {
  it.each(
    entidadesUnicas
      .filter((e) => e.tenantId)
      .map((e) => [e.name, e.ctor] as const),
  )('%s (tenant-owned) tem coluna tenantId', (_name, ctor) => {
    expect(columnPropertyNamesOf(ctor)).toContain('tenantId');
  });

  it.each(
    entidadesUnicas
      .filter((e) => !e.tenantId)
      .map((e) => [e.name, e.ctor] as const),
  )('%s (global ou raiz do tenant) NUNCA tem coluna tenantId', (_name, ctor) => {
    expect(columnPropertyNamesOf(ctor)).not.toContain('tenantId');
  });

  it('toda entidade tenant-owned indexa tenantId (sozinho ou como parte de índice/unicidade composta)', () => {
    for (const entidade of entidadesUnicas.filter((e) => e.tenantId)) {
      const indexadoSozinho = indicesOf(entidade.ctor).some(
        (i) => Array.isArray(i.columns) && i.columns.includes('tenantId'),
      );
      const emUnicidadeComposta = uniquesOf(entidade.ctor).some(
        (u) => Array.isArray(u.columns) && u.columns.includes('tenantId'),
      );
      // `@OneToOne` dono cuja @JoinColumn cai em `tenant_id` gera sozinho uma
      // UNIQUE CONSTRAINT em tempo de build (RelationJoinColumnBuilder, ver
      // SnakeNamingStrategy.relationConstraintName) — não é visível via
      // storage.indices/storage.uniques (que só veem decorators), mas ainda
      // assim indexa tenantId (Lote 5B.3: BookingPolicy/BrandIdentity/
      // PublicSettings deixaram de ter @Index({unique:true}) próprio por isso).
      const viaOneToOneDono = relationsOf(entidade.ctor).some((r) => {
        if (r.relationType !== 'one-to-one') return false;
        if (
          (r.options as { createForeignKeyConstraints?: boolean })
            .createForeignKeyConstraints === false
        )
          return false;
        const joinColumn = storage.joinColumns.find(
          (jc) => jc.target === entidade.ctor && jc.propertyName === r.propertyName,
        );
        return joinColumn?.name === 'tenant_id';
      });
      expect(
        indexadoSozinho || emUnicidadeComposta || viaOneToOneDono,
        `${entidade.name}.tenantId não está indexado nem faz parte de uma unicidade composta`,
      ).toBe(true);
    }
  });
});

describe('tenantId nullable — só nas duas entidades de propósito duplo (plataforma/tenant)', () => {
  // Invite (convite de plataforma vs. de estabelecimento) e AuditLog
  // (auditoria de plataforma vs. de tenant) são as ÚNICAS entidades
  // tenant-owned desta lista cujo tenantId é nullable de propósito — nunca
  // "esquecido". Regra de serviço a implementar em lote posterior (nunca
  // aqui, e nunca só CHECK de banco, porque depende do valor de outra
  // coluna): Invite.tenantId é obrigatório quando type = ESTABLISHMENT e
  // deve ser nulo quando type = PLATFORM; AuditLog.tenantId é nulo quando a
  // ação é de escopo de plataforma (ex.: MASTER_CREATED/MASTER_REMOVED) e
  // obrigatório quando a ação pertence a um tenant.
  it('Invite.tenantId é nullable', () => {
    expect(columnOptionsOf(Invite, 'tenantId')?.nullable).toBe(true);
  });

  it('AuditLog.tenantId é nullable', () => {
    expect(columnOptionsOf(AuditLog, 'tenantId')?.nullable).toBe(true);
  });

  it('toda outra entidade tenant-owned tem tenantId obrigatório (nunca nullable)', () => {
    const excecoesDePropositoDuplo = new Set<Function>([Invite, AuditLog]);
    for (const entidade of entidadesUnicas.filter(
      (e) => e.tenantId && !excecoesDePropositoDuplo.has(e.ctor),
    )) {
      expect(
        columnOptionsOf(entidade.ctor, 'tenantId')?.nullable,
        `${entidade.name}.tenantId não deveria ser nullable`,
      ).not.toBe(true);
    }
  });
});

describe('tenantId denormalizado — pendente de constraint composta no Lote 5', () => {
  // As 6 tabelas abaixo ganharam tenantId nesta revisão além do mapeamento
  // original da seção 3.2 (que só tinha a FK do pai) — decisão desta
  // execução para atender à exigência de que toda entidade tenant-owned
  // tenha tenant_id próprio e indexado (ver docs/plans/
  // migracao-nestjs-typeorm-neon.md, seção 4/5). Nenhuma delas tem ainda
  // uma constraint de banco garantindo que o tenantId próprio bate com o
  // tenantId do registro pai — isso é SQL manual do Lote 5 (FK composta
  // (tenant_id, x_id) REFERENCES x(tenant_id, id), exigindo antes um
  // UNIQUE(tenant_id, id) em cada tabela-pai referenciada). Este teste só
  // documenta e comprova que a coluna existe — nunca simula a constraint.
  const pendentesDeConstraintComposta: [string, Function, string][] = [
    ['MembershipPermissionOverride', MembershipPermissionOverride, 'Membership'],
    ['ProfessionalSchedule', ProfessionalSchedule, 'Professional'],
    ['ProfessionalService', ProfessionalService, 'Professional e Service'],
    ['AppointmentItem', AppointmentItem, 'Appointment e Service'],
    ['AppointmentResource', AppointmentResource, 'Appointment e Resource'],
    ['AppointmentStatusChange', AppointmentStatusChange, 'Appointment'],
  ];

  it.each(pendentesDeConstraintComposta)(
    '%s tem tenantId denormalizado (consistência com %s fica para SQL manual no Lote 5)',
    (_nome, ctor) => {
      expect(columnPropertyNamesOf(ctor)).toContain('tenantId');
      expect(columnOptionsOf(ctor, 'tenantId')?.nullable).not.toBe(true);
    },
  );

  it('nenhuma dessas 6 tabelas declara uma relação TypeORM inventada para simular a constraint composta', () => {
    for (const [, ctor] of pendentesDeConstraintComposta) {
      const relacoesComTenant = relationsOf(ctor).filter(
        (r) => r.propertyName === 'tenant',
      );
      expect(
        relacoesComTenant,
        `${String(ctor)} não deveria ter relação "tenant" própria — a consistência é responsabilidade do Lote 5, não de uma relação TypeORM incorreta`,
      ).toHaveLength(0);
    }
  });
});

describe('slug do estabelecimento — único globalmente', () => {
  it('Tenant.slug tem índice único', () => {
    expect(hasIndexOnColumns(Tenant, ['slug'], true)).toBe(true);
  });

  it('Tenant.slug é citext (case-insensitive no próprio banco)', () => {
    expect(columnOptionsOf(Tenant, 'slug')?.type).toBe('citext');
  });
});

describe('unicidades de negócio com escopo do tenant', () => {
  it('CommissionRule é único por (tenantId, professionalId, serviceId)', () => {
    expect(
      hasUniqueOnColumns(CommissionRule, ['tenantId', 'professionalId', 'serviceId']),
    ).toBe(true);
  });

  it('CommissionEntry.appointmentId é único (no máximo um lançamento por agendamento, para sempre)', () => {
    expect(hasIndexOnColumns(CommissionEntry, ['appointmentId'], true)).toBe(true);
  });

  it('Consumer é único por (tenantId, whatsappNormalized) — isolamento por par, nunca telefone sozinho', () => {
    expect(hasUniqueOnColumns(Consumer, ['tenantId', 'whatsappNormalized'])).toBe(true);
  });

  it('ProfessionalService é único por (tenantId, professionalId, serviceId)', () => {
    expect(
      hasUniqueOnColumns(ProfessionalService, ['tenantId', 'professionalId', 'serviceId']),
    ).toBe(true);
  });

  it('Membership é único por (userId, tenantId)', () => {
    expect(hasUniqueOnColumns(Membership, ['userId', 'tenantId'])).toBe(true);
  });

  it('PlanFeature é único por (planId, featureId)', () => {
    expect(hasUniqueOnColumns(PlanFeature, ['planId', 'featureId'])).toBe(true);
  });

  it('TenantFeatureOverride é único por (tenantId, featureId)', () => {
    expect(hasUniqueOnColumns(TenantFeatureOverride, ['tenantId', 'featureId'])).toBe(
      true,
    );
  });
});

describe('índices multi-tenant principais', () => {
  // Correção pós-Lote 3: os dois índices compostos de Appointment lideram
  // com tenantId (consultas reais da agenda são sempre por tenant primeiro).
  // Não há índice avulso em tenantId/status/startAt sozinhos — seriam
  // redundantes (o prefixo esquerdo de cada composto já serve `WHERE
  // tenant_id = $1`) e uma consulta sem tenant_id nunca é caso de uso real.
  it('Appointment indexa (tenantId, professionalId, startAt, endAt) — horários de um profissional', () => {
    expect(
      hasIndexOnColumns(Appointment, [
        'tenantId',
        'professionalId',
        'startAt',
        'endAt',
      ]),
    ).toBe(true);
  });

  it('Appointment indexa (tenantId, status, startAt) — lista por status', () => {
    expect(
      hasIndexOnColumns(Appointment, ['tenantId', 'status', 'startAt']),
    ).toBe(true);
  });

  it('Appointment NÃO tem índice avulso em tenantId/status/startAt sozinhos (seriam redundantes)', () => {
    expect(hasIndexOnColumns(Appointment, ['tenantId'])).toBe(false);
    expect(hasIndexOnColumns(Appointment, ['status'])).toBe(false);
    expect(hasIndexOnColumns(Appointment, ['startAt'])).toBe(false);
  });

  it('AuditLog indexa (tenantId, occurredAt) e actorUserId (actorUserId é consulta de plataforma, cross-tenant, mantida de propósito)', () => {
    expect(hasIndexOnColumns(AuditLog, ['tenantId', 'occurredAt'])).toBe(true);
    expect(hasIndexOnColumns(AuditLog, ['actorUserId'])).toBe(true);
  });

  it('CommissionEntry indexa (tenantId, professionalId, serviceDate) — relatório por período/profissional do estabelecimento', () => {
    expect(
      hasIndexOnColumns(CommissionEntry, ['tenantId', 'professionalId', 'serviceDate']),
    ).toBe(true);
  });

  it('CommissionRule e ProfessionalService não têm índice avulso em tenantId — a unicidade composta já cobre (prefixo esquerdo)', () => {
    expect(hasIndexOnColumns(CommissionRule, ['tenantId'])).toBe(false);
    expect(hasIndexOnColumns(ProfessionalService, ['tenantId'])).toBe(false);
    expect(hasUniqueOnColumns(CommissionRule, ['tenantId', 'professionalId', 'serviceId'])).toBe(true);
    expect(
      hasUniqueOnColumns(ProfessionalService, ['tenantId', 'professionalId', 'serviceId']),
    ).toBe(true);
  });

  it('Consumer não tem índice avulso em tenantId (coberto pela unicidade tenantId+whatsappNormalized), mas mantém whatsappNormalized avulso (consulta de plataforma, cross-tenant)', () => {
    expect(hasIndexOnColumns(Consumer, ['tenantId'])).toBe(false);
    expect(hasIndexOnColumns(Consumer, ['whatsappNormalized'])).toBe(true);
  });

  it('Invite indexa (tenantId, status) e targetEmail', () => {
    expect(hasIndexOnColumns(Invite, ['tenantId', 'status'])).toBe(true);
    expect(hasIndexOnColumns(Invite, ['targetEmail'])).toBe(true);
  });

  it('TimeBlock indexa (professionalId, startAt, endAt)', () => {
    expect(hasIndexOnColumns(TimeBlock, ['professionalId', 'startAt', 'endAt'])).toBe(
      true,
    );
  });

  it('SupportSession indexa (tenantId, startedAt) e masterUserId', () => {
    expect(hasIndexOnColumns(SupportSession, ['tenantId', 'startedAt'])).toBe(true);
    expect(hasIndexOnColumns(SupportSession, ['masterUserId'])).toBe(true);
  });
});

describe('colunas monetárias — sempre inteiro, nunca float', () => {
  it.each([
    [Plan, 'priceCents'],
    [Service, 'priceCents'],
    [CommissionRule, 'value'],
    [CommissionEntry, 'priceCentsSnapshot'],
    [CommissionEntry, 'appliedValue'],
    [CommissionEntry, 'professionalCents'],
    [CommissionEntry, 'establishmentCents'],
    [AppointmentItem, 'priceCentsSnapshot'],
  ] as const)('%s.%s é do tipo "int"', (ctor, property) => {
    expect(columnOptionsOf(ctor, property)?.type).toBe('int');
  });
});

describe('comissão — percentual em pontos-base, nunca fração/float', () => {
  it('CommissionRule.value e CommissionEntry.appliedValue são inteiros', () => {
    expect(columnOptionsOf(CommissionRule, 'value')?.type).toBe('int');
    expect(columnOptionsOf(CommissionEntry, 'appliedValue')?.type).toBe('int');
  });

  // Documenta a convenção de unidade acordada (correção pós-Lote 3): 100% =
  // 10000 pontos-base, nunca "100" (que seria fração/percentual humano).
  // O futuro CHECK do Lote 5 usa exatamente esta faixa para PERCENTAGE.
  it.each([
    [10000, '100%'],
    [4000, '40%'],
    [1250, '12,5%'],
    [1, '0,01%'],
    [0, '0%'],
  ])('%i pontos-base representa %s — dentro da faixa válida 0-10000', (pontosBase) => {
    expect(Number.isInteger(pontosBase)).toBe(true);
    expect(pontosBase).toBeGreaterThanOrEqual(0);
    expect(pontosBase).toBeLessThanOrEqual(10000);
  });

  it('valores fora de 0-10000 não representam percentual válido (limite documentado para o CHECK do Lote 5)', () => {
    for (const invalido of [-1, 10001, 15000]) {
      const dentroDaFaixa = invalido >= 0 && invalido <= 10000;
      expect(dentroDaFaixa).toBe(false);
    }
  });
});

describe('relações históricas/financeiras — nunca cascade destrutivo', () => {
  it.each([
    [CommissionEntry, 'tenant', 'RESTRICT'],
    [CommissionEntry, 'appointment', 'RESTRICT'],
    [CommissionEntry, 'professional', 'RESTRICT'],
    [CommissionEntry, 'service', 'RESTRICT'],
    [AuditLog, 'actor', 'RESTRICT'],
    [AuditLog, 'tenant', 'RESTRICT'],
    [AuditLog, 'supportSession', 'RESTRICT'],
    [SupportSession, 'masterUser', 'RESTRICT'],
    [SupportSession, 'tenant', 'RESTRICT'],
    [Appointment, 'tenant', 'RESTRICT'],
    [Appointment, 'consumer', 'RESTRICT'],
    [Appointment, 'professional', 'RESTRICT'],
    [Appointment, 'unit', 'RESTRICT'],
  ] as const)('%s.%s é RESTRICT (nunca CASCADE)', (ctor, property, expected) => {
    expect(relationOnDelete(ctor, property)).toBe(expected);
  });

  it('dado operacional/financeiro/auditoria nunca usa CASCADE em direção a Tenant (nunca apagar tenant com dado operacional)', () => {
    // Exceção deliberada e documentada (seção 3.2 do plano, herdada do
    // schema.prisma original): as 4 tabelas de configuração/exceção
    // estritamente dependentes do tenant (TenantFeatureOverride,
    // BrandIdentity, BookingPolicy, PublicSettings) usam Cascade de
    // propósito — não têm valor histórico/financeiro independente do
    // tenant. A regra "nunca cascade" vale para dado operacional,
    // financeiro e de auditoria, nunca para essas 4.
    const excecoesDeConfiguracao1x1 = new Set<Function>([
      TenantFeatureOverride,
      BrandIdentity,
      BookingPolicy,
      PublicSettings,
    ]);
    const relacoesParaTenant = storage.relations.filter(
      (r) => r.propertyName === 'tenant' && !excecoesDeConfiguracao1x1.has(r.target as Function),
    );
    expect(relacoesParaTenant.length).toBeGreaterThan(0);
    for (const relacao of relacoesParaTenant) {
      expect(relacao.options.onDelete, `${String(relacao.target)}.tenant`).not.toBe(
        'CASCADE',
      );
    }
  });
});

describe('nunca aponta para o frontend ou o Prisma gerado', () => {
  it('nenhum arquivo de entidade importa de src/lib, src/generated ou @/ (frontend/Prisma gerado)', async () => {
    const { readdir, readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const path = await import('node:path');

    const entitiesDir = path.dirname(fileURLToPath(import.meta.url));
    const arquivos = (await readdir(entitiesDir)).filter((f) =>
      f.endsWith('.entity.ts'),
    );
    expect(arquivos.length).toBe(30);

    const padroesProibidos = [/@\/lib\//, /src\/generated/, /\.\.\/\.\.\/src\//];
    for (const arquivo of arquivos) {
      const conteudo = await readFile(path.join(entitiesDir, arquivo), 'utf-8');
      for (const padrao of padroesProibidos) {
        expect(
          padrao.test(conteudo),
          `${arquivo} contém referência proibida (${padrao})`,
        ).toBe(false);
      }
    }
  });
});

describe('sem inicialização de DataSource', () => {
  it('importar as 30 entidades não conecta nem inicializa nenhum DataSource', async () => {
    const { RuntimeDataSource } = await import('../database/runtime-data-source.js');
    const { MigrationsDataSource } = await import(
      '../database/migrations-data-source.js'
    );
    expect(RuntimeDataSource.isInitialized).toBe(false);
    expect(MigrationsDataSource.isInitialized).toBe(false);
  });
});
