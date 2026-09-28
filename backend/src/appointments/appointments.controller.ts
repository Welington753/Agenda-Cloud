// Rotas de agendamentos (Lote 6D.5) — espelha professionals.controller.ts.
// Todas exigem sessão (`SessionGuard`) e passam o `userId` provado pelo guard
// adiante; o controller nunca decide autorização sozinho.
//
// Lote 6D.6 acrescenta DUAS ações explícitas (`/cancel` e `/reschedule`) e a
// consulta dos horários para remarcar. Continuam NÃO existindo rota pública,
// exclusão física nem mudança livre de status: não há rota que aceite um
// `status` do cliente — cancelar é a única transição que este lote grava, e
// remarcar não muda status nenhum.
import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AUTH_CONTEXT_REQUEST_KEY, type IdentityContext } from '../auth/session-context.js';
import { SessionGuard } from '../auth/session.guard.js';
import {
  cancelAppointmentSchema,
  createAppointmentSchema,
  listAppointmentsSchema,
  rescheduleAppointmentSchema,
  rescheduleOptionsSchema,
  type CreateAppointmentDto,
  type ListAppointmentsDto,
  type RescheduleAppointmentDto,
  type RescheduleOptionsDto,
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

  /** Horários para remarcar ESTA reserva. O profissional e o serviço vêm da
   * reserva (nunca da query), e a ocupação dela é ignorada no cálculo. */
  @Get(':appointmentId/reschedule-options')
  async rescheduleOptions(
    @Param('tenantId') tenantId: string,
    @Param('appointmentId') appointmentId: string,
    @Query(new ZodValidationPipe(rescheduleOptionsSchema)) query: RescheduleOptionsDto,
    @Req() req: Request,
  ) {
    const options = await this.appointmentsService.rescheduleOptions(
      identityOf(req).userId,
      tenantId,
      appointmentId,
      query,
    );
    return { options };
  }

  /**
   * Ação explícita de cancelamento. `POST .../cancel` (e não `DELETE`) porque
   * NÃO existe exclusão física: a linha continua lá, com o estado `CANCELED` e
   * a transição registrada. O corpo é validado mesmo sendo vazio — é assim que
   * um `status` ou `priceCents` enviado pelo navegador é recusado em vez de
   * ignorado em silêncio.
   */
  @Post(':appointmentId/cancel')
  async cancel(
    @Param('tenantId') tenantId: string,
    @Param('appointmentId') appointmentId: string,
    @Body(new ZodValidationPipe(cancelAppointmentSchema)) _dto: unknown,
    @Req() req: Request,
  ) {
    const appointment = await this.appointmentsService.cancel(
      identityOf(req).userId,
      tenantId,
      appointmentId,
    );
    return { appointment };
  }

  /** Ação explícita de remarcação: move SÓ o horário da mesma reserva. */
  @Post(':appointmentId/reschedule')
  async reschedule(
    @Param('tenantId') tenantId: string,
    @Param('appointmentId') appointmentId: string,
    @Body(new ZodValidationPipe(rescheduleAppointmentSchema)) dto: RescheduleAppointmentDto,
    @Req() req: Request,
  ) {
    const appointment = await this.appointmentsService.reschedule(
      identityOf(req).userId,
      tenantId,
      appointmentId,
      dto,
    );
    return { appointment };
  }
}
