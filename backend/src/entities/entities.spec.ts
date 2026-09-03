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
  const entidadesUnicas = Array.from(new Set(ENTITIES.map((e) => e.ctor))).map(
    (ctor) => ENTITIES.find((e) => e.ctor === ctor)!,
  );

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
      expect(
        indexadoSozinho || emUnicidadeComposta,
        `${entidade.name}.tenantId não está indexado nem faz parte de uma unicidade composta`,
      ).toBe(true);
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
  it('Appointment indexa tenantId sozinho', () => {
    expect(hasIndexOnColumns(Appointment, ['tenantId'])).toBe(true);
  });

  it('Appointment indexa (professionalId, startAt, endAt) — checagem de conflito de horário', () => {
    expect(
      hasIndexOnColumns(Appointment, ['professionalId', 'startAt', 'endAt']),
    ).toBe(true);
  });

  it('Appointment indexa status e startAt isoladamente', () => {
    expect(hasIndexOnColumns(Appointment, ['status'])).toBe(true);
    expect(hasIndexOnColumns(Appointment, ['startAt'])).toBe(true);
  });

  it('AuditLog indexa (tenantId, occurredAt) e actorUserId', () => {
    expect(hasIndexOnColumns(AuditLog, ['tenantId', 'occurredAt'])).toBe(true);
    expect(hasIndexOnColumns(AuditLog, ['actorUserId'])).toBe(true);
  });

  it('CommissionEntry indexa (professionalId, serviceDate) — relatório por período/profissional', () => {
    expect(hasIndexOnColumns(CommissionEntry, ['professionalId', 'serviceDate'])).toBe(
      true,
    );
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
    const excecoesDeConfiguracao1x1 = new Set([
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
