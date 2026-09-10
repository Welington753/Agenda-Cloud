// POST /auth/register, POST /auth/login, GET /auth/me, POST /auth/logout —
// mesma disciplina em todos: cookie só depois do serviço resolver (ou seja,
// depois do COMMIT da transação, ver auth.service.ts); qualquer erro lançado
// pelo serviço nunca chega perto de `res.cookie`.
import {
  Body,
  Controller,
  ConflictException,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import {
  SESSION_COOKIE_NAME,
  buildClearSessionCookieOptions,
  buildSessionCookieOptions,
} from '../config/session-cookie.config.js';
import { EmailAlreadyInUseError, InvalidCredentialsError, PlanUnavailableError } from './auth.errors.js';
import { AuthService } from './auth.service.js';
import { loginSchema, type LoginDto } from './login.dto.js';
import { registerSchema, type RegisterDto } from './register.dto.js';
import { AUTH_CONTEXT_REQUEST_KEY, type AuthenticatedContext } from './session-context.js';
import { SessionGuard } from './session.guard.js';

const GENERIC_INVALID_CREDENTIALS_MESSAGE = 'Não foi possível entrar com essas credenciais.';

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

  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    let result;
    try {
      result = await this.authService.login(dto, {
        now: new Date(),
        userAgent: req.get('user-agent'),
        ipAddress: req.ip,
      });
    } catch (error) {
      if (error instanceof InvalidCredentialsError) {
        throw new UnauthorizedException(GENERIC_INVALID_CREDENTIALS_MESSAGE);
      }
      // Inclui AmbiguousSessionContextError e qualquer erro desconhecido —
      // nunca uma resposta customizada, deixa o filtro padrão do Nest agir
      // (500 genérico, sem stack/detalhe de banco).
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

  @Get('me')
  @UseGuards(SessionGuard)
  me(@Req() req: Request) {
    // O guard já resolveu e anexou tudo — nenhuma consulta própria aqui
    // (nunca duplica o trabalho do guard, ver session.guard.ts).
    const auth = (req as unknown as Record<string, unknown>)[
      AUTH_CONTEXT_REQUEST_KEY
    ] as AuthenticatedContext;

    return {
      user: auth.user,
      tenant: auth.tenant,
      unit: auth.unit,
      membership: auth.membership,
      plan: auth.plan,
      trial: auth.trial,
    };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const token = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE_NAME];
    // Idempotente por natureza no serviço — nenhum cookie/token/estado da
    // sessão nunca aparece no retorno (sempre 204, ver auth.service.ts).
    await this.authService.logout(token);

    const nodeEnv = this.configService.getOrThrow<string>('NODE_ENV');
    res.clearCookie(SESSION_COOKIE_NAME, buildClearSessionCookieOptions(nodeEnv));
  }
}
