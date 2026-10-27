import type { EstablishmentQuery } from './platform.dto.js';

// Nome igual ao contexto real de sessão: unidade principal, com slug como
// fallback. O lateral tem no máximo uma linha, logo não duplica tenants.
export const ESTABLISHMENT_FROM = `FROM tenants t
  JOIN plans p ON p.id = t.plan_id
  LEFT JOIN LATERAL (
    SELECT name FROM units WHERE tenant_id = t.id AND is_primary = true
    ORDER BY created_at, id LIMIT 1
  ) main_unit ON true`;

export const ESTABLISHMENT_COLUMNS = `t.id, COALESCE(main_unit.name, t.slug::text) AS name,
  t.slug, t.category, t.timezone, t.status, t.created_at AS "createdAt",
  json_build_object('id', p.id, 'code', p.code, 'name', p.name,
    'catalogPriceCents', p.price_cents, 'maxProfessionals', p.max_professionals,
    'maxUnits', p.max_units) AS plan,
  COALESCE((SELECT json_agg(json_build_object('id', u.id, 'name', u.name,
    'email', COALESCE(u.email::text, u.username::text), 'phone', u.phone, 'status', u.status) ORDER BY u.name, u.id)
    FROM memberships m JOIN users u ON u.id = m.user_id
    WHERE m.tenant_id = t.id AND m.role = 'DONO'), '[]'::json) AS owners`;

export function establishmentFilter(query: EstablishmentQuery): {
  sql: string;
  values: string[];
} {
  const clauses: string[] = [];
  const values: string[] = [];
  if (query.q) {
    values.push(`%${query.q.replace(/[\\%_]/g, '\\$&')}%`);
    const parameter = `$${values.length}`;
    clauses.push(`(COALESCE(main_unit.name, t.slug::text) ILIKE ${parameter}
      OR t.slug::text ILIKE ${parameter}
      OR EXISTS (SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE m.tenant_id = t.id AND m.role = 'DONO'
        AND (u.name ILIKE ${parameter} OR u.email::text ILIKE ${parameter} OR u.phone ILIKE ${parameter})))`);
  }
  if (query.status) {
    values.push(query.status);
    clauses.push(`t.status = $${values.length}`);
  }
  if (query.planId) {
    values.push(query.planId);
    clauses.push(`t.plan_id = $${values.length}`);
  }
  return {
    sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
    values,
  };
}
