// Visão geral e listagem comercial do portal da plataforma. Funções puras:
// sem Nest, sem banco e sem relógio do processo (docs/plans/
// portal-visao-geral-e-listagem.md).
//
// UMA regra de acesso só, a mesma da operação:
// - situação administrativa: só TRIAL e ACTIVE operam
//   (`isTenantUsableForSession`); suspenso, arquivado, cancelado e
//   inadimplente antigo não operam, com qualquer validade;
// - validade (assinatura do Agenda Cloud): `accessSituation`, com teste,
//   período pago, cortesia, "sem vencimento", legado e renovações já
//   registradas.
// Nada aqui conta estabelecimentos por status ou datas sem passar por essas
// duas funções. TRIAL é modalidade da validade (teste gratuito), não conta
// inativa.
//
// Preço: a condição de cada ciclo é a de `cyclePricing` (contrato em vigor,
// senão catálogo, senão pendente). O último pagamento nunca vira contrato.
import { isTenantUsableForSession } from '../auth/tenant-access.js';
import type { TenantStatus } from '../entities/enums/tenant-status.enum.js';
import {
  accessSituation,
  localDate,
  type AccessFlags,
  type AccessPeriodKind,
  type AccessState,
  type BillingCycle,
  type StoredPeriod,
} from '../commercial/access-periods.js';
import { BILLING_CYCLES, cyclePricing, type CyclePricing } from '../commercial/pricing.js';
import type { DataLocal } from '../availability/time-zone.js';

/** Fuso dos totais da plataforma (mês dos pagamentos). A validade de cada
 * estabelecimento usa o fuso dele. */
export const PLATFORM_TIME_ZONE = 'America/Sao_Paulo';

/** "Termina nos próximos 7 dias": o último dia coberto está entre hoje e
 * hoje + 6, no fuso do estabelecimento (o acesso deixa de valer até a
 * meia-noite de hoje + 7). */
export const EXPIRING_WINDOW_DAYS = 7;

