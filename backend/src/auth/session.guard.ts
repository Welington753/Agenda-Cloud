// Guard de sessão (Lote 6B.4/6B.5) — protege GET /auth/me. Só leitura: usa
// `dataSource.manager` (sem transação, auto-commit por consulta), nunca
// escreve nada. Resolve TUDO que o controller precisa (user/tenant/unit/
// membership/plan/trial já sanitizados) e anexa em `request[AUTH_CONTEXT_
// REQUEST_KEY]` — o controller nunca repete essas consultas.
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { DataSource } from 'typeorm';
import { Membership } from '../entities/membership.entity.js';
import { Plan } from '../entities/plan.entity.js';
import { Session } from '../entities/session.entity.js';
import { Tenant } from '../entities/tenant.entity.js';
import { Unit } from '../entities/unit.entity.js';
import { User } from '../entities/user.entity.js';
import { UserStatus } from '../entities/enums/user-status.enum.js';
import { SESSION_COOKIE_NAME } from '../config/session-cookie.config.js';
import { AmbiguousSessionContextError } from './auth.errors.js';
import { AUTH_CONTEXT_REQUEST_KEY, type AuthenticatedContext } from './session-context.js';
import { hashSessionToken, isValidSessionTokenFormat } from './session-token.js';
import { isTenantUsableForSession } from './tenant-access.js';
import { TRIAL_DURATION_DAYS, computeTrialWindow } from './trial-policy.js';

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

    const memberships = await manager.find(Membership, { where: { userId: user.id } });
    if (memberships.length !== 1) {
      // Ver AmbiguousSessionContextError: nunca escolhe um tenant arbitrário.
      throw new AmbiguousSessionContextError();
    }
    const membership = memberships[0];

    const tenant = await manager.findOne(Tenant, { where: { id: membership.tenantId } });
    if (!tenant || !isTenantUsableForSession(tenant.status)) {
      throw new UnauthorizedException(GENERIC_UNAUTHORIZED_MESSAGE);
    }

    const unit = await manager.findOne(Unit, { where: { tenantId: tenant.id, isPrimary: true } });
    const plan = await manager.findOne(Plan, { where: { id: tenant.planId } });
    if (!plan) {
      throw new UnauthorizedException(GENERIC_UNAUTHORIZED_MESSAGE);
    }
    const { trialStartAt, trialEndAt } = computeTrialWindow(tenant.createdAt);

    const authContext: AuthenticatedContext = {
      user: { id: user.id, name: user.name, email: user.email },
      tenant: { id: tenant.id, slug: tenant.slug, status: tenant.status },
      unit: unit ? { id: unit.id, name: unit.name, isPrimary: unit.isPrimary } : null,
      membership: { id: membership.id, role: membership.role },
      plan: { code: plan.code, name: plan.name, priceCents: plan.priceCents },
      trial: { trialStartAt, trialEndAt, durationDays: TRIAL_DURATION_DAYS },
    };
    (request as unknown as Record<string, unknown>)[AUTH_CONTEXT_REQUEST_KEY] = authContext;

    return true;
  }
}
