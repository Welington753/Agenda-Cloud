// Rotas de clientes do estabelecimento (Lote 6D.5) — espelha
// professionals.controller.ts. Todas exigem sessão (`SessionGuard`) e passam
// o `userId` provado pelo guard adiante; o controller nunca decide
// autorização sozinho.
//
// BUSCA, CADASTRO, a LISTAGEM PAGINADA da tela de Clientes (no máximo 50
// por página, sempre do tenant provado), a LISTA AGRUPADA por telefone, a
// FICHA, o HISTÓRICO e a EDIÇÃO (docs/plans/clientes-ficha-e-duplicados.md).
// Rotas fixas (`page`, `groups`) antes de `:consumerId`.
import { Body, Controller, Get, Patch, Post, Param, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AUTH_CONTEXT_REQUEST_KEY, type IdentityContext } from '../auth/session-context.js';
import { SessionGuard } from '../auth/session.guard.js';
import {
  consumerGroupsSchema,
  consumerHistorySchema,
  consumerIdParamSchema,
  consumerPageSchema,
  consumerSearchSchema,
  createConsumerSchema,
  updateConsumerSchema,
  type ConsumerGroupsDto,
  type ConsumerHistoryDto,
  type ConsumerPageDto,
  type ConsumerSearchDto,
  type CreateConsumerDto,
  type UpdateConsumerDto,
} from './consumer.dto.js';
import { ConsumersService } from './consumers.service.js';
import { ConsumerProfileService } from './consumer-profile.service.js';

function identityOf(req: Request): IdentityContext {
  return (req as unknown as Record<string, unknown>)[
    AUTH_CONTEXT_REQUEST_KEY
  ] as IdentityContext;
}

@Controller('tenants/:tenantId/consumers')
@UseGuards(SessionGuard)
export class ConsumersController {
  constructor(
    private readonly consumersService: ConsumersService,
    private readonly profileService: ConsumerProfileService,
  ) {}

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

  /** Listagem paginada da tela de Clientes (primeira página ao abrir; a
   * busca filtra a mesma lista). Mesma autorização da busca. */
  @Get('page')
  async page(
    @Param('tenantId') tenantId: string,
    @Query(new ZodValidationPipe(consumerPageSchema)) query: ConsumerPageDto,
    @Req() req: Request,
  ) {
    return this.consumersService.listPage(identityOf(req).userId, tenantId, query);
  }

  /** Lista agrupada por telefone (rota nova; a `page` continua igual para
   * o web anterior). */
  @Get('groups')
  async groups(
    @Param('tenantId') tenantId: string,
    @Query(new ZodValidationPipe(consumerGroupsSchema)) query: ConsumerGroupsDto,
    @Req() req: Request,
  ) {
    return this.profileService.groups(identityOf(req).userId, tenantId, query);
  }

  /** Cadastro. Reenvio com a mesma `requestKey` e os mesmos dados: 200 com
   * o cadastro original (`repeated: true`); cadastro novo: 201. */
  @Post()
  async create(
    @Param('tenantId') tenantId: string,
    @Body(new ZodValidationPipe(createConsumerSchema)) dto: CreateConsumerDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const resultado = await this.consumersService.register(identityOf(req).userId, tenantId, dto);
    if (resultado.repeated) res.status(200);
    return resultado;
  }

  @Get(':consumerId')
  async profile(
    @Param('tenantId') tenantId: string,
    @Param('consumerId', new ZodValidationPipe(consumerIdParamSchema)) consumerId: string,
    @Req() req: Request,
  ) {
    return this.profileService.profile(identityOf(req).userId, tenantId, consumerId);
  }

  @Get(':consumerId/appointments')
  async history(
    @Param('tenantId') tenantId: string,
    @Param('consumerId', new ZodValidationPipe(consumerIdParamSchema)) consumerId: string,
    @Query(new ZodValidationPipe(consumerHistorySchema)) query: ConsumerHistoryDto,
    @Req() req: Request,
  ) {
    return this.profileService.history(identityOf(req).userId, tenantId, consumerId, query);
  }

  @Patch(':consumerId')
  async update(
    @Param('tenantId') tenantId: string,
    @Param('consumerId', new ZodValidationPipe(consumerIdParamSchema)) consumerId: string,
    @Body(new ZodValidationPipe(updateConsumerSchema)) dto: UpdateConsumerDto,
    @Req() req: Request,
  ) {
    const consumer = await this.consumersService.update(identityOf(req).userId, tenantId, consumerId, dto);
    return { consumer };
  }
}
