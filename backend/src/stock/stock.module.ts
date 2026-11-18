// Estoque v1 (adicional ESTOQUE, docs/plans/estoque-v1.md): categorias,
// produtos, movimentações manuais e conferência, no painel do
// estabelecimento. Cada rota confere vínculo, adicional e permissão.
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { StockCategoriesController } from './stock-categories.controller.js';
import { StockCategoriesService } from './stock-categories.service.js';
import { StockCountsController } from './stock-counts.controller.js';
import { StockCountsService } from './stock-counts.service.js';
import { StockMovementsController } from './stock-movements.controller.js';
import { StockMovementsService } from './stock-movements.service.js';
import { StockProductsController } from './stock-products.controller.js';
import { StockProductsService } from './stock-products.service.js';

@Module({
  imports: [AuthModule],
  controllers: [StockCategoriesController, StockProductsController, StockMovementsController, StockCountsController],
  providers: [StockCategoriesService, StockProductsService, StockMovementsService, StockCountsService],
})
export class StockModule {}
