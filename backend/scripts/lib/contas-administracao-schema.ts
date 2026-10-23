// Conferência da migration `AccountsAdministration1792800000000` no banco do
// piloto, ANTES e DEPOIS de aplicá-la (ver
// docs/runbooks/publicacao-piloto-render.md, parte E).
//
// Só leitura: `BEGIN TRANSACTION READ ONLY` ... `ROLLBACK`. Lê metadados e
// duas contagens em `invites` (a tabela que ganha constraints novas), nunca
// linhas de pessoas. As falhas saem como nomes fixos.
//
// ANTES: histórico com EXATAMENTE as seis migrations até WebPush, nenhum
// objeto novo presente e nenhuma linha de `invites` que as constraints novas
// recusariam (se houver, a migration falharia no meio: melhor parar antes).
// DEPOIS: as sete migrations na ordem e cada objeto novo presente.
import type { PgClientLike } from './pg-client.js';
import { parseNonNegativeInteger } from './pg-value-parsers.js';
import { MIGRATIONS_INICIAIS, MIGRATIONS_NOTIFICACOES_AGENDAMENTO_PUBLICO } from './notificacoes-agendamento-publico-schema.js';

export const MIGRATIONS_ATE_WEB_PUSH = [
  ...MIGRATIONS_INICIAIS,
  ...MIGRATIONS_NOTIFICACOES_AGENDAMENTO_PUBLICO,
  'WebPush1792713600000',
] as const;

export const MIGRATION_CONTAS = 'AccountsAdministration1792800000000';

export const COLUNAS_NOVAS: readonly (readonly [string, string])[] = [
  ['audit_logs', 'target_user_id'],
  ['sessions', 'reauthenticated_at'],
  ['invites', 'target_user_id'],
  ['invites', 'platform_permissions'],
  ['invites', 'delivery_status'],
  ['invites', 'delivery_attempts'],
  ['invites', 'last_delivery_at'],
  ['invites', 'delivery_failure'],
  ['invites', 'send_count'],
  ['invites', 'request_key'],
  ['invites', 'updated_at'],
];

export const CONSTRAINTS_NOVAS = [
  'fk_audit_logs_target_user',
  'fk_invites_target_user',
  'ck_invites_delivery_status',
  'ck_invites_delivery_attempts',
  'ck_invites_send_count',
  'ck_invites_type_scope',
  'uq_invites_created_by_request_key',
  'pk_password_resets',
  'uq_password_resets_token_hash',
  'fk_password_resets_user',
  'ck_password_resets_status',
] as const;

export const INDICES_NOVOS = [
  'idx_audit_logs_target_user_occurred_at',
  'idx_audit_logs_occurred_at',
  'uq_invites_pending_establishment',
  'uq_invites_pending_platform',
  'idx_invites_target_user_id',
  'idx_invites_status_created_at',
  'uq_password_resets_pending_user',
] as const;

export const ACOES_NOVAS = [
  'USER_UPDATED',
  'USER_BLOCKED',
  'USER_REACTIVATED',
  'INVITE_RESENT',
  'INVITE_REVOKED',
  'INVITE_ACCEPTED',
  'MEMBERSHIP_REMOVED',
  'PASSWORD_RESET_REQUESTED',
  'PASSWORD_RESET_COMPLETED',
  'PLATFORM_ACCESS_CHANGED',
] as const;

export interface EstadoContas {
  migrationNames: string[];
  tabelaPasswordResets: boolean;
  colunas: string[];
  constraints: string[];
  indices: string[];
  acoes: string[];
  convitesIncoerentes: number;
  convitesPendentesDuplicados: number;
}

