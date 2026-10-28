// Conferência, no servidor, de um conjunto de permissões que o dono quer
// deixar num acesso de equipe — a mesma na criação e na troca. Quem recebe o
// quê:
//
// - as três ações sobre os PRÓPRIOS atendimentos: quem tem profissional
//   ligado (todo PROFISSIONAL; o GERENTE só se tiver);
// - as áreas do estabelecimento (common/manager-permissions.ts): só GERENTE,
//   e só com as dependências de cada uma junto, para o dono ver e confirmar
//   o conjunto que de fato vale;
// - só o que o próprio dono pode fazer (conferido para o que ENTRA: retirar
//   é sempre possível, mesmo que o dono tenha perdido a permissão depois).
import { ConflictException } from '@nestjs/common';
import {
  MANAGER_PERMISSION_META,
  isManagerPermission,
  missingManagerRequirements,
  type ManagerPermission,
} from '../common/manager-permissions.js';
import { STAFF_PERMISSIONS, type StaffPermission, type TeamRole } from './staff-access.js';
import type { TeamManager } from './team-authorization.js';
import type { TeamPermission } from './team.dto.js';

const conflito = (code: string, message: string) => new ConflictException({ code, message });

export function isStaffPermission(valor: string): valor is StaffPermission {
  return (STAFF_PERMISSIONS as readonly string[]).includes(valor);
}

export function validarConcessoes(
  gestor: Pick<TeamManager, 'grantable' | 'grantableManager'>,
  alvo: { role: TeamRole; withProfessional: boolean },
  conjunto: readonly TeamPermission[],
  novas: readonly TeamPermission[] = conjunto,
): void {
  const proprias = conjunto.filter(isStaffPermission);
  const areas = conjunto.filter(isManagerPermission);
  if (proprias.length && !alvo.withProfessional) {
    throw conflito(
      'PERMISSAO_NAO_SE_APLICA',
      'As ações sobre os próprios atendimentos valem só para um acesso com profissional ligado.',
    );
  }
  if (areas.length && alvo.role !== 'GERENTE') {
    throw conflito('PERMISSAO_NAO_SE_APLICA', 'As áreas do estabelecimento só podem ser concedidas ao perfil Gerente.');
  }
  const indevidas = novas.filter((p) =>
    isStaffPermission(p) ? !gestor.grantable.includes(p) : !gestor.grantableManager.includes(p as ManagerPermission),
  );
  if (indevidas.length) {
    throw conflito(
      'PERMISSAO_NAO_DISPONIVEL',
      'Você só pode liberar o que você mesmo pode fazer neste estabelecimento.',
    );
  }
  const faltam = missingManagerRequirements(areas);
  if (faltam.length) {
    throw conflito(
      'PERMISSOES_INCOMPLETAS',
      `Para valer, este conjunto precisa também de: ${faltam.map((p) => MANAGER_PERMISSION_META[p].label.toLowerCase()).join('; ')}.`,
    );
  }
}
