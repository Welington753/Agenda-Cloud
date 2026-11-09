// Conferência da migration `ProfessionalCommissionSettings1793577600000`
// ("Recebe comissão" e regra geral por profissional) no banco do piloto (ver
// docs/runbooks/publicacao-regra-geral-comissoes-piloto.md). Dois estados, e
// nenhum outro:
//
//   before-commission-settings  o baseline 15 válido: as quinze migrations até
//                               ProfessionalCommissions, na ordem, com a
//                               conferência `after-professional-commissions`
//                               inteira (reaproveitada) e nenhum objeto da 16;
//   after-commission-settings   as dezesseis migrations, os objetos do baseline
//                               15 (a mesma conferência, sem exigir o histórico
//                               de exatamente quinze) e cada objeto da 16 com a
//                               definição exata.
//
// O estado "depois" é PERMANENTE: vale para um banco em uso. Configurações
// gravadas e apurações com escopo são uso normal da API nova e nunca o
// invalidam. Tabela de configurações vazia e escopos NULL são invariantes da
// TRANSIÇÃO, conferidos só logo depois de aplicar (`falhasDaTransicao`).
//
// Só leitura: `BEGIN TRANSACTION READ ONLY` ... `ROLLBACK`. Lê metadados,
// contagens e identificadores, nunca nome de pessoa, e-mail, telefone, senha
// ou valor. As falhas saem como nomes fixos.
//
// Nomes e definições vêm de
// src/migrations/1793577600000-ProfessionalCommissionSettings.ts. Ficam
// duplicados de propósito (os scripts compilam com `rootDir: ./scripts`);
// regra-geral-comissoes-schema.spec.ts confere que batem com o texto da
// migration, e o db-e2e, com o banco.
import type { PgClientLike } from './pg-client.js';
import { parseNonNegativeInteger } from './pg-value-parsers.js';
import {
  MIGRATIONS_ATE_COMISSOES,
  falhasDepoisDeComissoes,
  lerEstadoComissoes,
  type EstadoComissoes,
} from './comissoes-profissionais-schema.js';

export { MIGRATIONS_ATE_COMISSOES };
export const MIGRATION_REGRA_GERAL = 'ProfessionalCommissionSettings1793577600000';
export const MIGRATIONS_ATE_REGRA_GERAL = [...MIGRATIONS_ATE_COMISSOES, MIGRATION_REGRA_GERAL] as const;

export const TABELA_CONFIGURACOES = 'professional_commission_settings';

/** Colunas da tabela nova, na ordem: `nome:tipo:notnull:padrao`
 * (`format_type` e `pg_get_expr`, como o Postgres os imprime). */
export const COLUNAS_DA_TABELA = [
  'tenant_id:character varying(30):t:sem_padrao',
  'professional_id:character varying(30):t:sem_padrao',
  'receives_commission:boolean:t:sem_padrao',
  'default_type:commission_type:f:sem_padrao',
  'default_value:integer:f:sem_padrao',
  'created_at:timestamp(3) with time zone:t:now()',
  'updated_at:timestamp(3) with time zone:t:now()',
] as const;

/** Coluna nova em `commission_entries`: anulável, sem padrão (nenhuma linha
 * antiga ganha escopo). */
export const COLUNA_ESCOPO: readonly [string, string] = ['commission_entries', 'applied_rule_scope'];
export const COLUNA_ESCOPO_ESPERADA = 'character varying(10):f:sem_padrao';

/** Constraints novas com a definição exata (`pg_get_constraintdef`), não só o
 * nome e o tipo. */
