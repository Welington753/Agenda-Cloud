// Conferência das migrations `StaffLogin1792972800000` e
// `AppointmentPayments1793059200000` no banco do piloto, ANTES e DEPOIS de
// aplicá-las juntas (ver docs/runbooks/publicacao-acesso-recebimentos-piloto.md).
//
// Só leitura: `BEGIN TRANSACTION READ ONLY` ... `ROLLBACK`. Lê metadados e
// contagens, nunca linhas de pessoas. As falhas saem como nomes fixos.
//
// ANTES: histórico com EXATAMENTE as oito migrations até TeamAccess, nenhum
// objeto novo presente e `users.email` ainda obrigatório. Nenhum dado
// existente faz as migrations falharem no meio: toda conta antiga tem e-mail
// (a coluna é NOT NULL até aqui) e nenhuma tem `username`.
// DEPOIS: as dez migrations na ordem, cada objeto novo presente e
// `users.email` opcional.
import type { PgClientLike } from './pg-client.js';
import { parseNonNegativeInteger } from './pg-value-parsers.js';
import { MIGRATIONS_ATE_CONTAS, MIGRATION_EQUIPE } from './equipe-acessos-schema.js';
import { somenteLeitura, type PublicacaoDoLote } from './publicacao-lote.js';

export const MIGRATIONS_ATE_EQUIPE = [...MIGRATIONS_ATE_CONTAS, MIGRATION_EQUIPE] as const;
export const MIGRATION_STAFF_LOGIN = 'StaffLogin1792972800000';
export const MIGRATION_RECEBIMENTOS = 'AppointmentPayments1793059200000';
export const MIGRATIONS_ACESSO_RECEBIMENTOS = [MIGRATION_STAFF_LOGIN, MIGRATION_RECEBIMENTOS] as const;

export const COLUNAS_ACESSO_RECEBIMENTOS: readonly (readonly [string, string])[] = [
  ['users', 'username'],
  ['users', 'must_change_password'],
];

export const TABELAS_ACESSO_RECEBIMENTOS = ['staff_account_requests', 'appointment_payments'] as const;

export const CONSTRAINTS_ACESSO_RECEBIMENTOS = [
  'ck_users_username_format',
  'ck_users_login_identifier',
  'pk_staff_account_requests',
  'fk_staff_account_requests_actor',
  'fk_staff_account_requests_tenant',
  'fk_staff_account_requests_user',
  'pk_appointment_payments',
  'uq_appointment_payments_tenant_id',
  'fk_appointment_payments_appointment',
  'fk_appointment_payments_recorded_by',
  'fk_appointment_payments_refunded_by',
  'ck_appointment_payments_amount',
  'ck_appointment_payments_method',
  'ck_appointment_payments_refund',
] as const;

export const INDICES_ACESSO_RECEBIMENTOS = [
  'uq_users_username',
  'uq_appointment_payments_active',
  'uq_appointment_payments_request_key',
  'idx_appointment_payments_tenant_received',
  'idx_appointment_payments_tenant_refunded',
] as const;

/** Valores novos de `audit_action`. As migrations usam `ADD VALUE IF NOT
 * EXISTS`: um valor já presente antes não é falha. */
export const VALORES_ACESSO_RECEBIMENTOS = [
  'audit_action.STAFF_ACCESS_CREATED',
  'audit_action.STAFF_PASSWORD_RESET',
  'audit_action.PASSWORD_CHANGED',
  'audit_action.PAYMENT_RECORDED',
  'audit_action.PAYMENT_REFUNDED',
] as const;

export interface EstadoAcessoRecebimentos {
  migrationNames: string[];
  colunas: string[];
  tabelas: string[];
  constraints: string[];
  indices: string[];
  valores: string[];
  emailObrigatorio: boolean;
}

