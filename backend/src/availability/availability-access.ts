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
import { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { Permission } from '../entities/enums/permission.enum.js';
import { PermissionMode } from '../entities/enums/permission-mode.enum.js';
import type { PermissionOverrideLike } from '../common/tenant-authorization.js';

export const AVAILABILITY_FORBIDDEN_MESSAGE =
  'Você não tem permissão para consultar a agenda deste estabelecimento.';

/** Papéis com acesso padrão à consulta neste lote. */
const ROLES_WITH_AVAILABILITY_ACCESS: ReadonlySet<EstablishmentRole> = new Set([
  EstablishmentRole.DONO,
]);

const PERMISSOES_PERTINENTES: readonly Permission[] = [
  Permission.AGENDA_VISUALIZAR,
  Permission.PROFISSIONAIS_VISUALIZAR,
  Permission.SERVICOS_VISUALIZAR,
];

export function canViewAvailability(
  role: EstablishmentRole,
  overrides: readonly PermissionOverrideLike[] = [],
): boolean {
  if (!ROLES_WITH_AVAILABILITY_ACCESS.has(role)) return false;
  return !overrides.some(
    (override) =>
      override.mode === PermissionMode.DENIED &&
      PERMISSOES_PERTINENTES.includes(override.permission),
  );
}
