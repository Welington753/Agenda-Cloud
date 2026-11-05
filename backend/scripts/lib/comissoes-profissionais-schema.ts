// Conferência da migration `ProfessionalCommissions1793491200000` no banco do
// piloto, ANTES e DEPOIS de aplicá-la (ver
// docs/runbooks/publicacao-comissoes-profissionais-piloto.md). Dois estados,
// nesta ordem, e nenhum outro:
//
//   before-professional-commissions  as catorze migrations até
//                                    AppointmentServiceSnapshots, com os
//                                    objetos delas (conferência
//                                    `after-appointment-snapshots`,
//                                    reaproveitada), nenhum objeto da nova e o
//                                    catálogo de antes (comissões só no Max);
//   after-professional-commissions   as quinze migrations, cada objeto novo com
//                                    a definição exata e a linha nova do
//                                    catálogo (comissões no Pro e no Max).
//
// Só leitura: `BEGIN TRANSACTION READ ONLY` ... `ROLLBACK`. Lê metadados,
// contagens e identificadores (ids, códigos de plano e de recurso), nunca
// nome de pessoa, e-mail, telefone, senha ou valor. As falhas saem como nomes
// fixos.
//
// Nomes abaixo vêm de src/migrations/1793491200000-ProfessionalCommissions.ts.
// Ficam duplicados de propósito (os scripts compilam com `rootDir:
// ./scripts`); comissoes-profissionais-schema.spec.ts confere que são iguais.
import type { PgClientLike } from './pg-client.js';
import { parseNonNegativeInteger } from './pg-value-parsers.js';
import {
  MIGRATIONS_ATE_NOMES_CONGELADOS,
  falhasDepoisDosNomesCongelados,
  lerEstadoPortalMultisservicos,
} from './portal-multisservicos-schema.js';

export { MIGRATIONS_ATE_NOMES_CONGELADOS };
export const MIGRATION_COMISSOES = 'ProfessionalCommissions1793491200000';
export const MIGRATIONS_ATE_COMISSOES = [...MIGRATIONS_ATE_NOMES_CONGELADOS, MIGRATION_COMISSOES] as const;

/** Valores novos de enum, como `tipo.valor`. */
export const VALORES_COMISSOES = ['audit_action.COMMISSION_RULE_CHANGED', 'permission.COMISSOES_PROPRIAS_VISUALIZAR'] as const;

/** Coluna nova: anulável, sem valor padrão (nenhuma linha antiga ganha item). */
export const COLUNA_ITEM: readonly [string, string] = ['commission_entries', 'appointment_item_id'];
export const COLUNA_ITEM_ESPERADA = 'character varying(30):YES:sem_padrao';

/** Colunas que passam a aceitar NULL (antes, todas NOT NULL). */
export const COLUNAS_QUE_ACEITAM_NULO = [
  'price_cents_snapshot',
  'applied_type',
  'applied_value',
  'professional_cents',
  'establishment_cents',
] as const;

/** Constraints novas, com o tipo (`pg_constraint.contype`). */
export const CONSTRAINTS_COMISSOES: readonly (readonly [string, 'u' | 'f' | 'c'])[] = [
  ['uq_appointment_items_tenant_id', 'u'],
  ['fk_commission_entries_tenant_appointment_item', 'f'],
  ['ck_commission_entries_rule_snapshot', 'c'],
];

/** Definição exata (`pg_indexes.indexdef`) de cada índice, antes e depois.
 * `uq_commission_entries_appointment_id` existe nos dois estados: vira
 * parcial (só linhas antigas, sem item). null: o índice não existe. */
export const INDICES_COMISSOES: Readonly<Record<string, { antes: string | null; depois: string }>> = {
  uq_commission_entries_appointment_id: {
    antes: 'CREATE UNIQUE INDEX uq_commission_entries_appointment_id ON public.commission_entries USING btree (appointment_id)',
    depois:
      'CREATE UNIQUE INDEX uq_commission_entries_appointment_id ON public.commission_entries USING btree (appointment_id) WHERE (appointment_item_id IS NULL)',
  },
  uq_commission_entries_appointment_item_id: {
    antes: null,
    depois:
      'CREATE UNIQUE INDEX uq_commission_entries_appointment_item_id ON public.commission_entries USING btree (appointment_item_id)',
  },
  idx_commission_entries_tenant_id_appointment_id: {
    antes: null,
    depois:
      'CREATE INDEX idx_commission_entries_tenant_id_appointment_id ON public.commission_entries USING btree (tenant_id, appointment_id)',
  },
};

