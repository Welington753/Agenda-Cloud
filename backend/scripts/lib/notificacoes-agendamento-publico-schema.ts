// Conferência exata do schema das migrations `NotificationJobs1792540800000`
// e `PublicBooking1792627200000` no banco do piloto, ANTES e DEPOIS de
// aplicá-las (ver docs/runbooks/publicacao-piloto-render.md, seção 6C).
//
// Só leitura: tudo roda em `BEGIN TRANSACTION READ ONLY` e termina em
// `ROLLBACK`. Só lê metadados (catálogo do Postgres e nomes em
// `typeorm_migrations`), nunca linhas de clientes, reservas ou usuários.
//
// Nada aqui é "maior ou igual": o histórico precisa ter EXATAMENTE os nomes
// esperados, na ordem, e cada coluna, constraint e índice é comparado pela
// definição devolvida pelo próprio Postgres. As falhas saem como nomes fixos
// de objetos do schema, nunca como valores lidos do banco.
import type { PgClientLike } from './pg-client.js';

export const MIGRATIONS_INICIAIS = [
  'InitialSchema1788782400000',
  'AllowUndefinedPlanPrice1788782450000',
  'InitialPlanCatalog1788782460000',
] as const;

export const MIGRATIONS_NOTIFICACOES_AGENDAMENTO_PUBLICO = [
  'NotificationJobs1792540800000',
  'PublicBooking1792627200000',
] as const;

export const TABELAS_NOVAS = ['notification_jobs', 'public_booking_settings', 'public_booking_requests'] as const;

/** [tipo, aceita nulo, padrão, tamanho ou precisão] como o
 * `information_schema.columns` devolve. */
type ColunaEsperada = readonly [string, 'YES' | 'NO', string | null, number | null];

const VARCHAR = 'character varying';
const TIMESTAMPTZ = 'timestamp with time zone';

export const COLUNAS_ESPERADAS: Readonly<Record<string, Readonly<Record<string, ColunaEsperada>>>> = {
  consumers: {
    whatsapp_opt_in_at: [TIMESTAMPTZ, 'YES', null, 3],
    whatsapp_opt_in_source: [VARCHAR, 'YES', null, 40],
    whatsapp_opt_out_at: [TIMESTAMPTZ, 'YES', null, 3],
  },
  notification_jobs: {
    id: [VARCHAR, 'NO', null, 30],
    tenant_id: [VARCHAR, 'NO', null, 30],
    appointment_id: [VARCHAR, 'NO', null, 30],
    kind: [VARCHAR, 'NO', null, 30],
    channel: [VARCHAR, 'NO', "'WHATSAPP'::character varying", 20],
    appointment_start_at: [TIMESTAMPTZ, 'NO', null, 3],
    scheduled_for: [TIMESTAMPTZ, 'NO', null, 3],
    not_after: [TIMESTAMPTZ, 'NO', null, 3],
    dedupe_key: [VARCHAR, 'NO', null, 160],
    status: [VARCHAR, 'NO', "'SCHEDULED'::character varying", 20],
    attempts: ['integer', 'NO', '0', null],
    locked_by: [VARCHAR, 'YES', null, 80],
    locked_until: [TIMESTAMPTZ, 'YES', null, 3],
    provider_message_id: [VARCHAR, 'YES', null, 160],
    outcome_reason: [VARCHAR, 'YES', null, 40],
    last_error: [VARCHAR, 'YES', null, 500],
    sent_at: [TIMESTAMPTZ, 'YES', null, 3],
    delivered_at: [TIMESTAMPTZ, 'YES', null, 3],
    finished_at: [TIMESTAMPTZ, 'YES', null, 3],
    created_at: [TIMESTAMPTZ, 'NO', 'now()', 3],
    updated_at: [TIMESTAMPTZ, 'NO', 'now()', 3],
  },
  public_booking_settings: {
    tenant_id: [VARCHAR, 'NO', null, 30],
    enabled: ['boolean', 'NO', 'false', null],
    updated_by: [VARCHAR, 'YES', null, 30],
    updated_at: [TIMESTAMPTZ, 'NO', 'now()', 3],
  },
  public_booking_requests: {
    id: [VARCHAR, 'NO', null, 30],
    tenant_id: [VARCHAR, 'NO', null, 30],
    appointment_id: [VARCHAR, 'NO', null, 30],
    phone_normalized: [VARCHAR, 'NO', null, 20],
    idempotency_key: [VARCHAR, 'NO', null, 64],
    payload_hash: ['character', 'NO', null, 64],
    created_at: [TIMESTAMPTZ, 'NO', 'now()', 3],
  },
};

