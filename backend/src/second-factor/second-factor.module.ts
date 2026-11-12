// Módulo do segundo fator. `SecondFactorConfig` e o guard do portal vêm do
// AuthModule (exportados lá para os módulos de plataforma usarem a MESMA
// regra). Limites por IP próprios, só nestas rotas, contando só recusas (um
// acerto não consome o limite de quem entra todo dia).
import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module.js';
import { AccountDelivery } from '../accounts/account-delivery.js';
import { ACCOUNT_SUBMIT_LIMIT, createAccountRateLimiter } from '../accounts/account-rate-limit.js';
import { parseClientIpSource, parseProxySecret } from '../config/client-ip.js';
import { SecondFactorAdminController, SecondFactorController } from './second-factor.controller.js';
import { SecondFactorService } from './second-factor.service.js';

@Module({
  imports: [ConfigModule, AuthModule],
  controllers: [SecondFactorController, SecondFactorAdminController],
  providers: [AccountDelivery, SecondFactorService],
})
export class SecondFactorModule implements NestModule {
  constructor(private readonly config: ConfigService) {}

  configure(consumer: MiddlewareConsumer): void {
    const source = parseClientIpSource(this.config.get('CLIENT_IP_SOURCE'));
    const secret = parseProxySecret(this.config.get('API_PROXY_SECRET'));
    consumer
      .apply(createAccountRateLimiter(ACCOUNT_SUBMIT_LIMIT, source, secret, { onlyFailures: true }))
      .forRoutes(
        { path: 'auth/second-factor/verify', method: RequestMethod.POST },
        { path: 'auth/second-factor/recovery', method: RequestMethod.POST },
        { path: 'auth/second-factor/grant', method: RequestMethod.POST },
        { path: 'auth/second-factor/enrollment', method: RequestMethod.POST },
        { path: 'auth/second-factor/enrollment/confirm', method: RequestMethod.POST },
        { path: 'auth/second-factor/recovery-codes', method: RequestMethod.POST },
        { path: 'platform/users/:userId/second-factor/grants', method: RequestMethod.POST },
      );
  }
}
