// @nestjs/config com validação obrigatória de env — falha rápida e clara se
// faltar DATABASE_URL/DIRECT_URL/porta, nunca sobe com env incompleta (ver
// docs/plans/migracao-nestjs-typeorm-neon.md, seção 2.1 e Lote 2).

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './env.validation.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
  ],
})
export class AppConfigModule {}
