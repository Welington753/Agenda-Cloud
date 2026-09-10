// Única fonte de verdade de "este tenant pode ser usado para autenticar" —
// compartilhada entre AuthService.login e SessionGuard (GET /auth/me), nunca
// duplicada, para as duas rotas nunca divergirem sobre o que é um tenant
// "ativo o suficiente".
import { TenantStatus } from '../entities/enums/tenant-status.enum.js';

const USABLE_STATUSES: ReadonlySet<TenantStatus> = new Set([
  TenantStatus.TRIAL,
  TenantStatus.ACTIVE,
]);

export function isTenantUsableForSession(status: TenantStatus): boolean {
  return USABLE_STATUSES.has(status);
}
