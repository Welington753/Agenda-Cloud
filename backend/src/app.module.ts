import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AppConfigModule } from './config/config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { AuthModule } from './auth/auth.module.js';
import { ServicesModule } from './services/services.module.js';
import { ProfessionalsModule } from './professionals/professionals.module.js';
import { AvailabilityModule } from './availability/availability.module.js';
import { ConsumersModule } from './consumers/consumers.module.js';
import { AppointmentsModule } from './appointments/appointments.module.js';
import { PublicBookingModule } from './public-booking/public-booking.module.js';
import { PushModule } from './push/push.module.js';
import { PlatformModule } from './platform/platform.module.js';
import { AccountsModule } from './accounts/accounts.module.js';
import { TeamModule } from './team/team.module.js';
import { DashboardModule } from './dashboard/dashboard.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { DatabaseErrorFilter } from './common/database-error.filter.js';

@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    AuthModule,
    ServicesModule,
    ProfessionalsModule,
    AvailabilityModule,
    ConsumersModule,
    AppointmentsModule,
    PublicBookingModule,
    PushModule,
    PlatformModule,
    AccountsModule,
    TeamModule,
    DashboardModule,
    PaymentsModule,
  ],
  controllers: [AppController],
  // Erro de banco sem tratamento: 500 genérico e log sem os valores da query.
  providers: [AppService, { provide: APP_FILTER, useClass: DatabaseErrorFilter }],
})
export class AppModule {}
