// Quem registra, consulta e estorna recebimentos de atendimentos: só o DONO
// do estabelecimento, como os clientes e a agenda geral. Não há permissão
// financeira própria no enum ainda; ampliar para outro papel é decisão de um
// lote de papéis, não suposição daqui. O funcionário nunca vê dinheiro.
//
// Recebimentos mostram os atendimentos (cliente, serviço, profissional,
// data) e são lançados sobre eles: a mesma política de VER A AGENDA
// (`canViewAppointments`), a mesma do Início. Um dono com a agenda
// restringida pela administração (`DENIED` em `AGENDA_VISUALIZAR`) também não
// vê nem lança recebimentos.
import type { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { canViewAppointments } from '../appointments/appointment-access.js';
import type { PermissionOverrideLike } from '../common/tenant-authorization.js';

export const PAYMENTS_FORBIDDEN_MESSAGE =
  'Você não tem permissão para ver ou registrar recebimentos deste estabelecimento.';

export function canManagePayments(role: EstablishmentRole, overrides: readonly PermissionOverrideLike[] = []): boolean {
  return canViewAppointments(role, overrides);
}
