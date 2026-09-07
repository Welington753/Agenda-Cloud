// DataSource de migrations — usado só pelo TypeORM CLI (`migration:generate`,
// `migration:run`, `migration:revert`, a partir do Lote 4+), consome
// DIRECT_URL (URL direta do Neon, sessão longa, sem pooler — necessária para
// `CREATE EXTENSION`, locks de DDL etc., mesmo motivo já documentado em
// `prisma.config.ts` do lado Prisma). Nunca chama `.initialize()` aqui — o
// próprio comando do TypeORM CLI conecta quando for de fato executado, fora do
// escopo deste lote. synchronize/migrationsRun sempre false.

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DataSource, type DataSourceOptions } from 'typeorm';
import { SnakeNamingStrategy } from './snake-naming-strategy.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

// Ver a mesma nota em runtime-data-source.ts sobre por que `Extract` (e não
// um import profundo do driver) é usado para obter o tipo específico do
// Postgres com `ssl` tipado.
type PostgresDataSourceOptions = Extract<DataSourceOptions, { type: 'postgres' }>;

/** Pura e testável sem rede: recebe a URL já validada, nunca lê `process.env`
 * diretamente. */
export function buildMigrationsDataSourceOptions(
  directUrl: string,
): PostgresDataSourceOptions {
  return {
    type: 'postgres',
    url: directUrl,
    synchronize: false,
    migrationsRun: false,
    namingStrategy: new SnakeNamingStrategy(),
    logging: ['error', 'warn'],
    ssl: { rejectUnauthorized: true },
    entities: [path.join(moduleDir, '../entities/**/*.entity.{ts,js}')],
    // `!(*.spec)` (extglob, suportado pelo `tinyglobby` que o TypeORM usa
    // internamente — confirmado sem conectar a banco nenhum) exclui os
    // arquivos de teste que vivem ao lado das migrations em
    // `backend/src/migrations/` — sem essa exclusão, TypeORM tentaria
    // carregar `*.spec.ts` como migration de verdade.
    migrations: [path.join(moduleDir, '../migrations/**/!(*.spec).{ts,js}')],
    // Nome explícito e estável (nunca o default "migrations", genérico
    // demais e propenso a colidir com nome de tabela de domínio futura) —
    // coexiste sem conflito com `_prisma_migrations` (namespace de controle
    // independente, ver docs/plans/migracao-nestjs-typeorm-neon.md, seção
    // 8.6).
    migrationsTableName: 'typeorm_migrations',
  };
}

/** Instância construída (nunca inicializada) a partir do ambiente do processo.
 * Ausência de `DIRECT_URL` não lança aqui — o TypeORM CLI só precisa da URL no
 * momento em que um comando de migration for de fato executado (fora deste
 * lote); manter o import sem exceção mantém o arquivo testável isoladamente. */
export const migrationsDataSourceOptions = buildMigrationsDataSourceOptions(
  process.env.DIRECT_URL ?? '',
);

export const MigrationsDataSource = new DataSource(migrationsDataSourceOptions);

export default MigrationsDataSource;
