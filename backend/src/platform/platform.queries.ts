import type { EstablishmentQuery } from './platform.dto.js';
import { DEFAULT_ESTABLISHMENT_SCOPE, scopeSql, type EstablishmentScope } from './portal-overview.js';
import { timestampInRangeSql } from './portal-reports.js';

// Nome igual ao contexto real de sessão: unidade principal, com slug como
// fallback. O lateral tem no máximo uma linha, logo não duplica tenants.
export const ESTABLISHMENT_FROM = `FROM tenants t
  JOIN plans p ON p.id = t.plan_id
  LEFT JOIN LATERAL (
    SELECT name FROM units WHERE tenant_id = t.id AND is_primary = true
    ORDER BY created_at, id LIMIT 1
  ) main_unit ON true`;

export const ESTABLISHMENT_COLUMNS = `t.id, COALESCE(main_unit.name, t.slug::text) AS name,
  t.slug, t.category, t.timezone, t.status, t.created_at AS "createdAt", t.is_test AS "isTest",
  json_build_object('id', p.id, 'code', p.code, 'name', p.name,
    'catalogPriceCents', p.price_cents, 'maxProfessionals', p.max_professionals,
    'maxUnits', p.max_units) AS plan,
  COALESCE((SELECT json_agg(json_build_object('id', u.id, 'name', u.name,
    'email', COALESCE(u.email::text, u.username::text), 'phone', u.phone, 'status', u.status) ORDER BY u.name, u.id)
    FROM memberships m JOIN users u ON u.id = m.user_id
    WHERE m.tenant_id = t.id AND m.role = 'DONO'), '[]'::json) AS owners`;

/** `ids`: resultado de um filtro calculado fora do SQL (regra de acesso ou
 * condição contratada, ver portal-overview.ts); restringe a mesma consulta
 * paginada. */
export function establishmentFilter(
  query: EstablishmentQuery,
  ids?: readonly string[],
): {
  sql: string;
  values: unknown[];
} {
  const clauses: string[] = [];
  const values: unknown[] = [];
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
  // Alcance (clientes, internos/teste, todos): o mesmo WHERE serve à
  // contagem e à página, logo total e paginação seguem o alcance.
  const alcance = scopeSql(query.scope ?? DEFAULT_ESTABLISHMENT_SCOPE, 't');
  if (alcance) clauses.push(alcance);
  // Data de cadastro no fuso da plataforma (as duas inclusas), a mesma regra
  // dos "Cadastros registrados no período" do relatório.
  if (query.createdFrom && query.createdTo) {
    values.push(query.createdFrom, query.createdTo);
    clauses.push(timestampInRangeSql('t.created_at', `$${values.length - 1}`, `$${values.length}`));
  }
  if (ids) {
    values.push(ids);
    clauses.push(`t.id = ANY($${values.length}::varchar[])`);
  }
  return {
    sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
    values,
  };
}

/**
 * Pagamentos de assinatura: UMA regra para a Visão geral, o relatório por
 * período e o extrato. Períodos pagos confirmados à mão em BRL (a constraint
 * do banco já exige os três juntos), pela data de recebimento registrada
 * (`date`, as duas pontas inclusas), no alcance pela marca `is_test` atual.
 * `status`: `RECEIVED` = não anulado agora; `CANCELED` = anulado agora;
 * ausente = os dois. Exige `JOIN tenants t` na consulta.
 */
export function subscriptionPaymentWhere(filter: {
  tenantId?: string;
  from?: string;
  to?: string;
  scope: EstablishmentScope;
  status?: 'RECEIVED' | 'CANCELED';
}): { sql: string; values: unknown[] } {
  const clauses = [`ap.kind = 'PAID'`, `ap.confirmation_source = 'MANUAL'`, `ap.currency = 'BRL'`];
  const values: unknown[] = [];
  if (filter.tenantId) {
    values.push(filter.tenantId);
    clauses.push(`ap.tenant_id = $${values.length}`);
  }
  if (filter.from && filter.to) {
    values.push(filter.from, filter.to);
    clauses.push(`ap.payment_received_on BETWEEN $${values.length - 1}::date AND $${values.length}::date`);
  }
  const alcance = scopeSql(filter.scope, 't');
  if (alcance) clauses.push(alcance);
  if (filter.status === 'RECEIVED') clauses.push('ap.canceled_at IS NULL');
  if (filter.status === 'CANCELED') clauses.push('ap.canceled_at IS NOT NULL');
  return { sql: `WHERE ${clauses.join(' AND ')}`, values };
}
