// Conferência SÓ DE LEITURA do banco do piloto, antes e depois de aplicar as
// migrations compiladas (ver docs/runbooks/publicacao-piloto-render.md,
// seção 4). Nunca escreve: as consultas rodam em `BEGIN TRANSACTION READ
// ONLY` e terminam em `ROLLBACK`, e este módulo nunca chama `migration:run`.
//
// Antes de qualquer conexão, confere o DESTINO pela URL: scheme, conexão
// direta (sem pooler), Endpoint ID igual ao informado para o piloto,
// diferente do production existente, e TLS com verificação de certificado.
// Saída só em linhas fixas `NOME: valor`, sem URL, host nem Endpoint ID.
import {
  describePostMigrationBaselineFailures,
  runPostMigrationBaselineCheck,
} from './baseline-checks.js';
import { validateDirectUrl } from './connection-guard.js';
import {
  compararObjetos,
  descreverFalhasAntes,
  descreverFalhasDepois,
  lerEstadoNotificacoesAgendamentoPublico,
  TOTAL_OBJETOS_ESPERADOS,
} from './notificacoes-agendamento-publico-schema.js';
import {
  falhasAntesDeContas,
  falhasDepoisDeContas,
  lerEstadoContas,
  objetosPresentes,
  TOTAL_OBJETOS_CONTAS,
} from './contas-administracao-schema.js';
import {
  falhasAntesDeEquipe,
  falhasDepoisDeEquipe,
  lerEstadoEquipe,
  objetosEquipePresentes,
  TOTAL_OBJETOS_EQUIPE,
} from './equipe-acessos-schema.js';
import {
  falhasAntesDeAcessoRecebimentos,
  falhasDepoisDeAcessoRecebimentos,
  lerEstadoAcessoRecebimentos,
  objetosAcessoRecebimentosPresentes,
  TOTAL_OBJETOS_ACESSO_RECEBIMENTOS,
} from './acesso-recebimentos-schema.js';
import type { PgClientLike } from './pg-client.js';
import { parseNonNegativeInteger } from './pg-value-parsers.js';
import { GuardedMigrationError, toSanitizedFailure, type SanitizedErrorCode } from './sanitize.js';

/** `before-notifications-public-booking`/`after-notifications-public-booking`:
 * antes e depois de aplicar NotificationJobs e PublicBooking num piloto que
 * já tem dados (ver notificacoes-agendamento-publico-schema.ts). */
export type PilotExpectation =
  | 'empty'
  | 'initialized'
  | 'before-notifications-public-booking'
  | 'after-notifications-public-booking'
  | 'before-accounts-administration'
  | 'after-accounts-administration'
  | 'before-team-access'
  | 'after-team-access'
  | 'before-staff-payments'
  | 'after-staff-payments';

const EXPECTATIVAS: readonly PilotExpectation[] = [
  'empty',
  'initialized',
  'before-notifications-public-booking',
  'after-notifications-public-booking',
  'before-accounts-administration',
  'after-accounts-administration',
  'before-team-access',
  'after-team-access',
  'before-staff-payments',
  'after-staff-payments',
];

interface EnvLike {
  [key: string]: string | undefined;
}

export interface PilotDatabaseCheckDeps {
  env: EnvLike;
  createClient: (connectionString: string) => Promise<PgClientLike>;
  log: (line: string) => void;
}

export interface PilotDatabaseCheckResult {
  success: boolean;
  code?: SanitizedErrorCode;
}

// Mesma regra de backend/src/config/env.validation.ts (`keepsTlsVerification`):
// o driver `pg` aplica estes parâmetros da URL POR CIMA de `ssl: {
// rejectUnauthorized: true }`. Duplicado aqui de propósito: os scripts
// compilam com `rootDir: ./scripts` e não importam de `src/`.
const SSLMODES_SEM_VERIFICACAO = new Set(['disable', 'allow', 'no-verify']);

