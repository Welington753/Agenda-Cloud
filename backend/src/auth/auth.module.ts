// Módulo de autenticação (Lote 6B.3) — só POST /auth/register nesta etapa.
// Rate limit aplicado via middleware Nest (`configure`), amarrado só a essa
// rota — nunca global, nunca em outra rota por engano.
import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { createRegisterRateLimiter } from './register-rate-limit.js';

// `ConfigModule` (sem opções) garante `ConfigService` resolvível mesmo quando
// `AuthModule` é testado isolado (fora do `AppModule`) — na aplicação real,
// `AppConfigModule` (ver config/config.module.ts) já é `isGlobal: true` e
// cobre isso; este import é redundante lá, mas inofensivo (mesmo
// `process.env`, nenhuma segunda validação).
@Module({
  imports: [ConfigModule],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(createRegisterRateLimiter())
      .forRoutes({ path: 'auth/register', method: RequestMethod.POST });
  }
}