export const CONSTRAINTS_REGRA_GERAL: Readonly<Record<string, { tipo: 'p' | 'f' | 'c'; definicao: string }>> = {
  pk_professional_commission_settings: { tipo: 'p', definicao: 'PRIMARY KEY (tenant_id, professional_id)' },
  fk_professional_commission_settings_tenant_professional: {
    tipo: 'f',
    definicao: 'FOREIGN KEY (tenant_id, professional_id) REFERENCES professionals(tenant_id, id) ON DELETE CASCADE',
  },
  ck_professional_commission_settings_default_pair: {
    tipo: 'c',
    definicao: 'CHECK (((default_type IS NULL) = (default_value IS NULL)))',
  },
  ck_professional_commission_settings_default_range: {
    tipo: 'c',
    definicao:
      "CHECK (((default_type IS NULL) OR ((default_type = 'PERCENTAGE'::commission_type) AND ((default_value >= 1) AND (default_value <= 10000))) OR ((default_type = 'FIXED'::commission_type) AND ((default_value >= 1) AND (default_value <= 100000000)))))",
  },
  ck_commission_entries_applied_rule_scope: {
    tipo: 'c',
    definicao:
      "CHECK (((applied_rule_scope IS NULL) OR (((applied_rule_scope)::text = ANY ((ARRAY['SERVICE'::character varying, 'DEFAULT'::character varying])::text[])) AND (applied_type IS NOT NULL))))",
  },
};

/** Índices da tabela nova: só o da chave primária. */
export const INDICES_DA_TABELA = ['pk_professional_commission_settings'] as const;

