// Módulo da consulta de disponibilidade (Lote 6D.4). Sem rate limit próprio:
// é rota autenticada por sessão, mesma decisão de ServicesModule e
// ProfessionalsModule.
//
// `SessionGuard` vem importado do AuthModule, nunca redeclarado aqui.
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AvailabilityController } from './availability.controller.js';
import { AvailabilityService } from './availability.service.js';

// `AvailabilityService` é exportado para o AppointmentsModule (Lote 6D.5)
// reutilizar EXATAMENTE o mesmo carregamento e as mesmas regras na hora de
// gravar — nunca uma segunda cópia do cálculo.
@Module({
  imports: [AuthModule],
  controllers: [AvailabilityController],
  providers: [AvailabilityService],
  exports: [AvailabilityService],
})
export class AvailabilityModule {}
