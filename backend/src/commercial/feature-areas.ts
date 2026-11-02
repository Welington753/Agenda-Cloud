// Recurso do plano que cada área da sessão usa (as áreas são as de
// accounts/tenant-effective-access.ts). O mesmo recurso que a rota da área
// confere em `PoliticaDeAcesso.recurso`; sem recurso, a área é núcleo de
// todo plano (serviços, visão geral, avisos).
//
// Só serve para a tela esconder o que voltaria recusado: a rota confere de
// novo a cada requisição.
import { FeatureKey } from '../entities/enums/feature-key.enum.js';

export function areaFeature(area: string): FeatureKey | null {
  if (area.startsWith('AGENDA_PROPRIA_')) return FeatureKey.EQUIPE;
  if (area.startsWith('AGENDA_') || area.startsWith('SOLICITACOES_') || area === 'DISPONIBILIDADE') {
    return FeatureKey.AGENDA;
  }
  if (area.startsWith('RECEBIMENTOS_')) return FeatureKey.PAGAMENTOS;
  if (area.startsWith('CLIENTES_')) return FeatureKey.CONSUMIDORES;
  if (area.startsWith('PROFISSIONAIS_')) return FeatureKey.PROFISSIONAIS;
  if (area === 'AGENDAMENTO_ONLINE') return FeatureKey.AGENDAMENTO_PUBLICO;
  if (area === 'EQUIPE') return FeatureKey.EQUIPE;
  return null;
}

/** Recursos ligados para o estabelecimento: os do plano, com as exceções
 * gravadas por estabelecimento (`tenant_feature_overrides`). */
export const ENABLED_FEATURES_SQL = `SELECT f.key::text AS key FROM features f
  WHERE COALESCE(
    (SELECT o.enabled FROM tenant_feature_overrides o WHERE o.tenant_id = $1 AND o.feature_id = f.id),
    EXISTS (SELECT 1 FROM tenants t JOIN plan_features pf ON pf.plan_id = t.plan_id
      WHERE t.id = $1 AND pf.feature_id = f.id)
  )`;
