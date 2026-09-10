// Conecta a aplicação ao Postgres em runtime, reaproveitando a mesma
// construção de opções de `runtime-data-source.ts` (DATABASE_URL,
// SnakeNamingStrategy, synchronize:false, migrationsRun:false) — única fonte
// de verdade, sem duplicar a configuração numa segunda leitura de env. A
// URL/senha nunca aparece em log: `buildRuntimeDataSourceOptions` já define
// `logging: ['error', 'warn']` (nunca 'query'/'all'), e nenhum código aqui
// imprime `configService.getOrThrow(...)`.
//
// Importar esta classe nunca conecta nada: `TypeOrmModule.forRootAsync` só
// registra um provider assíncrono; a conexão real (`DataSource.initialize()`)
// só acontece quando o Nest de fato instancia esse provider — no bootstrap
// real da aplicação (`NestFactory.create` + `app.listen`, main.ts), nunca ao
// só importar/declarar o módulo. Testes (unitários e `test/app.e2e-spec.ts`)
// nunca deixam esse provider real ser instanciado: ou testam
// `createRuntimeTypeOrmOptions` isoladamente (sem Nest), ou substituem o
// provider `DataSource` antes de compilar o módulo de teste.
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { DataSourceOptions } from 'typeorm';
import { buildRuntimeDataSourceOptions } from './runtime-data-source.js';

/** Pura e testável sem Nest nem rede: única leitura de `DATABASE_URL` feita
 * via `ConfigService.getOrThrow` (nunca `process.env` direto, mesma
 * disciplina de `config/env.validation.ts` e `main.ts`). Propaga o erro do
 * próprio `getOrThrow` se a variável estiver ausente — nunca engole a falha
 * nem inventa um valor default, então a aplicação recusa subir de forma clara
 * em vez de desligar o banco silenciosamente. */
export function createRuntimeTypeOrmOptions(
  configService: Pick<ConfigService, 'getOrThrow'>,
): DataSourceOptions {
  return buildRuntimeDataSourceOptions(
    configService.getOrThrow<string>('DATABASE_URL'),
  );
}

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: createRuntimeTypeOrmOptions,
    }),
  ],
})
export class DatabaseModule {}
