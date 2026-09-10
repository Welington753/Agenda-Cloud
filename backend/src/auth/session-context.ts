// Contexto autenticado anexado por SessionGuard à `Request` — nunca a
// entidade Credential (ver auditoria do guard, Lote 6B.4/6B.5). Tudo aqui já
// sanitizado (nada de tokenHash/passwordHash), pronto para GET /auth/me
// serializar sem nenhuma consulta extra.
import type { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import type { TenantStatus } from '../entities/enums/tenant-status.enum.js';

export interface AuthenticatedContext {
  user: { id: string; name: string; email: string };
  tenant: { id: string; slug: string; status: TenantStatus };
  unit: { id: string; name: string; isPrimary: boolean } | null;
  membership: { id: string; role: EstablishmentRole };
  plan: { code: string; name: string; priceCents: number | null };
  trial: { trialStartAt: Date; trialEndAt: Date; durationDays: number };
}

// Nome da propriedade em `Request` onde o guard anexa o contexto — uma única
// fonte de verdade para guard/controller nunca divergirem.
export const AUTH_CONTEXT_REQUEST_KEY = 'auth' as const;