export interface EstadoRegraGeral {
  migrationNames: string[];
  /** A leitura do baseline 15 (comissoes-profissionais-schema.ts). */
  comissoes: EstadoComissoes;
  tabelaExiste: boolean;
  /** `nome:tipo:notnull:padrao` das colunas da tabela nova, na ordem. */
  colunasDaTabela: string[];
  /** `tipo:notnull:padrao` da coluna nova, ou null se não existe. */
  colunaEscopo: string | null;
  /** Definição de cada constraint da lista que existe (`tipo|definicao`). */
  constraints: Record<string, string>;
  /** Nomes dos índices da tabela nova, em ordem. */
  indicesDaTabela: string[];
  /** Gatilhos de usuário na tabela nova (nenhum esperado). */
  gatilhosDaTabela: number;
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

export async function lerEstadoRegraGeral(client: PgClientLike): Promise<EstadoRegraGeral> {
  // A conferência da 15 abre e fecha as próprias transações só-leitura.
  const comissoes = await lerEstadoComissoes(client);
  return somenteLeitura(client, async () => {
    const migrations = await client.query<{ name: string }>('SELECT name FROM typeorm_migrations ORDER BY id');
    const [{ existe }] = (
      await client.query<{ existe: boolean }>(`SELECT to_regclass($1) IS NOT NULL AS existe`, [`public.${TABELA_CONFIGURACOES}`])
    ).rows;
    const colunas = existe
      ? await client.query<{ linha: string }>(
          `SELECT a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || CASE WHEN a.attnotnull THEN 't' ELSE 'f' END
                  || ':' || coalesce(pg_get_expr(d.adbin, d.adrelid), 'sem_padrao') AS linha
             FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
            WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped
            ORDER BY a.attnum`,
          [`public.${TABELA_CONFIGURACOES}`],
        )
      : { rows: [] };
    const escopo = await client.query<{ linha: string }>(
      `SELECT format_type(a.atttypid, a.atttypmod) || ':' || CASE WHEN a.attnotnull THEN 't' ELSE 'f' END
              || ':' || coalesce(pg_get_expr(d.adbin, d.adrelid), 'sem_padrao') AS linha
         FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE a.attrelid = $1::regclass AND a.attname = $2 AND NOT a.attisdropped`,
      [`public.${COLUNA_ESCOPO[0]}`, COLUNA_ESCOPO[1]],
    );
    const constraints = await client.query<{ conname: string; contype: string; definicao: string }>(
      `SELECT c.conname, c.contype::text AS contype, pg_get_constraintdef(c.oid) AS definicao
         FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE n.nspname = 'public' AND c.conname = ANY($1)`,
      [Object.keys(CONSTRAINTS_REGRA_GERAL)],
    );
    const indices = existe
      ? await client.query<{ indexname: string }>(
          `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = $1 ORDER BY indexname`,
          [TABELA_CONFIGURACOES],
        )
      : { rows: [] };
    const gatilhos = existe
      ? await client.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM pg_trigger WHERE tgrelid = $1::regclass AND NOT tgisinternal`,
          [`public.${TABELA_CONFIGURACOES}`],
        )
      : { rows: [{ n: '0' }] };
    return {
      migrationNames: migrations.rows.map((r) => r.name),
      comissoes,
      tabelaExiste: existe === true,
      colunasDaTabela: colunas.rows.map((r) => r.linha),
      colunaEscopo: escopo.rows[0]?.linha ?? null,
      constraints: Object.fromEntries(constraints.rows.map((r) => [r.conname, `${r.contype}|${r.definicao}`])),
      indicesDaTabela: indices.rows.map((r) => r.indexname),
      gatilhosDaTabela: numero(gatilhos.rows[0]?.n, 'settings_triggers'),
    };
  });
}

const mesmaLista = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((valor, i) => valor === b[i]);

/** O baseline 15 (`after-professional-commissions`, a mesma função do kit
 * da 15), com o histórico recortado nas quinze: o histórico completo é
 * conferido à parte por quem chama. */
function falhasDoBaseline15(estado: EstadoRegraGeral): string[] {
  const recortado = { ...estado.comissoes, migrationNames: estado.comissoes.migrationNames.slice(0, MIGRATIONS_ATE_COMISSOES.length) };
  return falhasDepoisDeComissoes(recortado).map((f) => `baseline15_${f}`);
}

export function falhasAntesDaRegraGeral(estado: EstadoRegraGeral): string[] {
  const falhas: string[] = [];
  if (!mesmaLista(estado.migrationNames, MIGRATIONS_ATE_COMISSOES)) falhas.push('migration_history');
  falhas.push(...falhasDoBaseline15(estado));
  if (estado.tabelaExiste) falhas.push('settings_table_already_exists');
  if (estado.colunaEscopo !== null) falhas.push('rule_scope_column_already_exists');
  if (Object.keys(estado.constraints).length) falhas.push('settings_constraints_already_exist');
  return falhas;
}

export function falhasDepoisDaRegraGeral(estado: EstadoRegraGeral): string[] {
  const falhas: string[] = [];
  if (!mesmaLista(estado.migrationNames, MIGRATIONS_ATE_REGRA_GERAL)) falhas.push('migration_history');
  falhas.push(...falhasDoBaseline15(estado));
  if (!estado.tabelaExiste) falhas.push(`table_${TABELA_CONFIGURACOES}`);
  else {
    if (!mesmaLista(estado.colunasDaTabela, COLUNAS_DA_TABELA)) falhas.push(`table_${TABELA_CONFIGURACOES}_columns`);
    if (!mesmaLista(estado.indicesDaTabela, INDICES_DA_TABELA)) falhas.push(`table_${TABELA_CONFIGURACOES}_indexes`);
    if (estado.gatilhosDaTabela !== 0) falhas.push(`table_${TABELA_CONFIGURACOES}_triggers`);
  }
  if (estado.colunaEscopo === null) falhas.push(`column_${COLUNA_ESCOPO.join('_')}`);
  else if (estado.colunaEscopo !== COLUNA_ESCOPO_ESPERADA) falhas.push(`column_${COLUNA_ESCOPO.join('_')}_definition`);
  for (const [nome, { tipo, definicao }] of Object.entries(CONSTRAINTS_REGRA_GERAL)) {
    const lida = estado.constraints[nome];
    if (lida === undefined) falhas.push(nome);
    else if (lida !== `${tipo}|${definicao}`) falhas.push(`${nome}_definition`);
  }
  return falhas;
}

/** Tabela, coluna nova e constraints. */
export const TOTAL_OBJETOS_REGRA_GERAL = 1 + 1 + Object.keys(CONSTRAINTS_REGRA_GERAL).length;

export function objetosRegraGeralPresentes(estado: EstadoRegraGeral): number {
  return (
    (estado.tabelaExiste && mesmaLista(estado.colunasDaTabela, COLUNAS_DA_TABELA) ? 1 : 0) +
    (estado.colunaEscopo === COLUNA_ESCOPO_ESPERADA ? 1 : 0) +
    Object.entries(CONSTRAINTS_REGRA_GERAL).filter(([n, { tipo, definicao }]) => estado.constraints[n] === `${tipo}|${definicao}`).length
  );
}

// ------------------------------------------------------------ transição

export interface InvariantesDaTransicao {
  configuracoes: number;
  apuracoesComEscopo: number;
}

/** Só no estado "depois": o que a API nova já gravou. */
export async function lerInvariantesDaTransicao(client: PgClientLike): Promise<InvariantesDaTransicao> {
  return somenteLeitura(client, async () => {
    const [r] = (
      await client.query<{ configuracoes: string; escopo: string }>(
        `SELECT (SELECT count(*) FROM ${TABELA_CONFIGURACOES})::text AS configuracoes,
                (SELECT count(*) FROM commission_entries WHERE applied_rule_scope IS NOT NULL)::text AS escopo`,
      )
    ).rows;
    return {
      configuracoes: numero(r?.configuracoes, 'settings_rows'),
      apuracoesComEscopo: numero(r?.escopo, 'scoped_entries'),
    };
  });
}

/** Logo depois de aplicar (antes da API nova): nada gravado nas estruturas
 * novas. Num banco em uso pela API nova, NÃO é falha. */
export function falhasDaTransicao(invariantes: InvariantesDaTransicao): string[] {
  const falhas: string[] = [];
  if (invariantes.configuracoes !== 0) falhas.push('settings_rows_right_after_migration');
  if (invariantes.apuracoesComEscopo !== 0) falhas.push('scoped_entries_right_after_migration');
  return falhas;
}

// ------------------------------------------------------------ janela de transição

export interface UsoDesdeAJanela {
  /** Profissionais criados desde o início da janela. */
  profissionaisCriados: number;
  /** ... sem linha de configuração: criados pela API anterior (recebem, pelo
   * comportamento antigo). */
  profissionaisSemConfiguracao: number;
  /** ... com a linha desligada: criados pela API nova (nascem sem receber). */
  profissionaisDesligados: number;
  /** Apurações calculadas desde o início da janela. */
  apuracoes: number;
  /** ... com regra e sem escopo: calculadas pela API anterior (a nova sempre
   * grava o escopo quando aplica regra). */
  apuracoesDaApiAnterior: number;
}

/** Só no estado "depois". `desde`: instante do banco (`clock_timestamp()`)
 * lido pela fase `aplicar` logo antes da frase. */
export async function lerUsoDesdeAJanela(client: PgClientLike, desde: string): Promise<UsoDesdeAJanela> {
  return somenteLeitura(client, async () => {
    const [r] = (
      await client.query<Record<string, string>>(
        `SELECT
          (SELECT count(*) FROM professionals p WHERE p.created_at >= $1::timestamptz)::text AS criados,
          (SELECT count(*) FROM professionals p
            WHERE p.created_at >= $1::timestamptz
              AND NOT EXISTS (SELECT 1 FROM ${TABELA_CONFIGURACOES} s WHERE s.tenant_id = p.tenant_id AND s.professional_id = p.id))::text AS sem,
          (SELECT count(*) FROM professionals p JOIN ${TABELA_CONFIGURACOES} s ON s.tenant_id = p.tenant_id AND s.professional_id = p.id
            WHERE p.created_at >= $1::timestamptz AND NOT s.receives_commission)::text AS desligados,
          (SELECT count(*) FROM commission_entries WHERE calculated_at >= $1::timestamptz)::text AS apuracoes,
          (SELECT count(*) FROM commission_entries
            WHERE calculated_at >= $1::timestamptz AND applied_type IS NOT NULL AND applied_rule_scope IS NULL)::text AS anterior`,
        [desde],
      )
    ).rows;
    return {
      profissionaisCriados: numero(r?.criados, 'professionals_since'),
      profissionaisSemConfiguracao: numero(r?.sem, 'professionals_without_settings_since'),
      profissionaisDesligados: numero(r?.desligados, 'professionals_off_since'),
      apuracoes: numero(r?.apuracoes, 'entries_since'),
      apuracoesDaApiAnterior: numero(r?.anterior, 'entries_by_previous_api_since'),
    };
  });
}

/** A janela foi respeitada: nada criado nem apurado pela API anterior desde
 * o início dela. */
export function janelaViolada(uso: UsoDesdeAJanela): boolean {
  return uso.profissionaisSemConfiguracao > 0 || uso.apuracoesDaApiAnterior > 0;
}

export function descreverJanela(uso: UsoDesdeAJanela): string[] {
  return [
    `JANELA_PROFISSIONAIS_CRIADOS: ${uso.profissionaisCriados} (sem_configuracao=${uso.profissionaisSemConfiguracao} desligados=${uso.profissionaisDesligados})`,
    `JANELA_APURACOES: ${uso.apuracoes} (da_api_anterior=${uso.apuracoesDaApiAnterior})`,
    janelaViolada(uso)
      ? `JANELA_DE_TRANSICAO: VIOLADA (${uso.profissionaisSemConfiguracao} profissional(is) criado(s) e ${uso.apuracoesDaApiAnterior} apuração(ões) calculada(s) pela API anterior desde o início da janela)`
      : 'JANELA_DE_TRANSICAO: ok (nada criado nem apurado pela API anterior desde o início da janela)',
  ];
}

// ------------------------------------------------------------ levantamento

export interface ImpactoRegraGeral {
  estabelecimentos: number;
  /** Com o recurso COMISSOES efetivo (exceção individual primeiro, senão o plano). */
  estabelecimentosComComissoes: number;
  profissionais: number;
  profissionaisAtivos: number;
  /** null antes da tabela existir. */
  profissionaisComConfiguracao: number | null;
  profissionaisDesligados: number | null;
  profissionaisComRegraGeral: number | null;
  regras: number;
  apuracoes: number;
  /** null antes da coluna existir. */
  apuracoesComEscopo: number | null;
  atendimentosConcluidos: number;
}

/**
 * Levantamento SÓ DE LEITURA, nos dois estados: o que é novo só é lido quando
 * existe. Mesma lógica de
 * docs/runbooks/consultas/impacto-regra-geral-comissoes-somente-leitura.sql
 * na parte que funciona nos dois estados.
 */
export async function lerImpactoRegraGeral(client: PgClientLike): Promise<ImpactoRegraGeral> {
  return somenteLeitura(client, async () => {
    const [{ tabela, coluna }] = (
      await client.query<{ tabela: boolean; coluna: boolean }>(
        `SELECT to_regclass($1) IS NOT NULL AS tabela,
                EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                         AND table_name = $2 AND column_name = $3) AS coluna`,
        [`public.${TABELA_CONFIGURACOES}`, ...COLUNA_ESCOPO],
      )
    ).rows;
    const [c] = (
      await client.query<Record<string, string | null>>(
        `SELECT
          (SELECT count(*) FROM tenants)::text AS estabelecimentos,
          (SELECT count(*) FROM tenants t
            WHERE coalesce((SELECT o.enabled FROM tenant_feature_overrides o WHERE o.tenant_id = t.id AND o.feature_id = 'feat_comissoes'),
                           EXISTS (SELECT 1 FROM plan_features pf WHERE pf.plan_id = t.plan_id AND pf.feature_id = 'feat_comissoes')))::text AS com_comissoes,
          (SELECT count(*) FROM professionals)::text AS profissionais,
          (SELECT count(*) FROM professionals WHERE active)::text AS ativos,
          ${tabela ? `(SELECT count(*) FROM ${TABELA_CONFIGURACOES})::text` : 'NULL'} AS com_configuracao,
          ${tabela ? `(SELECT count(*) FROM ${TABELA_CONFIGURACOES} WHERE NOT receives_commission)::text` : 'NULL'} AS desligados,
          ${tabela ? `(SELECT count(*) FROM ${TABELA_CONFIGURACOES} WHERE default_type IS NOT NULL)::text` : 'NULL'} AS com_regra_geral,
          (SELECT count(*) FROM commission_rules)::text AS regras,
          (SELECT count(*) FROM commission_entries)::text AS apuracoes,
          ${coluna ? '(SELECT count(*) FROM commission_entries WHERE applied_rule_scope IS NOT NULL)::text' : 'NULL'} AS com_escopo,
          (SELECT count(*) FROM appointments WHERE status = 'COMPLETED')::text AS concluidos`,
      )
    ).rows;
    const opcional = (v: string | null | undefined, campo: string) => (v === null || v === undefined ? null : numero(v, campo));
    return {
      estabelecimentos: numero(c?.estabelecimentos ?? undefined, 'tenants'),
      estabelecimentosComComissoes: numero(c?.com_comissoes ?? undefined, 'tenants_with_commissions'),
      profissionais: numero(c?.profissionais ?? undefined, 'professionals'),
      profissionaisAtivos: numero(c?.ativos ?? undefined, 'professionals_active'),
      profissionaisComConfiguracao: opcional(c?.com_configuracao, 'settings_rows'),
      profissionaisDesligados: opcional(c?.desligados, 'settings_off'),
      profissionaisComRegraGeral: opcional(c?.com_regra_geral, 'settings_with_default'),
      regras: numero(c?.regras ?? undefined, 'commission_rules'),
      apuracoes: numero(c?.apuracoes ?? undefined, 'commission_entries'),
      apuracoesComEscopo: opcional(c?.com_escopo, 'scoped_entries'),
      atendimentosConcluidos: numero(c?.concluidos ?? undefined, 'appointments_completed'),
    };
  });
}

/** Linhas fixas `NOME: valor` para a saída dos procedimentos. */
export function descreverImpactoRegraGeral(impacto: ImpactoRegraGeral): string[] {
  const nada = (v: number | null) => (v === null ? 'ainda não existe' : String(v));
  return [
    `ESTABELECIMENTOS: ${impacto.estabelecimentos} (com_comissoes=${impacto.estabelecimentosComComissoes})`,
    `PROFISSIONAIS: ${impacto.profissionais} (ativos=${impacto.profissionaisAtivos})`,
    `PROFISSIONAIS_COM_CONFIGURACAO: ${nada(impacto.profissionaisComConfiguracao)} (desligados=${nada(impacto.profissionaisDesligados)} com_regra_geral=${nada(impacto.profissionaisComRegraGeral)})`,
    `REGRAS_DE_COMISSAO: ${impacto.regras}`,
    `APURACOES: ${impacto.apuracoes} (com_escopo=${nada(impacto.apuracoesComEscopo)})`,
    `ATENDIMENTOS_CONCLUIDOS: ${impacto.atendimentosConcluidos}`,
    'REGRA_GERAL_NOTA: nenhum profissional existente muda (sem configuração = recebe, sem regra geral); só os criados pela API nova nascem sem receber',
  ];
}

// ------------------------------------------------------------ reversão

/** No estado depois: o que um `migration:revert` faria. Com configuração ou
 * apuração com escopo, o `down` recusa; forçá-lo apagaria histórico. */
export async function lerEfeitoDaReversao(client: PgClientLike): Promise<Record<string, number>> {
  return somenteLeitura(client, async () => {
    const [r] = (
      await client.query<Record<string, string>>(
        `SELECT
          (SELECT count(*) FROM ${TABELA_CONFIGURACOES})::text AS "configuracoesQueBloqueiamODown",
          (SELECT count(*) FROM commission_entries WHERE applied_rule_scope IS NOT NULL)::text AS "apuracoesComEscopoQueBloqueiamODown",
          (SELECT count(*) FROM professionals p
            WHERE NOT EXISTS (SELECT 1 FROM ${TABELA_CONFIGURACOES} s WHERE s.tenant_id = p.tenant_id AND s.professional_id = p.id))::text AS "profissionaisSemConfiguracao"`,
      )
    ).rows;
    return Object.fromEntries(Object.entries(r ?? {}).map(([k, v]) => [k, parseNonNegativeInteger(v, k)]));
  });
}