export const isoDate = (d: DataLocal) =>
  `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;

/** Dias de calendário de `de` até `ate` (negativo se `ate` vem antes). */
export function daysBetween(de: DataLocal, ate: DataLocal): number {
  return Math.round((Date.UTC(ate.year, ate.month - 1, ate.day) - Date.UTC(de.year, de.month - 1, de.day)) / 86_400_000);
}

/**
 * - `ALLOWED`: opera agora;
 * - `BLOCKED_STATUS`: situação administrativa fora de operação (prevalece
 *   sobre qualquer validade, como na operação);
 * - `BLOCKED_VALIDITY`: em operação, mas a validade bloqueia (vencida ou sem
 *   período e sem a marca de anterior).
 */
export type EffectiveAccess = 'ALLOWED' | 'BLOCKED_STATUS' | 'BLOCKED_VALIDITY';

export interface TenantAccessView {
  state: AccessState;
  legacy: boolean;
  noExpiry: boolean;
  blocked: boolean;
  validUntil: string | null;
  /** Último dia coberto, `YYYY-MM-DD` no fuso do estabelecimento. */
  lastDay: string | null;
  /** Dias de hoje até o último dia coberto (0: termina hoje). `null` sem
   * data de fim (sem vencimento, legado, vencido, ausente). */
  daysLeft: number | null;
  expiredAt: string | null;
  expiredKind: AccessPeriodKind | null;
  operational: 'ACTIVE' | 'INACTIVE';
  effective: EffectiveAccess;
}

export interface TenantAccessInput {
  status: string;
  timezone: string;
  periods: readonly StoredPeriod[];
  flags: Required<AccessFlags>;
}

export function tenantAccessView(input: TenantAccessInput, now: Date): TenantAccessView {
  const situacao = accessSituation(input.periods, now, input.flags);
  const operando = isTenantUsableForSession(input.status as TenantStatus);
  const ultimo = situacao.validUntil ? localDate(new Date(situacao.validUntil.getTime() - 1), input.timezone) : null;
  return {
    state: situacao.state,
    legacy: input.flags.legacy,
    noExpiry: input.flags.noExpiry,
    blocked: situacao.blocked,
    validUntil: situacao.validUntil?.toISOString() ?? null,
    lastDay: ultimo ? isoDate(ultimo) : null,
    daysLeft: ultimo ? daysBetween(localDate(now, input.timezone), ultimo) : null,
    expiredAt: situacao.expiredAt?.toISOString() ?? null,
    expiredKind: situacao.expiredKind,
    operational: operando ? 'ACTIVE' : 'INACTIVE',
    effective: !operando ? 'BLOCKED_STATUS' : situacao.blocked ? 'BLOCKED_VALIDITY' : 'ALLOWED',
  };
}

/** Teste, período pago ou cortesia em curso cujo último dia coberto (com as
 * renovações já registradas) cai nos próximos 7 dias. */
export function expiringSoon(view: TenantAccessView): boolean {
  return !view.blocked && view.daysLeft !== null && view.daysLeft >= 0 && view.daysLeft < EXPIRING_WINDOW_DAYS;
}

export interface CommercialSummary {
  /** Ciclo da última condição registrada para o plano atual; `null` sem
   * contrato. Nunca vem do último pagamento. */
  agreedCycle: BillingCycle | null;
  cycles: CyclePricing[];
  /** Nenhum valor contratado específico em vigor no plano atual, em nenhum
   * ciclo (segue o catálogo ou está sem preço). */
  contractPending: boolean;
}

export function commercialSummary(
  catalog: ReadonlyMap<BillingCycle, number | null>,
  contract: ReadonlyMap<BillingCycle, number | null>,
  agreedCycle: BillingCycle | null,
): CommercialSummary {
  const cycles = BILLING_CYCLES.map((c) => cyclePricing(c, catalog.get(c) ?? null, contract.get(c) ?? null));
  return { agreedCycle, cycles, contractPending: cycles.every((c) => c.contractCents === null) };
}

/**
 * Filtros da listagem, além da busca, da situação e do plano:
 * - `ACCESS_ALLOWED` / `ACCESS_BLOCKED`: acesso efetivo agora;
 * - `EXPIRING_SOON`: validade termina nos próximos 7 dias (ver acima);
 * - `VALIDITY_BLOCKED`: a validade bloqueia (vencida, ou sem período e sem a
 *   marca de anterior), com qualquer situação administrativa;
 * - `CONTRACT_PENDING`: sem valor contratado específico no plano atual.
 */
export const ESTABLISHMENT_FILTERS = [
  'ACCESS_ALLOWED',
  'ACCESS_BLOCKED',
  'EXPIRING_SOON',
  'VALIDITY_BLOCKED',
  'CONTRACT_PENDING',
] as const;
export type EstablishmentFilter = (typeof ESTABLISHMENT_FILTERS)[number];

export function matchesFilter(filter: EstablishmentFilter, view: TenantAccessView, commercial: CommercialSummary): boolean {
  switch (filter) {
    case 'ACCESS_ALLOWED':
      return view.effective === 'ALLOWED';
    case 'ACCESS_BLOCKED':
      return view.effective !== 'ALLOWED';
    case 'EXPIRING_SOON':
      return expiringSoon(view);
    case 'VALIDITY_BLOCKED':
      return view.blocked;
    case 'CONTRACT_PENDING':
      return commercial.contractPending;
  }
}

/**
 * Alcance da listagem e dos indicadores, pela marca `tenants.is_test`:
 * - `CLIENTS` (padrão): estabelecimentos que usam o SaaS (`is_test = false`);
 * - `INTERNAL`: internos e de teste (`is_test = true`), no mesmo grupo;
 * - `ALL`: todos.
 * `is_test = false` é o padrão técnico da coluna: um cadastro antigo nunca
 * conferido também cai em `CLIENTS` até alguém marcá-lo. Nada é classificado
 * automaticamente.
 */
export const ESTABLISHMENT_SCOPES = ['CLIENTS', 'INTERNAL', 'ALL'] as const;
export type EstablishmentScope = (typeof ESTABLISHMENT_SCOPES)[number];
export const DEFAULT_ESTABLISHMENT_SCOPE: EstablishmentScope = 'CLIENTS';

export function matchesScope(scope: EstablishmentScope, isTest: boolean): boolean {
  return scope === 'ALL' || (scope === 'INTERNAL') === isTest;
}

/** Condição SQL do alcance sobre `<alias>.is_test`; `null` em `ALL`. Mesma
 * regra de `matchesScope` (sem parâmetro: só literais fixos). */
export function scopeSql(scope: EstablishmentScope, alias: string): string | null {
  if (scope === 'ALL') return null;
  return `${alias}.is_test = ${scope === 'INTERNAL' ? 'true' : 'false'}`;
}

/** Mês corrente no fuso da plataforma: do dia 1 ao último dia, inclusive
 * (datas de calendário, como `payment_received_on`). */
export function monthRange(now: Date, timeZone = PLATFORM_TIME_ZONE): { month: string; from: string; to: string } {
  const hoje = localDate(now, timeZone);
  const ultimo = new Date(Date.UTC(hoje.year, hoje.month, 0)).getUTCDate();
  return {
    month: isoDate(hoje).slice(0, 7),
    from: isoDate({ ...hoje, day: 1 }),
    to: isoDate({ ...hoje, day: ultimo }),
  };
}

/**
 * Só estabelecimentos em operação administrativa (um suspenso ou arquivado
 * foi parado de propósito e aparece no total de suspensos):
 * - `VALIDITY_BLOCKED`: em operação, mas sem acesso pela validade;
 * - `EXPIRING_SOON`: validade termina nos próximos 7 dias.
 */
export type AttentionReason = 'VALIDITY_BLOCKED' | 'EXPIRING_SOON';

export function attentionReason(view: TenantAccessView): AttentionReason | null {
  if (view.operational !== 'ACTIVE') return null;
  if (view.blocked) return 'VALIDITY_BLOCKED';
  if (expiringSoon(view)) return 'EXPIRING_SOON';
  return null;
}

/** Bloqueados primeiro; depois quem termina antes. */
export function compareAttention(
  a: { reason: AttentionReason; view: TenantAccessView; id: string },
  b: { reason: AttentionReason; view: TenantAccessView; id: string },
): number {
  if (a.reason !== b.reason) return a.reason === 'VALIDITY_BLOCKED' ? -1 : 1;
  const dias = (a.view.daysLeft ?? -1) - (b.view.daysLeft ?? -1);
  return dias !== 0 ? dias : a.id.localeCompare(b.id);
}

export interface DirectoryCounts {
  total: number;
  allowed: number;
  blocked: number;
  blockedByStatus: number;
  blockedByValidity: number;
  expiringSoon: number;
  validityBlocked: number;
  suspended: number;
  contractPending: number;
  byState: Record<AccessState, number>;
}

export function directoryCounts(
  entries: Iterable<{ status: string; access: TenantAccessView; commercial: CommercialSummary }>,
): DirectoryCounts {
  const c: DirectoryCounts = {
    total: 0,
    allowed: 0,
    blocked: 0,
    blockedByStatus: 0,
    blockedByValidity: 0,
    expiringSoon: 0,
    validityBlocked: 0,
    suspended: 0,
    contractPending: 0,
    byState: { NO_EXPIRY: 0, UNTRACKED: 0, MISSING: 0, TRIAL: 0, PAID: 0, COURTESY: 0, EXPIRED: 0 },
  };
  for (const e of entries) {
    c.total += 1;
    if (e.access.effective === 'ALLOWED') c.allowed += 1;
    else c.blocked += 1;
    if (e.access.effective === 'BLOCKED_STATUS') c.blockedByStatus += 1;
    if (e.access.effective === 'BLOCKED_VALIDITY') c.blockedByValidity += 1;
    if (expiringSoon(e.access)) c.expiringSoon += 1;
    if (e.access.blocked) c.validityBlocked += 1;
    if (e.status === 'SUSPENDED') c.suspended += 1;
    if (e.commercial.contractPending) c.contractPending += 1;
    c.byState[e.access.state] += 1;
  }
  return c;
}
