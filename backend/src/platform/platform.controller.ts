import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { SessionGuard } from '../auth/session.guard.js';
import {
  AUTH_CONTEXT_REQUEST_KEY,
  type IdentityContext,
} from '../auth/session-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import {
  archiveEstablishmentSchema,
  billingCycleSchema,
  catalogPriceSchema,
  contractPriceSchema,
  grantNoExpirySchema,
  revokeNoExpirySchema,
  subscriptionPaymentsQuerySchema,
  type CatalogPriceDto,
  type ContractPriceDto,
  type GrantNoExpiryDto,
  type RevokeNoExpiryDto,
  type SubscriptionPaymentsQuery,
  changePlanSchema,
  correctAccessPeriodSchema,
  extendTrialSchema,
  grantCourtesySchema,
  recordPaidPeriodSchema,
  type CorrectAccessPeriodDto,
  type ExtendTrialDto,
  type GrantCourtesyDto,
  type RecordPaidPeriodDto,
  establishmentIdSchema,
  establishmentQuerySchema,
  overviewQuerySchema,
  reportQuerySchema,
  reactivateEstablishmentSchema,
  setTestFlagSchema,
  suspendEstablishmentSchema,
  updateEstablishmentSchema,
  type ArchiveEstablishmentDto,
  type ChangePlanDto,
  type EstablishmentQuery,
  type OverviewQuery,
  type ReportQuery,
  type ReactivateEstablishmentDto,
  type SetTestFlagDto,
  type SuspendEstablishmentDto,
  type UpdateEstablishmentDto,
} from './platform.dto.js';
import { PlatformService } from './platform.service.js';
import { EstablishmentAdminService } from './establishment-admin.service.js';
import { AccessValidityService } from './access-validity.service.js';
import { AccessCorrectionService } from './access-correction.service.js';
import { NoExpiryService } from './no-expiry.service.js';
import { PricingService } from './pricing.service.js';
import type { BillingCycle } from '../commercial/access-periods.js';

const tenantIdPipe = new ZodValidationPipe(establishmentIdSchema);

type AuthenticatedRequest = Request & {
  [AUTH_CONTEXT_REQUEST_KEY]: IdentityContext;
};

@Controller('platform')
@UseGuards(SessionGuard)
export class PlatformController {
  constructor(
    private readonly platform: PlatformService,
    private readonly admin: EstablishmentAdminService,
    private readonly validity: AccessValidityService,
    private readonly correction: AccessCorrectionService,
    private readonly noExpiry: NoExpiryService,
    private readonly pricing: PricingService,
  ) {}

  @Get('access')
  @Header('Cache-Control', 'private, no-store')
  access(@Req() request: AuthenticatedRequest) {
    return this.platform.access(request.auth.userId);
  }

  /** Totais do portal com a regra central de acesso e os pagamentos de
   * assinatura do mês (só MASTER_OWNER ativo, relido no servidor). */
  @Get('overview')
  @Header('Cache-Control', 'private, no-store')
  overview(
    @Req() request: AuthenticatedRequest,
    @Query(new ZodValidationPipe(overviewQuerySchema)) query: OverviewQuery,
  ) {
    return this.platform.overview(request.auth.userId, query.scope);
  }

  /** Relatório por período: pagamentos de assinatura recebidos e cadastros
   * registrados (mesma leitura do portal, nenhuma permissão nova). */
  @Get('reports')
  @Header('Cache-Control', 'private, no-store')
  report(
    @Req() request: AuthenticatedRequest,
    @Query(new ZodValidationPipe(reportQuerySchema)) query: ReportQuery,
  ) {
    return this.platform.report(request.auth.userId, query);
  }

  @Get('establishments')
  @Header('Cache-Control', 'private, no-store')
  list(
    @Req() request: AuthenticatedRequest,
    @Query(new ZodValidationPipe(establishmentQuerySchema))
    query: EstablishmentQuery,
  ) {
    return this.platform.list(request.auth.userId, query);
  }

