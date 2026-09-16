// @nestjs/config com validação obrigatória de env — falha rápida e clara se
// faltar DATABASE_URL/DIRECT_URL/porta, nunca sobe com env incompleta (ver
// docs/plans/migracao-nestjs-typeorm-neon.md, seção 2.1 e Lote 2).
//
// `ignoreEnvFile` é condicionado a um opt-in explícito (ver
// ignore-env-file.ts) — por padrão continua carregando `.env` do diretório de
// trabalho, exatamente como antes. Quem precisar rodar localmente com
// configuração vinda só do processo (nunca do `.env` em disco, por exemplo
// quando ele aponta para infraestrutura real) define
// `IGNORE_DOTENV_FILE=true` no ambiente do processo antes de iniciar.

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { shouldIgnoreEnvFile } from './ignore-env-file.js';
import { validateEnv } from './env.validation.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: shouldIgnoreEnvFile(process.env),
      validate: validateEnv,
    }),
  ],
})
export class AppConfigModule {}
