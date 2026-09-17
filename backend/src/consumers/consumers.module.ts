// Módulo de clientes do estabelecimento (Lote 6D.5). Sem rate limit próprio:
// são rotas autenticadas por sessão, mesma decisão de ServicesModule,
// ProfessionalsModule e AvailabilityModule.
//
// `ConsumersService` é exportado para o AppointmentsModule gravar um cliente
// novo DENTRO da transação da reserva (ver appointments.service.ts).
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ConsumersController } from './consumers.controller.js';
import { ConsumersService } from './consumers.service.js';

@Module({
  imports: [AuthModule],
  controllers: [ConsumersController],
  providers: [ConsumersService],
  exports: [ConsumersService],
})
export class ConsumersModule {}