export function urlKeepsTlsVerification(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  const sslmode = url.searchParams.get('sslmode');
  if (sslmode !== null && SSLMODES_SEM_VERIFICACAO.has(sslmode.toLowerCase())) return false;
  if (url.searchParams.has('uselibpqcompat')) return false;
  const ssl = url.searchParams.get('ssl');
  if (ssl !== null && ['0', 'false'].includes(ssl.toLowerCase())) return false;
  return true;
}

function readRequired(env: EnvLike, name: string): string {
  const value = env[name];
  if (!value) {
    throw new GuardedMigrationError('ERR_MISSING_SECRET', `Variável obrigatória ausente: ${name}`);
  }
  return value;
}

function readExpectation(env: EnvLike): PilotExpectation {
  const value = env.PILOT_EXPECT;
  const encontrada = EXPECTATIVAS.find((expectativa) => expectativa === value);
  if (encontrada) return encontrada;
  throw new GuardedMigrationError(
    'ERR_INVALID_EXPECTATION',
    `PILOT_EXPECT precisa ser exatamente um destes: ${EXPECTATIVAS.join(', ')}.`,
  );
}

/** Destino conferido só pela URL e pelos Endpoint IDs, sem rede. Lança
 * `GuardedMigrationError` na primeira divergência. */
export function assertPilotTarget(env: EnvLike): { directUrl: string; expectation: PilotExpectation } {
  const expectation = readExpectation(env);
  const directUrl = readRequired(env, 'PILOT_DIRECT_URL');
  const pilotEndpointId = readRequired(env, 'PILOT_ENDPOINT_ID');
  const productionEndpointId = readRequired(env, 'PRODUCTION_ENDPOINT_ID');

  if (pilotEndpointId === productionEndpointId) {
    throw new GuardedMigrationError(
      'ERR_PILOT_AS_PRODUCTION',
      'O endpoint do piloto não pode ser igual ao endpoint de production.',
    );
  }
  validateDirectUrl(directUrl, pilotEndpointId);
  if (!urlKeepsTlsVerification(directUrl)) {
    throw new GuardedMigrationError(
      'ERR_TLS_VERIFICATION_DISABLED',
      'A URL de conexão desliga ou afrouxa a verificação TLS (sslmode/ssl/uselibpqcompat).',
    );
  }
  return { directUrl, expectation };
}

interface EmptyTargetReport {
  publicTableCount: number;
  hasMigrationsTable: boolean;
}

async function readEmptyTargetReport(client: PgClientLike): Promise<EmptyTargetReport> {
  await client.query('BEGIN TRANSACTION READ ONLY');
  try {
    const tables = await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM information_schema.tables WHERE table_schema = 'public'",
    );
    const migrations = await client.query<{ present: boolean }>(
      "SELECT to_regclass('public.typeorm_migrations') IS NOT NULL AS present",
    );
    await client.query('ROLLBACK');
    return {
      publicTableCount: parseNonNegativeInteger(tables.rows[0]?.count, 'public_table_count'),
      hasMigrationsTable: migrations.rows[0]?.present === true,
    };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // O erro original é o que importa.
    }
    throw error;
  }
}