export async function lerEstadoContas(client: PgClientLike): Promise<EstadoContas> {
  await client.query('BEGIN TRANSACTION READ ONLY');
  try {
    const migrations = await client.query<{ name: string }>('SELECT name FROM typeorm_migrations ORDER BY id');
    const tabela = await client.query<{ presente: boolean }>(
      "SELECT to_regclass('public.password_resets') IS NOT NULL AS presente",
    );
    const colunas = await client.query<{ nome: string }>(
      `SELECT table_name || '.' || column_name AS nome FROM information_schema.columns
        WHERE table_schema = 'public' AND (table_name, column_name) IN (${COLUNAS_NOVAS.map(
          (_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`,
        ).join(', ')})`,
      COLUNAS_NOVAS.flat(),
    );
    const constraints = await client.query<{ conname: string }>(
      `SELECT c.conname FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE n.nspname = 'public' AND c.conname = ANY($1)`,
      [[...CONSTRAINTS_NOVAS]],
    );
    const indices = await client.query<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = ANY($1)",
      [[...INDICES_NOVOS]],
    );
    const acoes = await client.query<{ valor: string }>(
      `SELECT e.enumlabel AS valor FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'audit_action' AND e.enumlabel = ANY($1)`,
      [[...ACOES_NOVAS]],
    );
    const incoerentes = await client.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM invites
        WHERE NOT ((type = 'ESTABLISHMENT' AND tenant_id IS NOT NULL AND establishment_role IS NOT NULL
                    AND platform_role IS NULL)
                OR (type = 'PLATFORM' AND tenant_id IS NULL AND establishment_role IS NULL
                    AND platform_role IS NOT NULL))`,
    );
    const duplicados = await client.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM (
         SELECT 1 FROM invites WHERE status = 'PENDING'
          GROUP BY type, tenant_id, target_email HAVING count(*) > 1) d`,
    );
    await client.query('ROLLBACK');
    return {
      migrationNames: migrations.rows.map((r) => r.name),
      tabelaPasswordResets: tabela.rows[0]?.presente === true,
      colunas: colunas.rows.map((r) => r.nome),
      constraints: constraints.rows.map((r) => r.conname),
      indices: indices.rows.map((r) => r.indexname),
      acoes: acoes.rows.map((r) => r.valor),
      convitesIncoerentes: parseNonNegativeInteger(incoerentes.rows[0]?.total, 'invites_incoherent'),
      convitesPendentesDuplicados: parseNonNegativeInteger(duplicados.rows[0]?.total, 'invites_duplicated'),
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

const mesmaLista = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((valor, i) => valor === b[i]);

export function falhasAntesDeContas(estado: EstadoContas): string[] {
  const falhas: string[] = [];
  if (!mesmaLista(estado.migrationNames, MIGRATIONS_ATE_WEB_PUSH)) falhas.push('migration_history');
  if (estado.tabelaPasswordResets) falhas.push('password_resets_already_exists');
  if (estado.colunas.length) falhas.push('new_columns_already_exist');
  if (estado.constraints.length) falhas.push('new_constraints_already_exist');
  if (estado.indices.length) falhas.push('new_indexes_already_exist');
  if (estado.convitesIncoerentes > 0) falhas.push('invites_incoherent_rows');
  if (estado.convitesPendentesDuplicados > 0) falhas.push('invites_duplicated_pending');
  return falhas;
}

export function falhasDepoisDeContas(estado: EstadoContas): string[] {
  const falhas: string[] = [];
  if (!mesmaLista(estado.migrationNames, [...MIGRATIONS_ATE_WEB_PUSH, MIGRATION_CONTAS])) falhas.push('migration_history');
  if (!estado.tabelaPasswordResets) falhas.push('password_resets_missing');
  for (const [tabela, coluna] of COLUNAS_NOVAS) {
    if (!estado.colunas.includes(`${tabela}.${coluna}`)) falhas.push(`column_${tabela}_${coluna}`);
  }
  for (const nome of CONSTRAINTS_NOVAS) if (!estado.constraints.includes(nome)) falhas.push(nome);
  for (const nome of INDICES_NOVOS) if (!estado.indices.includes(nome)) falhas.push(nome);
  for (const acao of ACOES_NOVAS) if (!estado.acoes.includes(acao)) falhas.push(`audit_action_${acao}`);
  return falhas;
}

export const TOTAL_OBJETOS_CONTAS =
  1 + COLUNAS_NOVAS.length + CONSTRAINTS_NOVAS.length + INDICES_NOVOS.length + ACOES_NOVAS.length;

export function objetosPresentes(estado: EstadoContas): number {
  return (
    (estado.tabelaPasswordResets ? 1 : 0) +
    estado.colunas.length +
    estado.constraints.length +
    estado.indices.length +
    estado.acoes.length
  );
}
