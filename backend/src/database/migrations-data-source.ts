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

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

/** Pura e testável sem rede: recebe a URL já validada, nunca lê `process.env`
 * diretamente. */
export function buildMigrationsDataSourceOptions(
  directUrl: string,
): DataSourceOptions {
  return {
    type: 'postgres',
    url: directUrl,
    synchronize: false,
    migrationsRun: false,
    logging: ['error', 'warn'],
    ssl: { rejectUnauthorized: true },
    entities: [path.join(moduleDir, '../entities/**/*.entity.{ts,js}')],
    // Populado no Lote 5 — mesma cobertura dev/produção do glob de entidades.
    migrations: [path.join(moduleDir, '../migrations/**/*.{ts,js}')],
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
