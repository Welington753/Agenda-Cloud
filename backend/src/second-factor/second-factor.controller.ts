// Rotas do segundo fator (TOTP) das contas de plataforma.
//
// `/auth/second-factor/*`: da PRÓPRIA conta. Só pedem a sessão (a etapa de
// senha), porque são elas que levam do login ao portal; nenhuma concede ação
// administrativa: cada uma só verifica, cadastra ou troca o fator da própria
// conta, com as exigências do serviço. Escritas passam pela
// `TrustedOriginGuard` (origem e corpo JSON) e por limite por IP
// (second-factor.module.ts). Respostas sem cache: algumas levam o segredo ou
// os códigos UMA vez.
//
// `/platform/users/:userId/second-factor/grants`: outro proprietário da
// plataforma emite uma liberação. Fica atrás do guard do portal.
import { Body, Controller, Get, Header, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { idSchema } from '../accounts/accounts.dto.js';
import { SessionGuard } from '../auth/session.guard.js';
import { AUTH_CONTEXT_REQUEST_KEY, type IdentityContext } from '../auth/session-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { TrustedOriginGuard } from '../push/trusted-origin.guard.js';
import {
  codeSchema,
  enrollmentStartSchema,
  grantIssueSchema,
  grantRedeemSchema,
  type CodeDto,
  type EnrollmentStartDto,
  type GrantIssueDto,
  type GrantRedeemDto,
} from './second-factor.dto.js';
import { PlatformSecondFactorGuard } from './second-factor.guard.js';
import { SecondFactorService } from './second-factor.service.js';

type AuthenticatedRequest = Request & { [AUTH_CONTEXT_REQUEST_KEY]: IdentityContext };

@Controller('auth/second-factor')
@UseGuards(SessionGuard)
export class SecondFactorController {
  constructor(private readonly service: SecondFactorService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  status(@Req() req: AuthenticatedRequest) {
    return this.service.status(req.auth.userId, req.auth.sessionId);
  }

  @Post('verify')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(TrustedOriginGuard)
  verify(@Req() req: AuthenticatedRequest, @Body(new ZodValidationPipe(codeSchema)) dto: CodeDto) {
    return this.service.verify(req.auth.userId, req.auth.sessionId, dto.code);
  }

  @Post('recovery')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(TrustedOriginGuard)
  recover(@Req() req: AuthenticatedRequest, @Body(new ZodValidationPipe(codeSchema)) dto: CodeDto) {
    return this.service.recover(req.auth.userId, req.auth.sessionId, dto.code);
  }

  @Post('grant')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(TrustedOriginGuard)
  redeem(@Req() req: AuthenticatedRequest, @Body(new ZodValidationPipe(grantRedeemSchema)) dto: GrantRedeemDto) {
    return this.service.redeemGrant(req.auth.userId, req.auth.sessionId, dto.token);
  }

  @Post('enrollment')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(TrustedOriginGuard)
  start(@Req() req: AuthenticatedRequest, @Body(new ZodValidationPipe(enrollmentStartSchema)) dto: EnrollmentStartDto) {
    return this.service.startEnrollment(req.auth.userId, req.auth.sessionId, dto.code);
  }

  @Post('enrollment/confirm')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(TrustedOriginGuard)
  confirm(@Req() req: AuthenticatedRequest, @Body(new ZodValidationPipe(codeSchema)) dto: CodeDto) {
    return this.service.confirmEnrollment(req.auth.userId, req.auth.sessionId, dto.code);
  }

  @Post('recovery-codes')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(TrustedOriginGuard)
  regenerate(@Req() req: AuthenticatedRequest, @Body(new ZodValidationPipe(codeSchema)) dto: CodeDto) {
    return this.service.regenerateRecoveryCodes(req.auth.userId, req.auth.sessionId, dto.code);
  }
}

@Controller('platform')
@UseGuards(SessionGuard, PlatformSecondFactorGuard)
export class SecondFactorAdminController {
  constructor(private readonly service: SecondFactorService) {}

  @Post('users/:userId/second-factor/grants')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(TrustedOriginGuard)
  issue(
    @Req() req: AuthenticatedRequest,
    @Param('userId', new ZodValidationPipe(idSchema)) userId: string,
    @Body(new ZodValidationPipe(grantIssueSchema)) dto: GrantIssueDto,
  ) {
    return this.service.issueGrant(req.auth.userId, req.auth.sessionId, userId, dto);
  }
}