/** A única mudança de dados: uma linha de `plan_features`. */
export const LINHA_DO_CATALOGO = {
  id: 'pf_pc_equipe_comissoes',
  planId: 'plan_equipe',
  planCode: 'equipe',
  featureId: 'feat_comissoes',
} as const;
export const RECURSO_COMISSOES = { id: 'feat_comissoes', key: 'COMISSOES' } as const;

/** Planos com o recurso de comissões, por id, em cada estado. */
export const PLANOS_COM_COMISSOES = {
  antes: ['plan_pro'],
  depois: ['plan_equipe', 'plan_pro'],
} as const;

/**
 * Tabelas do catálogo e das exceções que a migration não pode mudar, além da
 * linha nova: planos (e preços que eles guardam), recursos, catálogo de cada
 * plano, exceções por estabelecimento, preços do catálogo, preços contratados
 * e "sem vencimento". `plan_features` é comparada sem a linha nova.
 */
export const TABELAS_DO_CATALOGO = [
  'plans',
  'features',
  'plan_features',
  'tenant_feature_overrides',
  'plan_prices',
  'tenant_contract_prices',
  'tenant_no_expiry_grants',
] as const;

export interface EstadoComissoes {
  migrationNames: string[];
  /** Falhas da conferência `after-appointment-snapshots` (sem o histórico, conferido aqui). */
  falhasDosNomesCongelados: string[];
  valores: string[];
  /** `tipo(tamanho):anulavel:padrao` da coluna nova, ou null se não existe. */
  colunaItem: string | null;
  /** Colunas da lista que aceitam NULL hoje. */
  colunasAnulaveis: string[];
  /** `nome:tipo`. */
  constraints: string[];
  /** Definição de cada índice da lista que existe. */
  indices: Record<string, string>;
  /** `id:plan_id:feature_id` da linha nova, ou null. */
  linhaDoCatalogo: string | null;
  /** Linhas (com qualquer id) que ligam o Pro ao recurso de comissões. */
  linhasProComComissoes: number;
  /** Ids dos planos que têm o recurso, em ordem. */
  planosComComissoes: string[];
  /** O recurso `feat_comissoes` existe com a chave `COMISSOES`. */
  recursoExiste: boolean;
  /** O plano `plan_equipe` existe com o código `equipe`. */
  planoProExiste: boolean;
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

export async function lerEstadoComissoes(client: PgClientLike): Promise<EstadoComissoes> {
  // A conferência do portal abre e fecha a própria transação só-leitura.
  const anteriores = await lerEstadoPortalMultisservicos(client);
  return somenteLeitura(client, async () => {
    const migrations = await client.query<{ name: string }>('SELECT name FROM typeorm_migrations ORDER BY id');
    const valores = await client.query<{ valor: string }>(
      `SELECT t.typname || '.' || e.enumlabel AS valor FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname || '.' || e.enumlabel = ANY($1)`,
      [[...VALORES_COMISSOES]],
    );
    const colunas = await client.query<{
      coluna: string;
      tipo: string;
      tamanho: string | null;
      anulavel: string;
      padrao: string | null;
    }>(
      `SELECT column_name AS coluna, data_type AS tipo, character_maximum_length::text AS tamanho,
              is_nullable AS anulavel, column_default AS padrao
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1 AND column_name = ANY($2)`,
      [COLUNA_ITEM[0], [COLUNA_ITEM[1], ...COLUNAS_QUE_ACEITAM_NULO]],
    );
    const constraints = await client.query<{ conname: string; contype: string }>(
      `SELECT c.conname, c.contype::text AS contype FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE n.nspname = 'public' AND c.conname = ANY($1)`,
      [CONSTRAINTS_COMISSOES.map(([nome]) => nome)],
    );
    const indices = await client.query<{ indexname: string; indexdef: string }>(
      "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = ANY($1)",
      [Object.keys(INDICES_COMISSOES)],
    );
    const [catalogo] = (
      await client.query<{ linha: string | null; pro: string; recurso: boolean; plano: boolean }>(
        `SELECT
          (SELECT id || ':' || plan_id || ':' || feature_id FROM plan_features WHERE id = $1) AS linha,
          (SELECT count(*) FROM plan_features WHERE plan_id = $2 AND feature_id = $3)::text AS pro,
          EXISTS (SELECT 1 FROM features WHERE id = $3 AND key::text = $4) AS recurso,
          EXISTS (SELECT 1 FROM plans WHERE id = $2 AND code = $5) AS plano`,
        [LINHA_DO_CATALOGO.id, LINHA_DO_CATALOGO.planId, LINHA_DO_CATALOGO.featureId, RECURSO_COMISSOES.key, LINHA_DO_CATALOGO.planCode],
      )
    ).rows;
    const planos = await client.query<{ plan_id: string }>(
      'SELECT DISTINCT plan_id FROM plan_features WHERE feature_id = $1 ORDER BY plan_id',
      [RECURSO_COMISSOES.id],
    );
    const item = colunas.rows.find((c) => c.coluna === COLUNA_ITEM[1]);
    return {
      migrationNames: migrations.rows.map((r) => r.name),
      falhasDosNomesCongelados: falhasDepoisDosNomesCongelados({
        ...anteriores,
        migrationNames: [...MIGRATIONS_ATE_NOMES_CONGELADOS],
      }),
      valores: valores.rows.map((r) => r.valor),
      colunaItem: item ? `${item.tipo}${item.tamanho ? `(${item.tamanho})` : ''}:${item.anulavel}:${item.padrao ?? 'sem_padrao'}` : null,
      colunasAnulaveis: COLUNAS_QUE_ACEITAM_NULO.filter((c) =>
        colunas.rows.some((r) => r.coluna === c && r.anulavel === 'YES'),
      ),
      constraints: constraints.rows.map((r) => `${r.conname}:${r.contype}`),
      indices: Object.fromEntries(indices.rows.map((r) => [r.indexname, r.indexdef])),
      linhaDoCatalogo: catalogo?.linha ?? null,
      linhasProComComissoes: numero(catalogo?.pro, 'pro_commission_rows'),
      planosComComissoes: planos.rows.map((r) => r.plan_id),
      recursoExiste: catalogo?.recurso === true,
      planoProExiste: catalogo?.plano === true,
    };
  });
}

const mesmaLista = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((valor, i) => valor === b[i]);

const linhaEsperada = `${LINHA_DO_CATALOGO.id}:${LINHA_DO_CATALOGO.planId}:${LINHA_DO_CATALOGO.featureId}`;

function falhasComuns(estado: EstadoComissoes): string[] {
  const falhas = estado.falhasDosNomesCongelados.map((f) => `snapshots_${f}`);
  if (!estado.recursoExiste) falhas.push(`feature_row_${RECURSO_COMISSOES.id}`);
  if (!estado.planoProExiste) falhas.push(`plan_row_${LINHA_DO_CATALOGO.planId}`);
  return falhas;
}

export function falhasAntesDeComissoes(estado: EstadoComissoes): string[] {
  const falhas: string[] = [];
  if (!mesmaLista(estado.migrationNames, MIGRATIONS_ATE_NOMES_CONGELADOS)) falhas.push('migration_history');
  falhas.push(...falhasComuns(estado));
  if (estado.valores.length) falhas.push('commission_enum_values_already_exist');
  if (estado.colunaItem !== null) falhas.push('appointment_item_column_already_exists');
  if (estado.colunasAnulaveis.length) falhas.push('commission_columns_already_nullable');
  if (estado.constraints.length) falhas.push('commission_constraints_already_exist');
  for (const [nome, { antes }] of Object.entries(INDICES_COMISSOES)) {
    if ((estado.indices[nome] ?? null) !== antes) falhas.push(antes === null ? `${nome}_already_exists` : `${nome}_definition`);
  }
  if (estado.linhaDoCatalogo !== null || estado.linhasProComComissoes) falhas.push('pro_plan_already_has_commissions');
  if (!mesmaLista(estado.planosComComissoes, PLANOS_COM_COMISSOES.antes)) falhas.push('plans_with_commissions_unexpected');
  return falhas;
}

export function falhasDepoisDeComissoes(estado: EstadoComissoes): string[] {
  const falhas: string[] = [];
  if (!mesmaLista(estado.migrationNames, MIGRATIONS_ATE_COMISSOES)) falhas.push('migration_history');
  falhas.push(...falhasComuns(estado));
  for (const valor of VALORES_COMISSOES) if (!estado.valores.includes(valor)) falhas.push(`enum_${valor}`);
  if (estado.colunaItem === null) falhas.push(`column_${COLUNA_ITEM.join('_')}`);
  else if (estado.colunaItem !== COLUNA_ITEM_ESPERADA) falhas.push(`column_${COLUNA_ITEM.join('_')}_definition`);
  for (const coluna of COLUNAS_QUE_ACEITAM_NULO) {
    if (!estado.colunasAnulaveis.includes(coluna)) falhas.push(`column_${coluna}_not_nullable`);
  }
  for (const [nome, tipo] of CONSTRAINTS_COMISSOES) if (!estado.constraints.includes(`${nome}:${tipo}`)) falhas.push(nome);
  for (const [nome, { depois }] of Object.entries(INDICES_COMISSOES)) {
    const lido = estado.indices[nome];
    if (lido === undefined) falhas.push(nome);
    else if (lido !== depois) falhas.push(`${nome}_definition`);
  }
  if (estado.linhaDoCatalogo !== linhaEsperada) falhas.push(`catalog_${LINHA_DO_CATALOGO.id}`);
  if (estado.linhasProComComissoes !== 1) falhas.push('pro_plan_commission_rows');
  if (!mesmaLista(estado.planosComComissoes, PLANOS_COM_COMISSOES.depois)) falhas.push('plans_with_commissions_unexpected');
  return falhas;
}

/** Valores de enum, coluna nova, colunas que aceitam NULL, constraints,
 * índices (o parcial conta como mudança) e a linha do catálogo. */
export const TOTAL_OBJETOS_COMISSOES =
  VALORES_COMISSOES.length +
  1 +
  COLUNAS_QUE_ACEITAM_NULO.length +
  CONSTRAINTS_COMISSOES.length +
  Object.keys(INDICES_COMISSOES).length +
  1;

export function objetosComissoesPresentes(estado: EstadoComissoes): number {
  return (
    estado.valores.length +
    (estado.colunaItem !== null ? 1 : 0) +
    estado.colunasAnulaveis.length +
    CONSTRAINTS_COMISSOES.filter(([n, t]) => estado.constraints.includes(`${n}:${t}`)).length +
    Object.entries(INDICES_COMISSOES).filter(([n, { depois }]) => estado.indices[n] === depois).length +
    (estado.linhaDoCatalogo === linhaEsperada ? 1 : 0)
  );
}

// ------------------------------------------------------------ catálogo

/**
 * md5 de cada tabela de `TABELAS_DO_CATALOGO`, no MESMO formato de
 * `fotografar` (operacao-piloto.mjs), com `plan_features` sem a linha nova.
 * No estado antes a linha não existe, então o resultado é igual à soma da
 * fotografia do backup; no depois, precisa continuar igual a ela.
 */
export async function lerSomasDoCatalogo(client: PgClientLike): Promise<Record<string, string>> {
  return somenteLeitura(client, async () => {
    await client.query("SET LOCAL TimeZone = 'UTC'");
    await client.query("SET LOCAL DateStyle = 'ISO, YMD'");
    await client.query("SET LOCAL IntervalStyle = 'postgres'");
    await client.query('SET LOCAL extra_float_digits = 1');
    const somas: Record<string, string> = {};
    for (const tabela of TABELAS_DO_CATALOGO) {
      const filtro = tabela === 'plan_features' ? 'WHERE x.id <> $1' : 'WHERE $1::text IS NOT NULL';
      const [linha] = (
        await client.query<{ soma: string }>(
          `SELECT coalesce(md5(string_agg(x::text, E'\\n' ORDER BY x::text COLLATE "C")), '') AS soma FROM public.${tabela} x ${filtro}`,
          [LINHA_DO_CATALOGO.id],
        )
      ).rows;
      somas[tabela] = linha?.soma ?? '';
    }
    return somas;
  });
}

/** Tabelas do catálogo cuja soma difere da referência (lista vazia: preservado). */
export function catalogoAlterado(referencia: Readonly<Record<string, string>>, atual: Readonly<Record<string, string>>): string[] {
  return TABELAS_DO_CATALOGO.filter((t) => referencia[t] === undefined || referencia[t] !== atual[t]);
}

// ------------------------------------------------------------ levantamento

export interface PlanoNoLevantamento {
  planoId: string;
  codigo: string;
  estabelecimentos: number;
  /** Com o recurso de comissões efetivo hoje (exceção primeiro, senão o plano). */
  comComissoesAgora: number;
  /** Com o recurso depois da migration (o catálogo novo somado). */
  comComissoesDepois: number;
}

export interface ImpactoComissoes {
  estabelecimentos: number;
  porPlano: PlanoNoLevantamento[];
  /** Estabelecimentos que passam a apurar comissões na conclusão com a API
   * nova (sem o recurso antes da migration, com ele depois). */
  passamAApurar: number;
  /** Exceções do recurso de comissões, ligadas e desligadas (continuam valendo
   * sobre o plano). */
  excecoesLigadas: number;
  excecoesDesligadas: number;
  regras: number;
  apuracoes: number;
  /** null antes da coluna existir. */
  apuracoesPorItem: number | null;
  apuracoesSemItem: number;
  concessoesDasProprias: number;
  atendimentosConcluidos: number;
  itensDeReserva: number;
}

/**
 * Levantamento SÓ DE LEITURA. Funciona nos dois estados: a coluna nova só é
 * lida quando existe. A regra do recurso é a de commercial/commercial-gate.ts
 * (`FEATURE_ENABLED_SQL`: exceção individual primeiro, senão o catálogo do
 * plano). Mesma lógica de
 * docs/runbooks/consultas/impacto-comissoes-profissionais-somente-leitura.sql.
 */
export async function lerImpactoComissoes(client: PgClientLike): Promise<ImpactoComissoes> {
  return somenteLeitura(client, async () => {
    const [{ coluna }] = (
      await client.query<{ coluna: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                          AND table_name = $1 AND column_name = $2) AS coluna`,
        [...COLUNA_ITEM],
      )
    ).rows;
    const planos = await client.query<{ id: string; code: string; n: string; agora: string; depois: string }>(
      `WITH efetivo AS (
         SELECT t.id, t.plan_id,
                (SELECT o.enabled FROM tenant_feature_overrides o WHERE o.tenant_id = t.id AND o.feature_id = $1) AS excecao,
                EXISTS (SELECT 1 FROM plan_features pf WHERE pf.plan_id = t.plan_id AND pf.feature_id = $1) AS no_plano
           FROM tenants t
       )
       SELECT p.id, p.code,
              count(e.id)::text AS n,
              count(e.id) FILTER (WHERE coalesce(e.excecao, e.no_plano))::text AS agora,
              count(e.id) FILTER (WHERE coalesce(e.excecao, e.no_plano OR p.id = $2))::text AS depois
         FROM plans p LEFT JOIN efetivo e ON e.plan_id = p.id
        GROUP BY p.id, p.code ORDER BY p.id`,
      [RECURSO_COMISSOES.id, LINHA_DO_CATALOGO.planId],
    );
    const [c] = (
      await client.query<Record<string, string | null>>(
        `SELECT
          (SELECT count(*) FROM tenants)::text AS estabelecimentos,
          (SELECT count(*) FROM tenant_feature_overrides WHERE feature_id = $1 AND enabled)::text AS ligadas,
          (SELECT count(*) FROM tenant_feature_overrides WHERE feature_id = $1 AND NOT enabled)::text AS desligadas,
          (SELECT count(*) FROM commission_rules)::text AS regras,
          (SELECT count(*) FROM commission_entries)::text AS apuracoes,
          ${coluna ? '(SELECT count(*) FROM commission_entries WHERE appointment_item_id IS NOT NULL)::text' : 'NULL'} AS por_item,
          ${coluna ? '(SELECT count(*) FROM commission_entries WHERE appointment_item_id IS NULL)::text' : '(SELECT count(*) FROM commission_entries)::text'} AS sem_item,
          (SELECT count(*) FROM membership_permission_overrides WHERE permission::text = $2)::text AS concessoes,
          (SELECT count(*) FROM appointments WHERE status = 'COMPLETED')::text AS concluidos,
          (SELECT count(*) FROM appointment_items)::text AS itens`,
        [RECURSO_COMISSOES.id, 'COMISSOES_PROPRIAS_VISUALIZAR'],
      )
    ).rows;
    const porPlano = planos.rows.map((r) => ({
      planoId: r.id,
      codigo: r.code,
      estabelecimentos: numero(r.n, 'tenants_by_plan'),
      comComissoesAgora: numero(r.agora, 'tenants_with_commissions'),
      comComissoesDepois: numero(r.depois, 'tenants_with_commissions_after'),
    }));
    const opcional = (v: string | null | undefined, campo: string) => (v === null || v === undefined ? null : numero(v, campo));
    return {
      estabelecimentos: numero(c?.estabelecimentos ?? undefined, 'tenants'),
      porPlano,
      passamAApurar: porPlano.reduce((soma, p) => soma + (p.comComissoesDepois - p.comComissoesAgora), 0),
      excecoesLigadas: numero(c?.ligadas ?? undefined, 'commission_overrides_enabled'),
      excecoesDesligadas: numero(c?.desligadas ?? undefined, 'commission_overrides_disabled'),
      regras: numero(c?.regras ?? undefined, 'commission_rules'),
      apuracoes: numero(c?.apuracoes ?? undefined, 'commission_entries'),
      apuracoesPorItem: opcional(c?.por_item, 'commission_entries_by_item'),
      apuracoesSemItem: numero(c?.sem_item ?? undefined, 'commission_entries_without_item'),
      concessoesDasProprias: numero(c?.concessoes ?? undefined, 'own_commissions_grants'),
      atendimentosConcluidos: numero(c?.concluidos ?? undefined, 'appointments_completed'),
      itensDeReserva: numero(c?.itens ?? undefined, 'appointment_items'),
    };
  });
}

/** Linhas fixas `NOME: valor` para a saída dos procedimentos. */
export function descreverImpactoComissoes(impacto: ImpactoComissoes): string[] {
  const nada = (v: number | null) => (v === null ? 'ainda não existe' : String(v));
  return [
    `ESTABELECIMENTOS: ${impacto.estabelecimentos}`,
    ...impacto.porPlano.map(
      (p) =>
        `PLANO: id=${p.planoId} codigo=${p.codigo} estabelecimentos=${p.estabelecimentos} com_comissoes_agora=${p.comComissoesAgora} com_comissoes_depois=${p.comComissoesDepois}`,
    ),
    `PASSAM_A_APURAR_COMISSOES: ${impacto.passamAApurar}`,
    `EXCECOES_DE_COMISSOES: ligadas=${impacto.excecoesLigadas} desligadas=${impacto.excecoesDesligadas}`,
    `REGRAS_DE_COMISSAO: ${impacto.regras}`,
    `APURACOES: ${impacto.apuracoes}`,
    `APURACOES_POR_ITEM: ${nada(impacto.apuracoesPorItem)}`,
    `APURACOES_SEM_ITEM: ${impacto.apuracoesSemItem}`,
    `CONCESSOES_DAS_PROPRIAS_COMISSOES: ${impacto.concessoesDasProprias}`,
    `ATENDIMENTOS_CONCLUIDOS: ${impacto.atendimentosConcluidos}`,
    `ITENS_DE_RESERVA: ${impacto.itensDeReserva}`,
    'COMISSOES_NOTA: com a API nova, cada conclusão num estabelecimento com o recurso grava comissão; nada é apurado para atendimentos já concluídos',
  ];
}

// ------------------------------------------------------------ reversão

/** No estado depois: o que um `migration:revert` faria. Com apuração por
 * item, o `down` recusa; forçá-lo apagaria histórico. */
export async function lerEfeitoDaReversao(client: PgClientLike): Promise<Record<string, number>> {
  return somenteLeitura(client, async () => {
    const [r] = (
      await client.query<Record<string, string>>(
        `SELECT
          (SELECT count(*) FROM commission_entries
            WHERE appointment_item_id IS NOT NULL OR price_cents_snapshot IS NULL OR applied_type IS NULL
               OR professional_cents IS NULL OR establishment_cents IS NULL)::text AS "apuracoesQueBloqueiamODown",
          (SELECT count(*) FROM commission_entries WHERE appointment_item_id IS NOT NULL)::text AS "apuracoesPorItem",
          (SELECT count(*) FROM commission_rules)::text AS "regrasQueFicam",
          (SELECT count(*) FROM plan_features WHERE id = $1)::text AS "linhasDoCatalogoApagadas",
          (SELECT count(*) FROM membership_permission_overrides WHERE permission::text = $2)::text AS "concessoesQueFicamSemEfeito",
          (SELECT count(*) FROM audit_logs WHERE action::text = $3)::text AS "registrosDeAuditoriaQueFicam"`,
        [LINHA_DO_CATALOGO.id, 'COMISSOES_PROPRIAS_VISUALIZAR', 'COMMISSION_RULE_CHANGED'],
      )
    ).rows;
    return Object.fromEntries(Object.entries(r ?? {}).map(([k, v]) => [k, parseNonNegativeInteger(v, k)]));
  });
}
