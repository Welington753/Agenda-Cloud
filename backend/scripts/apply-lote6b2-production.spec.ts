import { describe, expect, it, vi } from 'vitest';
import type { PgClientLike, PgQueryResult } from './lib/pg-client.js';
import type { ProcessResult, ProcessRunner } from './lib/process-runner.js';
import { applyLote6b2Production } from './apply-lote6b2-production.js';

const VALID_ENV = {
  L6B2_PRODUCTION_DIRECT_URL: 'postgresql://u:p@ep-prod-1.sa-east-1.aws.neon.tech/db',
  L6B2_BACKUP_DIRECT_URL: 'postgresql://u:p@ep-backup-1.sa-east-1.aws.neon.tech/db',
  L6B2_PRODUCTION_ENDPOINT_ID: 'ep-prod-1',
  L6B2_BACKUP_ENDPOINT_ID: 'ep-backup-1',
  L6B2_VALIDATION_ENDPOINT_ID: 'ep-validation-1',
  L6B2_BACKUP_BRANCH_NAME: 'backup-lote-6b2',
};
const VALID_CONFIRMATION = 'APLICAR_LOTE_6B2_PRODUCTION';
const VALID_BRANCH = 'integration/nestjs-typeorm-frontend';

function row(count: string | number): PgQueryResult<Record<string, unknown>> {
  return { rows: [{ count: String(count) }] };
}

function buildValidPreMigrationSequence(): PgQueryResult<Record<string, unknown>>[] {
  return [
    row(31),
    { rows: [{ name: 'InitialSchema' }] },
    { rows: [{ is_nullable: 'NO' }] },
    row(0),
    row(0),
    row(0),
    row(0),
    { rows: [{ extname: 'citext' }] },
  ];
}

function buildValidPostMigrationSequence(): PgQueryResult<Record<string, unknown>>[] {
  return [row(3), { rows: [{ is_nullable: 'YES' }] }, row(3), row(13), row(22), row(0), row(0)];
}

function buildSequencedClient(rowsInOrder: PgQueryResult<Record<string, unknown>>[]) {
  let index = 0;
  const queryLog: string[] = [];
  const client: PgClientLike = {
    connect: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockImplementation(async (sql: string) => {
      queryLog.push(sql);
      if (/^BEGIN|^ROLLBACK|^COMMIT/i.test(sql.trim())) return { rows: [] };
      return rowsInOrder[index++] ?? { rows: [] };
    }),
    end: vi.fn().mockResolvedValue(undefined),
  };
  return { client, queryLog };
}

function buildDeps(overrides: {
  env?: Record<string, string>;
  confirmation?: string;
  currentBranch?: string;
  clientsByUrl?: Record<string, () => PgClientLike>;
  processRunnerRun?: ProcessRunner['run'];
}) {
  const createClientCalls: string[] = [];
  const createClient = vi.fn(async (connectionString: string) => {
    createClientCalls.push(connectionString);
    const factory = overrides.clientsByUrl?.[connectionString];
    if (!factory) {
      throw new Error(`teste não configurou cliente fake para ${connectionString.slice(0, 10)}...`);
    }
    return factory();
  });

  const logLines: string[] = [];
  const log = (line: string) => logLines.push(line);

  const processRunner: ProcessRunner = {
    run:
      overrides.processRunnerRun ??
      vi.fn(async (): Promise<ProcessResult> => ({ code: 0, stdout: '', stderr: '' })),
  };

  return {
    deps: {
      env: overrides.env ?? VALID_ENV,
      confirmation: overrides.confirmation ?? VALID_CONFIRMATION,
      currentBranch: overrides.currentBranch ?? VALID_BRANCH,
      createClient,
      processRunner,
      log,
    },
    createClientCalls,
    logLines,
    processRunner,
  };
}

