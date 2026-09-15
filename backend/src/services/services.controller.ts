// Rotas de gestão de serviços (Lote 6D.1). Todas exigem sessão
// (`SessionGuard`, o mesmo de GET /auth/me) e todas passam o `userId` provado
// pelo guard para o serviço, que é quem confirma o vínculo com o
// estabelecimento — o controller nunca decide autorização sozinho.
//
// O `tenantId` aparece na URL porque o cliente precisa DIZER em qual
// estabelecimento está operando (um usuário pode ter vários). Isso não é
// autorização: `ServicesService` reconsulta a Membership a cada requisição.
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AUTH_CONTEXT_REQUEST_KEY, type IdentityContext } from '../auth/session-context.js';
import { SessionGuard } from '../auth/session.guard.js';
import {
  createServiceSchema,
  updateServiceSchema,
  type CreateServiceDto,
  type UpdateServiceDto,
} from './service.dto.js';
import { ServicesService } from './services.service.js';

function identityOf(req: Request): IdentityContext {
  return (req as unknown as Record<string, unknown>)[
    AUTH_CONTEXT_REQUEST_KEY
  ] as IdentityContext;
}

@Controller('tenants/:tenantId/services')
@UseGuards(SessionGuard)
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) {}

  @Get()
  async list(@Param('tenantId') tenantId: string, @Req() req: Request) {
    const services = await this.servicesService.list(identityOf(req).userId, tenantId);
    return { services };
  }

  @Post()
  @HttpCode(201)
  async create(
    @Param('tenantId') tenantId: string,
    @Body(new ZodValidationPipe(createServiceSchema)) dto: CreateServiceDto,
    @Req() req: Request,
  ) {
    const service = await this.servicesService.create(identityOf(req).userId, tenantId, dto);
    return { service };
  }

  @Patch(':serviceId')
  async update(
    @Param('tenantId') tenantId: string,
    @Param('serviceId') serviceId: string,
    @Body(new ZodValidationPipe(updateServiceSchema)) dto: UpdateServiceDto,
    @Req() req: Request,
  ) {
    const service = await this.servicesService.update(
      identityOf(req).userId,
      tenantId,
      serviceId,
      dto,
    );
    return { service };
  }

  /** Desativação como ação própria (nunca DELETE, nunca `active` no corpo do
   * PATCH): o registro é preservado inteiro, só a coluna `active` muda. */
  @Post(':serviceId/deactivate')
  @HttpCode(200)
  async deactivate(
    @Param('tenantId') tenantId: string,
    @Param('serviceId') serviceId: string,
    @Req() req: Request,
  ) {
    const service = await this.servicesService.deactivate(
      identityOf(req).userId,
      tenantId,
      serviceId,
    );
    return { service };
  }

  /** Reativação como ação própria, espelho de `deactivate` — nunca pelo
   * PATCH genérico (que exclui `active` de propósito, ver service.dto.ts). */
  @Post(':serviceId/reactivate')
  @HttpCode(200)
  async reactivate(
    @Param('tenantId') tenantId: string,
    @Param('serviceId') serviceId: string,
    @Req() req: Request,
  ) {
    const service = await this.servicesService.reactivate(
      identityOf(req).userId,
      tenantId,
      serviceId,
    );
    return { service };
  }
}
