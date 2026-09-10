import { describe, expect, it, vi } from 'vitest';
import type { PgClientLike, PgQueryResult } from './pg-client.js';
import {
  EXPECTED_FEATURE_COUNT_POST_MIGRATION,
  EXPECTED_PLAN_COUNT_POST_MIGRATION,
  EXPECTED_PLAN_FEATURE_LINK_COUNT_POST_MIGRATION,
  EXPECTED_PUBLIC_TABLE_COUNT,
  isPostMigrationBaselineValid,
  isPreMigrationBaselineValid,
  runPostMigrationBaselineCheck,
  runPreMigrationBaselineCheck,
  type PostMigrationBaselineReport,
  type PreMigrationBaselineReport,
} from './baseline-checks.js';

function buildValidPreMigrationRows(): Record<string, PgQueryResult<Record<string, unknown>>> {
  return {
    tableCount: { rows: [{ count: String(EXPECTED_PUBLIC_TABLE_COUNT) }] },
    migrations: { rows: [{ name: 'InitialSchema' }] },
    priceCents: { rows: [{ is_nullable: 'NO' }] },
    planCount: { rows: [{ count: '0' }] },
    featureCount: { rows: [{ count: '0' }] },
    tenantCount: { rows: [{ count: '0' }] },
    userCount: { rows: [{ count: '0' }] },
    extensions: { rows: [{ extname: 'citext' }] },
  };
}

function buildFakeClient(queryImpl: (sql: string) => PgQueryResult<Record<string, unknown>>) {
  const calls: string[] = [];
  const client: PgClientLike = {
    connect: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockImplementation(async (sql: string) => {
      calls.push(sql);
      return queryImpl(sql);
    }),
    end: vi.fn().mockResolvedValue(undefined),
  };
  return { client, calls };
}

function buildSequencedClient(rowsInOrder: PgQueryResult<Record<string, unknown>>[]) {
  let index = 0;
  const calls: string[] = [];
  const client: PgClientLike = {
    connect: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockImplementation(async (sql: string) => {
      calls.push(sql);
      if (/^BEGIN|^ROLLBACK|^COMMIT/i.test(sql.trim())) {
        return { rows: [] };
      }
      return rowsInOrder[index++] ?? { rows: [] };
    }),
    end: vi.fn().mockResolvedValue(undefined),
  };
  return { client, calls };
}

describe('runPreMigrationBaselineCheck', () => {
  it('abre transação READ ONLY e termina com ROLLBACK, nunca COMMIT', async () => {
    const valid = buildValidPreMigrationRows();
    const { client, calls } = buildSequencedClient([
      valid.tableCount,
      valid.migrations,
      valid.priceCents,
      valid.planCount,
      valid.featureCount,
      valid.tenantCount,
      valid.userCount,
      valid.extensions,
    ]);

    await runPreMigrationBaselineCheck(client);

    expect(calls[0]).toMatch(/BEGIN.*READ ONLY/i);
    expect(calls[calls.length - 1]).toMatch(/^ROLLBACK/i);
    expect(calls.some((c) => /^COMMIT/i.test(c.trim()))).toBe(false);
  });

  it('nunca emite INSERT/UPDATE/DELETE (só leitura + controle de transação)', async () => {
    const valid = buildValidPreMigrationRows();
    const { client, calls } = buildSequencedClient([
      valid.tableCount,
      valid.migrations,
      valid.priceCents,
      valid.planCount,
      valid.featureCount,
      valid.tenantCount,
      valid.userCount,
      valid.extensions,
    ]);

    await runPreMigrationBaselineCheck(client);

    for (const sql of calls) {
      expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\b/i);
    }
  });

  it('em caso de erro no meio da checagem, ainda tenta ROLLBACK antes de propagar', async () => {
    const { client, calls } = buildFakeClient((sql) => {
      if (/^BEGIN/i.test(sql.trim())) return { rows: [] };
      if (/^ROLLBACK/i.test(sql.trim())) return { rows: [] };
      throw new Error('falha de rede simulada, postgresql://user:pass@ep-real.neon.tech/db');
    });

    await expect(runPreMigrationBaselineCheck(client)).rejects.toThrow();
    expect(calls.some((c) => /^ROLLBACK/i.test(c.trim()))).toBe(true);
  });

  it('devolve um relatório fielmente montado a partir das linhas', async () => {
    const valid = buildValidPreMigrationRows();
    const { client } = buildSequencedClient([
      valid.tableCount,
      valid.migrations,
      valid.priceCents,
      valid.planCount,
      valid.featureCount,
      valid.tenantCount,
      valid.userCount,
      valid.extensions,
    ]);

    const report = await runPreMigrationBaselineCheck(client);

    expect(report.tableCount).toBe(EXPECTED_PUBLIC_TABLE_COUNT);
    expect(report.migrationNames).toEqual(['InitialSchema']);
    expect(report.priceCentsIsNotNull).toBe(true);
    expect(report.planCount).toBe(0);
    expect(report.extensionsPresent).toBe(true);
  });
});

