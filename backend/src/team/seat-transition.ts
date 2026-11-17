// Relatório SOMENTE LEITURA da transição da contagem de vagas (migration
// ModularSubscription). Para conferir, numa cópia restaurada do banco do
// piloto (nunca no piloto), quem muda de ocupação com a regra nova:
//
// - regra anterior (congelada aqui): vínculos ATIVOS de PROFISSIONAL e
//   GERENTE + convites PROFISSIONAL pendentes e no prazo;
// - regra nova (`staffSeatUsage`): usuários com vínculo ATIVO e papel
//   diferente de DONO, uma vez cada + convites de equipe pendentes e no prazo,
//   um por e-mail, sem quem já tem vínculo.
//
// Quem passar do limite NÃO perde nada: nenhum acesso é suspenso. Só novas
// criações, convites e reativações passam a ser recusadas até caber.
import type { EntityManager } from 'typeorm';
import { EFFECTIVE_TEAM_USER_LIMIT_SQL, staffSeatUsage } from './seats.js';

export interface SeatTransitionRow {
  tenantId: string;
  name: string;
  planId: string;
  previousUsed: number;
  newUsed: number;
  activeAccesses: number;
  pendingInvites: number;
  limit: number;
  limitSource: 'TENANT' | 'PLAN';
  overLimit: boolean;
}

export const PREVIOUS_SEAT_USAGE_SQL = `SELECT
    (SELECT count(*)::int FROM memberships m WHERE m.tenant_id = $1 AND m.status = 'ACTIVE' AND m.role IN ('PROFISSIONAL', 'GERENTE'))
  + (SELECT count(*)::int FROM invites i WHERE i.tenant_id = $1 AND i.establishment_role = 'PROFISSIONAL'
       AND i.status = 'PENDING' AND i.expires_at > $2) AS used`;

export async function seatTransitionReport(manager: EntityManager, now = new Date()): Promise<SeatTransitionRow[]> {
  const tenants = await manager.query<
    { id: string; name: string; plan_id: string; team_user_limit: number; own_limit: boolean }[]
  >(
    `SELECT t.id, COALESCE((SELECT name FROM units WHERE tenant_id = t.id AND is_primary = true ORDER BY created_at, id LIMIT 1),
              t.slug::text) AS name,
            t.plan_id, ${EFFECTIVE_TEAM_USER_LIMIT_SQL} AS team_user_limit, t.team_user_limit IS NOT NULL AS own_limit
       FROM tenants t JOIN plans p ON p.id = t.plan_id ORDER BY t.created_at, t.id`,
  );
  const linhas: SeatTransitionRow[] = [];
  for (const t of tenants) {
    const limite = Number(t.team_user_limit);
    const [anterior] = await manager.query<{ used: number }[]>(PREVIOUS_SEAT_USAGE_SQL, [t.id, now]);
    const nova = await staffSeatUsage(manager, t.id, limite, now);
    linhas.push({
      tenantId: t.id,
      name: t.name,
      planId: t.plan_id,
      previousUsed: Number(anterior.used),
      newUsed: nova.used,
      activeAccesses: nova.activeAccesses,
      pendingInvites: nova.pendingInvites,
      limit: limite,
      limitSource: t.own_limit ? 'TENANT' : 'PLAN',
      overLimit: nova.used > limite,
    });
  }
  return linhas;
}
