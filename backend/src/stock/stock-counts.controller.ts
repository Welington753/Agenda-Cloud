// Conferências de estoque: contar, revisar e confirmar de uma vez.
import { Body, Controller, Get, Header, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { SessionGuard } from '../auth/session.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { StockCountsService } from './stock-counts.service.js';
import { usuario, type AuthenticatedRequest } from './stock-http.js';
import {
  countListQuerySchema,
  createCountSchema,
  stockIdSchema,
  type CountListQueryDto,
  type CreateCountDto,
} from './stock.dto.js';

@Controller('tenants/:tenantId/stock/counts')
@UseGuards(SessionGuard)
export class StockCountsController {
  constructor(private readonly counts: StockCountsService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(
    @Req() req: AuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Query(new ZodValidationPipe(countListQuerySchema)) query: CountListQueryDto,
  ) {
    return this.counts.list(usuario(req), tenantId, query);
  }

  @Post()
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  create(
    @Req() req: AuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Body(new ZodValidationPipe(createCountSchema)) dto: CreateCountDto,
  ) {
    return this.counts.create(usuario(req), tenantId, dto);
  }

  @Get(':countId')
  @Header('Cache-Control', 'private, no-store')
  get(
    @Req() req: AuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Param('countId', new ZodValidationPipe(stockIdSchema)) countId: string,
  ) {
    return this.counts.get(usuario(req), tenantId, countId);
  }
}
