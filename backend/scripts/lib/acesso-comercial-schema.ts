// Conferência da migration `CommercialAccess1793232000000` no banco do
// piloto, ANTES e DEPOIS de aplicá-la (ver docs/plans/planos-e-validade-do-acesso.md
// e docs/runbooks/publicacao-acesso-comercial-piloto.md).
//
// Só leitura: `BEGIN TRANSACTION READ ONLY` ... `ROLLBACK`. Lê metadados,
// contagens e identificadores (ids, códigos de plano e de recurso), nunca
// nome de pessoa, e-mail, telefone ou senha. As falhas saem como nomes fixos.
//
// ANTES: histórico com EXATAMENTE as onze migrations até TeamManagerAccess,
// os objetos delas (conferência `after-team-manager`, reaproveitada), o que a
// migration nova usa (btree_gist, catálogo de recursos, constraint única de
// plan_features), os três planos com os nomes anteriores, nenhum objeto novo
// e NENHUMA exceção de recurso desligada (com o código novo ela passaria a
// valer; antes não tinha efeito). Exceção desligada é decisão de uma pessoa:
// o procedimento lista os ids e para.
// DEPOIS: as doze migrations na ordem, cada objeto novo presente, os nomes
// novos dos planos, as linhas novas do catálogo e nenhum recurso existente
// negado a um estabelecimento marcado como anterior ao controle.
//
// Nomes e valores abaixo vêm de src/migrations/1793232000000-CommercialAccess.ts.
// Ficam duplicados de propósito (os scripts compilam com `rootDir:
// ./scripts`); acesso-comercial-schema.spec.ts confere que são iguais.
import type { PgClientLike } from './pg-client.js';
import { parseNonNegativeInteger } from './pg-value-parsers.js';
import {
  MIGRATIONS_ATE_PAGAMENTOS,
  MIGRATION_GERENTE,
  falhasDepoisDeGerente,
  lerEstadoGerente,
} from './gerente-acessos-schema.js';

export const MIGRATIONS_ATE_GERENTE = [...MIGRATIONS_ATE_PAGAMENTOS, MIGRATION_GERENTE] as const;
export const MIGRATION_COMERCIAL = 'CommercialAccess1793232000000';

/** Valores novos de `audit_action`, como `tipo.valor`. */
export const VALORES_COMERCIAL = [
  'audit_action.ACCESS_PAID_PERIOD_RECORDED',
  'audit_action.ACCESS_TRIAL_EXTENDED',
  'audit_action.ACCESS_COURTESY_GRANTED',
  'audit_action.ACCESS_PERIOD_CORRECTED',
] as const;

export const TIPOS_COMERCIAL = {
  access_period_kind: ['TRIAL', 'PAID', 'COURTESY'],
  billing_cycle: ['MONTHLY', 'QUARTERLY'],
} as const;

export const TABELA_PERIODOS = 'tenant_access_periods';
export const COLUNAS_PERIODOS = [
  'id',
  'tenant_id',
  'kind',
  'plan_id',
  'starts_at',
  'ends_at',
  'anchor_day',
  'billing_cycle',
  'contracted_price_cents',
  'currency',
  'payment_method',
  'payment_received_on',
  'payment_reference',
  'confirmation_source',
  'reason',
  'recorded_at',
  'recorded_by_user_id',
  'request_key',
  'canceled_at',
  'canceled_by_user_id',
  'cancel_reason',
  'cancel_request_key',
] as const;

/** Constraints da tabela nova, com o tipo (`pg_constraint.contype`). */
export const CONSTRAINTS_PERIODOS: readonly (readonly [string, 'p' | 'f' | 'c' | 'x'])[] = [
  ['pk_tenant_access_periods', 'p'],
  ['fk_tenant_access_periods_tenant', 'f'],
  ['fk_tenant_access_periods_plan', 'f'],
  ['fk_tenant_access_periods_recorded_by', 'f'],
  ['fk_tenant_access_periods_canceled_by', 'f'],
  ['ck_tenant_access_periods_cancel', 'c'],
  ['ck_tenant_access_periods_dates', 'c'],
  ['ck_tenant_access_periods_anchor', 'c'],
  ['ck_tenant_access_periods_method', 'c'],
  ['ck_tenant_access_periods_kind', 'c'],
  ['ck_tenant_access_periods_courtesy', 'c'],
  ['ex_tenant_access_periods_paid_overlap', 'x'],
  ['ex_tenant_access_periods_trial_overlap', 'x'],
];

