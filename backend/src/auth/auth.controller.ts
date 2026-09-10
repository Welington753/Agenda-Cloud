// POST /auth/register — único endpoint deste lote. Cookie só é emitido depois
// de `authService.register` resolver (ou seja, depois do COMMIT da
// transação, ver auth.service.ts); qualquer erro lançado pelo serviço nunca
// chega perto de `res.cookie`. Login/logout/me ficam para o Lote 6B.4 (ver
// docs/plans/mvp-agendamento-pequenos-negocios.md).
import {
  Body,
  Controller,
  ConflictException,
  HttpCode,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import {
  SESSION_COOKIE_NAME,
  buildSessionCookieOptions,
} from '../config/session-cookie.config.js';
import { EmailAlreadyInUseError, PlanUnavailableError } from './auth.errors.js';
import { AuthService } from './auth.service.js';
import { registerSchema, type RegisterDto } from './register.dto.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Post('register')
  @HttpCode(201)
  async register(
    @Body(new ZodValidationPipe(registerSchema)) dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    let result;
    try {
      result = await this.authService.register(dto, {
        now: new Date(),
        userAgent: req.get('user-agent'),
        ipAddress: req.ip,
      });
    } catch (error) {
      if (error instanceof EmailAlreadyInUseError) {
        throw new ConflictException('E-mail já cadastrado.');
      }
      if (error instanceof PlanUnavailableError) {
        throw new ServiceUnavailableException('Cadastro temporariamente indisponível.');
      }
      throw error;
    }

    const nodeEnv = this.configService.getOrThrow<string>('NODE_ENV');
    res.cookie(SESSION_COOKIE_NAME, result.token, buildSessionCookieOptions(nodeEnv));

    return {
      user: result.user,
      tenant: result.tenant,
      unit: result.unit,
      membership: result.membership,
      plan: result.plan,
      trial: result.trial,
    };
  }
}
