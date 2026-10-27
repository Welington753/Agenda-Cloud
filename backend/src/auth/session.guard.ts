// Guard de sessão (Lote 6B.4, revisado no 6B.6) — protege GET /auth/me. Só
// autentica IDENTIDADE: sessão válida (não expirada, não revogada) + usuário
// ativo. Nunca toca Membership/Tenant/Unit/Plan/Credential — resolver quais
// estabelecimentos o usuário pode usar é responsabilidade de
// `AuthService.getSessionContext`, chamada pelo controller depois deste
// guard autorizar (ver auditoria multi-tenant, session-context.ts). Um
// usuário com zero, um ou vários vínculos de estabelecimento autentica
// exatamente da mesma forma — nunca é motivo de 401 nem de erro nenhum
// aqui.
//
// SENHA TEMPORÁRIA (StaffLogin): enquanto a conta tiver
// `must_change_password`, só as rotas marcadas com
// `@PermiteSenhaTemporaria()` (a sessão e a troca de senha) passam; todas as
// outras respondem 403 `TROCA_DE_SENHA_OBRIGATORIA`, relido a cada
// requisição. É o servidor que segura as áreas operacionais, não a tela.
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Optional,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { DataSource } from 'typeorm';
import { Session } from '../entities/session.entity.js';
import { User } from '../entities/user.entity.js';
import { UserStatus } from '../entities/enums/user-status.enum.js';
import { SESSION_COOKIE_NAME } from '../config/session-cookie.config.js';
import { AUTH_CONTEXT_REQUEST_KEY, type IdentityContext } from './session-context.js';
import { hashSessionToken, isValidSessionTokenFormat } from './session-token.js';

const GENERIC_UNAUTHORIZED_MESSAGE = 'Não autenticado.';

export const TROCA_DE_SENHA_OBRIGATORIA = 'TROCA_DE_SENHA_OBRIGATORIA';
const PERMITE_SENHA_TEMPORARIA = 'permiteSenhaTemporaria';

/** Rota que funciona com senha temporária (sessão e troca de senha). */
export const PermiteSenhaTemporaria = () => SetMetadata(PERMITE_SENHA_TEMPORARIA, true);

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly dataSource: DataSource,
    @Optional() private readonly reflector?: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const rawToken = (request.cookies as Record<string, string> | undefined)?.[
      SESSION_COOKIE_NAME
    ];

    if (!rawToken || !isValidSessionTokenFormat(rawToken)) {
      throw new UnauthorizedException(GENERIC_UNAUTHORIZED_MESSAGE);
    }

    const manager = this.dataSource.manager;
    const tokenHash = hashSessionToken(rawToken);

    const session = await manager.findOne(Session, { where: { tokenHash } });
    if (!session || session.revokedAt || session.expiresAt <= new Date()) {
      throw new UnauthorizedException(GENERIC_UNAUTHORIZED_MESSAGE);
    }

    const user = await manager.findOne(User, { where: { id: session.userId } });
    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException(GENERIC_UNAUTHORIZED_MESSAGE);
    }

    const [senha] = await manager.query<{ must_change_password: boolean }[]>(
      'SELECT must_change_password FROM users WHERE id = $1',
      [user.id],
    );
    if (senha?.must_change_password === true) {
      const permitida =
        this.reflector?.getAllAndOverride<boolean>(PERMITE_SENHA_TEMPORARIA, [context.getHandler(), context.getClass()]) ===
        true;
      if (!permitida) {
        throw new ForbiddenException({
          code: TROCA_DE_SENHA_OBRIGATORIA,
          message: 'Troque a senha temporária antes de continuar.',
        });
      }
    }

    const identity: IdentityContext = { userId: user.id, sessionId: session.id };
    (request as unknown as Record<string, unknown>)[AUTH_CONTEXT_REQUEST_KEY] = identity;

    return true;
  }
}
