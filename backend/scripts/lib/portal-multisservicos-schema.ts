// Conferência das migrations `PlatformPortal1793318400000` e
// `AppointmentServiceSnapshots1793404800000` no banco do piloto (ver
// docs/runbooks/publicacao-portal-multisservicos-piloto.md). Três estados,
// nesta ordem, e nenhum outro:
//
//   before-platform-portal       as doze migrations até CommercialAccess, com
//                                os objetos delas (conferência
//                                `after-commercial-access`, reaproveitada) e
//                                nenhum objeto das duas novas;
//   after-platform-portal        estado INTERMEDIÁRIO: treze migrations, os
//                                objetos do portal e ainda sem o nome
//                                congelado do serviço;
//   after-appointment-snapshots  estado FINAL: as catorze migrations e todos
//                                os objetos das duas.
//
// Só leitura: `BEGIN TRANSACTION READ ONLY` ... `ROLLBACK`. Lê metadados,
// contagens e identificadores (ids, papéis, situações), nunca nome de pessoa,
// e-mail, telefone, senha ou valor. As falhas saem como nomes fixos.
//
// Nomes abaixo vêm de src/migrations/1793318400000-PlatformPortal.ts e
// src/migrations/1793404800000-AppointmentServiceSnapshots.ts. Ficam
// duplicados de propósito (os scripts compilam com `rootDir: ./scripts`);
// portal-multisservicos-schema.spec.ts confere que são iguais.
import type { PgClientLike } from './pg-client.js';
import { parseNonNegativeInteger } from './pg-value-parsers.js';
import {
  MIGRATIONS_ATE_GERENTE,
  MIGRATION_COMERCIAL,
  falhasDepoisDeComercial,
  lerEstadoComercial,
} from './acesso-comercial-schema.js';

export const MIGRATIONS_ATE_COMERCIAL = [...MIGRATIONS_ATE_GERENTE, MIGRATION_COMERCIAL] as const;
export const MIGRATION_PORTAL = 'PlatformPortal1793318400000';
export const MIGRATION_NOMES_CONGELADOS = 'AppointmentServiceSnapshots1793404800000';
export const MIGRATIONS_ATE_PORTAL = [...MIGRATIONS_ATE_COMERCIAL, MIGRATION_PORTAL] as const;
export const MIGRATIONS_ATE_NOMES_CONGELADOS = [...MIGRATIONS_ATE_PORTAL, MIGRATION_NOMES_CONGELADOS] as const;

/** Valores novos de `audit_action`, como `tipo.valor`. */
export const VALORES_PORTAL = [
  'audit_action.PLAN_PRICE_CHANGED',
  'audit_action.CONTRACT_PRICE_CHANGED',
  'audit_action.ACCESS_NO_EXPIRY_GRANTED',
  'audit_action.ACCESS_NO_EXPIRY_REVOKED',
] as const;

/** Tabelas novas do portal e as colunas de cada uma. */
export const TABELAS_PORTAL: Readonly<Record<string, readonly string[]>> = {
  plan_prices: [
    'id',
    'plan_id',
    'billing_cycle',
    'amount_cents',
    'currency',
    'reason',
    'recorded_at',
    'recorded_by_user_id',
    'request_key',
  ],
  tenant_contract_prices: [
    'id',
    'tenant_id',
    'plan_id',
    'billing_cycle',
    'amount_cents',
    'currency',
    'reason',
    'access_period_id',
    'recorded_at',
    'recorded_by_user_id',
    'request_key',
  ],
  tenant_no_expiry_grants: [
    'id',
    'tenant_id',
    'granted_at',
    'granted_by_user_id',
    'grant_reason',
    'grant_request_key',
    'revoked_at',
    'revoked_by_user_id',
    'revoke_reason',
    'revoke_request_key',
  ],
};
export const NOMES_DAS_TABELAS_PORTAL = Object.keys(TABELAS_PORTAL);

