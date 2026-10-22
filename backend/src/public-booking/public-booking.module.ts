// Módulo do agendamento online: rotas públicas por slug e a configuração e
// lista de solicitações na área privada.
//
// Reusa AvailabilityService e AppointmentsService (exportados pelos módulos
// deles) — o pedido público passa pelo MESMO cálculo e pela MESMA gravação
// da agenda interna, nunca por uma cópia.
import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AppointmentsModule } from '../appointments/appointments.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { AvailabilityModule } from '../availability/availability.module.js';
import { PushModule } from '../push/push.module.js';
import { parseClientIpSource, parseProxySecret } from '../config/client-ip.js';
import {
  createPublicReadRateLimiter,
  createPublicRequestRateLimiter,
} from './public-booking-rate-limit.js';
import {
  PublicBookingAdminController,
  PublicBookingController,
} from './public-booking.controller.js';
import { PublicBookingService } from './public-booking.service.js';

@Module({
  imports: [ConfigModule, AuthModule, AvailabilityModule, AppointmentsModule, PushModule],
  controllers: [PublicBookingController, PublicBookingAdminController],
  providers: [PublicBookingService],
})
export class PublicBookingModule implements NestModule {
  constructor(private readonly configService: ConfigService) {}

  configure(consumer: MiddlewareConsumer): void {
    const clientIpSource = parseClientIpSource(this.configService.get('CLIENT_IP_SOURCE'));
    const proxySecret = parseProxySecret(this.configService.get('API_PROXY_SECRET'));
    // Envio: limite próprio e mais apertado.
    consumer
      .apply(createPublicRequestRateLimiter(clientIpSource, proxySecret))
      .forRoutes({ path: 'public/:slug/booking-requests', method: RequestMethod.POST });
    // Leitura da página e dos horários.
    consumer
      .apply(createPublicReadRateLimiter(clientIpSource, proxySecret))
      .forRoutes(
        { path: 'public/:slug', method: RequestMethod.GET },
        { path: 'public/:slug/availability', method: RequestMethod.GET },
      );
  }
}
