// Recebimentos manuais dos atendimentos (dono). Sessão obrigatória; a
// autorização no estabelecimento é refeita pelo serviço em toda requisição.
import { Body, Controller, Get, Header, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AUTH_CONTEXT_REQUEST_KEY, type IdentityContext } from '../auth/session-context.js';
import { SessionGuard } from '../auth/session.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import {
  paymentIdSchema,
  paymentPeriodSchema,
  recordPaymentSchema,
  refundPaymentSchema,
  type PaymentPeriodDto,
  type RecordPaymentDto,
  type RefundPaymentDto,
} from './payments.dto.js';
import { PaymentsService } from './payments.service.js';

type AuthenticatedRequest = Request & { [AUTH_CONTEXT_REQUEST_KEY]: IdentityContext };
const identidade = (req: AuthenticatedRequest) => req[AUTH_CONTEXT_REQUEST_KEY];

@Controller('tenants/:tenantId/payments')
@UseGuards(SessionGuard)
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(
    @Req() req: AuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Query(new ZodValidationPipe(paymentPeriodSchema)) periodo: PaymentPeriodDto,
  ) {
    return this.payments.list(identidade(req).userId, tenantId, periodo);
  }

  @Post()
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  record(
    @Req() req: AuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Body(new ZodValidationPipe(recordPaymentSchema)) dto: RecordPaymentDto,
  ) {
    return this.payments.record(identidade(req).userId, tenantId, dto);
  }

  @Post(':paymentId/refund')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  refund(
    @Req() req: AuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Param('paymentId', new ZodValidationPipe(paymentIdSchema)) paymentId: string,
    @Body(new ZodValidationPipe(refundPaymentSchema)) dto: RefundPaymentDto,
  ) {
    const { userId, sessionId } = identidade(req);
    return this.payments.refund(userId, sessionId, tenantId, paymentId, dto);
  }
}
