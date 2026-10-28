// "Equipe e acessos" (dono) e agenda do funcionário. Reusa o convite da
// gestão de contas (InvitesService) e o andamento dos atendimentos
// (AppointmentsService): nenhuma segunda cópia das regras de aceite, de
// horário ou de estado.
import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TEAM_CREATION_FAILURE_LIMIT, createAccountRateLimiter } from '../accounts/account-rate-limit.js';
import { AccountsModule } from '../accounts/accounts.module.js';
import { AppointmentsModule } from '../appointments/appointments.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { parseClientIpSource, parseProxySecret } from '../config/client-ip.js';
import { MyAgendaController, TeamController } from './team.controller.js';
import { MyAgendaService } from './my-agenda.service.js';
import { TeamService } from './team.service.js';
import { StaffAccountsService } from './staff-accounts.service.js';

@Module({
  imports: [ConfigModule, AuthModule, AccountsModule, AppointmentsModule],
  controllers: [TeamController, MyAgendaController],
  providers: [TeamService, MyAgendaService, StaffAccountsService],
})
export class TeamModule implements NestModule {
  constructor(private readonly config: ConfigService) {}

  configure(consumer: MiddlewareConsumer): void {
    // Login ou e-mail em uso volta com mensagem genérica; as recusas em série
    // param aqui (ver account-rate-limit.ts).
    consumer
      .apply(
        createAccountRateLimiter(
          TEAM_CREATION_FAILURE_LIMIT,
          parseClientIpSource(this.config.get('CLIENT_IP_SOURCE')),
          parseProxySecret(this.config.get('API_PROXY_SECRET')),
          { onlyFailures: true },
        ),
      )
      .forRoutes(
        { path: 'tenants/:tenantId/team/staff-accounts', method: RequestMethod.POST },
        { path: 'tenants/:tenantId/team/invites', method: RequestMethod.POST },
      );
  }
}
