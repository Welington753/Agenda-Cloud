// Conferência da migration `TeamAccess1792886400000` no banco do piloto,
// ANTES e DEPOIS de aplicá-la (ver docs/plans/equipe-acessos-e-plano.md,
// "Publicação").
//
// Só leitura: `BEGIN TRANSACTION READ ONLY` ... `ROLLBACK`. Lê metadados e
// uma contagem em `invites` (a tabela que ganha a constraint nova), nunca
// linhas de pessoas. As falhas saem como nomes fixos.
//
// ANTES: histórico com EXATAMENTE as sete migrations até AccountsAdministration,
// nenhum objeto novo presente e nenhum convite que a constraint nova recusaria
// (convite de PROFISSIONAL sem profissional: a migration falharia no meio).
// DEPOIS: as oito migrations na ordem e cada objeto novo presente.
import type { PgClientLike } from './pg-client.js';
import { parseNonNegativeInteger } from './pg-value-parsers.js';
import { MIGRATIONS_ATE_WEB_PUSH, MIGRATION_CONTAS } from './contas-administracao-schema.js';

export const MIGRATIONS_ATE_CONTAS = [...MIGRATIONS_ATE_WEB_PUSH, MIGRATION_CONTAS] as const;
export const MIGRATION_EQUIPE = 'TeamAccess1792886400000';

export const COLUNAS_EQUIPE: readonly (readonly [string, string])[] = [
  ['tenants', 'restore_status'],
  ['memberships', 'status'],
  ['memberships', 'status_changed_at'],
  ['memberships', 'status_changed_by_user_id'],
  ['invites', 'professional_id'],
];

export const CONSTRAINTS_EQUIPE = [
  'ck_tenants_restore_status',
  'ck_memberships_status',
  'fk_memberships_status_changed_by_user',
  'fk_invites_tenant_professional',
  'ck_invites_professional_scope',
] as const;

export const INDICES_EQUIPE = ['uq_invites_pending_professional'] as const;

/** Valores novos de enum, como `tipo.valor`. */
export const VALORES_EQUIPE = [
  'tenant_status.ARCHIVED',
  'permission.ATENDIMENTO_PROPRIO_INICIAR',
  'permission.ATENDIMENTO_PROPRIO_CONCLUIR',
  'permission.ATENDIMENTO_PROPRIO_FALTA',
  'audit_action.TENANT_UPDATED',
  'audit_action.TENANT_ARCHIVED',
  'audit_action.MEMBERSHIP_SUSPENDED',
  'audit_action.MEMBERSHIP_REACTIVATED',
] as const;

export interface EstadoEquipe {
  migrationNames: string[];
  colunas: string[];
  constraints: string[];
  indices: string[];
  valores: string[];
  convitesDeProfissionalSemProfissional: number;
}

export async function lerEstadoEquipe(client: PgClientLike): Promise<EstadoEquipe> {
  await client.query('BEGIN TRANSACTION READ ONLY');
  try {
    const migrations = await client.query<{ name: string }>('SELECT name FROM typeorm_migrations ORDER BY id');
    const colunas = await client.query<{ nome: string }>(
      `SELECT table_name || '.' || column_name AS nome FROM information_schema.columns
        WHERE table_schema = 'public' AND (table_name, column_name) IN (${COLUNAS_EQUIPE.map(
          (_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`,
        ).join(', ')})`,
      COLUNAS_EQUIPE.flat(),
    );
    const constraints = await client.query<{ conname: string }>(
      `SELECT c.conname FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE n.nspname = 'public' AND c.conname = ANY($1)`,
      [[...CONSTRAINTS_EQUIPE]],
    );
    const indices = await client.query<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = ANY($1)",
      [[...INDICES_EQUIPE]],
    );
    const valores = await client.query<{ valor: string }>(
      `SELECT t.typname || '.' || e.enumlabel AS valor FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname || '.' || e.enumlabel = ANY($1)`,
      [[...VALORES_EQUIPE]],
    );
    const semProfissional = await client.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM invites WHERE establishment_role = 'PROFISSIONAL'
         AND ${colunas.rows.some((r) => r.nome === 'invites.professional_id') ? 'professional_id IS NULL' : 'true'}`,
    );
    await client.query('ROLLBACK');
    return {
      migrationNames: migrations.rows.map((r) => r.name),
      colunas: colunas.rows.map((r) => r.nome),
      constraints: constraints.rows.map((r) => r.conname),
      indices: indices.rows.map((r) => r.indexname),
      valores: valores.rows.map((r) => r.valor),
      convitesDeProfissionalSemProfissional: parseNonNegativeInteger(
        semProfissional.rows[0]?.total,
        'invites_professional_without_professional',
      ),
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

export function falhasAntesDeEquipe(estado: EstadoEquipe): string[] {
  const falhas: string[] = [];
  if (!mesmaLista(estado.migrationNames, MIGRATIONS_ATE_CONTAS)) falhas.push('migration_history');
  if (estado.colunas.length) falhas.push('new_columns_already_exist');
  if (estado.constraints.length) falhas.push('new_constraints_already_exist');
  if (estado.indices.length) falhas.push('new_indexes_already_exist');
  if (estado.convitesDeProfissionalSemProfissional > 0) falhas.push('invites_professional_role_rows');
  return falhas;
}

export function falhasDepoisDeEquipe(estado: EstadoEquipe): string[] {
  const falhas: string[] = [];
  if (!mesmaLista(estado.migrationNames, [...MIGRATIONS_ATE_CONTAS, MIGRATION_EQUIPE])) falhas.push('migration_history');
  for (const [tabela, coluna] of COLUNAS_EQUIPE) {
    if (!estado.colunas.includes(`${tabela}.${coluna}`)) falhas.push(`column_${tabela}_${coluna}`);
  }
  for (const nome of CONSTRAINTS_EQUIPE) if (!estado.constraints.includes(nome)) falhas.push(nome);
  for (const nome of INDICES_EQUIPE) if (!estado.indices.includes(nome)) falhas.push(nome);
  for (const valor of VALORES_EQUIPE) if (!estado.valores.includes(valor)) falhas.push(`enum_${valor}`);
  if (estado.convitesDeProfissionalSemProfissional > 0) falhas.push('invites_professional_role_rows');
  return falhas;
}

export const TOTAL_OBJETOS_EQUIPE =
  COLUNAS_EQUIPE.length + CONSTRAINTS_EQUIPE.length + INDICES_EQUIPE.length + VALORES_EQUIPE.length;

export function objetosEquipePresentes(estado: EstadoEquipe): number {
  return estado.colunas.length + estado.constraints.length + estado.indices.length + estado.valores.length;
}