  @Get('establishments/:tenantId')
  @Header('Cache-Control', 'private, no-store')
  detail(
    @Req() request: AuthenticatedRequest,
    @Param('tenantId', new ZodValidationPipe(establishmentIdSchema))
    tenantId: string,
  ) {
    return this.platform.detail(request.auth.userId, tenantId);
  }

  /** Dados cadastrais. O endereço público (slug) não muda por aqui. */
  @Patch('establishments/:tenantId')
  @Header('Cache-Control', 'private, no-store')
  update(
    @Req() request: AuthenticatedRequest,
    @Param('tenantId', tenantIdPipe) tenantId: string,
    @Body(new ZodValidationPipe(updateEstablishmentSchema)) dto: UpdateEstablishmentDto,
  ) {
    return this.admin.update(request.auth.userId, tenantId, dto);
  }

  /** Marca de estabelecimento de teste (`noindex` na página pública). Só
   * conta da plataforma com `manageEstablishments`, relida no serviço. */
  @Put('establishments/:tenantId/test-flag')
  @Header('Cache-Control', 'private, no-store')
  setTestFlag(
    @Req() request: AuthenticatedRequest,
    @Param('tenantId', tenantIdPipe) tenantId: string,
    @Body(new ZodValidationPipe(setTestFlagSchema)) dto: SetTestFlagDto,
  ) {
    return this.admin.setTestFlag(request.auth.userId, tenantId, dto);
  }

  @Post('establishments/:tenantId/suspend')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  suspend(
    @Req() request: AuthenticatedRequest,
    @Param('tenantId', tenantIdPipe) tenantId: string,
    @Body(new ZodValidationPipe(suspendEstablishmentSchema)) dto: SuspendEstablishmentDto,
  ) {
    return this.admin.suspend(request.auth.userId, request.auth.sessionId, tenantId, dto);
  }

  @Post('establishments/:tenantId/archive')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  archive(
    @Req() request: AuthenticatedRequest,
    @Param('tenantId', tenantIdPipe) tenantId: string,
    @Body(new ZodValidationPipe(archiveEstablishmentSchema)) dto: ArchiveEstablishmentDto,
  ) {
    return this.admin.archive(request.auth.userId, request.auth.sessionId, tenantId, dto);
  }

  @Post('establishments/:tenantId/reactivate')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  reactivate(
    @Req() request: AuthenticatedRequest,
    @Param('tenantId', tenantIdPipe) tenantId: string,
    @Body(new ZodValidationPipe(reactivateEstablishmentSchema)) dto: ReactivateEstablishmentDto,
  ) {
    return this.admin.reactivate(request.auth.userId, request.auth.sessionId, tenantId, dto);
  }

  @Put('establishments/:tenantId/plan')
  @Header('Cache-Control', 'private, no-store')
  changePlan(
    @Req() request: AuthenticatedRequest,
    @Param('tenantId', tenantIdPipe) tenantId: string,
    @Body(new ZodValidationPipe(changePlanSchema)) dto: ChangePlanDto,
  ) {
    return this.admin.changePlan(request.auth.userId, request.auth.sessionId, tenantId, dto);
  }

  // Validade do acesso (assinatura do Agenda Cloud). Registro manual pela
  // administração; nenhuma confirmação automática de banco ou operadora.

  @Post('establishments/:tenantId/access/paid')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  recordPaid(
    @Req() request: AuthenticatedRequest,
    @Param('tenantId', tenantIdPipe) tenantId: string,
    @Body(new ZodValidationPipe(recordPaidPeriodSchema)) dto: RecordPaidPeriodDto,
  ) {
    return this.validity.recordPaid(request.auth.userId, request.auth.sessionId, tenantId, dto);
  }

  @Post('establishments/:tenantId/access/trial-extension')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  extendTrial(
    @Req() request: AuthenticatedRequest,
    @Param('tenantId', tenantIdPipe) tenantId: string,
    @Body(new ZodValidationPipe(extendTrialSchema)) dto: ExtendTrialDto,
  ) {
    return this.validity.extendTrial(request.auth.userId, request.auth.sessionId, tenantId, dto);
  }

