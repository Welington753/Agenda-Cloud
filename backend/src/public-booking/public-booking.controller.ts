// Rotas do agendamento online.
//
// `PublicBookingController` (`/public/:slug`) é a ÚNICA superfície sem
// sessão: não usa `SessionGuard`, não lê cookie e nunca recebe `tenantId`
// (o estabelecimento vem do slug, conferido no serviço). Limites por IP em
// public-booking.module.ts.
//
// `PublicBookingAdminController` (`/tenants/:tenantId/...`) é área privada:
// `SessionGuard` e autorização por Membership no serviço, como as demais
// rotas reais. Criar rotas públicas não tirou proteção de nenhuma existente.
import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AUTH_CONTEXT_REQUEST_KEY, type IdentityContext } from '../auth/session-context.js';
import { SessionGuard } from '../auth/session.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import {
  publicAvailabilityQuerySchema,
  publicBookingRequestSchema,
  publicBookingSettingsSchema,
  publicSlugSchema,
  type PublicAvailabilityQueryDto,
  type PublicBookingRequestDto,
  type PublicBookingSettingsDto,
} from './public-booking.dto.js';
import { PublicBookingService } from './public-booking.service.js';

function identityOf(req: Request): IdentityContext {
  return (req as unknown as Record<string, unknown>)[
    AUTH_CONTEXT_REQUEST_KEY
  ] as IdentityContext;
}

@Controller('public/:slug')
export class PublicBookingController {
  constructor(private readonly publicBooking: PublicBookingService) {}

  @Get()
  async profile(@Param('slug', new ZodValidationPipe(publicSlugSchema)) slug: string) {
    return { profile: await this.publicBooking.profile(slug) };
  }

  @Get('availability')
  async availability(
    @Param('slug', new ZodValidationPipe(publicSlugSchema)) slug: string,
    @Query(new ZodValidationPipe(publicAvailabilityQuerySchema)) query: PublicAvailabilityQueryDto,
  ) {
    return { availability: await this.publicBooking.availabilityFor(slug, query) };
  }

  /** 201 para pedido novo e 200 para a repetição de um envio já gravado
   * (mesma chave): a tela distingue "recebemos agora" de "já tínhamos". */
  @Post('booking-requests')
  @HttpCode(201)
  async request(
    @Param('slug', new ZodValidationPipe(publicSlugSchema)) slug: string,
    @Body(new ZodValidationPipe(publicBookingRequestSchema)) dto: PublicBookingRequestDto,
    @Req() req: Request,
  ) {
    const receipt = await this.publicBooking.request(slug, dto);
    if (receipt.replayed) req.res?.status(200);
    return { request: receipt };
  }
}

@Controller('tenants/:tenantId')
@UseGuards(SessionGuard)
export class PublicBookingAdminController {
  constructor(private readonly publicBooking: PublicBookingService) {}

  @Get('public-booking')
  async settings(@Param('tenantId') tenantId: string, @Req() req: Request) {
    return { settings: await this.publicBooking.settings(identityOf(req).userId, tenantId) };
  }

  @Put('public-booking')
  async updateSettings(
    @Param('tenantId') tenantId: string,
    @Body(new ZodValidationPipe(publicBookingSettingsSchema)) dto: PublicBookingSettingsDto,
    @Req() req: Request,
  ) {
    return {
      settings: await this.publicBooking.updateSettings(identityOf(req).userId, tenantId, dto.enabled),
    };
  }

  /** Reservas aguardando confirmação (futuras), com a origem de cada uma.
   * Ler esta lista não muda nada: confirmar e recusar são as ações
   * explícitas de `/appointments/:id/confirm` e `/cancel`. */
  @Get('booking-requests')
  async pending(@Param('tenantId') tenantId: string, @Req() req: Request) {
    return this.publicBooking.pendingRequests(identityOf(req).userId, tenantId);
  }
}
