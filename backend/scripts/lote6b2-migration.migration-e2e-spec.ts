// Teste de integração real do Lote 6B.10 — prova, contra um PostgreSQL
// DESCARTÁVEL de verdade (nunca Neon, nunca banco existente), que o
// caminho real de production (artefatos compilados em `dist-migrations/` →
// `createChildProcessRunner()` real → `npm run migration:show:compiled`/
// `migration:run:compiled` → `parseMigrationShowOutput`/
// `validateMigrationShowStatus` reais) funciona ponta a ponta, inclusive
// sob as condições de ambiente do runner real (`CI=true`, que ativa a
// injeção de ANSI do TypeORM via `ansis` — causa raiz comprovada da
// execução real #6).
//
// Só roda quando `MIGRATION_E2E_DIRECT_URL` está definida — nunca
// localmente por acidente, nunca contra um banco que não seja o descartável
// provisionado pelo workflow de CI (ver
// .github/workflows/test-migration-lote6b2.yml). `rejectUnauthorized: true`
// nunca é enfraquecido: TLS real, confiado via `NODE_EXTRA_CA_CERTS`
// (certificado autoassinado gerado só para este teste).
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DataSource } from 'typeorm';
import { describe, expect, it, beforeAll } from 'vitest';
import { createPgClient } from './lib/pg-client.js';
import { createChildProcessRunner } from './lib/process-runner.js';
import {
  EXPECTED_LOTE_6B2_MIGRATION_NAMES,
  parseMigrationShowOutput,
  validateMigrationShowStatus,
} from './lib/migration-output.js';
import { EXPECTED_INITIAL_SCHEMA_MIGRATION_NAME } from './lib/baseline-checks.js';

const DIRECT_URL = process.env.MIGRATION_E2E_DIRECT_URL;

