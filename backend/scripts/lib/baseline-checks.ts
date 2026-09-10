// Checagens de baseline (Lote 6B.7) — sempre dentro de `BEGIN TRANSACTION
// READ ONLY` terminando em `ROLLBACK`, nunca `COMMIT`: mesmo se alguém
// injetar um bug aqui, a transação em si nunca deixa escrever nada. Cada
// checagem é um número/booleano comparado contra uma constante conhecida —
// nunca "parece certo", sempre exato. Se o baseline não bater
// (`isPreMigrationBaselineValid`/`isPostMigrationBaselineValid` = false), o
// chamador (ver apply-lote6b2-production.ts) NUNCA prossegue para
// `migration:run`.
import type { PgClientLike } from './pg-client.js';

export const EXPECTED_PUBLIC_TABLE_COUNT = 31;
export const EXPECTED_PLAN_COUNT_POST_MIGRATION = 3;
export const EXPECTED_FEATURE_COUNT_POST_MIGRATION = 13;
export const EXPECTED_PLAN_FEATURE_LINK_COUNT_POST_MIGRATION = 22;

async function rollbackSafely(client: PgClientLike): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Nunca deixa um erro de ROLLBACK mascarar o erro original que causou a
    // necessidade de fazer rollback — silenciado de propósito aqui.
  }
}

export interface PreMigrationBaselineReport {
  tableCount: number;
  migrationNames: string[];
  priceCentsIsNotNull: boolean;
  planCount: number;
  featureCount: number;
  tenantCount: number;
  userCount: number;
  extensionsPresent: boolean;
}

/** Baseline esperado ANTES de aplicar migration nenhuma — usado tanto para
 * o backup (nunca escrito, ver B6) quanto para production antes do
 * `migration:run` (ver B7). Só InitialSchema aplicada, catálogo/negócio
 * vazios, `price_cents` ainda NOT NULL. */
export async function runPreMigrationBaselineCheck(
  client: PgClientLike,
): Promise<PreMigrationBaselineReport> {
  await client.query('BEGIN TRANSACTION READ ONLY');
  try {
    const tableCountResult = await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
    );
    const migrationsResult = await client.query<{ name: string }>(
      'SELECT name FROM typeorm_migrations ORDER BY id',
    );
    const priceCentsResult = await client.query<{ is_nullable: string }>(
      "SELECT is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'plans' AND column_name = 'price_cents'",
    );
    const planCountResult = await client.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM plans',
    );
    const featureCountResult = await client.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM features',
    );
    const tenantCountResult = await client.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM tenants',
    );
    const userCountResult = await client.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM users',
    );
    const extensionsResult = await client.query<{ extname: string }>(
      "SELECT extname FROM pg_extension WHERE extname = 'citext'",
    );

    await client.query('ROLLBACK');

    return {
      tableCount: Number(tableCountResult.rows[0]?.count ?? 0),
      migrationNames: migrationsResult.rows.map((row) => row.name),
      priceCentsIsNotNull: priceCentsResult.rows[0]?.is_nullable === 'NO',
      planCount: Number(planCountResult.rows[0]?.count ?? 0),
      featureCount: Number(featureCountResult.rows[0]?.count ?? 0),
      tenantCount: Number(tenantCountResult.rows[0]?.count ?? 0),
      userCount: Number(userCountResult.rows[0]?.count ?? 0),
      extensionsPresent: extensionsResult.rows.length >= 1,
    };
  } catch (error) {
    await rollbackSafely(client);
    throw error;
  }
}

export function isPreMigrationBaselineValid(report: PreMigrationBaselineReport): boolean {
  return (
    report.tableCount === EXPECTED_PUBLIC_TABLE_COUNT &&
    report.migrationNames.length === 1 &&
    report.migrationNames[0] === 'InitialSchema' &&
    report.priceCentsIsNotNull &&
    report.planCount === 0 &&
    report.featureCount === 0 &&
    report.tenantCount === 0 &&
    report.userCount === 0 &&
    report.extensionsPresent
  );
}

export interface PostMigrationBaselineReport {
  migrationCount: number;
  priceCentsIsNullable: boolean;
  planCount: number;
  featureCount: number;
  planFeatureLinkCount: number;
  tenantCount: number;
  userCount: number;
}

/** Baseline esperado DEPOIS de `AllowUndefinedPlanPrice` +
 * `InitialPlanCatalog` (só em production, nunca aplicado no backup — ver
 * B6). */
export async function runPostMigrationBaselineCheck(
  client: PgClientLike,
): Promise<PostMigrationBaselineReport> {
  await client.query('BEGIN TRANSACTION READ ONLY');
  try {
    const migrationCountResult = await client.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM typeorm_migrations',
    );
    const priceCentsResult = await client.query<{ is_nullable: string }>(
      "SELECT is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'plans' AND column_name = 'price_cents'",
    );
    const planCountResult = await client.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM plans',
    );
    const featureCountResult = await client.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM features',
    );
    const planFeatureLinkCountResult = await client.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM plan_features',
    );
    const tenantCountResult = await client.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM tenants',
    );
    const userCountResult = await client.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM users',
    );

    await client.query('ROLLBACK');

    return {
      migrationCount: Number(migrationCountResult.rows[0]?.count ?? 0),
      priceCentsIsNullable: priceCentsResult.rows[0]?.is_nullable === 'YES',
      planCount: Number(planCountResult.rows[0]?.count ?? 0),
      featureCount: Number(featureCountResult.rows[0]?.count ?? 0),
      planFeatureLinkCount: Number(planFeatureLinkCountResult.rows[0]?.count ?? 0),
      tenantCount: Number(tenantCountResult.rows[0]?.count ?? 0),
      userCount: Number(userCountResult.rows[0]?.count ?? 0),
    };
  } catch (error) {
    await rollbackSafely(client);
    throw error;
  }
}

export function isPostMigrationBaselineValid(report: PostMigrationBaselineReport): boolean {
  return (
    report.migrationCount === 3 &&
    report.priceCentsIsNullable &&
    report.planCount === EXPECTED_PLAN_COUNT_POST_MIGRATION &&
    report.featureCount === EXPECTED_FEATURE_COUNT_POST_MIGRATION &&
    report.planFeatureLinkCount === EXPECTED_PLAN_FEATURE_LINK_COUNT_POST_MIGRATION &&
    report.tenantCount === 0 &&
    report.userCount === 0
  );
}