export async function lerEstadoAcessoRecebimentos(client: PgClientLike): Promise<EstadoAcessoRecebimentos> {
  return somenteLeitura(client, async () => {
    const migrations = await client.query<{ name: string }>('SELECT name FROM typeorm_migrations ORDER BY id');
    const colunas = await client.query<{ nome: string }>(
      `SELECT table_name || '.' || column_name AS nome FROM information_schema.columns
        WHERE table_schema = 'public' AND (table_name, column_name) IN (${COLUNAS_ACESSO_RECEBIMENTOS.map(
          (_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`,
        ).join(', ')})`,
      COLUNAS_ACESSO_RECEBIMENTOS.flat(),
    );
    const tabelas = await client.query<{ nome: string }>(
      "SELECT table_name AS nome FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1)",
      [[...TABELAS_ACESSO_RECEBIMENTOS]],
    );
    const constraints = await client.query<{ conname: string }>(
      `SELECT c.conname FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE n.nspname = 'public' AND c.conname = ANY($1)`,
      [[...CONSTRAINTS_ACESSO_RECEBIMENTOS]],
    );
    const indices = await client.query<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = ANY($1)",
      [[...INDICES_ACESSO_RECEBIMENTOS]],
    );
    const valores = await client.query<{ valor: string }>(
      `SELECT t.typname || '.' || e.enumlabel AS valor FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname || '.' || e.enumlabel = ANY($1)`,
      [[...VALORES_ACESSO_RECEBIMENTOS]],
    );
    const email = await client.query<{ nulo: string }>(
      `SELECT is_nullable AS nulo FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'email'`,
    );
    return {
      migrationNames: migrations.rows.map((r) => r.name),
      colunas: colunas.rows.map((r) => r.nome),
      tabelas: tabelas.rows.map((r) => r.nome),
      constraints: constraints.rows.map((r) => r.conname),
      indices: indices.rows.map((r) => r.indexname),
      valores: valores.rows.map((r) => r.valor),
      emailObrigatorio: email.rows[0]?.nulo === 'NO',
    };
  });
}

const mesmaLista = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((valor, i) => valor === b[i]);

export function falhasAntesDeAcessoRecebimentos(estado: EstadoAcessoRecebimentos): string[] {
  const falhas: string[] = [];
  if (!mesmaLista(estado.migrationNames, MIGRATIONS_ATE_EQUIPE)) falhas.push('migration_history');
  if (estado.colunas.length) falhas.push('new_columns_already_exist');
  if (estado.tabelas.length) falhas.push('new_tables_already_exist');
  if (estado.constraints.length) falhas.push('new_constraints_already_exist');
  if (estado.indices.length) falhas.push('new_indexes_already_exist');
  if (!estado.emailObrigatorio) falhas.push('users_email_already_optional');
  return falhas;
}

export function falhasDepoisDeAcessoRecebimentos(estado: EstadoAcessoRecebimentos): string[] {
  const falhas: string[] = [];
  if (!mesmaLista(estado.migrationNames, [...MIGRATIONS_ATE_EQUIPE, ...MIGRATIONS_ACESSO_RECEBIMENTOS])) {
    falhas.push('migration_history');
  }
  for (const [tabela, coluna] of COLUNAS_ACESSO_RECEBIMENTOS) {
    if (!estado.colunas.includes(`${tabela}.${coluna}`)) falhas.push(`column_${tabela}_${coluna}`);
  }
  for (const nome of TABELAS_ACESSO_RECEBIMENTOS) if (!estado.tabelas.includes(nome)) falhas.push(`table_${nome}`);
  for (const nome of CONSTRAINTS_ACESSO_RECEBIMENTOS) if (!estado.constraints.includes(nome)) falhas.push(nome);
  for (const nome of INDICES_ACESSO_RECEBIMENTOS) if (!estado.indices.includes(nome)) falhas.push(nome);
  for (const valor of VALORES_ACESSO_RECEBIMENTOS) if (!estado.valores.includes(valor)) falhas.push(`enum_${valor}`);
  if (estado.emailObrigatorio) falhas.push('users_email_still_required');
  return falhas;
}

export const TOTAL_OBJETOS_ACESSO_RECEBIMENTOS =
  COLUNAS_ACESSO_RECEBIMENTOS.length +
  TABELAS_ACESSO_RECEBIMENTOS.length +
  CONSTRAINTS_ACESSO_RECEBIMENTOS.length +
  INDICES_ACESSO_RECEBIMENTOS.length +
  VALORES_ACESSO_RECEBIMENTOS.length;

export function objetosAcessoRecebimentosPresentes(estado: EstadoAcessoRecebimentos): number {
  return (
    estado.colunas.length + estado.tabelas.length + estado.constraints.length + estado.indices.length + estado.valores.length
  );
}

/** O que só a API nova grava. Zero em tudo antes de ela publicar; depois, é o
 * que um retorno de código ou de migration precisa levar em conta. */
export interface DadosNovos {
  contasSemEmail: number;
  contasComUsuario: number;
  trocaDeSenhaPendente: number;
  pedidosDeAcesso: number;
  recebimentosAtivos: number;
  recebimentosEstornados: number;
}

/** Lê `DadosNovos` só com as partes do schema que existirem (antes da
 * migration, tudo é zero sem consultar tabela ausente). */
export async function lerDadosNovos(client: PgClientLike): Promise<DadosNovos> {
  const estado = await lerEstadoAcessoRecebimentos(client);
  const temColunas = COLUNAS_ACESSO_RECEBIMENTOS.every(([t, c]) => estado.colunas.includes(`${t}.${c}`));
  const temPedidos = estado.tabelas.includes('staff_account_requests');
  const temRecebimentos = estado.tabelas.includes('appointment_payments');
  return somenteLeitura(client, async () => {
    const [r] = (
      await client.query<Record<keyof DadosNovos, string>>(`SELECT
        (SELECT count(*) FROM users WHERE email IS NULL)::text AS "contasSemEmail",
        ${temColunas ? '(SELECT count(*) FROM users WHERE username IS NOT NULL)' : '0'}::text AS "contasComUsuario",
        ${temColunas ? '(SELECT count(*) FROM users WHERE must_change_password)' : '0'}::text AS "trocaDeSenhaPendente",
        ${temPedidos ? '(SELECT count(*) FROM staff_account_requests)' : '0'}::text AS "pedidosDeAcesso",
        ${temRecebimentos ? '(SELECT count(*) FROM appointment_payments WHERE refunded_at IS NULL)' : '0'}::text AS "recebimentosAtivos",
        ${temRecebimentos ? '(SELECT count(*) FROM appointment_payments WHERE refunded_at IS NOT NULL)' : '0'}::text AS "recebimentosEstornados"`)
    ).rows;
    const n = (chave: keyof DadosNovos) => parseNonNegativeInteger(r?.[chave], chave);
    return {
      contasSemEmail: n('contasSemEmail'),
      contasComUsuario: n('contasComUsuario'),
      trocaDeSenhaPendente: n('trocaDeSenhaPendente'),
      pedidosDeAcesso: n('pedidosDeAcesso'),
      recebimentosAtivos: n('recebimentosAtivos'),
      recebimentosEstornados: n('recebimentosEstornados'),
    };
  });
}

export const dadosNovosVazios = (d: DadosNovos): boolean => Object.values(d).every((v) => v === 0);

export function descreverDadosNovos(d: DadosNovos, prefixo: string): string[] {
  return Object.entries(d).map(([k, v]) => `${prefixo}${k}: ${v}`);
}

/** Contas e sessões abertas: o levantamento comparado antes e depois numa
 * cópia (as migrations não podem mudar nenhum dos dois). */
async function lerLevantamento(client: PgClientLike) {
  return somenteLeitura(client, async () => {
    const [r] = (
      await client.query<{ contas: string; sessoesAbertas: string; atendimentos: string }>(`SELECT
        (SELECT count(*) FROM users)::text AS contas,
        (SELECT count(*) FROM sessions WHERE revoked_at IS NULL AND expires_at > now())::text AS "sessoesAbertas",
        (SELECT count(*) FROM appointments)::text AS atendimentos`)
    ).rows;
    return {
      contas: parseNonNegativeInteger(r?.contas, 'contas'),
      atendimentos: parseNonNegativeInteger(r?.atendimentos, 'atendimentos'),
      sessoesAbertas: parseNonNegativeInteger(r?.sessoesAbertas, 'sessoesAbertas'),
    };
  });
}

export const PUBLICACAO_ACESSO_RECEBIMENTOS: PublicacaoDoLote = {
  migrationsAntes: MIGRATIONS_ATE_EQUIPE,
  pendentes: MIGRATIONS_ACESSO_RECEBIMENTOS,
  falhasAntes: async (client) => falhasAntesDeAcessoRecebimentos(await lerEstadoAcessoRecebimentos(client)),
  falhasDepois: async (client) => falhasDepoisDeAcessoRecebimentos(await lerEstadoAcessoRecebimentos(client)),
  async levantamento(client) {
    const l = await lerLevantamento(client);
    // As sessões abertas mudam com o relógio; só contas e atendimentos entram
    // na comparação.
    return {
      linhas: [`CONTAS: ${l.contas}`, `ATENDIMENTOS: ${l.atendimentos}`, `SESSOES_ABERTAS: ${l.sessoesAbertas}`],
      comparavel: { contas: l.contas, atendimentos: l.atendimentos },
    };
  },
  async novosVazios(client) {
    const d = await lerDadosNovos(client);
    return { linhas: descreverDadosNovos(d, 'NOVOS_'), ok: dadosNovosVazios(d) };
  },
  async reversao(client) {
    return descreverDadosNovos(await lerDadosNovos(client), 'REVERSAO_AFETARIA_');
  },
};
