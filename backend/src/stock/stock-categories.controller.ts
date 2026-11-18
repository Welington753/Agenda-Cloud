// Categorias e subcategorias do estoque (dono e gerente com o adicional).
import { Body, Controller, Get, Header, HttpCode, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { SessionGuard } from '../auth/session.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { StockCategoriesService } from './stock-categories.service.js';
import { usuario, type AuthenticatedRequest } from './stock-http.js';
import {
  categoryListQuerySchema,
  categoryNameSchema,
  stockIdSchema,
  type CategoryListQueryDto,
  type CategoryNameDto,
} from './stock.dto.js';

const id = new ZodValidationPipe(stockIdSchema);

@Controller('tenants/:tenantId/stock')
@UseGuards(SessionGuard)
export class StockCategoriesController {
  constructor(private readonly categories: StockCategoriesService) {}

  @Get('categories')
  @Header('Cache-Control', 'private, no-store')
  list(
    @Req() req: AuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Query(new ZodValidationPipe(categoryListQuerySchema)) query: CategoryListQueryDto,
  ) {
    return this.categories.list(usuario(req), tenantId, query);
  }

  @Post('categories')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  create(
    @Req() req: AuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Body(new ZodValidationPipe(categoryNameSchema)) dto: CategoryNameDto,
  ) {
    return this.categories.create(usuario(req), tenantId, dto);
  }

  @Patch('categories/:categoryId')
  @Header('Cache-Control', 'private, no-store')
  rename(
    @Req() req: AuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Param('categoryId', id) categoryId: string,
    @Body(new ZodValidationPipe(categoryNameSchema)) dto: CategoryNameDto,
  ) {
    return this.categories.rename(usuario(req), tenantId, categoryId, dto);
  }

  @Post('categories/:categoryId/archive')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  archive(@Req() req: AuthenticatedRequest, @Param('tenantId') tenantId: string, @Param('categoryId', id) categoryId: string) {
    return this.categories.archive(usuario(req), tenantId, categoryId);
  }

  @Post('categories/:categoryId/reactivate')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  reactivate(@Req() req: AuthenticatedRequest, @Param('tenantId') tenantId: string, @Param('categoryId', id) categoryId: string) {
    return this.categories.reactivate(usuario(req), tenantId, categoryId);
  }

  @Post('categories/:categoryId/subcategories')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  createSubcategory(
    @Req() req: AuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Param('categoryId', id) categoryId: string,
    @Body(new ZodValidationPipe(categoryNameSchema)) dto: CategoryNameDto,
  ) {
    return this.categories.createSubcategory(usuario(req), tenantId, categoryId, dto);
  }

  @Patch('subcategories/:subcategoryId')
  @Header('Cache-Control', 'private, no-store')
  renameSubcategory(
    @Req() req: AuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Param('subcategoryId', id) subcategoryId: string,
    @Body(new ZodValidationPipe(categoryNameSchema)) dto: CategoryNameDto,
  ) {
    return this.categories.renameSubcategory(usuario(req), tenantId, subcategoryId, dto);
  }

  @Post('subcategories/:subcategoryId/archive')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  archiveSubcategory(
    @Req() req: AuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Param('subcategoryId', id) subcategoryId: string,
  ) {
    return this.categories.archiveSubcategory(usuario(req), tenantId, subcategoryId);
  }

  @Post('subcategories/:subcategoryId/reactivate')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  reactivateSubcategory(
    @Req() req: AuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Param('subcategoryId', id) subcategoryId: string,
  ) {
    return this.categories.reactivateSubcategory(usuario(req), tenantId, subcategoryId);
  }
}
