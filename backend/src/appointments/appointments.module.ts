// Módulo de agendamentos (Lote 6D.5). Sem rate limit próprio: são rotas
// autenticadas por sessão, mesma decisão dos módulos anteriores.
//
// Importa AvailabilityModule e ConsumersModule para REUSAR o cálculo de
// disponibilidade e a gravação de cliente — nunca uma segunda cópia de
// nenhum dos dois.
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AvailabilityModule } from '../availability/availability.module.js';
import { ConsumersModule } from '../consumers/consumers.module.js';
import { AppointmentsController } from './appointments.controller.js';
import { AppointmentsService } from './appointments.service.js';

@Module({
  imports: [AuthModule, AvailabilityModule, ConsumersModule],
  controllers: [AppointmentsController],
  providers: [AppointmentsService],
})
export class AppointmentsModule {}