export const INDICES_PERIODOS = [
  'uq_tenant_access_periods_request_key',
  'uq_tenant_access_periods_cancel_request_key',
  'idx_tenant_access_periods_tenant_ends',
] as const;

export const COLUNA_LEGADO: readonly [string, string] = ['tenants', 'access_legacy_since'];

/** Os três planos conhecidos: id, código e nomes antes/depois. */
export const PLANOS_COMERCIAL = [
  { id: 'plan_essencial', code: 'essencial', antes: 'Essencial', depois: 'Básico' },
  { id: 'plan_equipe', code: 'equipe', antes: 'Gestão', depois: 'Pro' },
  { id: 'plan_pro', code: 'pro', antes: 'Rede', depois: 'Max' },
] as const;

/** Linhas novas de `plan_features` (ids fixos da migration). */
export const LINHAS_DO_CATALOGO = [
  { id: 'pf_ca_essencial_consumidores', planId: 'plan_essencial', featureId: 'feat_consumidores' },
  { id: 'pf_ca_essencial_equipe', planId: 'plan_essencial', featureId: 'feat_equipe' },
  { id: 'pf_ca_essencial_pagamentos', planId: 'plan_essencial', featureId: 'feat_pagamentos' },
  { id: 'pf_ca_equipe_pagamentos', planId: 'plan_equipe', featureId: 'feat_pagamentos' },
] as const;
export const PREFIXO_DO_CATALOGO = 'pf_ca_';

/** Recursos que já existiam no código antes do lote: nenhum estabelecimento
 * existente pode perder um deles. */
export const RECURSOS_EXISTENTES = [
  'feat_agenda',
  'feat_agendamento_publico',
  'feat_profissionais',
  'feat_consumidores',
  'feat_equipe',
  'feat_pagamentos',
] as const;

/** Prefixo das exceções que a migration grava (o `down()` remove só elas). */
export const PREFIXO_DAS_EXCECOES = 'tfo_ca_';

/** O que a migration usa e precisa existir antes e depois. */
export const PRE_REQUISITOS_COMERCIAL = {
  extensoes: ['btree_gist'] as readonly string[],
  constraints: ['uq_plan_features_plan_feature'] as readonly string[],
  tabelas: ['plans', 'features', 'plan_features', 'tenant_feature_overrides', 'tenants', 'audit_logs'] as readonly string[],
};

export interface EstadoComercial {
  migrationNames: string[];
  /** Falhas da conferência `after-team-manager` (sem o histórico, conferido aqui). */
  falhasDoGerente: string[];
  preRequisitosAusentes: string[];
  valores: string[];
  /** `tipo.valor` dos dois tipos novos (vazio se não existem). */
  tipos: string[];
  tabela: boolean;
  colunasDaTabela: string[];
  /** `nome:tipo` das constraints da tabela nova. */
  constraints: string[];
  indices: string[];
  colunaLegado: boolean;
  /** `id:code:name` dos três planos conhecidos que existem. */
  planos: string[];
  /** ids `pf_ca_*` presentes, com plano e recurso certos. */
  linhasDoCatalogo: string[];
  linhasDoCatalogoErradas: number;
  /** Recursos existentes ausentes da tabela `features`. */
  recursosAusentes: string[];
  excecoesDaMigration: number;
  excecoesDesligadas: number;
  /** Recursos existentes que os três planos não têm no catálogo. */
  recursosFaltandoNosPlanos: number;
}

async function somenteLeitura<T>(client: PgClientLike, ler: () => Promise<T>): Promise<T> {
  await client.query('BEGIN TRANSACTION READ ONLY');
  try {
    return await ler();
  } finally {
    try {
      await client.query('ROLLBACK');
    } catch {
      // O erro original é o que importa.
    }
  }
}

