// Leitura em lote do diretório do portal: situação do acesso e condição
// contratada de TODOS os estabelecimentos, num número fixo de consultas
// (nunca uma por estabelecimento). Quem chama já autorizou e abriu a
// transação de leitura. As regras ficam em portal-overview.ts.
import type { EntityManager } from 'typeorm';
import type { BillingCycle } from '../commercial/access-periods.js';
import { loadAllAccessInputs } from '../commercial/commercial-gate.js';
import {
  commercialSummary,
  tenantAccessView,
  type CommercialSummary,
  type TenantAccessView,
} from './portal-overview.js';

export interface DirectoryEntry {
  id: string;
  status: string;
  timezone: string;
  access: TenantAccessView;
  commercial: CommercialSummary;
}

/** Catálogo em vigor por plano e ciclo: a linha mais recente, como em
 * `currentCatalogPrice`. */
const CATALOG_SQL = `SELECT DISTINCT ON (plan_id, billing_cycle) plan_id, billing_cycle::text AS billing_cycle, amount_cents
  FROM plan_prices ORDER BY plan_id, billing_cycle, recorded_at DESC, id DESC`;

/** Contrato em vigor por estabelecimento e ciclo, só do plano ATUAL: a linha
 * mais recente, como em `currentContractPrice`. */
const CONTRACT_SQL = `SELECT DISTINCT ON (cp.tenant_id, cp.billing_cycle) cp.tenant_id, cp.billing_cycle::text AS billing_cycle,
    cp.amount_cents, cp.recorded_at, cp.id
  FROM tenant_contract_prices cp JOIN tenants t ON t.id = cp.tenant_id AND t.plan_id = cp.plan_id
  ORDER BY cp.tenant_id, cp.billing_cycle, cp.recorded_at DESC, cp.id DESC`;

export async function loadDirectory(manager: EntityManager, now: Date): Promise<Map<string, DirectoryEntry>> {
  const tenants = await manager.query<{ id: string; status: string; timezone: string; plan_id: string }[]>(
    'SELECT id, status::text AS status, timezone, plan_id FROM tenants',
  );
  const acesso = await loadAllAccessInputs(manager);

  const catalogo = new Map<string, Map<BillingCycle, number | null>>();
  for (const l of await manager.query<{ plan_id: string; billing_cycle: BillingCycle; amount_cents: number }[]>(CATALOG_SQL)) {
    if (!catalogo.has(l.plan_id)) catalogo.set(l.plan_id, new Map());
    catalogo.get(l.plan_id)!.set(l.billing_cycle, Number(l.amount_cents));
  }

  const contratos = new Map<string, Map<BillingCycle, number | null>>();
  // Ciclo da linha de contrato mais recente do plano atual (qualquer ciclo).
  const combinado = new Map<string, { cycle: BillingCycle; at: number; id: string }>();
  const linhas = await manager.query<
    { tenant_id: string; billing_cycle: BillingCycle; amount_cents: number | null; recorded_at: Date; id: string }[]
  >(CONTRACT_SQL);
  for (const l of linhas) {
    if (!contratos.has(l.tenant_id)) contratos.set(l.tenant_id, new Map());
    contratos.get(l.tenant_id)!.set(l.billing_cycle, l.amount_cents === null ? null : Number(l.amount_cents));
    const at = new Date(l.recorded_at).getTime();
    const atual = combinado.get(l.tenant_id);
    if (!atual || at > atual.at || (at === atual.at && l.id > atual.id)) {
      combinado.set(l.tenant_id, { cycle: l.billing_cycle, at, id: l.id });
    }
  }

  const diretorio = new Map<string, DirectoryEntry>();
  for (const t of tenants) {
    const entrada = acesso.get(t.id) ?? { periods: [], flags: { legacy: false, noExpiry: false } };
    diretorio.set(t.id, {
      id: t.id,
      status: t.status,
      timezone: t.timezone,
      access: tenantAccessView({ status: t.status, timezone: t.timezone, ...entrada }, now),
      commercial: commercialSummary(
        catalogo.get(t.plan_id) ?? new Map(),
        contratos.get(t.id) ?? new Map(),
        combinado.get(t.id)?.cycle ?? null,
      ),
    });
  }
  return diretorio;
}
