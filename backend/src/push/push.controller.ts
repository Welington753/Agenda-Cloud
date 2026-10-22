// Rotas privadas das notificações Web Push. `SessionGuard` em todas; as que
// recebem endpoint também passam pela `TrustedOriginGuard` (CSRF). O endpoint
// vai sempre no CORPO (nunca na URL, que acabaria em log de acesso).
import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AUTH_CONTEXT_REQUEST_KEY, type IdentityContext } from '../auth/session-context.js';
import { SessionGuard } from '../auth/session.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import {
  pushEndpointSchema,
  pushSubscriptionSchema,
  type PushEndpointDto,
  type PushSubscriptionDto,
} from './push.dto.js';
import { PushService } from './push.service.js';
import { TrustedOriginGuard } from './trusted-origin.guard.js';

function identityOf(req: Request): IdentityContext {
  return (req as unknown as Record<string, unknown>)[AUTH_CONTEXT_REQUEST_KEY] as IdentityContext;
}

@Controller()
@UseGuards(SessionGuard)
export class PushController {
  constructor(private readonly push: PushService) {}

  @Get('push/config')
  config() {
    return { push: this.push.configuracao() };
  }

  @Put('tenants/:tenantId/push-subscription')
  @UseGuards(TrustedOriginGuard)
  async ativar(
    @Param('tenantId') tenantId: string,
    @Body(new ZodValidationPipe(pushSubscriptionSchema)) dto: PushSubscriptionDto,
    @Req() req: Request,
  ) {
    return { subscription: await this.push.ativar(identityOf(req), tenantId, dto) };
  }

  @Post('tenants/:tenantId/push-subscription/status')
  @HttpCode(200)
  @UseGuards(TrustedOriginGuard)
  async estado(
    @Param('tenantId') tenantId: string,
    @Body(new ZodValidationPipe(pushEndpointSchema)) dto: PushEndpointDto,
    @Req() req: Request,
  ) {
    return { subscription: await this.push.estado(identityOf(req), tenantId, dto.endpoint) };
  }

  @Delete('tenants/:tenantId/push-subscription')
  @UseGuards(TrustedOriginGuard)
  async desativar(
    @Param('tenantId') tenantId: string,
    @Body(new ZodValidationPipe(pushEndpointSchema)) dto: PushEndpointDto,
    @Req() req: Request,
  ) {
    return { subscription: await this.push.desativar(identityOf(req), tenantId, dto.endpoint) };
  }
}
