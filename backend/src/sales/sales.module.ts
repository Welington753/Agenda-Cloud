// Vendas v1 (adicional VENDAS, docs/plans/vendas-v1.md): catálogo, busca
// limitada de cliente, registro, consultas, cancelamento, recebimentos de
// vendas e compras na ficha. Cada rota confere vínculo, recurso e permissão.
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ConsumerPurchasesController, SalesController } from './sales.controller.js';
import { SalePaymentsService } from './sale-payments.service.js';
import { SalesService } from './sales.service.js';

@Module({
  imports: [AuthModule],
  controllers: [SalesController, ConsumerPurchasesController],
  providers: [SalesService, SalePaymentsService],
})
export class SalesModule {}