const numero = (valor: string | undefined, campo: string) => parseNonNegativeInteger(valor, campo);

export async function lerEstadoComercial(client: PgClientLike): Promise<EstadoComercial> {
  // A conferência do gerente abre e fecha a própria transação só-leitura.
  const gerente = await lerEstadoGerente(client);
  return somenteLeitura(client, async () => {
    const migrations = await client.query<{ name: string }>('SELECT name FROM typeorm_migrations ORDER BY id');
    const extensoes = await client.query<{ extname: string }>('SELECT extname FROM pg_extension WHERE extname = ANY($1)', [
      [...PRE_REQUISITOS_COMERCIAL.extensoes],
    ]);
    const tabelasBase = await client.query<{ tabela: string }>(
      `SELECT c.relname AS tabela FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname = ANY($1)`,
      [[...PRE_REQUISITOS_COMERCIAL.tabelas, TABELA_PERIODOS]],
    );
    const constraintsBase = await client.query<{ conname: string }>(
      `SELECT c.conname FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE n.nspname = 'public' AND c.conname = ANY($1)`,
      [[...PRE_REQUISITOS_COMERCIAL.constraints]],
    );
    const valores = await client.query<{ valor: string }>(
      `SELECT t.typname || '.' || e.enumlabel AS valor FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname || '.' || e.enumlabel = ANY($1)`,
      [[...VALORES_COMERCIAL]],
    );
    const tipos = await client.query<{ valor: string }>(
      `SELECT t.typname || '.' || e.enumlabel AS valor FROM pg_type t
         JOIN pg_namespace n ON n.oid = t.typnamespace JOIN pg_enum e ON e.enumtypid = t.oid
        WHERE n.nspname = 'public' AND t.typname = ANY($1) ORDER BY t.typname, e.enumsortorder`,
      [Object.keys(TIPOS_COMERCIAL)],
    );
    const colunas = await client.query<{ tabela: string; coluna: string }>(
      `SELECT table_name AS tabela, column_name AS coluna FROM information_schema.columns
        WHERE table_schema = 'public' AND (table_name = $1 OR (table_name = $2 AND column_name = $3))`,
      [TABELA_PERIODOS, COLUNA_LEGADO[0], COLUNA_LEGADO[1]],
    );
    const constraints = await client.query<{ conname: string; contype: string }>(
      `SELECT c.conname, c.contype::text AS contype FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE n.nspname = 'public' AND c.conname = ANY($1)`,
      [CONSTRAINTS_PERIODOS.map(([nome]) => nome)],
    );
    const indices = await client.query<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = ANY($1)",
      [[...INDICES_PERIODOS]],
    );
    const nomesDasTabelas = tabelasBase.rows.map((r) => r.tabela);
    const temCatalogo = ['plans', 'features', 'plan_features', 'tenant_feature_overrides', 'tenants'].every((t) =>
      nomesDasTabelas.includes(t),
    );
    const vazio = { rows: [] as never[] };
    const planos = temCatalogo
      ? await client.query<{ chave: string }>(
          "SELECT id || ':' || code || ':' || name AS chave FROM plans WHERE id = ANY($1) ORDER BY id",
          [PLANOS_COMERCIAL.map((p) => p.id)],
        )
      : vazio;
    const linhas = temCatalogo
      ? await client.query<{ id: string; plan_id: string; feature_id: string }>(
          'SELECT id, plan_id, feature_id FROM plan_features WHERE starts_with(id, $1::text) ORDER BY id',
          [PREFIXO_DO_CATALOGO],
        )
      : vazio;
    const recursos = temCatalogo
      ? await client.query<{ id: string }>('SELECT id FROM features WHERE id = ANY($1)', [[...RECURSOS_EXISTENTES]])
      : vazio;
    const [contagens] = temCatalogo
      ? (
          await client.query<{ da_migration: string; desligadas: string; faltando: string }>(
            `SELECT
              (SELECT count(*) FROM tenant_feature_overrides WHERE starts_with(id, $1::text))::text AS da_migration,
              (SELECT count(*) FROM tenant_feature_overrides WHERE enabled = false)::text AS desligadas,
              (SELECT count(*) FROM plans p CROSS JOIN features f
                WHERE p.id = ANY($2) AND f.id = ANY($3)
                  AND NOT EXISTS (SELECT 1 FROM plan_features pf WHERE pf.plan_id = p.id AND pf.feature_id = f.id))::text AS faltando`,
            [PREFIXO_DAS_EXCECOES, PLANOS_COMERCIAL.map((p) => p.id), [...RECURSOS_EXISTENTES]],
          )
        ).rows
      : [undefined];

    const ausentes: string[] = [];
    for (const nome of PRE_REQUISITOS_COMERCIAL.extensoes) {
      if (!extensoes.rows.some((r) => r.extname === nome)) ausentes.push(`extension_${nome}`);
    }
    for (const nome of PRE_REQUISITOS_COMERCIAL.tabelas) if (!nomesDasTabelas.includes(nome)) ausentes.push(`table_${nome}`);
    for (const nome of PRE_REQUISITOS_COMERCIAL.constraints) {
      if (!constraintsBase.rows.some((r) => r.conname === nome)) ausentes.push(nome);
    }
    const esperadas = new Map<string, { planId: string; featureId: string }>(
      LINHAS_DO_CATALOGO.map((l) => [l.id, { planId: l.planId, featureId: l.featureId }]),
    );
    const certas = linhas.rows.filter((l) => {
      const e = esperadas.get(l.id);
      return e !== undefined && e.planId === l.plan_id && e.featureId === l.feature_id;
    });
    const idsDosRecursos = recursos.rows.map((r) => r.id);
    return {
      migrationNames: migrations.rows.map((r) => r.name),
      falhasDoGerente: falhasDepoisDeGerente({ ...gerente, migrationNames: [...MIGRATIONS_ATE_GERENTE] }),
      preRequisitosAusentes: ausentes,
      valores: valores.rows.map((r) => r.valor),
      tipos: tipos.rows.map((r) => r.valor),
      tabela: nomesDasTabelas.includes(TABELA_PERIODOS),
      colunasDaTabela: colunas.rows.filter((r) => r.tabela === TABELA_PERIODOS).map((r) => r.coluna),
      constraints: constraints.rows.map((r) => `${r.conname}:${r.contype}`),
      indices: indices.rows.map((r) => r.indexname),
      colunaLegado: colunas.rows.some((r) => r.tabela === COLUNA_LEGADO[0] && r.coluna === COLUNA_LEGADO[1]),
      planos: planos.rows.map((r) => r.chave),
      linhasDoCatalogo: certas.map((l) => l.id),
      linhasDoCatalogoErradas: linhas.rows.length - certas.length,
      recursosAusentes: RECURSOS_EXISTENTES.filter((id) => !idsDosRecursos.includes(id)),
      excecoesDaMigration: numero(contagens?.da_migration ?? '0', 'migration_overrides'),
      excecoesDesligadas: numero(contagens?.desligadas ?? '0', 'disabled_overrides'),
      recursosFaltandoNosPlanos: numero(contagens?.faltando ?? '0', 'plan_features_missing'),
    };
  });
}

