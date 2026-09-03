// DataSource de runtime — usado pela aplicação (via TypeOrmModule.forRootAsync,
// a partir do Lote 3+), consome DATABASE_URL (URL pooled do Neon). Nunca chama
// `.initialize()` aqui — construir um `DataSource` só guarda a configuração em
// memória, não abre conexão nenhuma; quem inicializa é o próprio NestJS/TypeORM
// module em tempo de bootstrap real (fora do escopo deste lote).
// synchronize/migrationsRun sempre false — schema só muda por migration
// versionada (ver docs/plans/migracao-nestjs-typeorm-neon.md, seção 2.1).

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DataSource, type DataSourceOptions } from 'typeorm';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

/** Pura e testável sem rede: recebe a URL já validada (ver
 * `config/env.validation.ts`), nunca lê `process.env` diretamente. */
export function buildRuntimeDataSourceOptions(
  databaseUrl: string,
): DataSourceOptions {
  return {
    type: 'postgres',
    url: databaseUrl,
    synchronize: false,
    migrationsRun: false,
    // Nunca 'query'/'all' — evitaria vazar parâmetros de bind em log.
    // 'error'/'warn' nunca incluem a connection string nem valor de coluna.
    logging: ['error', 'warn'],
    // Neon exige TLS; nunca `rejectUnauthorized: false` — validação de
    // certificado sempre ativa, mesmo em desenvolvimento.
    ssl: { rejectUnauthorized: true },
    // Populadas no Lote 3 (entidades) e Lote 5 (migrations) — o glob já cobre
    // tanto `src/**/*.entity.ts` (dev, ts-node/tsx) quanto
    // `dist/**/*.entity.js` (produção compilada), sem precisar mudar quando as
    // entidades forem criadas.
    entities: [path.join(moduleDir, '../entities/**/*.entity.{ts,js}')],
    migrations: [],
  };
}

/** Instância construída (nunca inicializada) a partir do ambiente do processo —
 * consumida futuramente por `TypeOrmModule.forRootAsync`. Construir um
 * `DataSource` não conecta a nada; `isInitialized` permanece `false` até que
 * algum código explicitamente chame `.initialize()` (fora deste lote). Se
 * `DATABASE_URL` não estiver definida, a aplicação já teria recusado subir na
 * validação de env (`config/env.validation.ts`) antes de qualquer código deste
 * módulo rodar — aqui só evitamos lançar no import para manter o arquivo
 * testável isoladamente. */
export const runtimeDataSourceOptions = buildRuntimeDataSourceOptions(
  process.env.DATABASE_URL ?? '',
);

export const RuntimeDataSource = new DataSource(runtimeDataSourceOptions);
