import {
  Controller,
  Get,
  Header,
  Param,
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
  establishmentIdSchema,
  establishmentQuerySchema,
  type EstablishmentQuery,
} from './platform.dto.js';
import { PlatformService } from './platform.service.js';

type AuthenticatedRequest = Request & {
  [AUTH_CONTEXT_REQUEST_KEY]: IdentityContext;
};

@Controller('platform')
@UseGuards(SessionGuard)
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

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
}