const mesmaLista = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((valor, i) => valor === b[i]);

const planosEsperados = (momento: 'antes' | 'depois') =>
  PLANOS_COMERCIAL.map((p) => `${p.id}:${p.code}:${p[momento]}`).sort();

const tiposEsperados = () => Object.entries(TIPOS_COMERCIAL).flatMap(([tipo, rotulos]) => rotulos.map((r) => `${tipo}.${r}`));

function falhasComuns(estado: EstadoComercial): string[] {
  return [
    ...estado.falhasDoGerente.map((f) => `team_manager_${f}`),
    ...estado.preRequisitosAusentes,
    ...estado.recursosAusentes.map((id) => `feature_row_${id}`),
  ];
}

export function falhasAntesDeComercial(estado: EstadoComercial): string[] {
  const falhas: string[] = [];
  if (!mesmaLista(estado.migrationNames, MIGRATIONS_ATE_GERENTE)) falhas.push('migration_history');
  falhas.push(...falhasComuns(estado));
  if (estado.valores.length) falhas.push('new_enum_values_already_exist');
  if (estado.tipos.length) falhas.push('new_types_already_exist');
  if (estado.tabela) falhas.push('access_periods_table_already_exists');
  if (estado.constraints.length || estado.indices.length) falhas.push('access_periods_objects_already_exist');
  if (estado.colunaLegado) falhas.push('legacy_column_already_exists');
  if (!mesmaLista([...estado.planos].sort(), planosEsperados('antes'))) falhas.push('plan_names_or_codes_unexpected');
  if (estado.linhasDoCatalogo.length || estado.linhasDoCatalogoErradas) falhas.push('catalog_rows_already_exist');
  if (estado.excecoesDaMigration) falhas.push('migration_overrides_already_exist');
  if (estado.excecoesDesligadas) falhas.push('disabled_feature_overrides');
  return falhas;
}

