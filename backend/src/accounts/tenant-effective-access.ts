// Acesso EFETIVO de um vínculo com estabelecimento, calculado pelas MESMAS
// funções de política que as rotas usam (`*-access.ts`). Nada aqui decide
// autorização por conta própria: se a política de uma rota mudar, a ficha da
// administração muda junto.
//
// Hoje toda rota de estabelecimento libera só o papel DONO, e um override só
// RESTRINGE (`DENIED`); `GRANTED` não amplia nada. Por isso:
// - o único papel que a administração atribui é DONO;
// - as únicas permissões que a administração ajusta são as `DENIED` que
//   alguma política consulta (`EFFECTIVE_TENANT_PERMISSIONS`);
// - um vínculo antigo com outro papel aparece com "nenhuma área liberada".
import { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { Permission } from '../entities/enums/permission.enum.js';
import type { PermissionMode } from '../entities/enums/permission-mode.enum.js';
import {
  canCancelAppointments,
  canCreateAppointments,
  canManageAppointmentStatus,
  canRescheduleAppointments,
  canViewAppointments,
} from '../appointments/appointment-access.js';
import { canViewAvailability } from '../availability/availability-access.js';
import { canManageConsumers, canViewConsumers } from '../consumers/consumer-access.js';
import { canManageProfessionals, canViewProfessionals } from '../professionals/professional-access.js';
import { canManagePublicBooking } from '../public-booking/public-booking-access.js';
import { canManageServices, canViewServices } from '../services/service-access.js';

export interface OverrideLike {
  permission: Permission;
  mode: PermissionMode;
}

type Politica = (role: EstablishmentRole, overrides: readonly OverrideLike[]) => boolean;

export const TENANT_AREAS: readonly { key: string; label: string; policy: Politica }[] = [
  { key: 'AGENDA_VER', label: 'Ver a agenda', policy: canViewAppointments },
  { key: 'AGENDA_CRIAR', label: 'Criar agendamentos', policy: canCreateAppointments },
  { key: 'AGENDA_REMARCAR', label: 'Remarcar agendamentos', policy: canRescheduleAppointments },
  { key: 'AGENDA_CANCELAR', label: 'Cancelar agendamentos', policy: canCancelAppointments },
  { key: 'AGENDA_ANDAMENTO', label: 'Confirmar, iniciar e concluir atendimentos', policy: canManageAppointmentStatus },
  { key: 'DISPONIBILIDADE', label: 'Consultar horários livres', policy: canViewAvailability },
  { key: 'CLIENTES_VER', label: 'Ver clientes', policy: canViewConsumers },
  { key: 'CLIENTES_GERENCIAR', label: 'Cadastrar clientes', policy: canManageConsumers },
  { key: 'SERVICOS_VER', label: 'Ver serviços', policy: canViewServices },
  { key: 'SERVICOS_GERENCIAR', label: 'Gerenciar serviços', policy: canManageServices },
  { key: 'PROFISSIONAIS_VER', label: 'Ver profissionais', policy: canViewProfessionals },
  { key: 'PROFISSIONAIS_GERENCIAR', label: 'Gerenciar profissionais e horários', policy: canManageProfessionals },
  { key: 'AGENDAMENTO_ONLINE', label: 'Configurar o agendamento online', policy: canManagePublicBooking },
];

/** Papéis que alguma rota libera hoje. */
export const EFFECTIVE_TENANT_ROLES: readonly EstablishmentRole[] = [EstablishmentRole.DONO];

/** Permissões cujo `DENIED` alguma política consulta (restringe de fato). */
export const EFFECTIVE_TENANT_PERMISSIONS: readonly Permission[] = [
  Permission.AGENDA_VISUALIZAR,
  Permission.AGENDA_GERENCIAR,
  Permission.AGENDAMENTO_CRIAR,
  Permission.AGENDAMENTO_EDITAR,
  Permission.AGENDAMENTO_CANCELAR,
  Permission.CONSUMIDORES_VISUALIZAR,
  Permission.CONSUMIDORES_GERENCIAR,
  Permission.SERVICOS_VISUALIZAR,
  Permission.SERVICOS_GERENCIAR,
  Permission.PROFISSIONAIS_VISUALIZAR,
  Permission.PROFISSIONAIS_GERENCIAR,
  Permission.CONFIGURACOES_GERENCIAR,
];

export interface AreaAccess {
  key: string;
  label: string;
  allowed: boolean;
}

export function tenantEffectiveAccess(
  role: EstablishmentRole,
  overrides: readonly OverrideLike[],
): AreaAccess[] {
  return TENANT_AREAS.map((area) => ({
    key: area.key,
    label: area.label,
    allowed: area.policy(role, overrides),
  }));
}
