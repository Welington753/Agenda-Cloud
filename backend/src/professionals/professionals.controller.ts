// Rotas de gestão de profissionais (Lote 6D.2) — espelha
// services/services.controller.ts. Todas exigem sessão (`SessionGuard`) e
// todas passam o `userId` provado pelo guard para o serviço, que é quem
// confirma o vínculo com o estabelecimento — o controller nunca decide
// autorização sozinho.
//
// O `tenantId` aparece na URL porque o cliente precisa DIZER em qual
// estabelecimento está operando. Isso não é autorização:
// `ProfessionalsService` reconsulta a Membership a cada requisição.
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AUTH_CONTEXT_REQUEST_KEY, type IdentityContext } from '../auth/session-context.js';
import { SessionGuard } from '../auth/session.guard.js';
import {
  createProfessionalSchema,
  setProfessionalServicesSchema,
  updateProfessionalSchema,
  type CreateProfessionalDto,
  type SetProfessionalServicesDto,
  type UpdateProfessionalDto,
} from './professional.dto.js';
import { ProfessionalsService } from './professionals.service.js';

function identityOf(req: Request): IdentityContext {
  return (req as unknown as Record<string, unknown>)[
    AUTH_CONTEXT_REQUEST_KEY
  ] as IdentityContext;
}

@Controller('tenants/:tenantId/professionals')
@UseGuards(SessionGuard)
export class ProfessionalsController {
  constructor(private readonly professionalsService: ProfessionalsService) {}

  @Get()
  async list(@Param('tenantId') tenantId: string, @Req() req: Request) {
    const professionals = await this.professionalsService.list(identityOf(req).userId, tenantId);
    return { professionals };
  }

  @Post()
  @HttpCode(201)
  async create(
    @Param('tenantId') tenantId: string,
    @Body(new ZodValidationPipe(createProfessionalSchema)) dto: CreateProfessionalDto,
    @Req() req: Request,
  ) {
    const professional = await this.professionalsService.create(
      identityOf(req).userId,
      tenantId,
      dto,
    );
    return { professional };
  }

  @Patch(':professionalId')
  async update(
    @Param('tenantId') tenantId: string,
    @Param('professionalId') professionalId: string,
    @Body(new ZodValidationPipe(updateProfessionalSchema)) dto: UpdateProfessionalDto,
    @Req() req: Request,
  ) {
    const professional = await this.professionalsService.update(
      identityOf(req).userId,
      tenantId,
      professionalId,
      dto,
    );
    return { professional };
  }

  /** Desativação como ação própria (nunca DELETE, nunca `active` no corpo do
   * PATCH): o registro e seus vínculos de serviço são preservados inteiros,
   * só a coluna `active` do profissional muda. */
  @Post(':professionalId/deactivate')
  @HttpCode(200)
  async deactivate(
    @Param('tenantId') tenantId: string,
    @Param('professionalId') professionalId: string,
    @Req() req: Request,
  ) {
    const professional = await this.professionalsService.deactivate(
      identityOf(req).userId,
      tenantId,
      professionalId,
    );
    return { professional };
  }

  /** Reativação — espelho de `deactivate`, nunca pelo PATCH genérico. */
  @Post(':professionalId/reactivate')
  @HttpCode(200)
  async reactivate(
    @Param('tenantId') tenantId: string,
    @Param('professionalId') professionalId: string,
    @Req() req: Request,
  ) {
    const professional = await this.professionalsService.reactivate(
      identityOf(req).userId,
      tenantId,
      professionalId,
    );
    return { professional };
  }

  /** Define o conjunto final de serviços vinculados — o servidor calcula o
   * diff (ver professionals.service.ts, `setServices`). PUT porque o corpo
   * descreve o estado final desejado, não uma ação incremental. */
  @Put(':professionalId/services')
  @HttpCode(200)
  async setServices(
    @Param('tenantId') tenantId: string,
    @Param('professionalId') professionalId: string,
    @Body(new ZodValidationPipe(setProfessionalServicesSchema)) dto: SetProfessionalServicesDto,
    @Req() req: Request,
  ) {
    const professional = await this.professionalsService.setServices(
      identityOf(req).userId,
      tenantId,
      professionalId,
      dto,
    );
    return { professional };
  }
}
