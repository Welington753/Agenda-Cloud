// Quem liga/desliga o agendamento público — função pura, no molde de
// availability-access.ts.
//
// SÓ DONO, como as demais políticas reais: não há tabela de permissões
// padrão por papel, e inferir que GERENTE pode expor o estabelecimento na
// internet seria ampliar acesso por suposição.
//
// DENIED pertinentes (só restringem):
// - `CONFIGURACOES_GERENCIAR`: ligar a página pública é configuração do
//   estabelecimento;
// - `AGENDA_GERENCIAR`: a página passa a criar reservas pendentes na agenda.
import { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { Permission } from '../entities/enums/permission.enum.js';
import { algumaNegada, type PermissionOverrideLike } from '../common/tenant-authorization.js';

export const PUBLIC_BOOKING_FORBIDDEN_MESSAGE =
  'Você não tem permissão para configurar o agendamento online deste estabelecimento.';

const PERMISSOES_PERTINENTES: readonly Permission[] = [
  Permission.CONFIGURACOES_GERENCIAR,
  Permission.AGENDA_GERENCIAR,
];

export function canManagePublicBooking(
  role: EstablishmentRole,
  overrides: readonly PermissionOverrideLike[] = [],
): boolean {
  if (role !== EstablishmentRole.DONO) return false;
  return !algumaNegada(overrides, PERMISSOES_PERTINENTES);
}