/** Constraints do portal, com o tipo (`pg_constraint.contype`). */
export const CONSTRAINTS_PORTAL: readonly (readonly [string, 'p' | 'f' | 'c'])[] = [
  ['pk_plan_prices', 'p'],
  ['fk_plan_prices_plan', 'f'],
  ['fk_plan_prices_recorded_by', 'f'],
  ['ck_plan_prices_amount', 'c'],
  ['ck_plan_prices_currency', 'c'],
  ['pk_tenant_contract_prices', 'p'],
  ['fk_tenant_contract_prices_tenant', 'f'],
  ['fk_tenant_contract_prices_plan', 'f'],
  ['fk_tenant_contract_prices_period', 'f'],
  ['fk_tenant_contract_prices_recorded_by', 'f'],
  ['ck_tenant_contract_prices_amount', 'c'],
  ['ck_tenant_contract_prices_currency', 'c'],
  ['ck_tenant_contract_prices_origin', 'c'],
  ['ck_tenant_access_periods_amount_source', 'c'],
  ['pk_tenant_no_expiry_grants', 'p'],
  ['fk_tenant_no_expiry_grants_tenant', 'f'],
  ['fk_tenant_no_expiry_grants_granted_by', 'f'],
  ['fk_tenant_no_expiry_grants_revoked_by', 'f'],
  ['ck_tenant_no_expiry_grants_revoke', 'c'],
];

export const INDICES_PORTAL = [
  'uq_plan_prices_request_key',
  'idx_plan_prices_current',
  'uq_tenant_contract_prices_request_key',
  'uq_tenant_contract_prices_period',
  'idx_tenant_contract_prices_current',
  'uq_tenant_no_expiry_grants_active',
  'uq_tenant_no_expiry_grants_grant_key',
  'uq_tenant_no_expiry_grants_revoke_key',
] as const;

/** Colunas novas em tabelas existentes: anuláveis, sem valor padrão. */
export const COLUNA_ORIGEM_DO_VALOR: readonly [string, string] = ['tenant_access_periods', 'amount_source'];
export const COLUNA_NOME_CONGELADO: readonly [string, string] = ['appointment_items', 'service_name_snapshot'];

export interface EstadoPortalMultisservicos {
  migrationNames: string[];
  /** Falhas da conferência `after-commercial-access` (sem o histórico, conferido aqui). */
  falhasDoComercial: string[];
  valores: string[];
  /** Colunas de cada tabela nova que existe. */
  tabelas: Record<string, string[]>;
  /** `nome:tipo`. */
  constraints: string[];
  indices: string[];
  /** `tipo:anulavel:padrao` da coluna nova, ou null se ela não existe. */
  colunaOrigem: string | null;
  colunaNomeCongelado: string | null;
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

export async function lerEstadoPortalMultisservicos(client: PgClientLike): Promise<EstadoPortalMultisservicos> {
  // A conferência comercial abre e fecha a própria transação só-leitura.
  const comercial = await lerEstadoComercial(client);
  return somenteLeitura(client, async () => {
    const migrations = await client.query<{ name: string }>('SELECT name FROM typeorm_migrations ORDER BY id');
    const valores = await client.query<{ valor: string }>(
      `SELECT t.typname || '.' || e.enumlabel AS valor FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname || '.' || e.enumlabel = ANY($1)`,
      [[...VALORES_PORTAL]],
    );
    const colunas = await client.query<{ tabela: string; coluna: string; tipo: string; anulavel: string; padrao: string | null }>(
      `SELECT table_name AS tabela, column_name AS coluna, data_type AS tipo, is_nullable AS anulavel, column_default AS padrao
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND (table_name = ANY($1) OR (table_name = $2 AND column_name = $3) OR (table_name = $4 AND column_name = $5))`,
      [NOMES_DAS_TABELAS_PORTAL, ...COLUNA_ORIGEM_DO_VALOR, ...COLUNA_NOME_CONGELADO],
    );
    const tabelas = await client.query<{ tabela: string }>(
      `SELECT c.relname AS tabela FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname = ANY($1)`,
      [NOMES_DAS_TABELAS_PORTAL],
    );
    const constraints = await client.query<{ conname: string; contype: string }>(
      `SELECT c.conname, c.contype::text AS contype FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE n.nspname = 'public' AND c.conname = ANY($1)`,
      [CONSTRAINTS_PORTAL.map(([nome]) => nome)],
    );
    const indices = await client.query<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = ANY($1)",
      [[...INDICES_PORTAL]],
    );
    const descrever = ([tabela, coluna]: readonly [string, string]) => {
      const c = colunas.rows.find((r) => r.tabela === tabela && r.coluna === coluna);
      return c ? `${c.tipo}:${c.anulavel}:${c.padrao ?? 'sem_padrao'}` : null;
    };
    const existentes = tabelas.rows.map((r) => r.tabela);
    return {
      migrationNames: migrations.rows.map((r) => r.name),
      falhasDoComercial: falhasDepoisDeComercial({ ...comercial, migrationNames: [...MIGRATIONS_ATE_COMERCIAL] }),
      valores: valores.rows.map((r) => r.valor),
      tabelas: Object.fromEntries(
        existentes.map((t) => [t, colunas.rows.filter((r) => r.tabela === t).map((r) => r.coluna)]),
      ),
      constraints: constraints.rows.map((r) => `${r.conname}:${r.contype}`),
      indices: indices.rows.map((r) => r.indexname),
      colunaOrigem: descrever(COLUNA_ORIGEM_DO_VALOR),
      colunaNomeCongelado: descrever(COLUNA_NOME_CONGELADO),
    };
  });
}

