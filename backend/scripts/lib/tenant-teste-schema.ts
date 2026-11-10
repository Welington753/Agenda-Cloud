// Conferência da migration `TenantTestFlag1793664000000` (marca de
// estabelecimento de teste) no banco do piloto (ver
// docs/runbooks/publicacao-tenant-teste-slugs.md). Dois estados, e nenhum
// outro:
//
//   before-tenant-test-flag  o baseline 16 válido: as dezesseis migrations até
//                            ProfessionalCommissionSettings, com a conferência
//                            `after-commission-settings` inteira (reaproveitada)
//                            e nada da 17;
//   after-tenant-test-flag   as dezessete migrations, o baseline 16 (a mesma
//                            conferência, sem exigir o histórico de exatamente
//                            dezesseis), a coluna `tenants.is_test` com a
//                            definição exata e o valor novo de `audit_action`.
//
// O estado "depois" é PERMANENTE: estabelecimentos marcados como teste são
// uso normal. A contagem de marcados sai como informação, nunca como falha:
// `default false` não identifica testes antigos, e o runbook exige a
// classificação explícita antes de considerar a proteção efetiva.
//
// Só leitura: `BEGIN TRANSACTION READ ONLY` ... `ROLLBACK`. Lê metadados e
// contagens, nunca nome, e-mail, telefone ou slug.
//
// Nomes e definições vêm de src/migrations/1793664000000-TenantTestFlag.ts,
// duplicados de propósito (os scripts compilam com `rootDir: ./scripts`);
// tenant-teste-schema.spec.ts confere que batem com a migration, e o
// db-e2e, com o banco.
import type { PgClientLike } from './pg-client.js';
import { parseNonNegativeInteger } from './pg-value-parsers.js';
import {
  MIGRATIONS_ATE_REGRA_GERAL,
  falhasDepoisDaRegraGeral,
  lerEstadoRegraGeral,
  type EstadoRegraGeral,
} from './regra-geral-comissoes-schema.js';

export { MIGRATIONS_ATE_REGRA_GERAL };
export const MIGRATION_TENANT_TESTE = 'TenantTestFlag1793664000000';
export const MIGRATIONS_ATE_TENANT_TESTE = [...MIGRATIONS_ATE_REGRA_GERAL, MIGRATION_TENANT_TESTE] as const;

export const COLUNA_IS_TEST: readonly [string, string] = ['tenants', 'is_test'];
/** `tipo:notnull:padrao`, como `format_type`/`pg_get_expr` imprimem. */
export const COLUNA_IS_TEST_ESPERADA = 'boolean:t:false';
export const VALOR_AUDITORIA = 'TENANT_TEST_FLAG_CHANGED';

