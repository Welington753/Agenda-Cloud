// Comissões do estabelecimento (dono): "Recebe comissão" e regra geral por
// profissional (um a um ou em massa), exceções por serviço e o relatório
// apurado. Sessão obrigatória; a autorização no estabelecimento é refeita
// pelo serviço em toda requisição.
import { Body, Controller, Delete, Get, Header, HttpCode, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AUTH_CONTEXT_REQUEST_KEY, type IdentityContext } from '../auth/session-context.js';
import { SessionGuard } from '../auth/session.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import {
  commissionBulkApplySchema,
  commissionBulkPreviewSchema,
  commissionReportQuerySchema,
  commissionRuleSchema,
  commissionSettingsSchema,
  professionalIdSchema,
  serviceIdSchema,
  type CommissionBulkApplyDto,
  type CommissionBulkPreviewDto,
  type CommissionReportQuery,
  type CommissionRuleDto,
  type CommissionSettingsDto,
} from './commissions.dto.js';
import { CommissionsService } from './commissions.service.js';

type AuthenticatedRequest = Request & { [AUTH_CONTEXT_REQUEST_KEY]: IdentityContext };
const identidade = (req: AuthenticatedRequest) => req[AUTH_CONTEXT_REQUEST_KEY];
const profissionalPipe = new ZodValidationPipe(professionalIdSchema);
const servicoPipe = new ZodValidationPipe(serviceIdSchema);

@Controller('tenants/:tenantId/commissions')
@UseGuards(SessionGuard)
export class CommissionsController {
  constructor(private readonly commissions: CommissionsService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  report(
    @Req() req: AuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Query(new ZodValidationPipe(commissionReportQuerySchema)) query: CommissionReportQuery,
  ) {
    return this.commissions.report(identidade(req).userId, tenantId, query);
  }

  /** "Recebe comissão" de cada profissional (lista de profissionais). */
  @Get('settings')
  @Header('Cache-Control', 'private, no-store')
  settingsSummary(@Req() req: AuthenticatedRequest, @Param('tenantId') tenantId: string) {
    return this.commissions.settingsSummary(identidade(req).userId, tenantId);
  }

  /** "Recebe comissão" e regra geral de um profissional. Caminho próprio:
   * `rules/:professionalId/:serviceId` aceitaria qualquer id no lugar. */
  @Put('settings/:professionalId')
  @Header('Cache-Control', 'private, no-store')
  setSettings(
    @Req() req: AuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Param('professionalId', profissionalPipe) professionalId: string,
    @Body(new ZodValidationPipe(commissionSettingsSchema)) dto: CommissionSettingsDto,
  ) {
    return this.commissions.setSettings(identidade(req).userId, tenantId, professionalId, dto);
  }

  /** Prévia da aplicação em massa da regra geral: nada é gravado. */
  @Post('bulk-settings/preview')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  previewBulkSettings(
    @Req() req: AuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Body(new ZodValidationPipe(commissionBulkPreviewSchema)) dto: CommissionBulkPreviewDto,
  ) {
    return this.commissions.previewBulkSettings(identidade(req).userId, tenantId, dto);
  }

  /** Aplica a regra geral a vários profissionais, com a impressão da prévia. */
  @Post('bulk-settings')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  applyBulkSettings(
    @Req() req: AuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Body(new ZodValidationPipe(commissionBulkApplySchema)) dto: CommissionBulkApplyDto,
  ) {
    return this.commissions.applyBulkSettings(identidade(req).userId, tenantId, dto);
  }

  @Get('rules/:professionalId')
  @Header('Cache-Control', 'private, no-store')
  rules(
    @Req() req: AuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Param('professionalId', profissionalPipe) professionalId: string,
  ) {
    return this.commissions.rules(identidade(req).userId, tenantId, professionalId);
  }

  @Put('rules/:professionalId/:serviceId')
  @Header('Cache-Control', 'private, no-store')
  setRule(
    @Req() req: AuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Param('professionalId', profissionalPipe) professionalId: string,
    @Param('serviceId', servicoPipe) serviceId: string,
    @Body(new ZodValidationPipe(commissionRuleSchema)) dto: CommissionRuleDto,
  ) {
    return this.commissions.setRule(identidade(req).userId, tenantId, professionalId, serviceId, dto);
  }

  @Delete('rules/:professionalId/:serviceId')
  @Header('Cache-Control', 'private, no-store')
  clearRule(
    @Req() req: AuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Param('professionalId', profissionalPipe) professionalId: string,
    @Param('serviceId', servicoPipe) serviceId: string,
  ) {
    return this.commissions.clearRule(identidade(req).userId, tenantId, professionalId, serviceId);
  }
}