const mesmaLista = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((valor, i) => valor === b[i]);

/** A coluna nova precisa ser texto, anulável e sem valor padrão: nenhuma linha
 * existente ganha valor inventado. */
const COLUNA_NOVA_ESPERADA = 'character varying:YES:sem_padrao';

function falhasDoPortalPresente(estado: EstadoPortalMultisservicos): string[] {
  const falhas: string[] = [];
  for (const valor of VALORES_PORTAL) if (!estado.valores.includes(valor)) falhas.push(`enum_${valor}`);
  for (const [tabela, colunas] of Object.entries(TABELAS_PORTAL)) {
    const lidas = estado.tabelas[tabela];
    if (!lidas) falhas.push(`table_${tabela}`);
    else if (!mesmaLista([...lidas].sort(), [...colunas].sort())) falhas.push(`${tabela}_columns`);
  }
  for (const [nome, tipo] of CONSTRAINTS_PORTAL) if (!estado.constraints.includes(`${nome}:${tipo}`)) falhas.push(nome);
  for (const nome of INDICES_PORTAL) if (!estado.indices.includes(nome)) falhas.push(nome);
  if (estado.colunaOrigem === null) falhas.push(`column_${COLUNA_ORIGEM_DO_VALOR.join('_')}`);
  else if (estado.colunaOrigem !== COLUNA_NOVA_ESPERADA) falhas.push(`column_${COLUNA_ORIGEM_DO_VALOR.join('_')}_definition`);
  return falhas;
}

const comercial = (estado: EstadoPortalMultisservicos) => estado.falhasDoComercial.map((f) => `commercial_${f}`);

export function falhasAntesDoPortal(estado: EstadoPortalMultisservicos): string[] {
  const falhas: string[] = [];
  if (!mesmaLista(estado.migrationNames, MIGRATIONS_ATE_COMERCIAL)) falhas.push('migration_history');
  falhas.push(...comercial(estado));
  if (estado.valores.length) falhas.push('portal_enum_values_already_exist');
  if (Object.keys(estado.tabelas).length) falhas.push('portal_tables_already_exist');
  if (estado.constraints.length || estado.indices.length) falhas.push('portal_objects_already_exist');
  if (estado.colunaOrigem !== null) falhas.push('amount_source_column_already_exists');
  if (estado.colunaNomeCongelado !== null) falhas.push('service_name_snapshot_column_already_exists');
  return falhas;
}

/** Estado intermediário: o portal aplicado, o nome congelado ainda não. */
export function falhasDepoisDoPortal(estado: EstadoPortalMultisservicos): string[] {
  const falhas: string[] = [];
  if (!mesmaLista(estado.migrationNames, MIGRATIONS_ATE_PORTAL)) falhas.push('migration_history');
  falhas.push(...comercial(estado), ...falhasDoPortalPresente(estado));
  if (estado.colunaNomeCongelado !== null) falhas.push('service_name_snapshot_column_already_exists');
  return falhas;
}