export interface EstadoTenantTeste {
  migrationNames: string[];
  /** A leitura do baseline 16 (regra-geral-comissoes-schema.ts). */
  regraGeral: EstadoRegraGeral;
  /** `tipo:notnull:padrao` da coluna nova, ou null se não existe. */
  colunaIsTest: string | null;
  valorDeAuditoria: boolean;
  /** Estabelecimentos marcados como teste (null antes da coluna). */
  marcadosComoTeste: number | null;
  estabelecimentos: number;
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

export async function lerEstadoTenantTeste(client: PgClientLike): Promise<EstadoTenantTeste> {
  // A conferência da 16 abre e fecha as próprias transações só-leitura.
  const regraGeral = await lerEstadoRegraGeral(client);
  return somenteLeitura(client, async () => {
    const migrations = await client.query<{ name: string }>('SELECT name FROM typeorm_migrations ORDER BY id');
    const coluna = await client.query<{ linha: string }>(
      `SELECT format_type(a.atttypid, a.atttypmod) || ':' || CASE WHEN a.attnotnull THEN 't' ELSE 'f' END
              || ':' || coalesce(pg_get_expr(d.adbin, d.adrelid), 'sem_padrao') AS linha
         FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE a.attrelid = $1::regclass AND a.attname = $2 AND NOT a.attisdropped`,
      [`public.${COLUNA_IS_TEST[0]}`, COLUNA_IS_TEST[1]],
    );
    const [{ existe }] = (
      await client.query<{ existe: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
                         WHERE t.typname = 'audit_action' AND e.enumlabel = $1) AS existe`,
        [VALOR_AUDITORIA],
      )
    ).rows;
    const colunaIsTest = coluna.rows[0]?.linha ?? null;
    const [contagem] = (
      await client.query<{ total: string; marcados: string | null }>(
        `SELECT count(*)::text AS total, ${colunaIsTest === null ? 'NULL' : 'count(*) FILTER (WHERE is_test)::text'} AS marcados
           FROM tenants`,
      )
    ).rows;
    return {
      migrationNames: migrations.rows.map((r) => r.name),
      regraGeral,
      colunaIsTest,
      valorDeAuditoria: existe === true,
      marcadosComoTeste:
        contagem?.marcados === null || contagem?.marcados === undefined
          ? null
          : parseNonNegativeInteger(contagem.marcados, 'tenants_is_test'),
      estabelecimentos: parseNonNegativeInteger(contagem?.total, 'tenants'),
    };
  });
}

const mesmaLista = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((valor, i) => valor === b[i]);

/** O baseline 16 (`after-commission-settings`, a mesma função do kit da 16),
 * com o histórico recortado nas dezesseis. */
function falhasDoBaseline16(estado: EstadoTenantTeste): string[] {
  const recortado: EstadoRegraGeral = {
    ...estado.regraGeral,
    migrationNames: estado.regraGeral.migrationNames.slice(0, MIGRATIONS_ATE_REGRA_GERAL.length),
  };
  return falhasDepoisDaRegraGeral(recortado).map((f) => `baseline16_${f}`);
}

export function falhasAntesDoTenantTeste(estado: EstadoTenantTeste): string[] {
  const falhas: string[] = [];
  if (!mesmaLista(estado.migrationNames, MIGRATIONS_ATE_REGRA_GERAL)) falhas.push('migration_history');
  falhas.push(...falhasDoBaseline16(estado));
  if (estado.colunaIsTest !== null) falhas.push('is_test_column_already_exists');
  return falhas;
}

export function falhasDepoisDoTenantTeste(estado: EstadoTenantTeste): string[] {
  const falhas: string[] = [];
  if (!mesmaLista(estado.migrationNames, MIGRATIONS_ATE_TENANT_TESTE)) falhas.push('migration_history');
  falhas.push(...falhasDoBaseline16(estado));
  if (estado.colunaIsTest === null) falhas.push(`column_${COLUNA_IS_TEST.join('_')}`);
  else if (estado.colunaIsTest !== COLUNA_IS_TEST_ESPERADA) falhas.push(`column_${COLUNA_IS_TEST.join('_')}_definition`);
  if (!estado.valorDeAuditoria) falhas.push(`audit_action_${VALOR_AUDITORIA}`);
  return falhas;
}

/** Coluna e valor de auditoria. */
export const TOTAL_OBJETOS_TENANT_TESTE = 2;

export function objetosTenantTestePresentes(estado: EstadoTenantTeste): number {
  return (estado.colunaIsTest === COLUNA_IS_TEST_ESPERADA ? 1 : 0) + (estado.valorDeAuditoria ? 1 : 0);
}

/** Linhas fixas `NOME: valor`. A marca padrão não classifica ninguém. */
export function descreverMarcados(estado: EstadoTenantTeste): string[] {
  return [
    `ESTABELECIMENTOS: ${estado.estabelecimentos}`,
    `MARCADOS_COMO_TESTE: ${estado.marcadosComoTeste === null ? 'coluna ainda não existe' : estado.marcadosComoTeste}`,
    'TESTE_NOTA: default false não identifica testes antigos; classifique cada um no portal antes de considerar a proteção efetiva',
  ];
}