export async function checkPilotDatabase(deps: PilotDatabaseCheckDeps): Promise<PilotDatabaseCheckResult> {
  const { log } = deps;
  let client: PgClientLike | undefined;
  try {
    const { directUrl, expectation } = assertPilotTarget(deps.env);
    log('TARGET_ENDPOINT_MATCH: true');
    log('DISTINCT_FROM_PRODUCTION: true');
    log('TLS_VERIFICATION: true');
    log(`EXPECT: ${expectation}`);

    client = await deps.createClient(directUrl);
    await client.connect();

    if (expectation === 'empty') {
      const report = await readEmptyTargetReport(client);
      log(`PUBLIC_TABLES: ${report.publicTableCount}`);
      log(`MIGRATIONS_TABLE: ${report.hasMigrationsTable}`);
      if (report.publicTableCount !== 0 || report.hasMigrationsTable) {
        return { success: false, code: 'ERR_TARGET_NOT_EMPTY' };
      }
      return { success: true };
    }

    if (
      expectation === 'before-notifications-public-booking' ||
      expectation === 'after-notifications-public-booking'
    ) {
      const estado = await lerEstadoNotificacoesAgendamentoPublico(client);
      const falhas =
        expectation === 'before-notifications-public-booking'
          ? descreverFalhasAntes(estado)
          : descreverFalhasDepois(estado);
      log(`MIGRATIONS_APPLIED: ${estado.migrationNames.length}`);
      log(`SCHEMA_OBJECTS_OK: ${compararObjetos(estado).conferidos}/${TOTAL_OBJETOS_ESPERADOS}`);
      log(`BASELINE_FAILURES: ${falhas.length === 0 ? 'none' : falhas.join(',')}`);
      return falhas.length === 0 ? { success: true } : { success: false, code: 'ERR_POST_MIGRATION_BASELINE_MISMATCH' };
    }

    if (expectation === 'before-accounts-administration' || expectation === 'after-accounts-administration') {
      const estado = await lerEstadoContas(client);
      const falhas =
        expectation === 'before-accounts-administration' ? falhasAntesDeContas(estado) : falhasDepoisDeContas(estado);
      log(`MIGRATIONS_APPLIED: ${estado.migrationNames.length}`);
      log(`SCHEMA_OBJECTS_OK: ${objetosPresentes(estado)}/${TOTAL_OBJETOS_CONTAS}`);
      log(`BASELINE_FAILURES: ${falhas.length === 0 ? 'none' : falhas.join(',')}`);
      return falhas.length === 0 ? { success: true } : { success: false, code: 'ERR_POST_MIGRATION_BASELINE_MISMATCH' };
    }

    if (expectation === 'before-team-access' || expectation === 'after-team-access') {
      const estado = await lerEstadoEquipe(client);
      const falhas = expectation === 'before-team-access' ? falhasAntesDeEquipe(estado) : falhasDepoisDeEquipe(estado);
      log(`MIGRATIONS_APPLIED: ${estado.migrationNames.length}`);
      log(`SCHEMA_OBJECTS_OK: ${objetosEquipePresentes(estado)}/${TOTAL_OBJETOS_EQUIPE}`);
      log(`BASELINE_FAILURES: ${falhas.length === 0 ? 'none' : falhas.join(',')}`);
      return falhas.length === 0 ? { success: true } : { success: false, code: 'ERR_POST_MIGRATION_BASELINE_MISMATCH' };
    }

    if (expectation === 'before-staff-payments' || expectation === 'after-staff-payments') {
      const estado = await lerEstadoAcessoRecebimentos(client);
      const falhas =
        expectation === 'before-staff-payments'
          ? falhasAntesDeAcessoRecebimentos(estado)
          : falhasDepoisDeAcessoRecebimentos(estado);
      log(`MIGRATIONS_APPLIED: ${estado.migrationNames.length}`);
      log(`SCHEMA_OBJECTS_OK: ${objetosAcessoRecebimentosPresentes(estado)}/${TOTAL_OBJETOS_ACESSO_RECEBIMENTOS}`);
      log(`BASELINE_FAILURES: ${falhas.length === 0 ? 'none' : falhas.join(',')}`);
      return falhas.length === 0 ? { success: true } : { success: false, code: 'ERR_POST_MIGRATION_BASELINE_MISMATCH' };
    }

    const report = await runPostMigrationBaselineCheck(client);
    const failures = describePostMigrationBaselineFailures(report);
    log(`MIGRATIONS_APPLIED: ${report.migrationCount}`);
    log(`BASELINE_FAILURES: ${failures.length === 0 ? 'none' : failures.join(',')}`);
    if (failures.length > 0) {
      return { success: false, code: 'ERR_POST_MIGRATION_BASELINE_MISMATCH' };
    }
    return { success: true };
  } catch (error) {
    const failure = toSanitizedFailure(error);
    log(`ERROR: ${failure.message}`);
    return { success: false, code: failure.code };
  } finally {
    if (client) {
      try {
        await client.end();
      } catch {
        // Encerrar a conexão nunca muda o resultado.
      }
    }
  }
}
