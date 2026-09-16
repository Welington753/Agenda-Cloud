// Módulo da consulta de disponibilidade (Lote 6D.4). Sem rate limit próprio:
// é rota autenticada por sessão, mesma decisão de ServicesModule e
// ProfessionalsModule.
//
// `SessionGuard` vem importado do AuthModule, nunca redeclarado aqui.
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AvailabilityController } from './availability.controller.js';
import { AvailabilityService } from './availability.service.js';

@Module({
  imports: [AuthModule],
  controllers: [AvailabilityController],
  providers: [AvailabilityService],
})
export class AvailabilityModule {}
