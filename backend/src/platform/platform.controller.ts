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
  changePlanSchema,
  establishmentIdSchema,
  establishmentQuerySchema,
  reactivateEstablishmentSchema,
  suspendEstablishmentSchema,
  updateEstablishmentSchema,
  type ArchiveEstablishmentDto,
  type ChangePlanDto,
  type EstablishmentQuery,
  type ReactivateEstablishmentDto,
  type SuspendEstablishmentDto,
  type UpdateEstablishmentDto,
} from './platform.dto.js';
import { PlatformService } from './platform.service.js';
import { EstablishmentAdminService } from './establishment-admin.service.js';

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
  ) {}

  @Get('access')
  @Header('Cache-Control', 'private, no-store')
  access(@Req() request: AuthenticatedRequest) {
    return this.platform.access(request.auth.userId);
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
}
