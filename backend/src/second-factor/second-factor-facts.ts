// Leitura dos fatos de segundo fator de UMA sessão, relida do banco a cada
// requisição (guard, rota de estado, troca de senha e serviço). SQL explícito:
// as colunas novas não estão nas entidades (como `reauthenticated_at`).
import type { EntityManager } from 'typeorm';
import type { SecondFactorEnforcement } from './second-factor-config.js';
import { secondFactorStatus, type SecondFactorFacts, type SecondFactorStatus } from './second-factor-state.js';

export interface SessionSecondFactor {
  userId: string;
  name: string;
  email: string | null;
  emailVerified: boolean;
  platformRole: string | null;
  userActive: boolean;
  verifiedAt: Date | null;
  reauthenticatedAt: Date | null;
  facts: SecondFactorFacts;
  status: SecondFactorStatus;
}

interface Linha {
  name: string;
  email: string | null;
  email_verified: boolean;
  status: string;
  platform_role: string | null;
  second_factor_enrollment_required: boolean;
  second_factor_verified_at: Date | null;
  second_factor_enrollment_allowed_until: Date | null;
  reauthenticated_at: Date | null;
  expires_at: Date;
  factor_active: boolean;
  grant_pending: boolean;
}

/** `null`: sessão revogada, de outra conta ou inexistente. */
export async function loadSessionSecondFactor(
  manager: EntityManager,
  userId: string,
  sessionId: string,
  enforcement: SecondFactorEnforcement,
  now: Date,
): Promise<SessionSecondFactor | null> {
  const [l] = await manager.query<Linha[]>(
    `SELECT u.name, u.email::text AS email, u.email_verified, u.status::text AS status, u.platform_role::text AS platform_role,
            u.second_factor_enrollment_required,
            s.second_factor_verified_at, s.second_factor_enrollment_allowed_until, s.reauthenticated_at, s.expires_at,
            EXISTS (SELECT 1 FROM user_second_factors f WHERE f.user_id = u.id) AS factor_active,
            EXISTS (SELECT 1 FROM second_factor_grants g
                     WHERE g.user_id = u.id AND g.used_at IS NULL AND g.revoked_at IS NULL AND g.expires_at > $3) AS grant_pending
       FROM users u
       JOIN sessions s ON s.id = $2 AND s.user_id = u.id AND s.revoked_at IS NULL
      WHERE u.id = $1`,
    [userId, sessionId, now],
  );
  if (!l) return null;
  const facts: SecondFactorFacts = {
    hasPlatformRole: l.platform_role !== null,
    factorActive: l.factor_active,
    enrollmentRequired: l.second_factor_enrollment_required,
    enforcement,
    verifiedAt: l.second_factor_verified_at,
    sessionExpiresAt: l.expires_at,
    enrollmentAllowedUntil: l.second_factor_enrollment_allowed_until,
    grantPending: l.grant_pending,
    now,
  };
  return {
    userId,
    name: l.name,
    email: l.email,
    emailVerified: l.email_verified,
    platformRole: l.platform_role,
    userActive: l.status === 'ACTIVE',
    verifiedAt: l.second_factor_verified_at,
    reauthenticatedAt: l.reauthenticated_at,
    facts,
    status: secondFactorStatus(facts),
  };
}