describe('isPreMigrationBaselineValid', () => {
  const validReport: PreMigrationBaselineReport = {
    tableCount: EXPECTED_PUBLIC_TABLE_COUNT,
    migrationNames: ['InitialSchema'],
    priceCentsIsNotNull: true,
    planCount: 0,
    featureCount: 0,
    tenantCount: 0,
    userCount: 0,
    extensionsPresent: true,
  };

  it('aceita o baseline esperado', () => {
    expect(isPreMigrationBaselineValid(validReport)).toBe(true);
  });

  it('rejeita contagem de tabelas divergente', () => {
    expect(isPreMigrationBaselineValid({ ...validReport, tableCount: 30 })).toBe(false);
  });

  it('rejeita histórico de migration diferente de só InitialSchema', () => {
    expect(
      isPreMigrationBaselineValid({ ...validReport, migrationNames: ['InitialSchema', 'Outra'] }),
    ).toBe(false);
  });

  it('rejeita price_cents nullable (deveria ser NOT NULL antes da migration)', () => {
    expect(isPreMigrationBaselineValid({ ...validReport, priceCentsIsNotNull: false })).toBe(false);
  });

  it('rejeita catálogo não vazio', () => {
    expect(isPreMigrationBaselineValid({ ...validReport, planCount: 1 })).toBe(false);
    expect(isPreMigrationBaselineValid({ ...validReport, featureCount: 1 })).toBe(false);
  });

  it('rejeita negócio não vazio', () => {
    expect(isPreMigrationBaselineValid({ ...validReport, tenantCount: 1 })).toBe(false);
    expect(isPreMigrationBaselineValid({ ...validReport, userCount: 1 })).toBe(false);
  });

  it('rejeita extensões ausentes', () => {
    expect(isPreMigrationBaselineValid({ ...validReport, extensionsPresent: false })).toBe(false);
  });
});

describe('runPostMigrationBaselineCheck', () => {
  function buildValidPostRows(): PgQueryResult<Record<string, unknown>>[] {
    return [
      { rows: [{ count: '3' }] }, // migrationCount
      { rows: [{ is_nullable: 'YES' }] }, // priceCents
      { rows: [{ count: String(EXPECTED_PLAN_COUNT_POST_MIGRATION) }] },
      { rows: [{ count: String(EXPECTED_FEATURE_COUNT_POST_MIGRATION) }] },
      { rows: [{ count: String(EXPECTED_PLAN_FEATURE_LINK_COUNT_POST_MIGRATION) }] },
      { rows: [{ count: '0' }] }, // tenantCount
      { rows: [{ count: '0' }] }, // userCount
    ];
  }

  it('abre READ ONLY e termina com ROLLBACK', async () => {
    const { client, calls } = buildSequencedClient(buildValidPostRows());
    await runPostMigrationBaselineCheck(client);
    expect(calls[0]).toMatch(/BEGIN.*READ ONLY/i);
    expect(calls[calls.length - 1]).toMatch(/^ROLLBACK/i);
  });

  it('devolve um relatório fielmente montado', async () => {
    const { client } = buildSequencedClient(buildValidPostRows());
    const report = await runPostMigrationBaselineCheck(client);
    expect(report.migrationCount).toBe(3);
    expect(report.priceCentsIsNullable).toBe(true);
    expect(report.planCount).toBe(EXPECTED_PLAN_COUNT_POST_MIGRATION);
    expect(report.featureCount).toBe(EXPECTED_FEATURE_COUNT_POST_MIGRATION);
    expect(report.planFeatureLinkCount).toBe(EXPECTED_PLAN_FEATURE_LINK_COUNT_POST_MIGRATION);
  });
});

describe('isPostMigrationBaselineValid', () => {
  const validReport: PostMigrationBaselineReport = {
    migrationCount: 3,
    priceCentsIsNullable: true,
    planCount: EXPECTED_PLAN_COUNT_POST_MIGRATION,
    featureCount: EXPECTED_FEATURE_COUNT_POST_MIGRATION,
    planFeatureLinkCount: EXPECTED_PLAN_FEATURE_LINK_COUNT_POST_MIGRATION,
    tenantCount: 0,
    userCount: 0,
  };

  it('aceita o baseline pós-migration esperado', () => {
    expect(isPostMigrationBaselineValid(validReport)).toBe(true);
  });

  it('rejeita contagem de migrations diferente de 3', () => {
    expect(isPostMigrationBaselineValid({ ...validReport, migrationCount: 2 })).toBe(false);
  });

  it('rejeita price_cents ainda NOT NULL', () => {
    expect(isPostMigrationBaselineValid({ ...validReport, priceCentsIsNullable: false })).toBe(false);
  });

  it('rejeita contagens de catálogo divergentes', () => {
    expect(isPostMigrationBaselineValid({ ...validReport, planCount: 2 })).toBe(false);
    expect(isPostMigrationBaselineValid({ ...validReport, featureCount: 10 })).toBe(false);
    expect(isPostMigrationBaselineValid({ ...validReport, planFeatureLinkCount: 20 })).toBe(false);
  });

  it('rejeita negócio não vazio', () => {
    expect(isPostMigrationBaselineValid({ ...validReport, tenantCount: 1 })).toBe(false);
  });
});
