// Política de acesso à CONSULTA de disponibilidade (Lote 6D.4) — função pura,
// sem Nest e sem banco, no mesmo molde de professional-access.ts e
// service-access.ts.
//
// POR QUE SÓ DONO: o backend ainda não tem a tabela de permissões padrão por
// papel. O schema já tem `Permission.AGENDA_VISUALIZAR`, mas inferir daqui o
// que GERENTE ou RECEPCIONISTA enxergam seria inventar autorização por
// suposição. Como nos lotes anteriores, a consulta fica com o DONO de vínculo
// ativo; ampliar é decisão de um lote de papéis, não deste.
//
// QUAIS `DENIED` SÃO PERTINENTES: os três abaixo, e só no sentido que
// RESTRINGE — nenhum `GRANTED` amplia nada aqui.
//
// - `AGENDA_VISUALIZAR`: a resposta é, literalmente, o negativo da agenda do
//   profissional naquele dia (quem não pode ver a agenda não deve deduzi-la
//   pelos buracos);
// - `PROFISSIONAIS_VISUALIZAR`: a resposta revela a jornada de trabalho de
//   uma pessoa específica;
// - `SERVICOS_VISUALIZAR`: consultar exige escolher um serviço do catálogo e
//   a resposta confirma a duração praticada.
//
// Nenhuma permissão nova é criada: os três valores já existem no enum real.
//
// BASE COMUM (docs/plans/permissoes-individuais.md, etapa 1): a política
// decide só por `accessAllows(effectiveAccess(role, overrides), …)`, sem
// mudança de regra. O gerente precisa das três concedidas (a dependência de
// `AGENDA_VISUALIZAR` já é `PROFISSIONAIS_VISUALIZAR`); o dono, de nenhuma
// das três negada. Equivalência com a regra anterior em
// appointments/appointment-access.equivalence.spec.ts.
import { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { Permission } from '../entities/enums/permission.enum.js';
import type { PermissionOverrideLike } from '../common/tenant-authorization.js';
import { accessAllows, accessCan, effectiveAccess, type LegacyAction } from '../common/access-evaluation.js';

export const AVAILABILITY_FORBIDDEN_MESSAGE =
  'Você não tem permissão para consultar a agenda deste estabelecimento.';

const PERMISSOES_PERTINENTES: readonly Permission[] = [
  Permission.AGENDA_VISUALIZAR,
  Permission.PROFISSIONAIS_VISUALIZAR,
  Permission.SERVICOS_VISUALIZAR,
];

const CONSULTAR: LegacyAction = {
  grants: ['AGENDA_VISUALIZAR', 'PROFISSIONAIS_VISUALIZAR', 'SERVICOS_VISUALIZAR'],
  ownerDenials: PERMISSOES_PERTINENTES,
};

export function canViewAvailability(
  role: EstablishmentRole,
  overrides: readonly PermissionOverrideLike[] = [],
): boolean {
  return accessAllows(effectiveAccess(role, overrides), CONSULTAR);
}

/** Preço dos serviços na resposta da consulta: só o GERENTE tem recorte, e vê
 * o preço com a consulta de recebimentos. O dono vê sempre, mesmo com DENIED
 * nela, como antes. */
export function canSeeAvailabilityPrices(
  role: EstablishmentRole,
  overrides: readonly PermissionOverrideLike[] = [],
): boolean {
  if (role !== EstablishmentRole.GERENTE) return true;
  return accessCan(effectiveAccess(role, overrides), 'RECEBIMENTOS_VISUALIZAR');
}