export function falhasDepoisDeComercial(estado: EstadoComercial): string[] {
  const falhas: string[] = [];
  if (!mesmaLista(estado.migrationNames, [...MIGRATIONS_ATE_GERENTE, MIGRATION_COMERCIAL])) falhas.push('migration_history');
  falhas.push(...falhasComuns(estado));
  for (const valor of VALORES_COMERCIAL) if (!estado.valores.includes(valor)) falhas.push(`enum_${valor}`);
  if (!mesmaLista(estado.tipos, tiposEsperados())) falhas.push('access_period_types');
  if (!estado.tabela) falhas.push(`table_${TABELA_PERIODOS}`);
  else if (!mesmaLista([...estado.colunasDaTabela].sort(), [...COLUNAS_PERIODOS].sort())) falhas.push('access_periods_columns');
  for (const [nome, tipo] of CONSTRAINTS_PERIODOS) if (!estado.constraints.includes(`${nome}:${tipo}`)) falhas.push(nome);
  for (const nome of INDICES_PERIODOS) if (!estado.indices.includes(nome)) falhas.push(nome);
  if (!estado.colunaLegado) falhas.push(`column_${COLUNA_LEGADO.join('_')}`);
  if (!mesmaLista([...estado.planos].sort(), planosEsperados('depois'))) falhas.push('plan_names_or_codes_unexpected');
  if (estado.linhasDoCatalogoErradas) falhas.push('catalog_rows_unexpected');
  for (const linha of LINHAS_DO_CATALOGO) if (!estado.linhasDoCatalogo.includes(linha.id)) falhas.push(`catalog_${linha.id}`);
  if (estado.recursosFaltandoNosPlanos) falhas.push('known_plans_missing_existing_features');
  return falhas;
}

export const TOTAL_OBJETOS_COMERCIAL =
  VALORES_COMERCIAL.length + 2 + 1 + CONSTRAINTS_PERIODOS.length + INDICES_PERIODOS.length + 1 + LINHAS_DO_CATALOGO.length;

export function objetosComercialPresentes(estado: EstadoComercial): number {
  const tiposPresentes = Object.keys(TIPOS_COMERCIAL).filter((t) => estado.tipos.some((v) => v.startsWith(`${t}.`))).length;
  return (
    estado.valores.length +
    tiposPresentes +
    (estado.tabela ? 1 : 0) +
    CONSTRAINTS_PERIODOS.filter(([n, t]) => estado.constraints.includes(`${n}:${t}`)).length +
    estado.indices.length +
    (estado.colunaLegado ? 1 : 0) +
    estado.linhasDoCatalogo.length
  );
}

// ------------------------------------------------------------ impacto

export const MAXIMO_DE_DETALHES_COMERCIAL = 50;