const lista = (valores: readonly string[]) => valores.map((v) => `'${v}'::character varying`).join(', ');

/** Texto exato de `pg_get_constraintdef` (PostgreSQL 17). */
export const CONSTRAINTS_ESPERADAS: Readonly<Record<string, string>> = {
  pk_notification_jobs: 'PRIMARY KEY (id)',
  uq_notification_jobs_dedupe_key: 'UNIQUE (dedupe_key)',
  fk_notification_jobs_tenant: 'FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT',
  fk_notification_jobs_tenant_appointment:
    'FOREIGN KEY (tenant_id, appointment_id) REFERENCES appointments(tenant_id, id) ON DELETE CASCADE',
  ck_notification_jobs_kind: `CHECK (((kind)::text = ANY ((ARRAY[${lista([
    'CONFIRMATION',
    'REMINDER_DAY_BEFORE',
    'REMINDER_2H',
  ])}])::text[])))`,
  ck_notification_jobs_status: `CHECK (((status)::text = ANY ((ARRAY[${lista([
    'SCHEDULED',
    'PROCESSING',
    'SENDING',
    'SENT',
    'DELIVERED',
    'UNCERTAIN',
    'FAILED',
    'SKIPPED',
    'CANCELED',
  ])}])::text[])))`,
  ck_notification_jobs_attempts: 'CHECK ((attempts >= 0))',
  ck_notification_jobs_window: 'CHECK ((not_after >= scheduled_for))',
  pk_public_booking_settings: 'PRIMARY KEY (tenant_id)',
  fk_public_booking_settings_tenant: 'FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE',
  pk_public_booking_requests: 'PRIMARY KEY (id)',
  uq_public_booking_requests_appointment: 'UNIQUE (appointment_id)',
  uq_public_booking_requests_tenant_key: 'UNIQUE (tenant_id, idempotency_key)',
  fk_public_booking_requests_tenant: 'FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT',
  fk_public_booking_requests_tenant_appointment:
    'FOREIGN KEY (tenant_id, appointment_id) REFERENCES appointments(tenant_id, id) ON DELETE CASCADE',
};

/** Texto exato de `pg_indexes.indexdef` dos índices criados à parte (os das
 * PKs e UNIQUEs acima vêm junto com as constraints). */
export const INDICES_ESPERADOS: Readonly<Record<string, string>> = {
  idx_notification_jobs_status_scheduled_for:
    'CREATE INDEX idx_notification_jobs_status_scheduled_for ON public.notification_jobs USING btree (status, scheduled_for)',
  idx_notification_jobs_tenant_appointment:
    'CREATE INDEX idx_notification_jobs_tenant_appointment ON public.notification_jobs USING btree (tenant_id, appointment_id)',
  uq_notification_jobs_provider_message_id:
    'CREATE UNIQUE INDEX uq_notification_jobs_provider_message_id ON public.notification_jobs USING btree (provider_message_id) WHERE (provider_message_id IS NOT NULL)',
  idx_public_booking_requests_tenant_phone_created:
    'CREATE INDEX idx_public_booking_requests_tenant_phone_created ON public.public_booking_requests USING btree (tenant_id, phone_normalized, created_at)',
};

export const TOTAL_OBJETOS_ESPERADOS =
  Object.values(COLUNAS_ESPERADAS).reduce((soma, colunas) => soma + Object.keys(colunas).length, 0) +
  Object.keys(CONSTRAINTS_ESPERADAS).length +
  Object.keys(INDICES_ESPERADOS).length;