/** Estado final: as duas aplicadas. */
export function falhasDepoisDosNomesCongelados(estado: EstadoPortalMultisservicos): string[] {
  const falhas: string[] = [];
  if (!mesmaLista(estado.migrationNames, MIGRATIONS_ATE_NOMES_CONGELADOS)) falhas.push('migration_history');
  falhas.push(...comercial(estado), ...falhasDoPortalPresente(estado));
  if (estado.colunaNomeCongelado === null) falhas.push(`column_${COLUNA_NOME_CONGELADO.join('_')}`);
  else if (estado.colunaNomeCongelado !== COLUNA_NOVA_ESPERADA) falhas.push(`column_${COLUNA_NOME_CONGELADO.join('_')}_definition`);
  return falhas;
}

export const TOTAL_OBJETOS_PORTAL_MULTISSERVICOS =
  VALORES_PORTAL.length + NOMES_DAS_TABELAS_PORTAL.length + CONSTRAINTS_PORTAL.length + INDICES_PORTAL.length + 2;

export function objetosPortalMultisservicosPresentes(estado: EstadoPortalMultisservicos): number {
  return (
    estado.valores.length +
    Object.keys(estado.tabelas).length +
    CONSTRAINTS_PORTAL.filter(([n, t]) => estado.constraints.includes(`${n}:${t}`)).length +
    estado.indices.length +
    (estado.colunaOrigem !== null ? 1 : 0) +
    (estado.colunaNomeCongelado !== null ? 1 : 0)
  );
}

// ------------------------------------------------------------ levantamento

/** Só a listagem detalhada (`CONTA_COM_PAPEL_GLOBAL`) é cortada; contagens e
 * a proteção de proprietário ativo usam `count(*)` sem limite. Os
 * proprietários vêm primeiro, para não ficarem fora do corte. */
export const MAXIMO_DE_CONTAS_LISTADAS = 50;

export interface ContaDaPlataforma {
  id: string;
  papel: string;
  situacao: string;
  /** Vínculos de DONO em estabelecimentos (ser dono não dá acesso global). */
  vinculosDeDono: number;
  criadaEm: string;
}

export interface ImpactoPortalMultisservicos {
  estabelecimentos: number;
  porSituacao: Record<string, number>;
  /** Registros comerciais que já existem e nenhuma das duas migrations toca. */
  periodos: number;
  periodosPorTipo: Record<string, number>;
  periodosAnulados: number;
  marcadosComoAnteriores: number;
  /** null antes da coluna existir. */
  pagosSemOrigem: number | null;
  pagosComOrigem: number | null;
  precosDoCatalogo: number | null;
  precosContratados: number | null;
  semVencimento: number | null;
  semVencimentoEmVigor: number | null;
  reservas: number;
  itensDeReserva: number;
  /** Reservas com mais de um item (antes desta versão, nenhuma tela as criava). */
  reservasComVariosItens: number;
  itensSemNomeCongelado: number | null;
  itensComNomeCongelado: number | null;
  recebimentos: number;
  /** Contas com papel global, por `papel:situacao`. */
  contasPorPapel: Record<string, number>;
  proprietariosAtivos: number;
  /** MASTER_ADMIN e MASTER_SUPPORT ativos: com a API nova, perdem todo acesso
   * ao portal (só MASTER_OWNER ativo entra). O papel fica gravado. */
  delegadosAtivos: number;
  /** Convites de plataforma pendentes, por papel. */
  convitesDePlataformaPendentes: Record<string, number>;
  /** Contas com papel global (só ids, papel, situação e datas), para a
   * conferência AUTORIZADA das identidades, feita fora deste procedimento. */
  contas: ContaDaPlataforma[];
}

/**
 * Levantamento SÓ DE LEITURA. Funciona nos três estados: o que depende das
 * migrations só é lido quando existe. Nada aqui altera papel ou permissão.
 * Mesma lógica de docs/runbooks/consultas/impacto-portal-multisservicos-somente-leitura.sql.
 */
