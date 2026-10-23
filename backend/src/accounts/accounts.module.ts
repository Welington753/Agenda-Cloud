import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module.js';
import { parseClientIpSource, parseProxySecret } from '../config/client-ip.js';
import { AccountDelivery } from './account-delivery.js';
import {
  ACCOUNT_PREVIEW_LIMIT,
  ACCOUNT_SUBMIT_LIMIT,
  REAUTH_LIMIT,
  createAccountRateLimiter,
} from './account-rate-limit.js';
import { AccountsAdminController } from './accounts-admin.controller.js';
import { AccountsAdminService } from './accounts-admin.service.js';
import { AccountsDirectoryService } from './accounts-directory.service.js';
import { InvitesService } from './invites.service.js';
import { PasswordResetsService } from './password-resets.service.js';
import { PublicAccountsController } from './public-accounts.controller.js';

@Module({
  imports: [ConfigModule, AuthModule],
  controllers: [AccountsAdminController, PublicAccountsController],
  providers: [AccountDelivery, AccountsAdminService, AccountsDirectoryService, InvitesService, PasswordResetsService],
})
export class AccountsModule implements NestModule {
  constructor(private readonly config: ConfigService) {}

  configure(consumer: MiddlewareConsumer): void {
    const source = parseClientIpSource(this.config.get('CLIENT_IP_SOURCE'));
    const secret = parseProxySecret(this.config.get('API_PROXY_SECRET'));
    consumer
      .apply(createAccountRateLimiter(ACCOUNT_SUBMIT_LIMIT, source, secret))
      .forRoutes(
        { path: 'invites/accept', method: RequestMethod.POST },
        { path: 'password-resets/complete', method: RequestMethod.POST },
      );
    consumer
      .apply(createAccountRateLimiter(ACCOUNT_PREVIEW_LIMIT, source, secret))
      .forRoutes(
        { path: 'invites/preview', method: RequestMethod.POST },
        { path: 'password-resets/preview', method: RequestMethod.POST },
      );
    consumer
      .apply(createAccountRateLimiter(REAUTH_LIMIT, source, secret))
      .forRoutes({ path: 'platform/reauth', method: RequestMethod.POST });
  }
}
