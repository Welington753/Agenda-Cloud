// Rotas de agendamentos (Lote 6D.5) — espelha professionals.controller.ts.
// Todas exigem sessão (`SessionGuard`) e passam o `userId` provado pelo guard
// adiante; o controller nunca decide autorização sozinho.
//
// NÃO existe rota pública neste lote, e nenhuma rota de cancelamento,
// remarcação ou mudança de status.
import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AUTH_CONTEXT_REQUEST_KEY, type IdentityContext } from '../auth/session-context.js';
import { SessionGuard } from '../auth/session.guard.js';
import {
  createAppointmentSchema,
  listAppointmentsSchema,
  type CreateAppointmentDto,
  type ListAppointmentsDto,
} from './appointment.dto.js';
import { AppointmentsService } from './appointments.service.js';

function identityOf(req: Request): IdentityContext {
  return (req as unknown as Record<string, unknown>)[
    AUTH_CONTEXT_REQUEST_KEY
  ] as IdentityContext;
}

@Controller('tenants/:tenantId/appointments')
@UseGuards(SessionGuard)
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  @Get()
  async list(
    @Param('tenantId') tenantId: string,
    @Query(new ZodValidationPipe(listAppointmentsSchema)) query: ListAppointmentsDto,
    @Req() req: Request,
  ) {
    return this.appointmentsService.list(identityOf(req).userId, tenantId, query);
  }

  @Get(':appointmentId')
  async get(
    @Param('tenantId') tenantId: string,
    @Param('appointmentId') appointmentId: string,
    @Req() req: Request,
  ) {
    const appointment = await this.appointmentsService.get(
      identityOf(req).userId,
      tenantId,
      appointmentId,
    );
    return { appointment };
  }

  @Post()
  async create(
    @Param('tenantId') tenantId: string,
    @Body(new ZodValidationPipe(createAppointmentSchema)) dto: CreateAppointmentDto,
    @Req() req: Request,
  ) {
    const appointment = await this.appointmentsService.create(
      identityOf(req).userId,
      tenantId,
      dto,
    );
    return { appointment };
  }
}