export async function lerImpactoPortalMultisservicos(client: PgClientLike): Promise<ImpactoPortalMultisservicos> {
  return somenteLeitura(client, async () => {
    const [existe] = (
      await client.query<{ origem: boolean; nome: boolean; precos: boolean; contratos: boolean; sem_vencimento: boolean }>(
        `SELECT
          EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                   AND table_name = $1 AND column_name = $2) AS origem,
          EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                   AND table_name = $3 AND column_name = $4) AS nome,
          to_regclass('public.plan_prices') IS NOT NULL AS precos,
          to_regclass('public.tenant_contract_prices') IS NOT NULL AS contratos,
          to_regclass('public.tenant_no_expiry_grants') IS NOT NULL AS sem_vencimento`,
        [...COLUNA_ORIGEM_DO_VALOR, ...COLUNA_NOME_CONGELADO],
      )
    ).rows;
    const situacoes = await client.query<{ situacao: string; n: string }>(
      'SELECT status::text AS situacao, count(*)::text AS n FROM tenants GROUP BY status ORDER BY status::text',
    );
    const tipos = await client.query<{ tipo: string; n: string }>(
      'SELECT kind::text AS tipo, count(*)::text AS n FROM tenant_access_periods GROUP BY kind ORDER BY kind::text',
    );
    // Trechos fixos, escolhidos aqui conforme o que existe.
    const [c] = (
      await client.query<Record<string, string | null>>(
        `SELECT
          (SELECT count(*) FROM tenant_access_periods)::text AS periodos,
          (SELECT count(*) FROM tenant_access_periods WHERE canceled_at IS NOT NULL)::text AS anulados,
          (SELECT count(*) FROM tenants WHERE access_legacy_since IS NOT NULL)::text AS marcados,
          ${existe.origem ? "(SELECT count(*) FROM tenant_access_periods WHERE kind = 'PAID' AND amount_source IS NULL)::text" : 'NULL'} AS pagos_sem_origem,
          ${existe.origem ? '(SELECT count(*) FROM tenant_access_periods WHERE amount_source IS NOT NULL)::text' : 'NULL'} AS pagos_com_origem,
          ${existe.precos ? '(SELECT count(*) FROM plan_prices)::text' : 'NULL'} AS precos,
          ${existe.contratos ? '(SELECT count(*) FROM tenant_contract_prices)::text' : 'NULL'} AS contratos,
          ${existe.sem_vencimento ? '(SELECT count(*) FROM tenant_no_expiry_grants)::text' : 'NULL'} AS sem_vencimento,
          ${existe.sem_vencimento ? '(SELECT count(*) FROM tenant_no_expiry_grants WHERE revoked_at IS NULL)::text' : 'NULL'} AS sem_vencimento_em_vigor,
          (SELECT count(*) FROM appointments)::text AS reservas,
          (SELECT count(*) FROM appointment_items)::text AS itens,
          (SELECT count(*) FROM (SELECT appointment_id FROM appointment_items GROUP BY appointment_id HAVING count(*) > 1) v)::text AS varios,
          ${existe.nome ? '(SELECT count(*) FROM appointment_items WHERE service_name_snapshot IS NULL)::text' : 'NULL'} AS sem_nome,
          ${existe.nome ? '(SELECT count(*) FROM appointment_items WHERE service_name_snapshot IS NOT NULL)::text' : 'NULL'} AS com_nome,
          (SELECT count(*) FROM appointment_payments)::text AS recebimentos,
          (SELECT count(*) FROM users WHERE platform_role = 'MASTER_OWNER' AND status = 'ACTIVE')::text AS proprietarios,
          (SELECT count(*) FROM users WHERE platform_role IN ('MASTER_ADMIN', 'MASTER_SUPPORT') AND status = 'ACTIVE')::text AS delegados`,
      )
    ).rows;
    const papeis = await client.query<{ chave: string; n: string }>(
      `SELECT platform_role::text || ':' || status::text AS chave, count(*)::text AS n FROM users
        WHERE platform_role IS NOT NULL GROUP BY 1 ORDER BY 1`,
    );
    const convites = await client.query<{ papel: string; n: string }>(
      `SELECT coalesce(platform_role::text, 'sem_papel') AS papel, count(*)::text AS n FROM invites
        WHERE type = 'PLATFORM' AND status = 'PENDING' GROUP BY 1 ORDER BY 1`,
    );
    const contas = await client.query<{ id: string; papel: string; situacao: string; dono: string; criada: string }>(
      `SELECT u.id, u.platform_role::text AS papel, u.status::text AS situacao,
              (SELECT count(*) FROM memberships m WHERE m.user_id = u.id AND m.role = 'DONO')::text AS dono,
              to_char(u.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS criada
         FROM users u WHERE u.platform_role IS NOT NULL
        ORDER BY (u.platform_role <> 'MASTER_OWNER'), u.platform_role::text, u.created_at, u.id
        LIMIT ${MAXIMO_DE_CONTAS_LISTADAS}`,
    );
    const contar = (rows: { n: string }[], chave: (r: never) => string, campo: string) =>
      Object.fromEntries(rows.map((r) => [chave(r as never), numero(r.n, campo)]));
    const opcional = (v: string | null | undefined, campo: string) => (v === null || v === undefined ? null : numero(v, campo));
    const porSituacao = contar(situacoes.rows, (r: { situacao: string }) => r.situacao, 'tenants_by_status');
    return {
      estabelecimentos: Object.values(porSituacao).reduce((a, b) => a + b, 0),
      porSituacao,
      periodos: numero(c?.periodos ?? undefined, 'access_periods'),
      periodosPorTipo: contar(tipos.rows, (r: { tipo: string }) => r.tipo, 'access_periods_by_kind'),
      periodosAnulados: numero(c?.anulados ?? undefined, 'access_periods_canceled'),
      marcadosComoAnteriores: numero(c?.marcados ?? undefined, 'tenants_legacy'),
      pagosSemOrigem: opcional(c?.pagos_sem_origem, 'paid_without_source'),
      pagosComOrigem: opcional(c?.pagos_com_origem, 'paid_with_source'),
      precosDoCatalogo: opcional(c?.precos, 'plan_prices'),
      precosContratados: opcional(c?.contratos, 'contract_prices'),
      semVencimento: opcional(c?.sem_vencimento, 'no_expiry_grants'),
      semVencimentoEmVigor: opcional(c?.sem_vencimento_em_vigor, 'no_expiry_active'),
      reservas: numero(c?.reservas ?? undefined, 'appointments'),
      itensDeReserva: numero(c?.itens ?? undefined, 'appointment_items'),
      reservasComVariosItens: numero(c?.varios ?? undefined, 'appointments_multi_item'),
      itensSemNomeCongelado: opcional(c?.sem_nome, 'items_without_snapshot'),
      itensComNomeCongelado: opcional(c?.com_nome, 'items_with_snapshot'),
      recebimentos: numero(c?.recebimentos ?? undefined, 'appointment_payments'),
      contasPorPapel: contar(papeis.rows, (r: { chave: string }) => r.chave, 'platform_accounts'),
      proprietariosAtivos: numero(c?.proprietarios ?? undefined, 'active_owners'),
      delegadosAtivos: numero(c?.delegados ?? undefined, 'active_delegated'),
      convitesDePlataformaPendentes: contar(convites.rows, (r: { papel: string }) => r.papel, 'platform_invites'),
      contas: contas.rows.map((r) => ({
        id: r.id,
        papel: r.papel,
        situacao: r.situacao,
        vinculosDeDono: numero(r.dono, 'owner_memberships'),
        criadaEm: r.criada,
      })),
    };
  });
}

