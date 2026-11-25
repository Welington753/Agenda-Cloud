// Áreas que um vínculo opera AGORA, para a tela montar o menu e esconder o
// que voltaria recusado. Calculadas pelas MESMAS políticas das rotas
// (accounts/tenant-effective-access.ts), com os mesmos ajustes efetivos
// (gerente sem confirmação do dono: nenhum `GRANTED`). Não autorizam nada:
// cada rota refaz a prova no banco a cada requisição, então uma permissão
// retirada vale na próxima requisição mesmo que o menu ainda a mostre.
//
// Áreas de recurso fora do plano do estabelecimento também ficam de fora
// (commercial/feature-areas.ts). A nova venda pede VENDAS e ESTOQUE; a
// manutenção das vendas já registradas aparece com VENDAS ligado ou, depois
// de uma retirada, enquanto houver alguma venda no estabelecimento.
import type { EntityManager } from 'typeorm';
import { tenantEffectiveAccess, type OverrideLike } from '../accounts/tenant-effective-access.js';
import { effectiveOverrides, permissionsConfirmed } from '../common/tenant-authorization.js';
import { areaFeatures, ENABLED_FEATURES_SQL, SALES_MAINTENANCE_AREAS } from '../commercial/feature-areas.js';
import type { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { canViewOwnAgenda } from '../team/staff-access.js';

export async function sessionAreas(
  manager: EntityManager,
  membership: { id: string; tenantId: string; role: EstablishmentRole; professionalId?: string | null },
): Promise<string[]> {
  const gravados = await manager.query<OverrideLike[]>(
    `SELECT permission::text AS permission, mode::text AS mode
       FROM membership_permission_overrides WHERE tenant_id = $1 AND membership_id = $2`,
    [membership.tenantId, membership.id],
  );
  const confirmado = membership.role === 'GERENTE' ? await permissionsConfirmed(manager, membership.id) : false;
  const valem = effectiveOverrides(membership.role, confirmado, gravados);
  const areas = tenantEffectiveAccess(membership.role, valem)
    .filter((a) => a.allowed && a.key !== 'AGENDA_PROPRIA_VER')
    .map((a) => a.key);
  // A agenda própria depende também do profissional ligado.
  if (membership.professionalId && canViewOwnAgenda(membership.role, confirmado)) areas.push('AGENDA_PROPRIA_VER');
  const ligados = new Set(
    (await manager.query<{ key: string }[]>(ENABLED_FEATURES_SQL, [membership.tenantId])).map((l) => l.key),
  );
  const comRecurso = areas.filter((area) => areaFeatures(area).every((recurso) => ligados.has(recurso)));
  if (ligados.has('VENDAS') || !comRecurso.some((area) => SALES_MAINTENANCE_AREAS.includes(area))) return comRecurso;
  const [vendas] = await manager.query<{ existe: boolean }[]>(
    'SELECT EXISTS (SELECT 1 FROM sales WHERE tenant_id = $1) AS existe',
    [membership.tenantId],
  );
  return vendas?.existe === true ? comRecurso : comRecurso.filter((area) => !SALES_MAINTENANCE_AREAS.includes(area));
}