interface LinhaColuna {
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
  tamanho: string | number | null;
}

export interface EstadoNotificacoesAgendamentoPublico {
  migrationNames: string[];
  priceCentsIsNullable: boolean;
  /** `tenants`, `appointments` e `consumers` existem, e `appointments` tem
   * uma constraint única exatamente em `(tenant_id, id)` — alvo das FKs
   * compostas das duas migrations. */
  prerequisitesPresent: boolean;
  tabelasNovasPresentes: string[];
  colunas: LinhaColuna[];
  constraints: Array<{ conname: string; def: string }>;
  indices: Array<{ indexname: string; indexdef: string }>;
}

async function rollbackSeguro(client: PgClientLike): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // O erro original é o que importa.
  }
}

export async function lerEstadoNotificacoesAgendamentoPublico(
  client: PgClientLike,
): Promise<EstadoNotificacoesAgendamentoPublico> {
  await client.query('BEGIN TRANSACTION READ ONLY');
  try {
    const tabelasComColunas = Object.keys(COLUNAS_ESPERADAS);
    const migrations = await client.query<{ name: string }>('SELECT name FROM typeorm_migrations ORDER BY id');
    const precoNulo = await client.query<{ is_nullable: string }>(
      "SELECT is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'plans' AND column_name = 'price_cents'",
    );
    const prerequisitos = await client.query<{ ok: boolean }>(
      `SELECT to_regclass('public.tenants') IS NOT NULL
          AND to_regclass('public.consumers') IS NOT NULL
          AND to_regclass('public.appointments') IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM pg_constraint c
             WHERE c.conrelid = to_regclass('public.appointments')
               AND c.contype IN ('p', 'u')
               AND pg_get_constraintdef(c.oid) IN ('UNIQUE (tenant_id, id)', 'PRIMARY KEY (tenant_id, id)')
          ) AS ok`,
    );
    const tabelasNovas = await client.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1)",
      [[...TABELAS_NOVAS]],
    );
    const colunas = await client.query<LinhaColuna>(
      `SELECT table_name, column_name, data_type, is_nullable, column_default,
              COALESCE(character_maximum_length, datetime_precision) AS tamanho
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ANY($1)`,
      [tabelasComColunas],
    );
    const constraints = await client.query<{ conname: string; def: string }>(
      `SELECT c.conname, pg_get_constraintdef(c.oid) AS def
         FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public' AND t.relname = ANY($1)`,
      [[...TABELAS_NOVAS]],
    );
    const indices = await client.query<{ indexname: string; indexdef: string }>(
      "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = ANY($1)",
      [[...TABELAS_NOVAS]],
    );
    await client.query('ROLLBACK');

    return {
      migrationNames: migrations.rows.map((linha) => linha.name),
      priceCentsIsNullable: precoNulo.rows[0]?.is_nullable === 'YES',
      prerequisitesPresent: prerequisitos.rows[0]?.ok === true,
      tabelasNovasPresentes: tabelasNovas.rows.map((linha) => linha.table_name).sort(),
      colunas: colunas.rows,
      constraints: constraints.rows,
      indices: indices.rows,
    };
  } catch (error) {
    await rollbackSeguro(client);
    throw error;
  }
}

function mesmaLista(real: readonly string[], esperada: readonly string[]): boolean {
  return real.length === esperada.length && real.every((nome, i) => nome === esperada[i]);
}

function colunaConfere(linha: LinhaColuna, [tipo, nulo, padrao, tamanho]: ColunaEsperada): boolean {
  return (
    linha.data_type === tipo &&
    linha.is_nullable === nulo &&
    (linha.column_default ?? null) === padrao &&
    (linha.tamanho === null ? null : Number(linha.tamanho)) === tamanho
  );
}

/** Objetos das duas migrations: quantos conferem e a lista de falhas
 * (`ausente:`, `diverge:` ou `extra:` + nome fixo do objeto). */