/** Linhas fixas `NOME: valor` para a saída dos procedimentos. */
export function descreverImpactoPortalMultisservicos(impacto: ImpactoPortalMultisservicos): string[] {
  const nada = (v: number | null) => (v === null ? 'ainda não existe' : String(v));
  const pares = (r: Record<string, number>) => Object.entries(r).map(([k, v]) => `${k}=${v}`).join(' ') || '-';
  const linhas = [
    `ESTABELECIMENTOS: ${impacto.estabelecimentos}`,
    `POR_SITUACAO: ${pares(impacto.porSituacao)}`,
    `MARCADOS_COMO_ANTERIORES: ${impacto.marcadosComoAnteriores}`,
    `PERIODOS_DE_ACESSO: ${impacto.periodos} (${pares(impacto.periodosPorTipo)}; anulados=${impacto.periodosAnulados})`,
    `PAGOS_SEM_ORIGEM_DO_VALOR: ${nada(impacto.pagosSemOrigem)}`,
    `PAGOS_COM_ORIGEM_DO_VALOR: ${nada(impacto.pagosComOrigem)}`,
    `PRECOS_DO_CATALOGO: ${nada(impacto.precosDoCatalogo)}`,
    `PRECOS_CONTRATADOS: ${nada(impacto.precosContratados)}`,
    `SEM_VENCIMENTO: ${nada(impacto.semVencimento)} (em vigor: ${nada(impacto.semVencimentoEmVigor)})`,
    `RESERVAS: ${impacto.reservas}`,
    `ITENS_DE_RESERVA: ${impacto.itensDeReserva}`,
    `RESERVAS_COM_VARIOS_ITENS: ${impacto.reservasComVariosItens}`,
    `ITENS_SEM_NOME_CONGELADO: ${nada(impacto.itensSemNomeCongelado)}`,
    `ITENS_COM_NOME_CONGELADO: ${nada(impacto.itensComNomeCongelado)}`,
    `RECEBIMENTOS: ${impacto.recebimentos}`,
    `CONTAS_COM_PAPEL_GLOBAL: ${pares(impacto.contasPorPapel)}`,
    `PROPRIETARIOS_ATIVOS: ${impacto.proprietariosAtivos}`,
    `DELEGADOS_ATIVOS_QUE_PERDEM_O_PORTAL: ${impacto.delegadosAtivos}`,
    `CONVITES_DE_PLATAFORMA_PENDENTES: ${pares(impacto.convitesDePlataformaPendentes)}`,
  ];
  for (const c of impacto.contas) {
    linhas.push(`CONTA_COM_PAPEL_GLOBAL: id=${c.id} papel=${c.papel} situacao=${c.situacao} vinculos_de_dono=${c.vinculosDeDono} criada=${c.criadaEm}`);
  }
  const total = Object.values(impacto.contasPorPapel).reduce((a, b) => a + b, 0);
  linhas.push(
    `CONTAS_LISTADAS: ${impacto.contas.length} de ${total}${impacto.contas.length < total ? ` (LISTAGEM_TRUNCADA; limite ${MAXIMO_DE_CONTAS_LISTADAS}, proprietários primeiro; contagens acima completas)` : ''}`,
  );
  if (impacto.contas.length < total) linhas.push(`CONTAS_NAO_LISTADAS: ${total - impacto.contas.length}`);
  linhas.push('CONTAS_NOTA: só leitura; a conferência das identidades é autorizada e feita fora deste procedimento; nenhum papel é alterado aqui');
  linhas.push('PROPRIETARIOS_NOTA: ter MASTER_OWNER ativo não confirma quem são; a conferência das identidades autorizadas continua pendente');
  return linhas;
}

