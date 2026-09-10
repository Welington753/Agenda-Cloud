// Orquestrador do workflow guardado de migration em production (Lote 6B.7)
// — chamado pelo `.github/workflows/apply-lote6b2-production.yml`, nunca
// disparado automaticamente. Tudo injetado (cliente Postgres, processo,
// env, branch, confirmação, log) — sem nenhuma dependência de rede/processo
// real amarrada no código, o que é o que torna isto testável sem banco (ver
// apply-lote6b2-production.spec.ts).
//
// Sequência, cada etapa capaz de parar tudo:
//   1. confirmação manual exata
//   2. branch exata
//   3. secrets presentes
//   4. URLs válidas (scheme, sem pooler, Endpoint ID bate)
//   5. os três endpoints distintos entre si
//   6. baseline do BACKUP (só leitura — nunca aplica migration nele)
//   7. baseline PRÉ-migration de production
//   8. `migration:show`; se nada pendente, pula `migration:run` (idempotente)
//   9. `migration:run -- -t all` (uma única tentativa — nunca retry automático)
//  10. baseline PÓS-migration de production
//
// Qualquer etapa que falhe retorna `{success:false, code}` sem lançar — o
// chamador (workflow) decide o exit code do job a partir disso, sempre só
// com o `code` sanitizado no log.
import {
  assertConfirmationPhrase,
  assertRoleDistinctness,
  assertRunningFromBranch,
  validateDirectUrl,
} from './lib/connection-guard.js';
import { readRequiredSecrets } from './lib/env-secrets.js';
import { countPendingMigrations } from './lib/migration-output.js';
import type { PgClientLike } from './lib/pg-client.js';
import type { ProcessRunner } from './lib/process-runner.js';
import { toSanitizedFailure, type SanitizedErrorCode } from './lib/sanitize.js';
import {
  isPostMigrationBaselineValid,
  isPreMigrationBaselineValid,
  runPostMigrationBaselineCheck,
  runPreMigrationBaselineCheck,
} from './lib/baseline-checks.js';

interface EnvLike {
  [key: string]: string | undefined;
}

export interface ApplyLote6b2Deps {
  env: EnvLike;
  confirmation: string | undefined;
  currentBranch: string | undefined;
  createClient: (connectionString: string) => Promise<PgClientLike>;
  processRunner: ProcessRunner;
  log: (line: string) => void;
}

export interface ApplyLote6b2Result {
  success: boolean;
  code?: SanitizedErrorCode;
}

async function withClient<T>(
  deps: ApplyLote6b2Deps,
  connectionString: string,
  work: (client: PgClientLike) => Promise<T>,
): Promise<T> {
  const client = await deps.createClient(connectionString);
  try {
    await client.connect();
    return await work(client);
  } finally {
    await client.end();
  }
}

export async function applyLote6b2Production(deps: ApplyLote6b2Deps): Promise<ApplyLote6b2Result> {
  try {
    assertConfirmationPhrase(deps.confirmation);
    assertRunningFromBranch(deps.currentBranch);

    const secrets = readRequiredSecrets(deps.env);
    const { endpointId: productionEndpointId } = validateDirectUrl(
      secrets.productionDirectUrl,
      secrets.productionEndpointId,
    );
    const { endpointId: backupEndpointId } = validateDirectUrl(
      secrets.backupDirectUrl,
      secrets.backupEndpointId,
    );
    assertRoleDistinctness({
      production: productionEndpointId,
      backup: backupEndpointId,
      validation: secrets.validationEndpointId,
    });

    const backupReport = await withClient(deps, secrets.backupDirectUrl, runPreMigrationBaselineCheck);
    const backupValid = isPreMigrationBaselineValid(backupReport);
    deps.log(`BASELINE_BACKUP: ${backupValid}`);
    if (!backupValid) {
      return { success: false, code: 'ERR_BASELINE_MISMATCH' };
    }

    const productionPreReport = await withClient(
      deps,
      secrets.productionDirectUrl,
      runPreMigrationBaselineCheck,
    );
    const productionPreValid = isPreMigrationBaselineValid(productionPreReport);
    deps.log(`BASELINE_PRODUCTION_PRE: ${productionPreValid}`);
    if (!productionPreValid) {
      return { success: false, code: 'ERR_BASELINE_MISMATCH' };
    }

    const productionEnv = { ...deps.env, DIRECT_URL: secrets.productionDirectUrl } as NodeJS.ProcessEnv;
    const showResult = await deps.processRunner.run('npm', ['run', 'migration:show'], {
      cwd: 'backend',
      env: productionEnv,
    });
    const pending = countPendingMigrations(showResult.stdout);

    if (pending === 0) {
      deps.log('MIGRATION_RUN: SKIPPED_NO_PENDING');
    } else {
      // Uma única tentativa — nunca um loop de retry. Um resultado ambíguo
      // (código de saída != 0) é reportado e para aqui; decidir se/como
      // tentar de novo é uma decisão humana (ver runbook), nunca automática.
      const runResult = await deps.processRunner.run('npm', ['run', 'migration:run', '--', '-t', 'all'], {
        cwd: 'backend',
        env: productionEnv,
      });
      if (runResult.code !== 0) {
        deps.log('MIGRATION_RUN: FAILED');
        return { success: false, code: 'ERR_AMBIGUOUS_RESULT' };
      }
      deps.log('MIGRATION_RUN: SUCCESS');
    }

    const productionPostReport = await withClient(
      deps,
      secrets.productionDirectUrl,
      runPostMigrationBaselineCheck,
    );
    const productionPostValid = isPostMigrationBaselineValid(productionPostReport);
    deps.log(`BASELINE_PRODUCTION_POST: ${productionPostValid}`);
    if (!productionPostValid) {
      return { success: false, code: 'ERR_BASELINE_MISMATCH' };
    }

    return { success: true };
  } catch (error) {
    const failure = toSanitizedFailure(error);
    deps.log(`FAILURE: ${failure.code}`);
    return { success: false, code: failure.code };
  }
}
