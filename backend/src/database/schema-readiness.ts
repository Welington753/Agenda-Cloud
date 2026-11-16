// Conferência de inicialização: o banco tem TODAS as migrations que este
// código exige? Roda uma vez, em main.ts, depois de a conexão abrir e ANTES
// de `app.listen` (nenhum gancho de módulo rodou, nenhuma porta escuta).
//
// POR QUE EXISTE: uma API publicada antes da migration correspondente sobe
// normalmente e só falha na primeira consulta (em 11/11/2026, `/auth/login`
// e `/auth/me` responderam 500 por `column Tenant.is_test does not exist`).
// Com esta conferência o processo termina antes de escutar; no Render, o
// deploy novo nunca fica saudável e o anterior continua atendendo.
//
// O QUE FAZ, SÓ LEITURA:
//  1. abre uma transação `READ ONLY` com `statement_timeout`;
//  2. pergunta se a tabela de controle existe (`to_regclass`, sem erro quando
//     não existe);
//  3. lê os nomes aplicados e compara com o manifesto inteiro
//     (required-migrations.ts) — pelo NOME de cada uma, nunca pela quantidade
//     nem só pela última;
//  4. desfaz a transação. Nada é criado, alterado ou aplicado. A API nunca
//     executa migration nem sincroniza schema (`migrationsRun` e
//     `synchronize` continuam `false`).
//
// O QUE NÃO GARANTE:
//  - Migration a MAIS no banco não bloqueia (banco adiantado durante a
//    publicação, rollback da API): só vira aviso no log. Esta conferência,
//    sozinha, não prova que o código funciona com um schema mais novo — uma
//    migration futura pode remover ou mudar o que este código usa. Essa
//    compatibilidade é do roteiro de cada lote.
//  - O nome na tabela diz que a migration foi REGISTRADA, não que o schema
//    não foi alterado à mão depois.
//  - É uma fotografia da inicialização: migration revertida com a API no ar
//    só é percebida no próximo início.
//
// LOG: nomes de migration, o nome da tabela de controle e o código do erro
// do driver. Nunca URL de conexão, usuário, senha, parâmetro ou a mensagem
// crua do driver.
import type { DataSource } from 'typeorm';
import { linhasDe } from '../common/linhas-de.js';
import { REQUIRED_MIGRATIONS } from './required-migrations.js';

/** Mesmo nome dos dois DataSources (runtime e migrations). */
export const DEFAULT_MIGRATIONS_TABLE = 'typeorm_migrations';

/** Teto de cada comando no servidor (`statement_timeout`). */
export const SCHEMA_CHECK_STATEMENT_TIMEOUT_MS = 5_000;
/** Teto da conferência inteira, contado no processo: cobre a rede que não
 * responde, que o `statement_timeout` do servidor não alcança. */
export const SCHEMA_CHECK_TOTAL_TIMEOUT_MS = 10_000;

export type SchemaProblem =
  | { reason: 'missing-migrations'; table: string; missing: string[]; required: number }
  | { reason: 'control-table-missing'; table: string }
  | { reason: 'database-unavailable'; code: string | null };

export interface SchemaReport {
  required: number;
  applied: number;
  /** Aplicadas no banco e desconhecidas deste código. Não bloqueiam. */
  extra: string[];
}

/** O banco não serve a este código (ou não deu para saber). A mensagem é o
 * diagnóstico completo, pronto para o log, sem nenhum dado de conexão. */
export class SchemaNotReadyError extends Error {
  constructor(readonly problem: SchemaProblem) {
    super(describeSchemaProblem(problem));
    this.name = 'SchemaNotReadyError';
  }
}

export interface MigrationComparison {
  /** Exigidas pelo código e ausentes do banco, na ordem do manifesto. */
  missing: string[];
  /** No banco e fora do manifesto, em ordem alfabética. */
  extra: string[];
}

/** Compara os dois CONJUNTOS de nomes. Pura. */
export function compareMigrations(
  required: readonly string[],
  applied: readonly string[],
): MigrationComparison {
  const aplicadas = new Set(applied);
  const exigidas = new Set(required);
  return {
    missing: required.filter((nome) => !aplicadas.has(nome)),
    extra: [...aplicadas].filter((nome) => !exigidas.has(nome)).sort(),
  };
}

const ORIENTACAO =
  'A API não executa migrations. Aplique as que faltam pelo roteiro de publicação (migration, depois API, depois web) ' +
  'ou publique uma versão do código compatível com este banco.';

export function describeSchemaProblem(problem: SchemaProblem): string {
  switch (problem.reason) {
    case 'missing-migrations': {
      const quantas = problem.missing.length;
      return (
        `A API não vai iniciar: o banco não tem ${quantas} de ${problem.required} migrations exigidas por este código ` +
        `(tabela "${problem.table}"). Ausentes: ${problem.missing.join(', ')}. ${ORIENTACAO}`
      );
    }
    case 'control-table-missing':
      return (
        `A API não vai iniciar: a tabela de controle de migrations "${problem.table}" não existe neste banco, ` +
        `então nenhuma migration exigida foi registrada. ${ORIENTACAO}`
      );
    case 'database-unavailable':
      return (
        'A API não vai iniciar: não foi possível ler a tabela de controle de migrations ' +
        `(${problem.code ? `código ${problem.code}` : 'sem código do driver'}). ` +
        'O banco está indisponível, recusou a conexão ou não respondeu a tempo. Nenhuma conferência foi concluída.'
      );
  }
}