// ------------------------------------------------------------ reversão

/** O que um `migration:revert` de cada migration apagaria (só as que existem). */
export async function lerEfeitoDaReversao(client: PgClientLike): Promise<Record<string, number>> {
  const estado = await lerEstadoPortalMultisservicos(client);
  return somenteLeitura(client, async () => {
    const efeito: Record<string, number> = {};
    const contar = async (chave: string, sql: string) => {
      const [{ n }] = (await client.query<{ n: string }>(sql)).rows;
      efeito[chave] = parseNonNegativeInteger(n, chave);
    };
    if (estado.colunaNomeCongelado !== null) {
      await contar('nomesCongeladosApagados', 'SELECT count(*)::text AS n FROM appointment_items WHERE service_name_snapshot IS NOT NULL');
      await contar(
        'reservasComVariosItensQueFicam',
        'SELECT count(*)::text AS n FROM (SELECT appointment_id FROM appointment_items GROUP BY appointment_id HAVING count(*) > 1) v',
      );
    }
    if (estado.tabelas.plan_prices) await contar('precosDoCatalogoApagados', 'SELECT count(*)::text AS n FROM plan_prices');
    if (estado.tabelas.tenant_contract_prices) {
      await contar('precosContratadosApagados', 'SELECT count(*)::text AS n FROM tenant_contract_prices');
    }
    if (estado.tabelas.tenant_no_expiry_grants) {
      await contar('semVencimentoApagados', 'SELECT count(*)::text AS n FROM tenant_no_expiry_grants');
      await contar('semVencimentoEmVigorApagados', 'SELECT count(*)::text AS n FROM tenant_no_expiry_grants WHERE revoked_at IS NULL');
    }
    if (estado.colunaOrigem !== null) {
      await contar('origensDoValorApagadas', 'SELECT count(*)::text AS n FROM tenant_access_periods WHERE amount_source IS NOT NULL');
    }
    return efeito;
  });
}
