// Rota da consulta de disponibilidade (Lote 6D.4) — sub-recurso de
// `professionals`, na mesma convenção de
// `tenants/:tenantId/professionals/:professionalId/schedule` (Lote 6D.3).
//
// `GET` porque é consulta pura: não cria nem altera nada, é repetível e
// cacheável pelo cliente se ele quiser. NÃO existe rota pública neste lote —
// `SessionGuard` protege esta, e só ela.
//
// O controller nunca decide autorização: repassa o `userId` provado pelo
// guard, e quem confirma o vínculo com o estabelecimento é o serviço.
import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AUTH_CONTEXT_REQUEST_KEY, type IdentityContext } from '../auth/session-context.js';
import { SessionGuard } from '../auth/session.guard.js';
import { availabilityQuerySchema, type AvailabilityQueryDto } from './availability.dto.js';
import { AvailabilityService } from './availability.service.js';

function identityOf(req: Request): IdentityContext {
  return (req as unknown as Record<string, unknown>)[
    AUTH_CONTEXT_REQUEST_KEY
  ] as IdentityContext;
}

@Controller('tenants/:tenantId/professionals/:professionalId/availability')
@UseGuards(SessionGuard)
export class AvailabilityController {
  constructor(private readonly availability: AvailabilityService) {}

  @Get()
  async consult(
    @Param('tenantId') tenantId: string,
    @Param('professionalId') professionalId: string,
    @Query(new ZodValidationPipe(availabilityQuerySchema)) query: AvailabilityQueryDto,
    @Req() req: Request,
  ) {
    const availability = await this.availability.consult(
      identityOf(req).userId,
      tenantId,
      professionalId,
      query,
    );
    return { availability };
  }
}