export function compararObjetos(estado: EstadoNotificacoesAgendamentoPublico): {
  conferidos: number;
  falhas: string[];
} {
  const falhas: string[] = [];
  let conferidos = 0;

  for (const [tabela, esperadas] of Object.entries(COLUNAS_ESPERADAS)) {
    const reais = new Map(
      estado.colunas.filter((linha) => linha.table_name === tabela).map((linha) => [linha.column_name, linha]),
    );
    for (const [coluna, esperada] of Object.entries(esperadas)) {
      const real = reais.get(coluna);
      if (!real) falhas.push(`ausente:${tabela}.${coluna}`);
      else if (colunaConfere(real, esperada)) conferidos++;
      else falhas.push(`diverge:${tabela}.${coluna}`);
    }
    // `consumers` tem as colunas do schema inicial; só as três novas são
    // desta conferência. Nas tabelas novas, qualquer coluna a mais diverge.
    if (tabela !== 'consumers') {
      for (const coluna of reais.keys()) if (!(coluna in esperadas)) falhas.push(`extra:${tabela}.${coluna}`);
    }
  }

  const constraints = new Map(estado.constraints.map((linha) => [linha.conname, linha.def]));
  for (const [nome, definicao] of Object.entries(CONSTRAINTS_ESPERADAS)) {
    const real = constraints.get(nome);
    if (real === undefined) falhas.push(`ausente:${nome}`);
    else if (real === definicao) conferidos++;
    else falhas.push(`diverge:${nome}`);
  }
  for (const nome of constraints.keys()) if (!(nome in CONSTRAINTS_ESPERADAS)) falhas.push(`extra:${nome}`);

  const indices = new Map(estado.indices.map((linha) => [linha.indexname, linha.indexdef]));
  for (const [nome, definicao] of Object.entries(INDICES_ESPERADOS)) {
    const real = indices.get(nome);
    if (real === undefined) falhas.push(`ausente:${nome}`);
    else if (real === definicao) conferidos++;
    else falhas.push(`diverge:${nome}`);
  }
  for (const nome of indices.keys()) {
    if (!(nome in INDICES_ESPERADOS) && !(nome in CONSTRAINTS_ESPERADAS)) falhas.push(`extra:${nome}`);
  }

  return { conferidos, falhas };
}

/** ANTES de aplicar: exatamente as três migrations iniciais, pré-requisitos
 * das FKs presentes e NENHUM objeto das duas migrations novas. */
export function descreverFalhasAntes(estado: EstadoNotificacoesAgendamentoPublico): string[] {
  const falhas: string[] = [];
  if (!mesmaLista(estado.migrationNames, MIGRATIONS_INICIAIS)) falhas.push('migration_history');
  if (!estado.priceCentsIsNullable) falhas.push('price_nullability');
  if (!estado.prerequisitesPresent) falhas.push('prerequisites');
  const { conferidos, falhas: falhasObjetos } = compararObjetos(estado);
  const algumObjetoNovo =
    estado.tabelasNovasPresentes.length > 0 ||
    conferidos > 0 ||
    falhasObjetos.some((falha) => !falha.startsWith('ausente:'));
  if (algumObjetoNovo) falhas.push('new_objects_present');
  return falhas;
}

/** DEPOIS de aplicar: exatamente as cinco migrations, na ordem, e cada um
 * dos objetos esperados com a definição exata. */
export function descreverFalhasDepois(estado: EstadoNotificacoesAgendamentoPublico): string[] {
  const falhas: string[] = [];
  if (!mesmaLista(estado.migrationNames, [...MIGRATIONS_INICIAIS, ...MIGRATIONS_NOTIFICACOES_AGENDAMENTO_PUBLICO])) {
    falhas.push('migration_history');
  }
  if (!estado.priceCentsIsNullable) falhas.push('price_nullability');
  if (!estado.prerequisitesPresent) falhas.push('prerequisites');
  falhas.push(...compararObjetos(estado).falhas);
  return falhas;
}
