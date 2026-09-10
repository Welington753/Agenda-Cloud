// Módulo de autenticação (Lotes 6B.3-6B.5) — register/login/me/logout. Rate
// limit aplicado via middleware Nest (`configure`), cada rota com seu próprio
// limiter, amarrado só àquela rota — nunca global, nunca em outra rota por
// engano. GET /auth/me e POST /auth/logout nunca recebem rate limit neste
// lote (ver auditoria do Lote 6B.4/6B.5).
import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { createLoginRateLimiter } from './login-rate-limit.js';
import { createRegisterRateLimiter } from './register-rate-limit.js';
import { SessionGuard } from './session.guard.js';

// `ConfigModule` (sem opções) garante `ConfigService` resolvível mesmo quando
// `AuthModule` é testado isolado (fora do `AppModule`) — na aplicação real,
// `AppConfigModule` (ver config/config.module.ts) já é `isGlobal: true` e
// cobre isso; este import é redundante lá, mas inofensivo (mesmo
// `process.env`, nenhuma segunda validação).
@Module({
  imports: [ConfigModule],
  controllers: [AuthController],
  providers: [AuthService, SessionGuard],
})
export class AuthModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(createRegisterRateLimiter())
      .forRoutes({ path: 'auth/register', method: RequestMethod.POST });
    consumer
      .apply(createLoginRateLimiter())
      .forRoutes({ path: 'auth/login', method: RequestMethod.POST });
  }
}
