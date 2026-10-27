// Quem registra, consulta e estorna recebimentos de atendimentos: só o DONO
// do estabelecimento, como os clientes e a agenda geral. Não há permissão
// financeira própria no enum ainda; ampliar para outro papel é decisão de um
// lote de papéis, não suposição daqui. O funcionário nunca vê dinheiro.
import { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import type { PermissionOverrideLike } from '../common/tenant-authorization.js';

export const PAYMENTS_FORBIDDEN_MESSAGE =
  'Você não tem permissão para ver ou registrar recebimentos deste estabelecimento.';

export function canManagePayments(role: EstablishmentRole, _overrides: readonly PermissionOverrideLike[] = []): boolean {
  return role === EstablishmentRole.DONO;
}
