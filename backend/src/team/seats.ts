// Vagas de acesso de funcionário e limite de profissionais, ambos pelo
// `plans.max_professionals` do plano do estabelecimento.
//
// REGRA DAS VAGAS
//
// - Cada acesso de funcionário (vínculo `PROFISSIONAL`) fica ligado a UM
//   profissional do estabelecimento; cada profissional tem no máximo um
//   acesso (índice único em `memberships.professional_id`) ou um convite
//   pendente (`uq_invites_pending_professional`).
// - Ocupam vaga: acessos de funcionário ATIVOS + convites de funcionário
//   pendentes e dentro do prazo. Acesso suspenso não ocupa; reativar confere
//   a vaga de novo. Convite revogado ou vencido libera; reenviar não ocupa
//   outra (o mesmo convite continua sendo um só).
// - O acesso de DONO não ocupa vaga de funcionário. Se o dono também é um
//   profissional da agenda, esse cadastro conta no limite de profissionais
//   como qualquer outro.
// - Ligar um login a um profissional existente não cria profissional nem
//   conta duas vezes: o limite de profissionais conta `professionals` ativos;
//   o de acessos conta vínculos e convites.
//
// CONCORRÊNCIA: toda operação que pode ocupar vaga ou profissional (convite,
// aceite, reativação de acesso, reenvio de convite vencido, criação e
// reativação de profissional, troca de plano) trava antes a linha do
// estabelecimento com `FOR NO KEY UPDATE`. Duas operações disputando a última
// vaga ficam em fila: a segunda já conta a primeira. `NO KEY` não bloqueia as
// gravações comuns que só referenciam o estabelecimento (FK, `FOR KEY SHARE`).
import { NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { TENANT_NOT_FOUND_MESSAGE } from '../common/tenant-authorization.js';

export const OPERATIONAL_TENANT_STATUSES = ['TRIAL', 'ACTIVE'] as const;

export interface LockedTenant {
  id: string;
  name: string;
  status: string;
  plan: { id: string; name: string; maxProfessionals: number; maxUnits: number };
}

export interface SeatUsage {
  limit: number;
  activeAccesses: number;
  pendingInvites: number;
  suspendedAccesses: number;
  used: number;
  available: number;
}

export async function lockTenantForSeats(manager: EntityManager, tenantId: string): Promise<LockedTenant> {
  const [linha] = await manager.query<
    { id: string; status: string; plan_id: string; plan_name: string; max_professionals: number; max_units: number }[]
  >(
    `SELECT t.id, t.status::text AS status, p.id AS plan_id, p.name AS plan_name, p.max_professionals, p.max_units
       FROM tenants t JOIN plans p ON p.id = t.plan_id
      WHERE t.id = $1 FOR NO KEY UPDATE OF t`,
    [tenantId],
  );
  if (!linha) throw new NotFoundException(TENANT_NOT_FOUND_MESSAGE);
  const [unidade] = await manager.query<{ name: string }[]>(
    `SELECT COALESCE((SELECT name FROM units WHERE tenant_id = $1 AND is_primary = true ORDER BY created_at, id LIMIT 1),
       (SELECT slug::text FROM tenants WHERE id = $1)) AS name`,
    [tenantId],
  );
  return {
    id: linha.id,
    name: unidade.name,
    status: linha.status,
    plan: {
      id: linha.plan_id,
      name: linha.plan_name,
      maxProfessionals: linha.max_professionals,
      maxUnits: linha.max_units,
    },
  };
}

export function isOperational(status: string): boolean {
  return (OPERATIONAL_TENANT_STATUSES as readonly string[]).includes(status);
}

/** Uso atual das vagas. `excludeInviteId`: o convite que está sendo aceito ou
 * reenviado, para não contar a si mesmo. */
export async function staffSeatUsage(
  manager: EntityManager,
  tenantId: string,
  limit: number,
  now: Date,
  excludeInviteId: string | null = null,
): Promise<SeatUsage> {
  const [vinculos] = await manager.query<{ ativos: number; suspensos: number }[]>(
    `SELECT count(*) FILTER (WHERE status = 'ACTIVE')::int AS ativos,
            count(*) FILTER (WHERE status <> 'ACTIVE')::int AS suspensos
       FROM memberships WHERE tenant_id = $1 AND role = 'PROFISSIONAL'`,
    [tenantId],
  );
  const [convites] = await manager.query<{ pendentes: number }[]>(
    `SELECT count(*)::int AS pendentes FROM invites
      WHERE tenant_id = $1 AND establishment_role = 'PROFISSIONAL' AND status = 'PENDING' AND expires_at > $2
        AND id IS DISTINCT FROM $3`,
    [tenantId, now, excludeInviteId],
  );
  const used = vinculos.ativos + convites.pendentes;
  return {
    limit,
    activeAccesses: vinculos.ativos,
    pendingInvites: convites.pendentes,
    suspendedAccesses: vinculos.suspensos,
    used,
    available: Math.max(0, limit - used),
  };
}

export async function activeProfessionals(manager: EntityManager, tenantId: string): Promise<number> {
  const [linha] = await manager.query<{ total: number }[]>(
    `SELECT count(*)::int AS total FROM professionals WHERE tenant_id = $1 AND active = true`,
    [tenantId],
  );
  return linha.total;
}

export async function unitsCount(manager: EntityManager, tenantId: string): Promise<number> {
  const [linha] = await manager.query<{ total: number }[]>(
    `SELECT count(*)::int AS total FROM units WHERE tenant_id = $1`,
    [tenantId],
  );
  return linha.total;
}

/** Convites de funcionário pendentes cujo prazo passou viram `EXPIRED`: liberam
 * a reserva do profissional para um convite novo. */
export async function expireStaleStaffInvites(manager: EntityManager, tenantId: string, now: Date): Promise<void> {
  await manager.query(
    `UPDATE invites SET status = 'EXPIRED', updated_at = $2
      WHERE tenant_id = $1 AND establishment_role = 'PROFISSIONAL' AND status = 'PENDING' AND expires_at <= $2`,
    [tenantId, now],
  );
}

export function seatLimitMessage(usage: SeatUsage): string {
  return (
    `O plano permite ${usage.limit} acesso(s) de funcionário e todos estão em uso ` +
    `(${usage.activeAccesses} ativo(s), ${usage.pendingInvites} convite(s) pendente(s)). ` +
    'Revogue um convite, suspenda ou remova um acesso, ou troque o plano.'
  );
}
