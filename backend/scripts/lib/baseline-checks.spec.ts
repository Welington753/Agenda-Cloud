import { describe, expect, it, vi } from 'vitest';
import type { PgClientLike, PgQueryResult } from './pg-client.js';
import { GuardedMigrationError } from './sanitize.js';
import {
  describePostMigrationBaselineFailures,
  describePreMigrationBaselineFailures,
  EXPECTED_FEATURE_COUNT_POST_MIGRATION,
  EXPECTED_INITIAL_SCHEMA_MIGRATION_NAME,
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

// A forma real que o driver `pg` devolve: COUNT(*)::text/BIGINT sempre como
// string decimal, nome de migration exatamente como o TypeORM grava (nome
// da CLASSE, timestamp colado sem separador — nunca um literal abreviado).
function buildValidPreMigrationRows(): Record<string, PgQueryResult<Record<string, unknown>>> {
  return {
    tableCount: { rows: [{ count: String(EXPECTED_PUBLIC_TABLE_COUNT) }] },
    migrations: { rows: [{ name: EXPECTED_INITIAL_SCHEMA_MIGRATION_NAME }] },
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

// Baseline real, auditado manualmente no SQL Editor do Neon dentro de
// `BEGIN TRANSACTION READ ONLY; ... ROLLBACK;` contra o branch de backup —
// exatamente a forma que o driver `pg` devolve. Bate com o baseline
// esperado, mas a execução real do workflow classificou isso como
// `ERR_BASELINE_MISMATCH` (causa: nome de migration comparado incompleto,
// não string-vs-number — os counts já eram string e já convertidos certo).
function buildRealNeonBackupRows(): PgQueryResult<Record<string, unknown>>[] {
  return [
    { rows: [{ count: '31' }] }, // tableCount
    { rows: [{ name: 'InitialSchema1788782400000' }] }, // migrations
    { rows: [{ is_nullable: 'NO' }] }, // priceCents
    { rows: [{ count: '0' }] }, // planCount
    { rows: [{ count: '0' }] }, // featureCount
    { rows: [{ count: '0' }] }, // tenantCount
    { rows: [{ count: '0' }] }, // userCount
    { rows: [{ extname: 'citext' }] }, // extensions
  ];
}

describe('baseline real do Neon (regressão do incidente de production)', () => {
  it('o baseline real do backup (auditado manualmente) é classificado como válido', async () => {
    const { client } = buildSequencedClient(buildRealNeonBackupRows());

    const report = await runPreMigrationBaselineCheck(client);

    // Não alterar este teste pra bater com a implementação — estes são os
    // valores reais confirmados manualmente no Neon; se a implementação
    // discorda deles, a implementação é que está errada.
    expect(isPreMigrationBaselineValid(report)).toBe(true);
  });

  it('o mesmo baseline real, mas com contrato interno antigo de number puro, continua válido', async () => {
    // O parser aceita number inteiro seguro além de string — o `pg` real
    // nunca devolve number para COUNT/BIGINT, mas o contrato do parser é
    // explicitamente definido pros dois formatos (ver pg-value-parsers.ts).
    const rows = buildRealNeonBackupRows();
    rows[0] = { rows: [{ count: 31 }] };
    const { client } = buildSequencedClient(rows);

    const report = await runPreMigrationBaselineCheck(client);

    expect(isPreMigrationBaselineValid(report)).toBe(true);
  });
});

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

  it('count malformado (decimal, negativo, texto) NUNCA vira número aprovado — lança e faz ROLLBACK', async () => {
    const valid = buildValidPreMigrationRows();
    const rowsWithMalformedCount = [
      { rows: [{ count: '31.5' }] }, // tableCount malformado
      valid.migrations,
      valid.priceCents,
      valid.planCount,
      valid.featureCount,
      valid.tenantCount,
      valid.userCount,
      valid.extensions,
    ];
    const { client, calls } = buildSequencedClient(rowsWithMalformedCount);

    await expect(runPreMigrationBaselineCheck(client)).rejects.toThrow(GuardedMigrationError);
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
    expect(report.migrationNames).toEqual([EXPECTED_INITIAL_SCHEMA_MIGRATION_NAME]);
    expect(report.priceCentsIsNotNull).toBe(true);
    expect(report.planCount).toBe(0);
    expect(report.extensionsPresent).toBe(true);
  });
});

describe('isPreMigrationBaselineValid', () => {
  const validReport: PreMigrationBaselineReport = {
    tableCount: EXPECTED_PUBLIC_TABLE_COUNT,
    migrationNames: [EXPECTED_INITIAL_SCHEMA_MIGRATION_NAME],
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

  it('rejeita migration ausente (histórico vazio)', () => {
    expect(isPreMigrationBaselineValid({ ...validReport, migrationNames: [] })).toBe(false);
  });

  it('rejeita migration extra além da esperada', () => {
    expect(
      isPreMigrationBaselineValid({
        ...validReport,
        migrationNames: [EXPECTED_INITIAL_SCHEMA_MIGRATION_NAME, 'Outra'],
      }),
    ).toBe(false);
  });

  it('rejeita nome de migration que não bate exatamente (ex.: sem o timestamp)', () => {
    expect(isPreMigrationBaselineValid({ ...validReport, migrationNames: ['InitialSchema'] })).toBe(false);
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

describe('describePreMigrationBaselineFailures — diagnóstico sanitizado', () => {
  const validReport: PreMigrationBaselineReport = {
    tableCount: EXPECTED_PUBLIC_TABLE_COUNT,
    migrationNames: [EXPECTED_INITIAL_SCHEMA_MIGRATION_NAME],
    priceCentsIsNotNull: true,
    planCount: 0,
    featureCount: 0,
    tenantCount: 0,
    userCount: 0,
    extensionsPresent: true,
  };
  const ALLOWED_CATEGORIES = new Set([
    'table_count',
    'migration_history',
    'price_nullability',
    'business_counts',
    'extensions',
  ]);

  it('vazio quando o baseline é válido', () => {
    expect(describePreMigrationBaselineFailures(validReport)).toEqual([]);
  });

  it('lista só categorias sanitizadas, nunca dado de query — cada falha isolada aponta sua própria categoria', () => {
    expect(describePreMigrationBaselineFailures({ ...validReport, tableCount: 30 })).toEqual(['table_count']);
    expect(describePreMigrationBaselineFailures({ ...validReport, migrationNames: [] })).toEqual([
      'migration_history',
    ]);
    expect(describePreMigrationBaselineFailures({ ...validReport, priceCentsIsNotNull: false })).toEqual([
      'price_nullability',
    ]);
    expect(describePreMigrationBaselineFailures({ ...validReport, planCount: 1 })).toEqual(['business_counts']);
    expect(describePreMigrationBaselineFailures({ ...validReport, extensionsPresent: false })).toEqual([
      'extensions',
    ]);
  });

  it('toda categoria retornada pertence ao conjunto sanitizado permitido', () => {
    const failures = describePreMigrationBaselineFailures({
      ...validReport,
      tableCount: 1,
      migrationNames: [],
      priceCentsIsNotNull: false,
      planCount: 1,
      extensionsPresent: false,
    });
    for (const category of failures) {
      expect(ALLOWED_CATEGORIES.has(category)).toBe(true);
    }
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

describe('describePostMigrationBaselineFailures — diagnóstico sanitizado', () => {
  const validReport: PostMigrationBaselineReport = {
    migrationCount: 3,
    priceCentsIsNullable: true,
    planCount: EXPECTED_PLAN_COUNT_POST_MIGRATION,
    featureCount: EXPECTED_FEATURE_COUNT_POST_MIGRATION,
    planFeatureLinkCount: EXPECTED_PLAN_FEATURE_LINK_COUNT_POST_MIGRATION,
    tenantCount: 0,
    userCount: 0,
  };

  it('vazio quando o baseline é válido', () => {
    expect(describePostMigrationBaselineFailures(validReport)).toEqual([]);
  });

  it('nenhuma categoria retornada contém URL, host, endpoint ou credencial', () => {
    const failures = describePostMigrationBaselineFailures({
      ...validReport,
      migrationCount: 1,
      priceCentsIsNullable: false,
      planCount: 0,
      tenantCount: 5,
    });
    const joined = failures.join(' ');
    expect(joined).not.toMatch(/postgres(?:ql)?:\/\//i);
    expect(joined).not.toMatch(/\.neon\.tech/i);
    expect(joined).not.toMatch(/\bep-[a-z0-9-]+\b/i);
  });
});
