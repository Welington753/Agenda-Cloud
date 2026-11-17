// Vagas de usuários da equipe e limite de profissionais. São dois limites
// separados (migration ModularSubscription):
// - usuários da equipe com login: `tenants.team_user_limit`; NULL segue
//   `plans.max_professionals` (compatibilidade dos planos anteriores, que já
//   usavam esse número como vagas de login). Ver `EFFECTIVE_TEAM_USER_LIMIT_SQL`;
// - profissionais ativos: `plans.max_professionals`; NULL (só no plano
//   modular) = sem limite contratual de profissionais.
//
// REGRA DAS VAGAS
//
// - Cada acesso de funcionário (vínculo `PROFISSIONAL`) fica ligado a UM
//   profissional do estabelecimento; cada profissional tem no máximo um
//   acesso (índice único em `memberships.professional_id`) ou um convite
//   pendente (`uq_invites_pending_professional`).
// - GERENTE (migration TeamManagerAccess) também é acesso de equipe e ocupa
//   vaga do mesmo jeito, com ou sem profissional ligado. Gerente sem
//   profissional NÃO cria profissional e não conta no limite de
//   profissionais; com profissional, usa o cadastro que já existe.
// - Ocupam vaga: cada USUÁRIO com vínculo ATIVO e papel diferente de DONO
//   (contado uma vez por estabelecimento) + convites de equipe pendentes e
//   dentro do prazo, um por e-mail, desde que o e-mail ainda não tenha
//   vínculo ali (o aceite não conta duas vezes). Acesso suspenso não ocupa;
//   reativar confere a vaga de novo. Convite revogado ou vencido libera;
//   reenviar não ocupa outra (o mesmo convite continua sendo um só).
//   Profissional sem login não tem vínculo: nunca ocupa.
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

/** Papéis cujo acesso ocupa vaga de equipe. O DONO fica fora. */
export const TEAM_SEAT_ROLES = ['PROFISSIONAL', 'GERENTE', 'RECEPCIONISTA'] as const;

/** Limite de usuários da equipe em vigor, para consultas com `tenants t` e
 * `plans p`. O plano modular sempre tem `team_user_limit` (gatilho da
 * migration); o `0` final só cobre um estado que o banco não aceita. */
export const EFFECTIVE_TEAM_USER_LIMIT_SQL = 'COALESCE(t.team_user_limit, p.max_professionals, 0)';

export interface LockedTenant {
  id: string;
  name: string;
  status: string;
  plan: { id: string; name: string; maxProfessionals: number | null; maxUnits: number };
  /** Limite de usuários da equipe em vigor e de onde veio. */
  teamUserLimit: number;
  teamUserLimitSource: 'TENANT' | 'PLAN';
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
    {
      id: string;
      status: string;
      plan_id: string;
      plan_name: string;
      max_professionals: number | null;
      max_units: number;
      team_user_limit: number;
      own_limit: boolean;
    }[]
  >(
    `SELECT t.id, t.status::text AS status, p.id AS plan_id, p.name AS plan_name, p.max_professionals, p.max_units,
            ${EFFECTIVE_TEAM_USER_LIMIT_SQL} AS team_user_limit, t.team_user_limit IS NOT NULL AS own_limit
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
      maxProfessionals: linha.max_professionals === null ? null : Number(linha.max_professionals),
      maxUnits: linha.max_units,
    },
    teamUserLimit: Number(linha.team_user_limit),
    teamUserLimitSource: linha.own_limit ? 'TENANT' : 'PLAN',
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
    `SELECT count(DISTINCT user_id) FILTER (WHERE status = 'ACTIVE')::int AS ativos,
            count(DISTINCT user_id) FILTER (WHERE status <> 'ACTIVE')::int AS suspensos
       FROM memberships WHERE tenant_id = $1 AND role <> 'DONO'`,
    [tenantId],
  );
  const [convites] = await manager.query<{ pendentes: number }[]>(
    `SELECT count(DISTINCT COALESCE(lower(i.target_email::text), i.id))::int AS pendentes FROM invites i
      WHERE i.tenant_id = $1 AND i.type = 'ESTABLISHMENT' AND i.establishment_role IS NOT NULL
        AND i.establishment_role <> 'DONO' AND i.status = 'PENDING' AND i.expires_at > $2
        AND i.id IS DISTINCT FROM $3
        AND NOT EXISTS (
          SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id
           WHERE m.tenant_id = i.tenant_id AND lower(u.email::text) = lower(i.target_email::text))`,
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
    `O limite contratado é de ${usage.limit} usuário(s) da equipe e ${usage.used} estão em uso ` +
    `(${usage.activeAccesses} ativo(s), ${usage.pendingInvites} reservado(s) por convite). ` +
    'Revogue um convite, suspenda um acesso ou peça à administração do TimVix o ajuste do limite.'
  );
}
