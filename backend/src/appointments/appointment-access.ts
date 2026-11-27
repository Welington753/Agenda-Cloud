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
// - confirmar, iniciar, concluir e registrar falta (Lote 6D.7):
//   `AGENDA_VISUALIZAR` (achar a reserva) e `AGENDA_GERENCIAR` (operar a
//   agenda). Não escolhem serviço, profissional nem cliente, então não exigem
//   as permissões de visualizar esses cadastros — e precisam funcionar mesmo
//   com o serviço ou o profissional desativados depois da reserva.
//
// GERENTE (ver common/manager-permissions.ts): cada ação vale só com a
// permissão correspondente CONCEDIDA pelo dono, com as dependências dela. O
// nome do papel não libera nada.
//
// SOLICITAÇÕES: consultar os pedidos que aguardam resposta e tratá-los
// (confirmar ou recusar uma reserva ainda `PENDING`). Para o dono, valem as
// políticas que sempre valeram (ver a agenda; confirmar pelo andamento,
// recusar pelo cancelamento). Para o gerente, as permissões próprias
// `SOLICITACOES_*`: tratar solicitações não dá o andamento nem o
// cancelamento da agenda inteira.
//
// Todos os valores já existem no enum real — nenhuma permissão nova
// (`AGENDAMENTO_CANCELAR` e `AGENDAMENTO_EDITAR` já estão em
// entities/enums/permission.enum.ts desde o Lote 3).
//
// BASE COMUM (docs/plans/permissoes-individuais.md, etapa 1): cada política
// decide só por `accessAllows(effectiveAccess(role, overrides), AÇÃO)`, sem
// mudança de regra. As listas do dono acima ficam literais, porque ver a
// agenda, cancelar e o andamento conferem no dono menos DENIED do que as
// dependências exigidas do gerente; tratar solicitações não é ação do dono,
// e os avisos não são do gerente. Equivalência com a regra anterior em
// appointment-access.equivalence.spec.ts. A agenda própria do funcionário
// continua em team/staff-access.ts, fora desta base nesta etapa.
import { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { Permission } from '../entities/enums/permission.enum.js';
import type { PermissionOverrideLike } from '../common/tenant-authorization.js';
import { accessAllows, accessCan, effectiveAccess, type LegacyAction } from '../common/access-evaluation.js';

export const APPOINTMENTS_FORBIDDEN_MESSAGE =
  'Você não tem permissão para acessar a agenda deste estabelecimento.';

export const APPOINTMENT_CREATE_FORBIDDEN_MESSAGE =
  'Você não tem permissão para criar agendamentos neste estabelecimento.';

export const APPOINTMENT_CANCEL_FORBIDDEN_MESSAGE =
  'Você não tem permissão para cancelar agendamentos neste estabelecimento.';

export const APPOINTMENT_STATUS_FORBIDDEN_MESSAGE =
  'Você não tem permissão para alterar o andamento dos atendimentos neste estabelecimento.';

export const APPOINTMENT_RESCHEDULE_FORBIDDEN_MESSAGE =
  'Você não tem permissão para remarcar agendamentos neste estabelecimento.';

// Listas do DONO: os DENIED que barram cada ação (literais, como antes).
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

const PERMISSOES_PARA_ANDAMENTO: readonly Permission[] = [
  Permission.AGENDA_VISUALIZAR,
  Permission.AGENDA_GERENCIAR,
];

// Cada ação: a concessão de gerente (com as dependências dela, em
// common/manager-permissions.ts) e a lista do dono.
const VER: LegacyAction = { grants: ['AGENDA_VISUALIZAR'], ownerDenials: PERMISSOES_PARA_VER };
const CRIAR: LegacyAction = { grants: ['AGENDAMENTO_CRIAR'], ownerDenials: PERMISSOES_PARA_CRIAR };
const CANCELAR: LegacyAction = { grants: ['AGENDAMENTO_CANCELAR'], ownerDenials: PERMISSOES_PARA_CANCELAR };
const REMARCAR: LegacyAction = { grants: ['AGENDAMENTO_EDITAR'], ownerDenials: PERMISSOES_PARA_REMARCAR };
const ANDAMENTO: LegacyAction = { grants: ['AGENDA_GERENCIAR'], ownerDenials: PERMISSOES_PARA_ANDAMENTO };
/** O dono vê as solicitações pela política de ver a agenda. */
const VER_SOLICITACOES: LegacyAction = { grants: ['SOLICITACOES_VISUALIZAR'], ownerDenials: PERMISSOES_PARA_VER };
/** O dono trata pelas políticas gerais (andamento e cancelamento). */
const TRATAR_SOLICITACOES: LegacyAction = { grants: ['SOLICITACOES_TRATAR'], ownerDenials: null };
/** Só o dono, com a política de ver a agenda. */
const RECEBER_AVISOS: LegacyAction = { grants: null, ownerDenials: PERMISSOES_PARA_VER };

function pode(role: EstablishmentRole, overrides: readonly PermissionOverrideLike[], acao: LegacyAction): boolean {
  return accessAllows(effectiveAccess(role, overrides), acao);
}

export function canViewAppointments(
  role: EstablishmentRole,
  overrides: readonly PermissionOverrideLike[] = [],
): boolean {
  return pode(role, overrides, VER);
}

export function canCreateAppointments(
  role: EstablishmentRole,
  overrides: readonly PermissionOverrideLike[] = [],
): boolean {
  return pode(role, overrides, CRIAR);
}

export function canCancelAppointments(
  role: EstablishmentRole,
  overrides: readonly PermissionOverrideLike[] = [],
): boolean {
  return pode(role, overrides, CANCELAR);
}

export function canRescheduleAppointments(
  role: EstablishmentRole,
  overrides: readonly PermissionOverrideLike[] = [],
): boolean {
  return pode(role, overrides, REMARCAR);
}

/** Confirmar, iniciar, concluir e registrar falta (Lote 6D.7). */
export function canManageAppointmentStatus(
  role: EstablishmentRole,
  overrides: readonly PermissionOverrideLike[] = [],
): boolean {
  return pode(role, overrides, ANDAMENTO);
}

/** Lista de solicitações. Dono: a mesma política de ver a agenda. */
export function canViewBookingRequests(
  role: EstablishmentRole,
  overrides: readonly PermissionOverrideLike[] = [],
): boolean {
  return pode(role, overrides, VER_SOLICITACOES);
}

/** Confirmar ou recusar uma reserva ainda `PENDING` SEM o andamento ou o
 * cancelamento gerais. Só o gerente com `SOLICITACOES_TRATAR`; o dono trata
 * pelas políticas gerais. */
export function canHandleBookingRequests(
  role: EstablishmentRole,
  overrides: readonly PermissionOverrideLike[] = [],
): boolean {
  return pode(role, overrides, TRATAR_SOLICITACOES);
}

/** Avisos de solicitação no aparelho: só o DONO neste lote, com a política
 * de ver a agenda. O gerente não se inscreve nem recebe (o despachante lê os
 * ajustes gravados, sem a confirmação do dono, e não deve ampliar nada). */
export function canReceiveBookingAlerts(
  role: EstablishmentRole,
  overrides: readonly PermissionOverrideLike[] = [],
): boolean {
  return pode(role, overrides, RECEBER_AVISOS);
}

// RECORTE DA RESPOSTA (appointments.service.ts, `recortarParaQuemPediu`): só
// o GERENTE tem recorte. O dono vê tudo, mesmo com DENIED nessas permissões,
// como sempre; os outros papéis nem chegam às rotas da agenda.

/** Telefone e observações do cliente: o gerente só com a consulta de clientes. */
export function canSeeAppointmentContact(
  role: EstablishmentRole,
  overrides: readonly PermissionOverrideLike[] = [],
): boolean {
  if (role !== EstablishmentRole.GERENTE) return true;
  return accessCan(effectiveAccess(role, overrides), 'CONSUMIDORES_VISUALIZAR');
}

/** Preço dos atendimentos: o gerente só com a consulta de recebimentos. */
export function canSeeAppointmentPrices(
  role: EstablishmentRole,
  overrides: readonly PermissionOverrideLike[] = [],
): boolean {
  if (role !== EstablishmentRole.GERENTE) return true;
  return accessCan(effectiveAccess(role, overrides), 'RECEBIMENTOS_VISUALIZAR');
}
