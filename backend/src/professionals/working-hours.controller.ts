// Rotas dos horários semanais de um profissional (Lote 6D.3) — sub-recurso
// de `professionals`, em controller próprio para cada arquivo manter uma
// responsabilidade só. Mesma disciplina de professionals.controller.ts:
// `SessionGuard` em todas as rotas e o `userId` provado pelo guard vai para o
// serviço, que é quem confirma o vínculo com o estabelecimento — o controller
// nunca decide autorização sozinho.
//
// `PUT` (não `PATCH`) porque o corpo descreve o estado final da semana
// inteira: substituição total, nunca alteração de alguns dias (ver
// working-hours.service.ts, `replace`).
import { Body, Controller, Get, HttpCode, Param, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AUTH_CONTEXT_REQUEST_KEY, type IdentityContext } from '../auth/session-context.js';
import { SessionGuard } from '../auth/session.guard.js';
import {
  replaceWorkingHoursSchema,
  type ReplaceWorkingHoursDto,
} from './working-hours.dto.js';
import { ProfessionalWorkingHoursService } from './working-hours.service.js';

function identityOf(req: Request): IdentityContext {
  return (req as unknown as Record<string, unknown>)[
    AUTH_CONTEXT_REQUEST_KEY
  ] as IdentityContext;
}

@Controller('tenants/:tenantId/professionals/:professionalId/schedule')
@UseGuards(SessionGuard)
export class ProfessionalWorkingHoursController {
  constructor(private readonly workingHours: ProfessionalWorkingHoursService) {}

  @Get()
  async get(
    @Param('tenantId') tenantId: string,
    @Param('professionalId') professionalId: string,
    @Req() req: Request,
  ) {
    const schedule = await this.workingHours.get(
      identityOf(req).userId,
      tenantId,
      professionalId,
    );
    return { schedule };
  }

  @Put()
  @HttpCode(200)
  async replace(
    @Param('tenantId') tenantId: string,
    @Param('professionalId') professionalId: string,
    @Body(new ZodValidationPipe(replaceWorkingHoursSchema)) dto: ReplaceWorkingHoursDto,
    @Req() req: Request,
  ) {
    const schedule = await this.workingHours.replace(
      identityOf(req).userId,
      tenantId,
      professionalId,
      dto,
    );
    return { schedule };
  }
}