/** Código do erro do driver (`ECONNREFUSED`, `57014`, `28P01`...), só quando
 * tem forma de código. A mensagem do driver nunca é repassada. */
function driverCode(erro: unknown): string | null {
  for (const candidato of [erro, (erro as { driverError?: unknown } | null)?.driverError]) {
    const codigo = (candidato as { code?: unknown } | null | undefined)?.code;
    if (typeof codigo === 'string' && /^[A-Za-z0-9_]{1,32}$/.test(codigo)) return codigo;
  }
  return null;
}

const TEMPO_ESGOTADO = Symbol('tempo esgotado');

async function comPrazo<T>(promessa: Promise<T>, ms: number): Promise<T | typeof TEMPO_ESGOTADO> {
  let relogio: NodeJS.Timeout | undefined;
  const prazo = new Promise<typeof TEMPO_ESGOTADO>((resolve) => {
    relogio = setTimeout(() => resolve(TEMPO_ESGOTADO), ms);
  });
  try {
    return await Promise.race([promessa, prazo]);
  } finally {
    clearTimeout(relogio);
  }
}

type ReadableDataSource = Pick<DataSource, 'createQueryRunner' | 'options' | 'driver'>;

/**
 * Lê os nomes aplicados, numa transação só de leitura. `null`: a tabela de
 * controle não existe. Erro de conexão ou de consulta sobe como veio.
 */
async function readAppliedMigrations(dataSource: ReadableDataSource, table: string): Promise<string[] | null> {
  const tabelaEscapada = dataSource.driver.escape(table);
  const runner = dataSource.createQueryRunner();
  let emTransacao = false;
  try {
    await runner.connect();
    await runner.query('BEGIN TRANSACTION READ ONLY');
    emTransacao = true;
    // Literal numérico fixo (constante deste arquivo), não entrada externa:
    // `SET` não aceita parâmetro de bind.
    await runner.query(`SET LOCAL statement_timeout = ${SCHEMA_CHECK_STATEMENT_TIMEOUT_MS}`);
    const existe = linhasDe<{ tabela: string | null }>(
      await runner.query('SELECT to_regclass($1)::text AS tabela', [tabelaEscapada]),
    );
    if (!existe[0]?.tabela) return null;
    const linhas = linhasDe<{ name: string }>(await runner.query(`SELECT name FROM ${tabelaEscapada}`));
    return linhas.map((linha) => linha.name);
  } finally {
    // Limpeza nunca esconde o erro original nem transforma sucesso em falha.
    if (emTransacao) await runner.query('ROLLBACK').catch(() => undefined);
    await runner.release().catch(() => undefined);
  }
}

export interface SchemaCheckOptions {
  required?: readonly string[];
  totalTimeoutMs?: number;
}

/**
 * Confere o manifesto inteiro contra o banco. Devolve o relatório quando
 * todas as exigidas estão registradas; senão lança `SchemaNotReadyError`.
 */
export async function checkRequiredMigrations(
  dataSource: ReadableDataSource,
  options: SchemaCheckOptions = {},
): Promise<SchemaReport> {
  const required = options.required ?? REQUIRED_MIGRATIONS;
  const table = dataSource.options.migrationsTableName ?? DEFAULT_MIGRATIONS_TABLE;

  let applied: string[] | null | typeof TEMPO_ESGOTADO;
  try {
    const leitura = readAppliedMigrations(dataSource, table);
    // Se o prazo vencer, a leitura segue sozinha até o driver desistir; o
    // processo vai terminar, então só evitamos uma rejeição sem tratamento.
    leitura.catch(() => undefined);
    applied = await comPrazo(leitura, options.totalTimeoutMs ?? SCHEMA_CHECK_TOTAL_TIMEOUT_MS);
  } catch (erro) {
    throw new SchemaNotReadyError({ reason: 'database-unavailable', code: driverCode(erro) });
  }
  if (applied === TEMPO_ESGOTADO) {
    throw new SchemaNotReadyError({ reason: 'database-unavailable', code: 'TEMPO_ESGOTADO' });
  }
  if (applied === null) throw new SchemaNotReadyError({ reason: 'control-table-missing', table });

  const { missing, extra } = compareMigrations(required, applied);
  if (missing.length > 0) {
    throw new SchemaNotReadyError({ reason: 'missing-migrations', table, missing, required: required.length });
  }
  return { required: required.length, applied: applied.length, extra };
}

export interface SchemaCheckLogger {
  log(mensagem: string): void;
  warn(mensagem: string): void;
}

/** Conferência da inicialização, com o registro do resultado. Lança
 * `SchemaNotReadyError` quando a API não pode subir. */
export async function ensureRequiredMigrations(
  dataSource: ReadableDataSource,
  logger: SchemaCheckLogger,
  options: SchemaCheckOptions = {},
): Promise<SchemaReport> {
  const relatorio = await checkRequiredMigrations(dataSource, options);
  logger.log(`Migrations exigidas por este código: ${relatorio.required} de ${relatorio.required} registradas no banco.`);
  if (relatorio.extra.length > 0) {
    logger.warn(
      `O banco tem ${relatorio.extra.length} migration(s) que este código não conhece: ${relatorio.extra.join(', ')}. ` +
        'Isto não bloqueia a inicialização, e esta conferência não garante compatibilidade com um schema mais novo.',
    );
  }
  return relatorio;
}