describe('applyLote6b2Production', () => {
  it('confirmação incorreta: para imediatamente, nunca cria cliente nenhum', async () => {
    const { deps, createClientCalls } = buildDeps({ confirmation: 'coisa-errada' });

    const result = await applyLote6b2Production(deps);

    expect(result.success).toBe(false);
    expect(result.code).toBe('ERR_CONFIRMATION_MISMATCH');
    expect(createClientCalls).toHaveLength(0);
  });

  it('branch incorreta: para imediatamente, nunca cria cliente nenhum', async () => {
    const { deps, createClientCalls } = buildDeps({ currentBranch: 'feat/outra-coisa' });

    const result = await applyLote6b2Production(deps);

    expect(result.success).toBe(false);
    expect(result.code).toBe('ERR_WRONG_BRANCH');
    expect(createClientCalls).toHaveLength(0);
  });

  it('secret ausente: para imediatamente com ERR_MISSING_SECRET', async () => {
    const { L6B2_PRODUCTION_DIRECT_URL: _omit, ...envSemProducao } = VALID_ENV;
    const { deps, createClientCalls } = buildDeps({ env: envSemProducao });

    const result = await applyLote6b2Production(deps);

    expect(result.success).toBe(false);
    expect(result.code).toBe('ERR_MISSING_SECRET');
    expect(createClientCalls).toHaveLength(0);
  });

  it('URL de production com pooler: para com ERR_POOLER_FORBIDDEN', async () => {
    const { deps } = buildDeps({
      env: { ...VALID_ENV, L6B2_PRODUCTION_DIRECT_URL: 'postgresql://u:p@ep-prod-1-pooler.neon.tech/db' },
    });

    const result = await applyLote6b2Production(deps);

    expect(result.success).toBe(false);
    expect(result.code).toBe('ERR_POOLER_FORBIDDEN');
  });

  it('endpoint de backup igual ao de production: para com ERR_BACKUP_AS_PRODUCTION', async () => {
    const { deps } = buildDeps({
      env: {
        ...VALID_ENV,
        L6B2_BACKUP_DIRECT_URL: VALID_ENV.L6B2_PRODUCTION_DIRECT_URL,
        L6B2_BACKUP_ENDPOINT_ID: VALID_ENV.L6B2_PRODUCTION_ENDPOINT_ID,
      },
    });

    const result = await applyLote6b2Production(deps);

    expect(result.success).toBe(false);
    expect(result.code).toBe('ERR_BACKUP_AS_PRODUCTION');
  });

  it('baseline do backup divergente: para SEM nunca conectar em production', async () => {
    const backupClient = buildSequencedClient([row(30) /* tableCount errado */]).client;
    const { deps, createClientCalls, processRunner } = buildDeps({
      clientsByUrl: { [VALID_ENV.L6B2_BACKUP_DIRECT_URL]: () => backupClient },
    });

    const result = await applyLote6b2Production(deps);

    expect(result.success).toBe(false);
    expect(result.code).toBe('ERR_BASELINE_MISMATCH');
    expect(createClientCalls).toEqual([VALID_ENV.L6B2_BACKUP_DIRECT_URL]);
    expect(processRunner.run).not.toHaveBeenCalled();
  });

  it('backup só recebe SELECT/BEGIN/ROLLBACK — nunca uma função de escrita', async () => {
    const { client: backupClient, queryLog } = buildSequencedClient(buildValidPreMigrationSequence());
    const { client: prodClient } = buildSequencedClient([row(30) /* production diverge, para aqui */]);
    const { deps } = buildDeps({
      clientsByUrl: {
        [VALID_ENV.L6B2_BACKUP_DIRECT_URL]: () => backupClient,
        [VALID_ENV.L6B2_PRODUCTION_DIRECT_URL]: () => prodClient,
      },
    });

    await applyLote6b2Production(deps);

    for (const sql of queryLog) {
      expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\b/i);
    }
  });

  it('baseline pré-migration de production divergente: para sem chamar migration:run', async () => {
    const { client: backupClient } = buildSequencedClient(buildValidPreMigrationSequence());
    const { client: prodClient } = buildSequencedClient([row(999) /* tableCount errado */]);
    const { deps, processRunner } = buildDeps({
      clientsByUrl: {
        [VALID_ENV.L6B2_BACKUP_DIRECT_URL]: () => backupClient,
        [VALID_ENV.L6B2_PRODUCTION_DIRECT_URL]: () => prodClient,
      },
    });

    const result = await applyLote6b2Production(deps);

    expect(result.success).toBe(false);
    expect(result.code).toBe('ERR_BASELINE_MISMATCH');
    expect(processRunner.run).not.toHaveBeenCalled();
  });

  it('caminho feliz completo: backup ok, production pré ok, migration:run ok, pós ok — sucesso', async () => {
    const { client: backupClient } = buildSequencedClient(buildValidPreMigrationSequence());
    const { client: prodPreClient } = buildSequencedClient(buildValidPreMigrationSequence());
    const { client: prodPostClient } = buildSequencedClient(buildValidPostMigrationSequence());
    let prodClientCallCount = 0;
    const prodClientFactory = () => (prodClientCallCount++ === 0 ? prodPreClient : prodPostClient);

    const runCalls: Array<{ command: string; args: string[] }> = [];
    const processRunnerRun: ProcessRunner['run'] = vi.fn(async (command, args) => {
      runCalls.push({ command, args });
      if (args.includes('migration:show')) {
        return { code: 0, stdout: '[ ] AllowUndefinedPlanPrice\n[ ] InitialPlanCatalog', stderr: '' };
      }
      return { code: 0, stdout: '', stderr: '' };
    });

    const { deps } = buildDeps({
      clientsByUrl: {
        [VALID_ENV.L6B2_BACKUP_DIRECT_URL]: () => backupClient,
        [VALID_ENV.L6B2_PRODUCTION_DIRECT_URL]: prodClientFactory,
      },
      processRunnerRun,
    });

    const result = await applyLote6b2Production(deps);

    expect(result.success).toBe(true);
    expect(runCalls.some((c) => c.args.includes('migration:run'))).toBe(true);
  });

  it('pós-baseline divergente DEPOIS de migration:run bem-sucedido: código distinto de falha pré-escrita', async () => {
    const { client: backupClient } = buildSequencedClient(buildValidPreMigrationSequence());
    const { client: prodPreClient } = buildSequencedClient(buildValidPreMigrationSequence());
    const { client: prodPostClient } = buildSequencedClient([row(999) /* pós diverge */]);
    let prodClientCallCount = 0;
    const prodClientFactory = () => (prodClientCallCount++ === 0 ? prodPreClient : prodPostClient);

    const processRunnerRun: ProcessRunner['run'] = vi.fn(async (_command, args) => {
      if (args.includes('migration:show')) {
        return { code: 0, stdout: '[ ] AllowUndefinedPlanPrice\n[ ] InitialPlanCatalog', stderr: '' };
      }
      return { code: 0, stdout: '', stderr: '' };
    });

    const { deps } = buildDeps({
      clientsByUrl: {
        [VALID_ENV.L6B2_BACKUP_DIRECT_URL]: () => backupClient,
        [VALID_ENV.L6B2_PRODUCTION_DIRECT_URL]: prodClientFactory,
      },
      processRunnerRun,
    });

    const result = await applyLote6b2Production(deps);

    expect(result.success).toBe(false);
    expect(result.code).toBe('ERR_POST_MIGRATION_BASELINE_MISMATCH');
    expect(result.code).not.toBe('ERR_BASELINE_MISMATCH');
  });

  it('migration:run com código de saída não-zero: reporta falha e NUNCA tenta de novo automaticamente', async () => {
    const { client: backupClient } = buildSequencedClient(buildValidPreMigrationSequence());
    const { client: prodPreClient } = buildSequencedClient(buildValidPreMigrationSequence());

    let migrationRunCalls = 0;
    const processRunnerRun: ProcessRunner['run'] = vi.fn(async (_command, args) => {
      if (args.includes('migration:show')) {
        return { code: 0, stdout: '[ ] AllowUndefinedPlanPrice', stderr: '' };
      }
      if (args.includes('migration:run')) {
        migrationRunCalls++;
        return { code: 1, stdout: '', stderr: 'connect ETIMEDOUT postgresql://u:p@ep-prod-1.neon.tech/db' };
      }
      return { code: 0, stdout: '', stderr: '' };
    });

    const { deps } = buildDeps({
      clientsByUrl: {
        [VALID_ENV.L6B2_BACKUP_DIRECT_URL]: () => backupClient,
        [VALID_ENV.L6B2_PRODUCTION_DIRECT_URL]: () => prodPreClient,
      },
      processRunnerRun,
    });

    const result = await applyLote6b2Production(deps);

    expect(result.success).toBe(false);
    expect(result.code).toBe('ERR_AMBIGUOUS_RESULT');
    expect(migrationRunCalls).toBe(1);
  });

  it('segunda execução (nada pendente): pula migration:run, ainda valida pós-baseline e sucede', async () => {
    const { client: backupClient } = buildSequencedClient(buildValidPreMigrationSequence());
    const { client: prodPreClient } = buildSequencedClient(buildValidPreMigrationSequence());
    const { client: prodPostClient } = buildSequencedClient(buildValidPostMigrationSequence());
    let prodCallCount = 0;
    const prodClientFactory = () => (prodCallCount++ === 0 ? prodPreClient : prodPostClient);

    const processRunnerRun: ProcessRunner['run'] = vi.fn(async (_command, args) => {
      if (args.includes('migration:show')) {
        return { code: 0, stdout: '[X] InitialSchema\n[X] AllowUndefinedPlanPrice\n[X] InitialPlanCatalog', stderr: '' };
      }
      return { code: 0, stdout: '', stderr: '' };
    });

    const { deps } = buildDeps({
      clientsByUrl: {
        [VALID_ENV.L6B2_BACKUP_DIRECT_URL]: () => backupClient,
        [VALID_ENV.L6B2_PRODUCTION_DIRECT_URL]: prodClientFactory,
      },
      processRunnerRun,
    });

    const result = await applyLote6b2Production(deps);

    expect(result.success).toBe(true);
    const migrationRunCalls = (processRunnerRun as ReturnType<typeof vi.fn>).mock.calls.filter(([, args]) =>
      (args as string[]).includes('migration:run'),
    );
    expect(migrationRunCalls).toHaveLength(0);
  });

  it('env do processo filho (migration:show/migration:run) nunca contém secrets além de DIRECT_URL de production', async () => {
    const { client: backupClient } = buildSequencedClient(buildValidPreMigrationSequence());
    const { client: prodPreClient } = buildSequencedClient(buildValidPreMigrationSequence());
    const { client: prodPostClient } = buildSequencedClient(buildValidPostMigrationSequence());
    let prodClientCallCount = 0;
    const prodClientFactory = () => (prodClientCallCount++ === 0 ? prodPreClient : prodPostClient);

    const envsSeenByChildProcess: NodeJS.ProcessEnv[] = [];
    const processRunnerRun: ProcessRunner['run'] = vi.fn(async (_command, args, options) => {
      envsSeenByChildProcess.push(options?.env ?? {});
      if (args.includes('migration:show')) {
        return { code: 0, stdout: '[ ] AllowUndefinedPlanPrice\n[ ] InitialPlanCatalog', stderr: '' };
      }
      return { code: 0, stdout: '', stderr: '' };
    });

    const { deps } = buildDeps({
      env: { ...VALID_ENV, CONFIRMATION: VALID_CONFIRMATION },
      clientsByUrl: {
        [VALID_ENV.L6B2_BACKUP_DIRECT_URL]: () => backupClient,
        [VALID_ENV.L6B2_PRODUCTION_DIRECT_URL]: prodClientFactory,
      },
      processRunnerRun,
    });

    await applyLote6b2Production(deps);

    expect(envsSeenByChildProcess.length).toBeGreaterThan(0);
    for (const env of envsSeenByChildProcess) {
      expect(env.L6B2_BACKUP_DIRECT_URL).toBeUndefined();
      expect(env.L6B2_PRODUCTION_ENDPOINT_ID).toBeUndefined();
      expect(env.L6B2_BACKUP_ENDPOINT_ID).toBeUndefined();
      expect(env.L6B2_VALIDATION_ENDPOINT_ID).toBeUndefined();
      expect(env.CONFIRMATION).toBeUndefined();
      expect(env.DIRECT_URL).toBe(VALID_ENV.L6B2_PRODUCTION_DIRECT_URL);
    }
  });

  it('saída (log) nunca contém URL/host/senha — só linhas sanitizadas', async () => {
    const { client: backupClient } = buildSequencedClient([row(30)]);
    const { deps, logLines } = buildDeps({
      clientsByUrl: { [VALID_ENV.L6B2_BACKUP_DIRECT_URL]: () => backupClient },
    });

    await applyLote6b2Production(deps);

    const joined = logLines.join('\n');
    expect(joined).not.toContain('postgresql://');
    expect(joined).not.toContain('ep-prod-1');
    expect(joined).not.toContain('ep-backup-1');
  });
});
