// Rotas de clientes do estabelecimento (Lote 6D.5) — espelha
// professionals.controller.ts. Todas exigem sessão (`SessionGuard`) e passam
// o `userId` provado pelo guard adiante; o controller nunca decide
// autorização sozinho.
//
// Só BUSCA e CADASTRO: é o mínimo para a primeira reserva existir. Não há
// listagem completa (seria enumeração da base), edição, desativação nem
// histórico neste lote.
import { Body, Controller, Get, Post, Param, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AUTH_CONTEXT_REQUEST_KEY, type IdentityContext } from '../auth/session-context.js';
import { SessionGuard } from '../auth/session.guard.js';
import {
  consumerSearchSchema,
  createConsumerSchema,
  type ConsumerSearchDto,
  type CreateConsumerDto,
} from './consumer.dto.js';
import { ConsumersService } from './consumers.service.js';

function identityOf(req: Request): IdentityContext {
  return (req as unknown as Record<string, unknown>)[
    AUTH_CONTEXT_REQUEST_KEY
  ] as IdentityContext;
}

@Controller('tenants/:tenantId/consumers')
@UseGuards(SessionGuard)
export class ConsumersController {
  constructor(private readonly consumersService: ConsumersService) {}

  @Get()
  async search(
    @Param('tenantId') tenantId: string,
    @Query(new ZodValidationPipe(consumerSearchSchema)) query: ConsumerSearchDto,
    @Req() req: Request,
  ) {
    const consumers = await this.consumersService.search(
      identityOf(req).userId,
      tenantId,
      query.q,
    );
    return { consumers };
  }

  @Post()
  async create(
    @Param('tenantId') tenantId: string,
    @Body(new ZodValidationPipe(createConsumerSchema)) dto: CreateConsumerDto,
    @Req() req: Request,
  ) {
    const consumer = await this.consumersService.create(identityOf(req).userId, tenantId, dto);
    return { consumer };
  }
}