describe.skipIf(!DIRECT_URL)('Lote 6B.2 — integração real com PostgreSQL descartável', () => {
  const directUrl = DIRECT_URL as string;
  const processRunner = createChildProcessRunner();
  const backendDir = process.cwd();
  const distMigrationsDataSource = path.join(backendDir, 'dist-migrations/database/migrations-data-source.js');
  const distInitialSchemaMigration = path.join(
    backendDir,
    'dist-migrations/migrations/1788782400000-InitialSchema.js',
  );

  // Ambiente do subprocesso: espelha exatamente o que
  // apply-lote6b2-production.ts monta (DIRECT_URL + NO_COLOR), nunca
  // secrets de verdade — só a URL fictícia/local deste banco descartável.
  // `process.env` é repassado (não substituído) porque o subprocesso real
  // precisa achar `node`/`npm` via PATH, igual em production.
  const guardedEnv = { ...process.env, DIRECT_URL: directUrl, NO_COLOR: '1' };

  beforeAll(async () => {
    // Harness real (nunca reescreve a migration): usa a CLASSE compilada de
    // verdade, rodando só via o mecanismo real do TypeORM
    // (`DataSource.runMigrations`), pra preparar o baseline "1 aplicada, 2
    // pendentes" antes do teste real do CLI.
    const migrationModule = (await import(pathToFileURL(distInitialSchemaMigration).href)) as Record<
      string,
      new () => import('typeorm').MigrationInterface
    >;
    const InitialSchemaClass = migrationModule.InitialSchema1788782400000;
    if (!InitialSchemaClass) {
      throw new Error('InitialSchema1788782400000 não exportada pelo módulo compilado (dist-migrations quebrado)');
    }

    const setupDataSource = new DataSource({
      type: 'postgres',
      url: directUrl,
      ssl: { rejectUnauthorized: true },
      entities: [],
      migrations: [InitialSchemaClass],
      migrationsTableName: 'typeorm_migrations',
      synchronize: false,
      migrationsRun: false,
      logging: false,
    });
    await setupDataSource.initialize();
    await setupDataSource.runMigrations({ transaction: 'all' });
    await setupDataSource.destroy();
  });

  it('DataSource de migrations compilado expõe exatamente uma instância e as três migrations deste lote', async () => {
    const mod = (await import(pathToFileURL(distMigrationsDataSource).href)) as Record<string, unknown>;
    const dataSourceExports = Object.values(mod).filter((value) => value instanceof DataSource);
    expect(dataSourceExports).toHaveLength(1);

    const { importClassesFromDirectories } = await import('typeorm/util/DirectoryExportedClassesLoader.js');
    const options = (mod.migrationsDataSourceOptions ?? {}) as { migrations: string[] };
    const fakeLogger = { log: () => {} };
    const migrationClasses = (await importClassesFromDirectories(
      fakeLogger as never,
      options.migrations,
    )) as Array<{ name: string }>;
    expect(new Set(migrationClasses.map((c) => c.name))).toEqual(new Set(EXPECTED_LOTE_6B2_MIGRATION_NAMES));
  });

  it('migration:show:compiled via process-runner real: reconhece 1 aplicada + 2 pendentes', async () => {
    const result = await processRunner.run('npm', ['run', 'migration:show:compiled'], { env: guardedEnv });

    expect(result.code).toBe(0);
    const status = parseMigrationShowOutput(result.stdout);
    expect(validateMigrationShowStatus(status)).toBeNull();
    expect(status.appliedNames).toEqual([EXPECTED_INITIAL_SCHEMA_MIGRATION_NAME]);
    expect(status.pendingNames.sort()).toEqual(
      ['AllowUndefinedPlanPrice1788782450000', 'InitialPlanCatalog1788782460000'].sort(),
    );
  });

  // Prova real (não simulada) da causa raiz da execução #6: sob `CI=true`
  // (sempre presente neste runner), o TypeORM emite ANSI mesmo sem
  // `NO_COLOR` — e o parser (`migration-output.ts`) precisa reconhecer as
  // migrations mesmo assim, como defesa em profundidade independente da
  // correção primária.
  it('defesa em profundidade: migration:show:compiled SEM NO_COLOR ainda é reconhecido pelo parser sob CI real', async () => {
    const envWithoutNoColor: NodeJS.ProcessEnv = { ...process.env, DIRECT_URL: directUrl };
    delete envWithoutNoColor.NO_COLOR;
    const result = await processRunner.run('npm', ['run', 'migration:show:compiled'], { env: envWithoutNoColor });

    expect(result.code).toBe(0);
    const status = parseMigrationShowOutput(result.stdout);
    expect(validateMigrationShowStatus(status)).toBeNull();
    expect(status.pendingNames).toHaveLength(2);
  });

  it('migration:run:compiled -- -t all via process-runner real: aplica as duas pendentes', async () => {
    const result = await processRunner.run('npm', ['run', 'migration:run:compiled', '--', '-t', 'all'], {
      env: guardedEnv,
    });

    expect(result.code).toBe(0);
  });

  it('estado final do banco bate exatamente com o baseline pós-migration esperado', async () => {
    const client = await createPgClient(directUrl);
    await client.connect();
    try {
      const tables = await client.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'",
      );
      const migrations = await client.query<{ name: string }>('SELECT name FROM typeorm_migrations ORDER BY id');
      const extensions = await client.query<{ extname: string }>(
        "SELECT extname FROM pg_extension WHERE extname IN ('citext','btree_gist')",
      );
      const priceNullable = await client.query<{ is_nullable: string }>(
        "SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='plans' AND column_name='price_cents'",
      );
      const plans = await client.query<{ price_cents: string | null }>('SELECT price_cents FROM plans');
      const features = await client.query<{ n: string }>('SELECT count(*)::text AS n FROM features');
      const planFeatures = await client.query<{ n: string }>('SELECT count(*)::text AS n FROM plan_features');
      const tenants = await client.query<{ n: string }>('SELECT count(*)::text AS n FROM tenants');
      const users = await client.query<{ n: string }>('SELECT count(*)::text AS n FROM users');

      expect(Number(tables.rows[0]?.n)).toBe(31);
      expect(migrations.rows.map((r) => r.name).sort()).toEqual([...EXPECTED_LOTE_6B2_MIGRATION_NAMES].sort());
      expect(extensions.rows.map((r) => r.extname).sort()).toEqual(['btree_gist', 'citext']);
      expect(priceNullable.rows[0]?.is_nullable).toBe('YES');
      expect(plans.rows).toHaveLength(3);
      expect(plans.rows.every((p) => p.price_cents === null)).toBe(true);
      expect(Number(features.rows[0]?.n)).toBe(13);
      expect(Number(planFeatures.rows[0]?.n)).toBe(22);
      expect(Number(tenants.rows[0]?.n)).toBe(0);
      expect(Number(users.rows[0]?.n)).toBe(0);
    } finally {
      await client.end();
    }
  });

  it('segunda execução de migration:show:compiled: as três aparecem aplicadas', async () => {
    const result = await processRunner.run('npm', ['run', 'migration:show:compiled'], { env: guardedEnv });

    expect(result.code).toBe(0);
    const status = parseMigrationShowOutput(result.stdout);
    expect(status.pendingNames).toHaveLength(0);
    expect(status.appliedNames.sort()).toEqual([...EXPECTED_LOTE_6B2_MIGRATION_NAMES].sort());
    expect(validateMigrationShowStatus(status)).toBeNull();
  });

  it('idempotência: repetir migration:run:compiled não duplica dados nem migrations', async () => {
    const result = await processRunner.run('npm', ['run', 'migration:run:compiled', '--', '-t', 'all'], {
      env: guardedEnv,
    });
    expect(result.code).toBe(0);

    const client = await createPgClient(directUrl);
    await client.connect();
    try {
      const migrations = await client.query<{ n: string }>('SELECT count(*)::text AS n FROM typeorm_migrations');
      const plans = await client.query<{ n: string }>('SELECT count(*)::text AS n FROM plans');
      const features = await client.query<{ n: string }>('SELECT count(*)::text AS n FROM features');
      const planFeatures = await client.query<{ n: string }>('SELECT count(*)::text AS n FROM plan_features');

      expect(Number(migrations.rows[0]?.n)).toBe(3);
      expect(Number(plans.rows[0]?.n)).toBe(3);
      expect(Number(features.rows[0]?.n)).toBe(13);
      expect(Number(planFeatures.rows[0]?.n)).toBe(22);
    } finally {
      await client.end();
    }
  });
});
