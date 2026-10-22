import { Module } from '@nestjs/common';
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
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
