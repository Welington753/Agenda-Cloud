// Lote 5B.2 — prova que os decorators das entidades (nomes de FK/unique/
// índice, os 5 UNIQUE(tenant_id,id), os 9 CHECK, a EXCLUDE, o índice de
// expiração e as 14 FKs compostas via @ForeignKey de classe) batem
// literalmente com `1788782400000-InitialSchema.ts`. Só registra metadata
// via `getMetadataArgsStorage()` — nenhum DataSource é inicializado, nenhuma
// conexão é aberta (importar uma entidade só executa os decorators, que só
// empilham metadata em memória).
import { globSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { getMetadataArgsStorage } from 'typeorm';
import {
  BUSINESS_UNIQUE_STATEMENTS,
  CHECK_STATEMENTS,
  EXCLUSION_STATEMENTS,
  INDEX_STATEMENTS,
  SIMPLE_FOREIGN_KEY_STATEMENTS,
  TENANT_COMPOSITE_FOREIGN_KEY_STATEMENTS,
  TENANT_PARENT_UNIQUE_STATEMENTS,
  UNIQUE_INDEX_STATEMENTS,
} from '../migrations/1788782400000-InitialSchema.js';

// As 4 tabelas cujo lado dono de `@OneToOne` gera sozinho a UNIQUE CONSTRAINT
// (via `SnakeNamingStrategy.relationConstraintName`) — não podem ter também
// um `@Index({unique:true})` decorado à mão, ou o schema:log volta a ver
// DROP+ADD da FK a cada rodada (drift do Lote 5B.2, eliminado no 5B.3).
const ONE_TO_ONE_OWNED_UNIQUE_COLUMNS: ReadonlyArray<{ target: string; propertyName: string }> = [
  { target: 'BookingPolicy', propertyName: 'tenantId' },
  { target: 'BrandIdentity', propertyName: 'tenantId' },
  { target: 'Credential', propertyName: 'userId' },
  { target: 'PublicSettings', propertyName: 'tenantId' },
];

const entitiesDir = path.dirname(fileURLToPath(import.meta.url));

beforeAll(async () => {
  const files = globSync(path.join(entitiesDir, '*.entity.ts'));
  for (const file of files) {
    await import(pathToFileURL(file).href);
  }
});

function namesFrom(pattern: RegExp, statements: readonly string[]): Set<string> {
  const names = new Set<string>();
  for (const statement of statements) {
    const match = pattern.exec(statement);
    if (match) names.add(match[1]);
  }
  return names;
}

describe('nomes de constraint/índice — decorators batem com a migration', () => {
  it('todo nome de @ForeignKey (composta ou não representável) existe na migration', () => {
    const storage = getMetadataArgsStorage();
    const migrationFkNames = new Set([
      ...namesFrom(/ADD CONSTRAINT (\w+) FOREIGN KEY/, SIMPLE_FOREIGN_KEY_STATEMENTS),
      ...namesFrom(/ADD CONSTRAINT (\w+) FOREIGN KEY/, TENANT_COMPOSITE_FOREIGN_KEY_STATEMENTS),
    ]);
    for (const fk of storage.foreignKeys) {
      expect(migrationFkNames.has(fk.name!), `@ForeignKey "${fk.name}" não existe na migration`).toBe(
        true,
      );
    }
  });

  it('todo foreignKeyConstraintName de @JoinColumn existe na migration (FK simples)', () => {
    const storage = getMetadataArgsStorage();
    const migrationSimpleFkNames = namesFrom(
      /ADD CONSTRAINT (\w+) FOREIGN KEY/,
      SIMPLE_FOREIGN_KEY_STATEMENTS,
    );
    const joinColumnNames = storage.joinColumns
      .map((jc) => jc.foreignKeyConstraintName)
      .filter((name): name is string => Boolean(name));
    expect(joinColumnNames.length).toBeGreaterThan(0);
    for (const name of joinColumnNames) {
      expect(migrationSimpleFkNames.has(name), `foreignKeyConstraintName "${name}" não existe na migration`).toBe(
        true,
      );
    }
  });

  it('todo nome de @Unique existe na migration (auxiliar de tenant ou de negócio)', () => {
    const storage = getMetadataArgsStorage();
    const migrationUniqueNames = new Set([
      ...namesFrom(/ADD CONSTRAINT (\w+) UNIQUE/, TENANT_PARENT_UNIQUE_STATEMENTS),
      ...namesFrom(/ADD CONSTRAINT (\w+) UNIQUE/, BUSINESS_UNIQUE_STATEMENTS),
    ]);
    for (const u of storage.uniques) {
      expect(migrationUniqueNames.has(u.name!), `@Unique "${u.name}" não existe na migration`).toBe(true);
    }
  });

  it('todo nome de @Index com string de nome existe na migration (único ou não)', () => {
    const storage = getMetadataArgsStorage();
    const migrationIndexNames = new Set([
      ...namesFrom(/CREATE (?:UNIQUE )?INDEX (\w+) ON/, UNIQUE_INDEX_STATEMENTS),
      ...namesFrom(/CREATE (?:UNIQUE )?INDEX (\w+) ON/, INDEX_STATEMENTS),
    ]);
    const namedIndices = storage.indices.filter((idx) => typeof idx.name === 'string');
    expect(namedIndices.length).toBeGreaterThan(0);
    for (const idx of namedIndices) {
      expect(migrationIndexNames.has(idx.name!), `@Index "${idx.name}" não existe na migration`).toBe(
        true,
      );
    }
  });
});

describe('5 UNIQUE(tenant_id, id) auxiliares', () => {
  it('exatamente 5 @Unique com 2 colunas terminando em ["tenantId","id"]', () => {
    const storage = getMetadataArgsStorage();
    const tenantIdUniques = storage.uniques.filter((u) => {
      const columns = typeof u.columns === 'function' ? Object.keys(u.columns({})) : (u.columns ?? []);
      return Array.isArray(columns) && columns.length === 2 && columns[0] === 'tenantId' && columns[1] === 'id';
    });
    expect(tenantIdUniques).toHaveLength(5);
    expect(new Set(tenantIdUniques.map((u) => u.name))).toEqual(
      new Set([
        'uq_professionals_tenant_id',
        'uq_services_tenant_id',
        'uq_consumers_tenant_id',
        'uq_memberships_tenant_id',
        'uq_appointments_tenant_id',
      ]),
    );
  });
});

describe('9 CHECK — nomes e expressões idênticos à migration', () => {
  it('exatamente 9 @Check, cada um com par (nome, expressão) presente na migration', () => {
    const storage = getMetadataArgsStorage();
    expect(storage.checks).toHaveLength(9);
    const migrationChecks = new Set(
      CHECK_STATEMENTS.map((s) => {
        const nameMatch = /ADD CONSTRAINT (\w+) CHECK \((.+)\)$/.exec(s)!;
        return `${nameMatch[1]}::${nameMatch[2]}`;
      }),
    );
    for (const check of storage.checks) {
      const key = `${check.name}::${check.expression}`;
      expect(migrationChecks.has(key), `CHECK "${check.name}" não bate com a migration`).toBe(true);
    }
  });
});

describe('EXCLUDE da agenda — nome e expressão idênticos, bounds [) e predicate CANCELED', () => {
  it('exatamente 1 @Exclusion, mesmo nome/expressão da migration', () => {
    const storage = getMetadataArgsStorage();
    expect(storage.exclusions).toHaveLength(1);
    const exclusion = storage.exclusions[0];
    expect(exclusion.name).toBe('appointments_no_overlap_excl');
    expect(exclusion.expression).toContain(`tstzrange(start_at, end_at, '[)') WITH &&`);
    expect(exclusion.expression).toContain(`WHERE (status <> 'CANCELED')`);
    const migrationExclusion = EXCLUSION_STATEMENTS[0];
    expect(migrationExclusion).toContain(`tstzrange(start_at, end_at, '[)') WITH &&`);
    expect(migrationExclusion).toContain(`WHERE (status <> 'CANCELED')`);
    expect(migrationExclusion).toContain('tenant_id WITH =');
    expect(migrationExclusion).toContain('professional_id WITH =');
  });
});

describe('idx_sessions_expires_at — novo, exigido pela seção 10', () => {
  it('existe um @Index nomeado idx_sessions_expires_at em Session.expiresAt', () => {
    const storage = getMetadataArgsStorage();
    const idx = storage.indices.find((i) => i.name === 'idx_sessions_expires_at');
    expect(idx).toBeDefined();
    expect(idx!.target).toHaveProperty('name', 'Session');
  });
});

describe('4 relações @OneToOne dono — UNIQUE CONSTRAINT única por coluna, sem índice duplicado (Lote 5B.3)', () => {
  it('nenhuma das 4 colunas tem @Index próprio (a constraint vem do relacionamento, não de decorator)', () => {
    const storage = getMetadataArgsStorage();
    for (const { target, propertyName } of ONE_TO_ONE_OWNED_UNIQUE_COLUMNS) {
      const hasOwnIndex = storage.indices.some((idx) => {
        const targetName = typeof idx.target === 'string' ? idx.target : idx.target.name;
        if (targetName !== target) return false;
        const columns =
          typeof idx.columns === 'function' ? Object.keys(idx.columns({})) : (idx.columns ?? []);
        return Array.isArray(columns) && columns.length === 1 && columns[0] === propertyName;
      });
      expect(hasOwnIndex, `${target}.${propertyName} não deveria ter @Index próprio`).toBe(false);
    }
  });

  it('as 4 relações continuam com a FK automática ativa (createForeignKeyConstraints nunca false aqui)', () => {
    const storage = getMetadataArgsStorage();
    for (const { target } of ONE_TO_ONE_OWNED_UNIQUE_COLUMNS) {
      const relation = storage.relations.find((r) => {
        const targetName = typeof r.target === 'string' ? r.target : r.target.name;
        return targetName === target && r.relationType === 'one-to-one';
      });
      expect(relation, `relação OneToOne de ${target} não encontrada`).toBeDefined();
      expect(
        (relation!.options as { createForeignKeyConstraints?: boolean }).createForeignKeyConstraints,
      ).not.toBe(false);
    }
  });

  it('a migration cria as 4 constraints como UNIQUE CONSTRAINT (não como CREATE UNIQUE INDEX)', () => {
    const expectedConstraints = [
      'ALTER TABLE credentials ADD CONSTRAINT uq_credentials_user_id UNIQUE (user_id)',
      'ALTER TABLE brand_identities ADD CONSTRAINT uq_brand_identities_tenant_id UNIQUE (tenant_id)',
      'ALTER TABLE booking_policies ADD CONSTRAINT uq_booking_policies_tenant_id UNIQUE (tenant_id)',
      'ALTER TABLE public_settings ADD CONSTRAINT uq_public_settings_tenant_id UNIQUE (tenant_id)',
    ];
    for (const statement of expectedConstraints) {
      expect(BUSINESS_UNIQUE_STATEMENTS).toContain(statement);
    }
    for (const table of ['credentials', 'brand_identities', 'booking_policies', 'public_settings']) {
      expect(UNIQUE_INDEX_STATEMENTS.some((s) => s.includes(`ON ${table} `))).toBe(false);
    }
  });
});

describe('tenant_feature_overrides.tenant_id — índice simples removido por redundância (Lote 5B.3)', () => {
  it('não existe @Index em TenantFeatureOverride.tenantId (coberto pelo prefixo do UNIQUE(tenant_id, feature_id))', () => {
    const storage = getMetadataArgsStorage();
    const hasIndex = storage.indices.some((idx) => {
      const targetName = typeof idx.target === 'string' ? idx.target : idx.target.name;
      return targetName === 'TenantFeatureOverride';
    });
    expect(hasIndex).toBe(false);
  });

  it('a migration nunca ganhou um CREATE INDEX dedicado para tenant_feature_overrides.tenant_id', () => {
    expect(
      INDEX_STATEMENTS.some((s) => s.includes('tenant_feature_overrides')),
    ).toBe(false);
  });
});

describe('14 FKs compostas representadas via @ForeignKey de classe', () => {
  it('exatamente 14 @ForeignKey — as 15 da migration menos a exceção de membership', () => {
    const storage = getMetadataArgsStorage();
    expect(storage.foreignKeys).toHaveLength(14);
  });

  it('os nomes batem exatamente com os 14 esperados (não inclui fk_memberships_tenant_professional)', () => {
    const storage = getMetadataArgsStorage();
    const names = new Set(storage.foreignKeys.map((fk) => fk.name));
    expect(names).toEqual(
      new Set([
        'fk_appointments_tenant_professional',
        'fk_appointments_tenant_consumer',
        'fk_appointment_items_tenant_appointment',
        'fk_appointment_resources_tenant_appointment',
        'fk_appointment_status_changes_tenant_appointment',
        'fk_professional_services_tenant_professional',
        'fk_professional_services_tenant_service',
        'fk_professional_schedules_tenant_professional',
        'fk_membership_permission_overrides_tenant_membership',
        'fk_commission_rules_tenant_professional',
        'fk_commission_rules_tenant_service',
        'fk_commission_entries_tenant_appointment',
        'fk_commission_entries_tenant_professional',
        'fk_commission_entries_tenant_service',
      ]),
    );
    expect(names.has('fk_memberships_tenant_professional')).toBe(false);
  });

  it('cada @ForeignKey usa exatamente (tenantId, <coluna>) -> (tenantId, id), igual à migration', () => {
    const storage = getMetadataArgsStorage();
    for (const fk of storage.foreignKeys) {
      expect(fk.columnNames).toHaveLength(2);
      expect(fk.columnNames![0]).toBe('tenantId');
      expect(fk.referencedColumnNames).toEqual(['tenantId', 'id']);
    }
  });
});

describe('nenhuma FK simples duplicada — createForeignKeyConstraints:false cobre exatamente as 14+1 relações substituídas', () => {
  it('15 relações desativam a FK automática (14 com @ForeignKey de classe + 1 exceção de membership)', () => {
    const storage = getMetadataArgsStorage();
    const disabled = storage.relations.filter(
      (r) => (r.options as { createForeignKeyConstraints?: boolean })?.createForeignKeyConstraints === false,
    );
    expect(disabled).toHaveLength(15);
  });

  it('por entidade, nº de relações desativadas == nº de @ForeignKey de classe, exceto Membership (0 FK, 1 relação desativada)', () => {
    const storage = getMetadataArgsStorage();
    const disabledByTarget = new Map<string, number>();
    for (const r of storage.relations) {
      if ((r.options as { createForeignKeyConstraints?: boolean })?.createForeignKeyConstraints === false) {
        const key = typeof r.target === 'string' ? r.target : r.target.name;
        disabledByTarget.set(key, (disabledByTarget.get(key) ?? 0) + 1);
      }
    }
    const fkByTarget = new Map<string, number>();
    for (const fk of storage.foreignKeys) {
      const key = typeof fk.target === 'string' ? fk.target : fk.target.name;
      fkByTarget.set(key, (fkByTarget.get(key) ?? 0) + 1);
    }
    for (const [target, disabledCount] of disabledByTarget) {
      if (target === 'Membership') {
        expect(fkByTarget.get(target) ?? 0).toBe(0);
      } else {
        expect(fkByTarget.get(target)).toBe(disabledCount);
      }
    }
  });

  it('nenhuma relação SEM createForeignKeyConstraints:false tem uma @ForeignKey de classe cobrindo a mesma coluna (sem duplicidade)', () => {
    const storage = getMetadataArgsStorage();
    const enabledRelationJoinColumns = storage.joinColumns.filter((jc) => {
      const owningRelation = storage.relations.find(
        (r) => r.target === jc.target && r.propertyName === jc.propertyName,
      );
      const disabled =
        (owningRelation?.options as { createForeignKeyConstraints?: boolean })
          ?.createForeignKeyConstraints === false;
      return !disabled;
    });
    for (const jc of enabledRelationJoinColumns) {
      const targetName = typeof jc.target === 'string' ? jc.target : jc.target.name;
      const columnName = jc.name ?? `${jc.propertyName}Id`;
      const overlapping = storage.foreignKeys.some((fk) => {
        const fkTargetName = typeof fk.target === 'string' ? fk.target : fk.target.name;
        return fkTargetName === targetName && fk.columnNames?.includes(columnName);
      });
      expect(
        overlapping,
        `${targetName}.${jc.propertyName} tem FK simples ativa E uma @ForeignKey de classe na mesma coluna`,
      ).toBe(false);
    }
  });
});

describe('memberships × professionals — única exceção manual preservada', () => {
  it('a migration ainda declara fk_memberships_tenant_professional com SET NULL (professional_id)', () => {
    const statement = TENANT_COMPOSITE_FOREIGN_KEY_STATEMENTS.find((s) =>
      s.includes('fk_memberships_tenant_professional'),
    );
    expect(statement).toBeDefined();
    expect(statement).toContain('ON DELETE SET NULL (professional_id)');
  });

  it('nenhum @ForeignKey de classe existe para Membership (fica só SQL manual)', () => {
    const storage = getMetadataArgsStorage();
    const membershipFks = storage.foreignKeys.filter((fk) => {
      const targetName = typeof fk.target === 'string' ? fk.target : fk.target.name;
      return targetName === 'Membership';
    });
    expect(membershipFks).toHaveLength(0);
  });

  it('a relação Membership.professional desativa a FK automática mesmo sem @ForeignKey substituto', () => {
    const storage = getMetadataArgsStorage();
    const relation = storage.relations.find(
      (r) =>
        (typeof r.target === 'string' ? r.target : r.target.name) === 'Membership' &&
        r.propertyName === 'professional',
    );
    expect(relation).toBeDefined();
    expect((relation!.options as { createForeignKeyConstraints?: boolean }).createForeignKeyConstraints).toBe(
      false,
    );
  });

  it('nenhum onDelete de nenhuma relação usa cast/string fora de OnDeleteType (nunca "SET NULL (" numa relação)', () => {
    const storage = getMetadataArgsStorage();
    for (const r of storage.relations) {
      const onDelete = (r.options as { onDelete?: string }).onDelete;
      if (onDelete) {
        expect(onDelete).toMatch(/^(RESTRICT|CASCADE|SET NULL|DEFAULT|NO ACTION)$/);
      }
    }
  });
});
