// Rotas de vendas e recebimentos de vendas (docs/plans/vendas-v1.md, seções
// 3 e 3.1). Sessão obrigatória; vínculo, recurso e permissão são conferidos
// pelo serviço em toda requisição. As rotas fixas vêm antes de `:saleId`.
import { Body, Controller, Get, Header, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AUTH_CONTEXT_REQUEST_KEY, type IdentityContext } from '../auth/session-context.js';
import { SessionGuard } from '../auth/session.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { SalePaymentsService } from './sale-payments.service.js';
import { SalesService } from './sales.service.js';
import {
  cancelSaleSchema,
  createSaleSchema,
  purchaseListQuerySchema,
  recordSalePaymentSchema,
  refundSalePaymentSchema,
  saleCatalogQuerySchema,
  saleConsumerSearchSchema,
  saleIdSchema,
  saleListQuerySchema,
  salePaymentListQuerySchema,
  type CancelSaleDto,
  type CreateSaleDto,
  type PurchaseListQueryDto,
  type RecordSalePaymentDto,
  type RefundSalePaymentDto,
  type SaleCatalogQueryDto,
  type SaleConsumerSearchDto,
  type SaleListQueryDto,
  type SalePaymentListQueryDto,
} from './sales.dto.js';

type AuthenticatedRequest = Request & { [AUTH_CONTEXT_REQUEST_KEY]: IdentityContext };
const identidade = (req: AuthenticatedRequest) => req[AUTH_CONTEXT_REQUEST_KEY];
const id = new ZodValidationPipe(saleIdSchema);

@Controller('tenants/:tenantId/sales')
@UseGuards(SessionGuard)
export class SalesController {
  constructor(
    private readonly sales: SalesService,
    private readonly payments: SalePaymentsService,
  ) {}

  @Get('catalog')
  @Header('Cache-Control', 'private, no-store')
  catalog(
    @Req() req: AuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Query(new ZodValidationPipe(saleCatalogQuerySchema)) query: SaleCatalogQueryDto,
  ) {
    return this.sales.catalog(identidade(req).userId, tenantId, query);
  }

  @Get('consumers')
  @Header('Cache-Control', 'private, no-store')
  consumers(
    @Req() req: AuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Query(new ZodValidationPipe(saleConsumerSearchSchema)) query: SaleConsumerSearchDto,
  ) {
    return this.sales.searchConsumers(identidade(req).userId, tenantId, query.q);
  }

  @Get('payments')
  @Header('Cache-Control', 'private, no-store')
  listPayments(
    @Req() req: AuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Query(new ZodValidationPipe(salePaymentListQuerySchema)) query: SalePaymentListQueryDto,
  ) {
    return this.payments.list(identidade(req).userId, tenantId, query);
  }

  @Post('payments/:paymentId/refund')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  refund(
    @Req() req: AuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Param('paymentId', id) paymentId: string,
    @Body(new ZodValidationPipe(refundSalePaymentSchema)) dto: RefundSalePaymentDto,
  ) {
    const { userId, sessionId } = identidade(req);
    return this.payments.refund(userId, sessionId, tenantId, paymentId, dto);
  }

  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(
    @Req() req: AuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Query(new ZodValidationPipe(saleListQuerySchema)) query: SaleListQueryDto,
  ) {
    return this.sales.list(identidade(req).userId, tenantId, query);
  }

  @Post()
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  create(
    @Req() req: AuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Body(new ZodValidationPipe(createSaleSchema)) dto: CreateSaleDto,
  ) {
    return this.sales.create(identidade(req).userId, tenantId, dto);
  }

  @Get(':saleId')
  @Header('Cache-Control', 'private, no-store')
  get(@Req() req: AuthenticatedRequest, @Param('tenantId') tenantId: string, @Param('saleId', id) saleId: string) {
    return this.sales.get(identidade(req).userId, tenantId, saleId);
  }

  @Post(':saleId/cancel')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  cancel(
    @Req() req: AuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Param('saleId', id) saleId: string,
    @Body(new ZodValidationPipe(cancelSaleSchema)) dto: CancelSaleDto,
  ) {
    const { userId, sessionId } = identidade(req);
    return this.sales.cancel(userId, sessionId, tenantId, saleId, dto);
  }

  @Post(':saleId/payments')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  recordPayment(
    @Req() req: AuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Param('saleId', id) saleId: string,
    @Body(new ZodValidationPipe(recordSalePaymentSchema)) dto: RecordSalePaymentDto,
  ) {
    return this.payments.record(identidade(req).userId, tenantId, saleId, dto);
  }
}

/** Compras na ficha do cliente (consulta geral de vendas e de clientes). */
@Controller('tenants/:tenantId/consumers/:consumerId/purchases')
@UseGuards(SessionGuard)
export class ConsumerPurchasesController {
  constructor(private readonly sales: SalesService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(
    @Req() req: AuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Param('consumerId', id) consumerId: string,
    @Query(new ZodValidationPipe(purchaseListQuerySchema)) query: PurchaseListQueryDto,
  ) {
    return this.sales.purchases(identidade(req).userId, tenantId, consumerId, query);
  }
}
