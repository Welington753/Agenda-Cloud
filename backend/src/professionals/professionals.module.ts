// Módulo de gestão de profissionais (Lote 6D.2). Sem rate limit próprio:
// são rotas autenticadas por sessão, mesma decisão de ServicesModule.
//
// `SessionGuard` vem importado do AuthModule, nunca redeclarado aqui — ver
// justificativa em services.module.ts.
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ProfessionalsController } from './professionals.controller.js';
import { ProfessionalsService } from './professionals.service.js';
import { ProfessionalWorkingHoursController } from './working-hours.controller.js';
import { ProfessionalWorkingHoursService } from './working-hours.service.js';

@Module({
  imports: [AuthModule],
  controllers: [ProfessionalsController, ProfessionalWorkingHoursController],
  providers: [ProfessionalsService, ProfessionalWorkingHoursService],
})
export class ProfessionalsModule {}
