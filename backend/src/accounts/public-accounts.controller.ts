// Entradas PÚBLICAS de conta: aceitar convite e redefinir senha pelo link do
// e-mail. São a única forma de uma conta nova passar a entrar (o cadastro
// livre foi fechado). O token chega no CORPO de um POST (nunca na URL, que
// iria para logs); consultar um link não consome nada.
//
// Aceite com sucesso abre a sessão (cookie depois do COMMIT, como o login).
// Redefinição de senha não abre sessão: a pessoa entra com a senha nova.
import { Body, Controller, Header, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { parseClientIpSource, parseProxySecret, resolveClientIp } from '../config/client-ip.js';
import { SESSION_COOKIE_NAME, buildSessionCookieOptions } from '../config/session-cookie.config.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { acceptInviteSchema, completeResetSchema, tokenOnlySchema } from './accounts.dto.js';
import { InvitesService } from './invites.service.js';
import { PasswordResetsService } from './password-resets.service.js';

@Controller()
export class PublicAccountsController {
  constructor(
    private readonly invites: InvitesService,
    private readonly resets: PasswordResetsService,
    private readonly config: ConfigService,
  ) {}

  @Post('invites/preview')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  previewInvite(@Body(new ZodValidationPipe(tokenOnlySchema)) dto: { token: string }) {
    return this.invites.preview(dto.token);
  }

  @Post('invites/accept')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  async acceptInvite(
    @Body(new ZodValidationPipe(acceptInviteSchema)) dto: { token: string; password: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.invites.accept(dto.token, dto.password, {
      now: new Date(),
      userAgent: req.get('user-agent'),
      ipAddress: resolveClientIp(
        req,
        parseClientIpSource(this.config.get('CLIENT_IP_SOURCE')),
        parseProxySecret(this.config.get('API_PROXY_SECRET')),
      ),
    });
    res.cookie(
      SESSION_COOKIE_NAME,
      result.sessionToken,
      buildSessionCookieOptions(this.config.getOrThrow<string>('NODE_ENV')),
    );
    return { destination: result.destination };
  }

  @Post('password-resets/preview')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  previewReset(@Body(new ZodValidationPipe(tokenOnlySchema)) dto: { token: string }) {
    return this.resets.preview(dto.token);
  }

  @Post('password-resets/complete')
  @HttpCode(204)
  async completeReset(@Body(new ZodValidationPipe(completeResetSchema)) dto: { token: string; password: string }) {
    await this.resets.complete(dto.token, dto.password);
  }
}
