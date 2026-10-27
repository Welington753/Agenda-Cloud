// Indicadores do Início do dono. Sessão obrigatória (`SessionGuard`); a
// autorização no estabelecimento é feita pelo serviço, a cada requisição.
import { Controller, Get, Header, Param, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AUTH_CONTEXT_REQUEST_KEY, type IdentityContext } from '../auth/session-context.js';
import { SessionGuard } from '../auth/session.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { dashboardQuerySchema, type DashboardQueryDto } from './dashboard.dto.js';
import { DashboardService } from './dashboard.service.js';

function identityOf(req: Request): IdentityContext {
  return (req as unknown as Record<string, unknown>)[AUTH_CONTEXT_REQUEST_KEY] as IdentityContext;
}

@Controller('tenants/:tenantId/dashboard')
@UseGuards(SessionGuard)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  summary(
    @Param('tenantId') tenantId: string,
    @Query(new ZodValidationPipe(dashboardQuerySchema)) query: DashboardQueryDto,
    @Req() req: Request,
  ) {
    return this.dashboard.summary(identityOf(req).userId, tenantId, query);
  }
}
