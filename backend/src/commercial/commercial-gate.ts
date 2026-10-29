// Situação comercial e recurso contratado, conferidos no servidor a cada
// requisição de estabelecimento, DEPOIS do vínculo e da situação
// administrativa e ANTES da permissão pessoal (ver
// common/tenant-authorization.ts). Uma concessão do dono a um gerente nunca
// libera recurso fora do plano, porque a política do módulo só é consultada
// depois daqui.
//
// O vínculo já está provado quando isto roda: as recusas são 403 com código
// próprio, para a tela explicar o motivo (o estabelecimento não é segredo
// para quem tem vínculo com ele).
import { ForbiddenException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { FeatureKey } from '../entities/enums/feature-key.enum.js';
import { accessSituation, type AccessPeriodKind, type AccessSituation, type IdentifiedPeriod } from './access-periods.js';

export const ACCESS_EXPIRED_CODE = 'ACESSO_VENCIDO';
export const FEATURE_NOT_CONTRACTED_CODE = 'RECURSO_NAO_CONTRATADO';

export const ACCESS_EXPIRED_MESSAGE =
  'O acesso deste estabelecimento venceu. Os dados e as reservas estão preservados; ' +
  'o responsável pode regularizar com a administração do Agenda Cloud.';
export const FEATURE_NOT_CONTRACTED_MESSAGE = 'Este recurso não faz parte do plano do estabelecimento.';

/** Prefixo estável da leitura dos períodos válidos (os dublês de teste
 * reconhecem a consulta por ele). Um período anulado por correção nunca
 * entra. */
export const ACCESS_PERIODS_SQL =
  'SELECT id, kind::text AS kind, starts_at, ends_at, anchor_day FROM tenant_access_periods WHERE tenant_id = $1 AND canceled_at IS NULL';

/** A marca explícita de estabelecimento anterior ao controle de validade. */
export const ACCESS_LEGACY_SQL = 'SELECT access_legacy_since IS NOT NULL AS legacy FROM tenants WHERE id = $1';

/** Prefixo estável da conferência de recurso. */
export const FEATURE_ENABLED_SQL = `SELECT COALESCE(
  (SELECT o.enabled FROM tenant_feature_overrides o JOIN features f ON f.id = o.feature_id
    WHERE o.tenant_id = $1 AND f.key::text = $2),
  EXISTS (SELECT 1 FROM tenants t JOIN plan_features pf ON pf.plan_id = t.plan_id
    JOIN features f ON f.id = pf.feature_id WHERE t.id = $1 AND f.key::text = $2)
) AS enabled`;

interface PeriodRow {
  id: string;
  kind: AccessPeriodKind;
  starts_at: Date | string;
  ends_at: Date | string;
  anchor_day: number | null;
}

export async function loadAccessPeriods(manager: EntityManager, tenantId: string): Promise<IdentifiedPeriod[]> {
  const linhas = await manager.query<PeriodRow[]>(`${ACCESS_PERIODS_SQL} ORDER BY starts_at, id`, [tenantId]);
  return linhas.map((l) => ({
    id: l.id,
    kind: l.kind,
    startsAt: new Date(l.starts_at),
    endsAt: new Date(l.ends_at),
    anchorDay: l.anchor_day === null ? null : Number(l.anchor_day),
  }));
}

/** Sem linha (estabelecimento inexistente), não é anterior: bloqueia. */
export async function loadAccessLegacy(manager: EntityManager, tenantId: string): Promise<{ legacy: boolean }> {
  const [linha] = await manager.query<{ legacy: boolean }[]>(ACCESS_LEGACY_SQL, [tenantId]);
  return { legacy: linha?.legacy === true };
}

export async function tenantAccessSituation(
  manager: EntityManager,
  tenantId: string,
  now: Date,
): Promise<AccessSituation> {
  return accessSituation(await loadAccessPeriods(manager, tenantId), now, await loadAccessLegacy(manager, tenantId));
}

export async function featureEnabled(manager: EntityManager, tenantId: string, feature: FeatureKey): Promise<boolean> {
  const [linha] = await manager.query<{ enabled: boolean }[]>(FEATURE_ENABLED_SQL, [tenantId, feature]);
  return linha?.enabled === true;
}

/** Vencido: 403 `ACESSO_VENCIDO`. Recurso fora do plano: 403
 * `RECURSO_NAO_CONTRATADO`. Quem chama já provou vínculo e situação
 * administrativa. */
export async function requireCommercialAccess(
  manager: EntityManager,
  tenantId: string,
  feature: FeatureKey | null,
  now = new Date(),
): Promise<void> {
  const situacao = await tenantAccessSituation(manager, tenantId, now);
  if (situacao.blocked) {
    throw new ForbiddenException({
      code: ACCESS_EXPIRED_CODE,
      message: ACCESS_EXPIRED_MESSAGE,
      expiredAt: situacao.expiredAt?.toISOString() ?? null,
    });
  }
  if (feature && !(await featureEnabled(manager, tenantId, feature))) {
    throw new ForbiddenException({ code: FEATURE_NOT_CONTRACTED_CODE, message: FEATURE_NOT_CONTRACTED_MESSAGE });
  }
}
