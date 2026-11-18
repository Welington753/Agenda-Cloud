// Quem consulta e opera o estoque (docs/plans/estoque-v1.md). Funções puras;
// o recurso do adicional (`ESTOQUE`) é conferido antes, pela rota
// (common/tenant-authorization.ts): sem o adicional contratado, nenhuma
// destas políticas chega a ser consultada.
//
// DONO: consulta e opera, salvo `DENIED` gravado pela administração (operar
// exige também não ter a consulta negada).
// GERENTE: só com o que o dono concedeu e confirmou em "Equipe e acessos":
// `ESTOQUE_VISUALIZAR` para consultar; `ESTOQUE_GERENCIAR` (que inclui a
// consulta, ver MANAGER_PERMISSION_REQUIRES) para cadastrar, movimentar e
// conferir.
// RECEPCIONISTA e PROFISSIONAL (funcionário): nunca.
import { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { Permission } from '../entities/enums/permission.enum.js';
import { algumaNegada, type PermissionOverrideLike } from '../common/tenant-authorization.js';
import { managerCan } from '../common/manager-permissions.js';

export const STOCK_FORBIDDEN_MESSAGE = 'Você não tem permissão para ver o estoque deste estabelecimento.';
export const STOCK_MANAGE_FORBIDDEN_MESSAGE = 'Você não tem permissão para operar o estoque deste estabelecimento.';

export function canViewStock(role: EstablishmentRole, overrides: readonly PermissionOverrideLike[] = []): boolean {
  if (role === EstablishmentRole.GERENTE) return managerCan(role, overrides, 'ESTOQUE_VISUALIZAR');
  if (role !== EstablishmentRole.DONO) return false;
  return !algumaNegada(overrides, [Permission.ESTOQUE_VISUALIZAR]);
}

export function canManageStock(role: EstablishmentRole, overrides: readonly PermissionOverrideLike[] = []): boolean {
  if (role === EstablishmentRole.GERENTE) return managerCan(role, overrides, 'ESTOQUE_GERENCIAR');
  if (role !== EstablishmentRole.DONO) return false;
  return !algumaNegada(overrides, [Permission.ESTOQUE_VISUALIZAR, Permission.ESTOQUE_GERENCIAR]);
}
