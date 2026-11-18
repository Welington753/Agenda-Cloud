// Produtos do estoque. O corpo da edição não aceita saldo (`.strict()`): o
// saldo só muda por movimentação.
import { Body, Controller, Get, Header, HttpCode, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { SessionGuard } from '../auth/session.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { StockProductsService } from './stock-products.service.js';
import { usuario, type AuthenticatedRequest } from './stock-http.js';
import {
  createProductSchema,
  productListQuerySchema,
  stockIdSchema,
  updateProductSchema,
  type CreateProductDto,
  type ProductListQueryDto,
  type UpdateProductDto,
} from './stock.dto.js';

const id = new ZodValidationPipe(stockIdSchema);

@Controller('tenants/:tenantId/stock/products')
@UseGuards(SessionGuard)
export class StockProductsController {
  constructor(private readonly products: StockProductsService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(
    @Req() req: AuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Query(new ZodValidationPipe(productListQuerySchema)) query: ProductListQueryDto,
  ) {
    return this.products.list(usuario(req), tenantId, query);
  }

  @Post()
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  create(
    @Req() req: AuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Body(new ZodValidationPipe(createProductSchema)) dto: CreateProductDto,
  ) {
    return this.products.create(usuario(req), tenantId, dto);
  }

  @Get(':productId')
  @Header('Cache-Control', 'private, no-store')
  get(@Req() req: AuthenticatedRequest, @Param('tenantId') tenantId: string, @Param('productId', id) productId: string) {
    return this.products.get(usuario(req), tenantId, productId);
  }

  @Patch(':productId')
  @Header('Cache-Control', 'private, no-store')
  update(
    @Req() req: AuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Param('productId', id) productId: string,
    @Body(new ZodValidationPipe(updateProductSchema)) dto: UpdateProductDto,
  ) {
    return this.products.update(usuario(req), tenantId, productId, dto);
  }

  @Post(':productId/archive')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  archive(@Req() req: AuthenticatedRequest, @Param('tenantId') tenantId: string, @Param('productId', id) productId: string) {
    return this.products.archive(usuario(req), tenantId, productId);
  }

  @Post(':productId/reactivate')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  reactivate(@Req() req: AuthenticatedRequest, @Param('tenantId') tenantId: string, @Param('productId', id) productId: string) {
    return this.products.reactivate(usuario(req), tenantId, productId);
  }
}