export interface ImpactoComercial {
  estabelecimentos: number;
  /** `situacao=n` por `tenants.status`. */
  porSituacao: Record<string, number>;
  /** Por plano: id, código e quantos estabelecimentos. */
  porPlano: { planoId: string; codigo: string; estabelecimentos: number }[];
  /** Estabelecimentos num plano fora dos três conhecidos. */
  foraDoCatalogo: number;
  excecoes: number;
  excecoesLigadas: number;
  excecoesDesligadas: number;
  /** Pares (estabelecimento, recurso) só com ids. */
  desligadas: { tenantId: string; featureId: string }[];
  /** Exceções `tfo_ca_*` que a migration grava (antes: previsão; depois: 0). */
  excecoesPrevistas: number;
  /** Linhas `pf_ca_*` que a migration grava: as do catálogo novo cujo par
   * (plano, recurso) ainda não existe (antes: previsão; depois: 0). */
  linhasDoCatalogoPrevistas: number;
  /** Exceções `tfo_ca_*` gravadas (antes: 0). */
  excecoesDaMigration: number;
  /** Pares (estabelecimento existente, recurso existente) negados pela regra
   * nova depois da migration. Antes dela: os que nem o catálogo novo nem a
   * exceção que a migration grava cobririam (só exceção desligada). Depois:
   * os estabelecimentos marcados como anteriores sem o recurso. Precisa ser
   * 0: nada é retirado. */
  recursosNegados: number;
  /** `null` antes da migration (coluna ou tabela ainda não existe). */
  marcadosComoAnteriores: number | null;
  semMarca: number | null;
  periodos: number | null;
  periodosAnulados: number | null;
}

/**
 * Levantamento SÓ DE LEITURA. Funciona antes e depois da migration: o que
 * depende dela só é lido quando existe. A regra do recurso é a de
 * commercial/commercial-gate.ts (`FEATURE_ENABLED_SQL`: exceção individual
 * primeiro, senão o catálogo do plano), com as linhas novas do catálogo
 * somadas ao que já existe. Mesma lógica de
 * docs/runbooks/consultas/impacto-comercial-somente-leitura.sql.
 */
