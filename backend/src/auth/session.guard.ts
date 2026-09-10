// Guard de sessão (Lote 6B.4, revisado no 6B.6) — protege GET /auth/me. Só
// autentica IDENTIDADE: sessão válida (não expirada, não revogada) + usuário
// ativo. Nunca toca Membership/Tenant/Unit/Plan/Credential — resolver quais
// estabelecimentos o usuário pode usar é responsabilidade de
// `AuthService.getSessionContext`, chamada pelo controller depois deste
// guard autorizar (ver auditoria multi-tenant, session-context.ts). Um
// usuário com zero, um ou vários vínculos de estabelecimento autentica
// exatamente da mesma forma — nunca é motivo de 401 nem de erro nenhum
// aqui.
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { DataSource } from 'typeorm';
import { Session } from '../entities/session.entity.js';
import { User } from '../entities/user.entity.js';
import { UserStatus } from '../entities/enums/user-status.enum.js';
import { SESSION_COOKIE_NAME } from '../config/session-cookie.config.js';
import { AUTH_CONTEXT_REQUEST_KEY, type IdentityContext } from './session-context.js';
import { hashSessionToken, isValidSessionTokenFormat } from './session-token.js';

const GENERIC_UNAUTHORIZED_MESSAGE = 'Não autenticado.';

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly dataSource: DataSource) {}

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

    const identity: IdentityContext = { userId: user.id, sessionId: session.id };
    (request as unknown as Record<string, unknown>)[AUTH_CONTEXT_REQUEST_KEY] = identity;

    return true;
  }
}
