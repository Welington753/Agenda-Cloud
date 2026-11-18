// Movimentações manuais e estorno. Nada aqui edita ou apaga um lançamento.
import { Body, Controller, Get, Header, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { SessionGuard } from '../auth/session.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { StockMovementsService } from './stock-movements.service.js';
import { usuario, type AuthenticatedRequest } from './stock-http.js';
import {
  createMovementSchema,
  movementListQuerySchema,
  reverseMovementSchema,
  stockIdSchema,
  type CreateMovementDto,
  type MovementListQueryDto,
  type ReverseMovementDto,
} from './stock.dto.js';

@Controller('tenants/:tenantId/stock/movements')
@UseGuards(SessionGuard)
export class StockMovementsController {
  constructor(private readonly movements: StockMovementsService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(
    @Req() req: AuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Query(new ZodValidationPipe(movementListQuerySchema)) query: MovementListQueryDto,
  ) {
    return this.movements.list(usuario(req), tenantId, query);
  }

  @Post()
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  create(
    @Req() req: AuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Body(new ZodValidationPipe(createMovementSchema)) dto: CreateMovementDto,
  ) {
    return this.movements.create(usuario(req), tenantId, dto);
  }

  @Post(':movementId/reversal')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  reverse(
    @Req() req: AuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Param('movementId', new ZodValidationPipe(stockIdSchema)) movementId: string,
    @Body(new ZodValidationPipe(reverseMovementSchema)) dto: ReverseMovementDto,
  ) {
    return this.movements.reverse(usuario(req), tenantId, movementId, dto);
  }
}
