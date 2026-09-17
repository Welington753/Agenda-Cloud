// Política de acesso aos agendamentos (Lote 6D.5) — função pura, sem Nest e
// sem banco, no mesmo molde de availability-access.ts.
//
// POR QUE SÓ DONO: mesma justificativa dos lotes anteriores. O schema já tem
// `AGENDAMENTO_CRIAR` e `AGENDA_VISUALIZAR`, mas não existe tabela de
// permissões padrão por papel — inferir daqui o que GERENTE ou
// RECEPCIONISTA podem fazer seria inventar autorização. Ampliar é decisão de
// um lote de papéis, não deste.
//
// QUAIS `DENIED` SÃO PERTINENTES, e só no sentido que RESTRINGE (nenhum
// `GRANTED` amplia nada):
//
// - ver a agenda: `AGENDA_VISUALIZAR` — a listagem É a agenda do dia;
// - criar: além de `AGENDA_VISUALIZAR` (criar exige enxergar o que já está
//   marcado), `AGENDAMENTO_CRIAR`, `PROFISSIONAIS_VISUALIZAR` (escolher de
//   quem é a agenda), `SERVICOS_VISUALIZAR` (escolher o serviço) e
//   `CONSUMIDORES_VISUALIZAR` (escolher o cliente). Um DENIED em qualquer
//   uma delas impede a reserva, porque a reserva usa todas.
//
// Todos os valores já existem no enum real — nenhuma permissão nova.
import { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { Permission } from '../entities/enums/permission.enum.js';
import { PermissionMode } from '../entities/enums/permission-mode.enum.js';
import type { PermissionOverrideLike } from '../common/tenant-authorization.js';

export const APPOINTMENTS_FORBIDDEN_MESSAGE =
  'Você não tem permissão para acessar a agenda deste estabelecimento.';

export const APPOINTMENT_CREATE_FORBIDDEN_MESSAGE =
  'Você não tem permissão para criar agendamentos neste estabelecimento.';

const ROLES_WITH_AGENDA_ACCESS: ReadonlySet<EstablishmentRole> = new Set([
  EstablishmentRole.DONO,
]);

const PERMISSOES_PARA_VER: readonly Permission[] = [Permission.AGENDA_VISUALIZAR];

const PERMISSOES_PARA_CRIAR: readonly Permission[] = [
  Permission.AGENDA_VISUALIZAR,
  Permission.AGENDAMENTO_CRIAR,
  Permission.PROFISSIONAIS_VISUALIZAR,
  Permission.SERVICOS_VISUALIZAR,
  Permission.CONSUMIDORES_VISUALIZAR,
];

function negado(
  overrides: readonly PermissionOverrideLike[],
  permissoes: readonly Permission[],
): boolean {
  return overrides.some(
    (override) =>
      override.mode === PermissionMode.DENIED && permissoes.includes(override.permission),
  );
}

export function canViewAppointments(
  role: EstablishmentRole,
  overrides: readonly PermissionOverrideLike[] = [],
): boolean {
  if (!ROLES_WITH_AGENDA_ACCESS.has(role)) return false;
  return !negado(overrides, PERMISSOES_PARA_VER);
}

export function canCreateAppointments(
  role: EstablishmentRole,
  overrides: readonly PermissionOverrideLike[] = [],
): boolean {
  if (!ROLES_WITH_AGENDA_ACCESS.has(role)) return false;
  return !negado(overrides, PERMISSOES_PARA_CRIAR);
}