export async function lerImpactoComercial(client: PgClientLike): Promise<ImpactoComercial> {
  return somenteLeitura(client, async () => {
    const [{ coluna, tabela }] = (
      await client.query<{ coluna: boolean; tabela: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                          AND table_name = 'tenants' AND column_name = 'access_legacy_since') AS coluna,
                to_regclass('public.tenant_access_periods') IS NOT NULL AS tabela`,
      )
    ).rows;
    const situacoes = await client.query<{ situacao: string; n: string }>(
      'SELECT status::text AS situacao, count(*)::text AS n FROM tenants GROUP BY status ORDER BY status::text',
    );
    const planos = await client.query<{ id: string; code: string; n: string }>(
      `SELECT p.id, p.code, (SELECT count(*) FROM tenants t WHERE t.plan_id = p.id)::text AS n
         FROM plans p ORDER BY p.id`,
    );
    const catalogo = LINHAS_DO_CATALOGO.map((l) => `${l.planId}:${l.featureId}`);
    // Antes da migration todo estabelecimento é existente e ela grava a
    // exceção ligada onde falta catálogo; depois, só os marcados contam e
    // nenhuma exceção nova virá. Trechos fixos, escolhidos aqui.
    const existente = coluna ? 't.access_legacy_since IS NOT NULL' : 'true';
    const cobertoPelaMigration = coluna ? 'false' : 'true';
    const [c] = (
      await client.query<Record<string, string>>(
        `WITH catalogo AS (
           SELECT plan_id, feature_id FROM plan_features
           UNION SELECT split_part(x, ':', 1), split_part(x, ':', 2) FROM unnest($1::text[]) x
         ), pares AS (
           SELECT t.id AS tenant_id, f.id AS feature_id,
                  (SELECT o.enabled FROM tenant_feature_overrides o WHERE o.tenant_id = t.id AND o.feature_id = f.id) AS excecao,
                  EXISTS (SELECT 1 FROM catalogo k WHERE k.plan_id = t.plan_id AND k.feature_id = f.id) AS no_plano,
                  ${existente} AS existente
             FROM tenants t CROSS JOIN features f WHERE f.id = ANY($2)
         )
         SELECT
           (SELECT count(*) FROM tenants WHERE NOT (plan_id = ANY($3)))::text AS fora,
           (SELECT count(*) FROM tenant_feature_overrides)::text AS excecoes,
           (SELECT count(*) FROM tenant_feature_overrides WHERE enabled)::text AS ligadas,
           (SELECT count(*) FROM tenant_feature_overrides WHERE NOT enabled)::text AS desligadas,
           (SELECT count(*) FROM tenant_feature_overrides WHERE starts_with(id, $4::text))::text AS da_migration,
           (SELECT count(*) FROM pares WHERE excecao IS NULL AND NOT no_plano)::text AS previstas,
           (SELECT count(*) FROM unnest($1::text[]) x
              JOIN plans p ON p.id = split_part(x, ':', 1) JOIN features f ON f.id = split_part(x, ':', 2)
             WHERE NOT EXISTS (SELECT 1 FROM plan_features pf WHERE pf.plan_id = p.id AND pf.feature_id = f.id))::text AS catalogo_previsto,
           (SELECT count(*) FROM pares WHERE existente
              AND (excecao IS FALSE OR (excecao IS NULL AND NOT no_plano AND NOT ${cobertoPelaMigration})))::text AS negados`,
        [catalogo, [...RECURSOS_EXISTENTES], PLANOS_COMERCIAL.map((p) => p.id), PREFIXO_DAS_EXCECOES],
      )
    ).rows;
    const desligadas = await client.query<{ tenant_id: string; feature_id: string }>(
      `SELECT tenant_id, feature_id FROM tenant_feature_overrides WHERE NOT enabled
        ORDER BY tenant_id, feature_id LIMIT ${MAXIMO_DE_DETALHES_COMERCIAL}`,
    );
    const legado = coluna
      ? (
          await client.query<{ marcados: string; sem: string }>(
            `SELECT count(*) FILTER (WHERE access_legacy_since IS NOT NULL)::text AS marcados,
                    count(*) FILTER (WHERE access_legacy_since IS NULL)::text AS sem FROM tenants`,
          )
        ).rows[0]
      : undefined;
    const periodos = tabela
      ? (
          await client.query<{ total: string; anulados: string }>(
            `SELECT count(*)::text AS total, count(*) FILTER (WHERE canceled_at IS NOT NULL)::text AS anulados
               FROM tenant_access_periods`,
          )
        ).rows[0]
      : undefined;
    const porSituacao = Object.fromEntries(situacoes.rows.map((r) => [r.situacao, numero(r.n, 'tenants_by_status')]));
    return {
      estabelecimentos: Object.values(porSituacao).reduce((a, b) => a + b, 0),
      porSituacao,
      porPlano: planos.rows.map((r) => ({ planoId: r.id, codigo: r.code, estabelecimentos: numero(r.n, 'tenants_by_plan') })),
      foraDoCatalogo: numero(c?.fora, 'tenants_outside_catalog'),
      excecoes: numero(c?.excecoes, 'overrides'),
      excecoesLigadas: numero(c?.ligadas, 'overrides_enabled'),
      excecoesDesligadas: numero(c?.desligadas, 'overrides_disabled'),
      desligadas: desligadas.rows.map((r) => ({ tenantId: r.tenant_id, featureId: r.feature_id })),
      excecoesPrevistas: numero(c?.previstas, 'overrides_expected'),
      linhasDoCatalogoPrevistas: numero(c?.catalogo_previsto, 'catalog_rows_expected'),
      excecoesDaMigration: numero(c?.da_migration, 'migration_overrides'),
      recursosNegados: numero(c?.negados, 'features_denied'),
      marcadosComoAnteriores: legado ? numero(legado.marcados, 'tenants_legacy') : null,
      semMarca: legado ? numero(legado.sem, 'tenants_not_legacy') : null,
      periodos: periodos ? numero(periodos.total, 'access_periods') : null,
      periodosAnulados: periodos ? numero(periodos.anulados, 'access_periods_canceled') : null,
    };
  });
}

/** Linhas fixas `NOME: valor` para a saída dos procedimentos. */
export function descreverImpactoComercial(impacto: ImpactoComercial): string[] {
  const nada = (v: number | null) => (v === null ? 'ainda não existe' : String(v));
  const linhas = [
    `ESTABELECIMENTOS: ${impacto.estabelecimentos}`,
    `POR_SITUACAO: ${Object.entries(impacto.porSituacao).map(([k, v]) => `${k}=${v}`).join(' ') || '-'}`,
    ...impacto.porPlano.map((p) => `PLANO: id=${p.planoId} codigo=${p.codigo} estabelecimentos=${p.estabelecimentos}`),
    `EM_PLANO_FORA_DO_CATALOGO: ${impacto.foraDoCatalogo}`,
    `EXCECOES_DE_RECURSO: ${impacto.excecoes} (ligadas=${impacto.excecoesLigadas} desligadas=${impacto.excecoesDesligadas})`,
    `EXCECOES_DESLIGADAS: ${impacto.excecoesDesligadas}`,
    `LINHAS_DO_CATALOGO_PREVISTAS: ${impacto.linhasDoCatalogoPrevistas}`,
    `EXCECOES_PREVISTAS_DA_MIGRATION: ${impacto.excecoesPrevistas}`,
    `EXCECOES_GRAVADAS_PELA_MIGRATION: ${impacto.excecoesDaMigration}`,
    `RECURSOS_EXISTENTES_NEGADOS: ${impacto.recursosNegados}`,
    `MARCADOS_COMO_ANTERIORES: ${nada(impacto.marcadosComoAnteriores)}`,
    `SEM_MARCA_DE_ANTERIOR: ${nada(impacto.semMarca)}`,
    `PERIODOS_DE_ACESSO: ${nada(impacto.periodos)}`,
    `PERIODOS_ANULADOS: ${nada(impacto.periodosAnulados)}`,
  ];
  for (const d of impacto.desligadas) linhas.push(`EXCECAO_DESLIGADA: tenant=${d.tenantId} recurso=${d.featureId}`);
  if (impacto.desligadas.length < impacto.excecoesDesligadas) {
    linhas.push(`EXCECOES_DESLIGADAS_NAO_LISTADAS: ${impacto.excecoesDesligadas - impacto.desligadas.length}`);
  }
  return linhas;
}

// ------------------------------------------------------------ reversão

/** Em `after`: o que um `migration:revert` apagaria ou deixaria de valer. */
export async function lerEfeitoDaReversao(client: PgClientLike): Promise<Record<string, number>> {
  return somenteLeitura(client, async () => {
    const [r] = (
      await client.query<Record<string, string>>(
        `SELECT
          (SELECT count(*) FROM tenant_access_periods)::text AS "periodosApagados",
          (SELECT count(*) FROM tenant_access_periods WHERE kind = 'PAID')::text AS "pagamentosApagados",
          (SELECT count(*) FROM tenant_access_periods WHERE kind = 'COURTESY')::text AS "cortesiasApagadas",
          (SELECT count(*) FROM tenant_access_periods WHERE kind = 'TRIAL')::text AS "testesApagados",
          (SELECT count(*) FROM tenant_access_periods WHERE canceled_at IS NOT NULL)::text AS "anulacoesApagadas",
          (SELECT count(*) FROM tenants WHERE access_legacy_since IS NOT NULL)::text AS "marcasDeAnteriorApagadas",
          (SELECT count(*) FROM tenants WHERE access_legacy_since IS NULL)::text AS "estabelecimentosSemMarca",
          (SELECT count(*) FROM tenant_feature_overrides WHERE starts_with(id, $1::text))::text AS "excecoesApagadas",
          (SELECT count(*) FROM plan_features WHERE starts_with(id, $2::text))::text AS "linhasDoCatalogoApagadas",
          (SELECT count(*) FROM audit_logs WHERE action::text = ANY($3))::text AS "registrosDeAuditoriaQueFicam"`,
        [PREFIXO_DAS_EXCECOES, PREFIXO_DO_CATALOGO, VALORES_COMERCIAL.map((v) => v.slice('audit_action.'.length))],
      )
    ).rows;
    return Object.fromEntries(Object.entries(r ?? {}).map(([k, v]) => [k, parseNonNegativeInteger(v, k)]));
  });
}
