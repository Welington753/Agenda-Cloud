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
// - cancelar (Lote 6D.6): `AGENDA_VISUALIZAR` (achar a reserva) e
//   `AGENDAMENTO_CANCELAR`. NÃO exige `SERVICOS_VISUALIZAR` nem
//   `PROFISSIONAIS_VISUALIZAR`: cancelar não escolhe serviço nem
//   profissional, e precisa funcionar mesmo depois de o serviço ou o
//   profissional da reserva ter sido desativado.
// - remarcar (Lote 6D.6): `AGENDA_VISUALIZAR`, `AGENDAMENTO_EDITAR` e também
//   `PROFISSIONAIS_VISUALIZAR` e `SERVICOS_VISUALIZAR` — remarcar consulta a
//   jornada do profissional e a elegibilidade do serviço para achar os
//   horários. NÃO exige `CONSUMIDORES_VISUALIZAR`: o cliente da reserva é
//   preservado, nunca reescolhido.
//
// Todos os valores já existem no enum real — nenhuma permissão nova
// (`AGENDAMENTO_CANCELAR` e `AGENDAMENTO_EDITAR` já estão em
// entities/enums/permission.enum.ts desde o Lote 3).
import { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { Permission } from '../entities/enums/permission.enum.js';
import { PermissionMode } from '../entities/enums/permission-mode.enum.js';
import type { PermissionOverrideLike } from '../common/tenant-authorization.js';

export const APPOINTMENTS_FORBIDDEN_MESSAGE =
  'Você não tem permissão para acessar a agenda deste estabelecimento.';

export const APPOINTMENT_CREATE_FORBIDDEN_MESSAGE =
  'Você não tem permissão para criar agendamentos neste estabelecimento.';

export const APPOINTMENT_CANCEL_FORBIDDEN_MESSAGE =
  'Você não tem permissão para cancelar agendamentos neste estabelecimento.';

export const APPOINTMENT_RESCHEDULE_FORBIDDEN_MESSAGE =
  'Você não tem permissão para remarcar agendamentos neste estabelecimento.';

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

const PERMISSOES_PARA_CANCELAR: readonly Permission[] = [
  Permission.AGENDA_VISUALIZAR,
  Permission.AGENDAMENTO_CANCELAR,
];

const PERMISSOES_PARA_REMARCAR: readonly Permission[] = [
  Permission.AGENDA_VISUALIZAR,
  Permission.AGENDAMENTO_EDITAR,
  Permission.PROFISSIONAIS_VISUALIZAR,
  Permission.SERVICOS_VISUALIZAR,
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

export function canCancelAppointments(
  role: EstablishmentRole,
  overrides: readonly PermissionOverrideLike[] = [],
): boolean {
  if (!ROLES_WITH_AGENDA_ACCESS.has(role)) return false;
  return !negado(overrides, PERMISSOES_PARA_CANCELAR);
}

export function canRescheduleAppointments(
  role: EstablishmentRole,
  overrides: readonly PermissionOverrideLike[] = [],
): boolean {
  if (!ROLES_WITH_AGENDA_ACCESS.has(role)) return false;
  return !negado(overrides, PERMISSOES_PARA_REMARCAR);
}