  @Post('establishments/:tenantId/access/courtesy')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  grantCourtesy(
    @Req() request: AuthenticatedRequest,
    @Param('tenantId', tenantIdPipe) tenantId: string,
    @Body(new ZodValidationPipe(grantCourtesySchema)) dto: GrantCourtesyDto,
  ) {
    return this.validity.grantCourtesy(request.auth.userId, request.auth.sessionId, tenantId, dto);
  }

  /** Anula um período registrado por engano. Corrige o registro; não
   * devolve nem movimenta dinheiro. */
  @Post('establishments/:tenantId/access/periods/:periodId/correction')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  correctPeriod(
    @Req() request: AuthenticatedRequest,
    @Param('tenantId', tenantIdPipe) tenantId: string,
    @Param('periodId', tenantIdPipe) periodId: string,
    @Body(new ZodValidationPipe(correctAccessPeriodSchema)) dto: CorrectAccessPeriodDto,
  ) {
    return this.correction.cancelPeriod(request.auth.userId, request.auth.sessionId, tenantId, periodId, dto);
  }

  // Portal da plataforma: "sem vencimento", preços e pagamentos das
  // assinaturas (docs/plans/portal-da-plataforma.md).

  @Post('establishments/:tenantId/access/no-expiry')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  grantNoExpiry(
    @Req() request: AuthenticatedRequest,
    @Param('tenantId', tenantIdPipe) tenantId: string,
    @Body(new ZodValidationPipe(grantNoExpirySchema)) dto: GrantNoExpiryDto,
  ) {
    return this.noExpiry.grant(request.auth.userId, request.auth.sessionId, tenantId, dto);
  }

  @Post('establishments/:tenantId/access/no-expiry/revoke')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  revokeNoExpiry(
    @Req() request: AuthenticatedRequest,
    @Param('tenantId', tenantIdPipe) tenantId: string,
    @Body(new ZodValidationPipe(revokeNoExpirySchema)) dto: RevokeNoExpiryDto,
  ) {
    return this.noExpiry.revoke(request.auth.userId, request.auth.sessionId, tenantId, dto);
  }

  /** Valor contratado com o cliente. Não registra pagamento. */
  @Put('establishments/:tenantId/contract-price')
  @Header('Cache-Control', 'private, no-store')
  setContractPrice(
    @Req() request: AuthenticatedRequest,
    @Param('tenantId', tenantIdPipe) tenantId: string,
    @Body(new ZodValidationPipe(contractPriceSchema)) dto: ContractPriceDto,
  ) {
    return this.pricing.setContractPrice(request.auth.userId, request.auth.sessionId, tenantId, dto);
  }

  @Get('prices')
  @Header('Cache-Control', 'private, no-store')
  prices(@Req() request: AuthenticatedRequest) {
    return this.pricing.catalog(request.auth.userId);
  }

  @Put('plans/:planId/prices/:cycle')
  @Header('Cache-Control', 'private, no-store')
  setCatalogPrice(
    @Req() request: AuthenticatedRequest,
    @Param('planId', tenantIdPipe) planId: string,
    @Param('cycle', new ZodValidationPipe(billingCycleSchema)) cycle: BillingCycle,
    @Body(new ZodValidationPipe(catalogPriceSchema)) dto: CatalogPriceDto,
  ) {
    return this.pricing.setCatalogPrice(request.auth.userId, request.auth.sessionId, planId, cycle, dto);
  }

  /** Pagamentos das assinaturas do Agenda Cloud (nunca recebimentos dos
   * atendimentos dos estabelecimentos). */
  @Get('subscription-payments')
  @Header('Cache-Control', 'private, no-store')
  subscriptionPayments(
    @Req() request: AuthenticatedRequest,
    @Query(new ZodValidationPipe(subscriptionPaymentsQuerySchema)) query: SubscriptionPaymentsQuery,
  ) {
    return this.pricing.subscriptionPayments(request.auth.userId, query);
  }
}
