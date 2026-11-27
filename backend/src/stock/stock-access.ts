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
//
// Toda decisão passa pela base comum (common/access-evaluation.ts), que
// calcula o acesso efetivo pelo modelo LEGADO: as mesmas regras por papel de
// antes. A recepcionista não vê o estoque porque nenhuma permissão de
// estoque está na lista dela (RECEPTIONIST_PERMISSIONS); o funcionário não
// tem concessão de gerente. A divisão de ESTOQUE_GERENCIAR em permissões
// menores é da etapa do modelo individual, não desta.
import type { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { accessCan, effectiveAccess } from '../common/access-evaluation.js';
import type { PermissionOverrideLike } from '../common/tenant-authorization.js';

export const STOCK_FORBIDDEN_MESSAGE = 'Você não tem permissão para ver o estoque deste estabelecimento.';
export const STOCK_MANAGE_FORBIDDEN_MESSAGE = 'Você não tem permissão para operar o estoque deste estabelecimento.';

export function canViewStock(role: EstablishmentRole, overrides: readonly PermissionOverrideLike[] = []): boolean {
  return accessCan(effectiveAccess(role, overrides), 'ESTOQUE_VISUALIZAR');
}

export function canManageStock(role: EstablishmentRole, overrides: readonly PermissionOverrideLike[] = []): boolean {
  return accessCan(effectiveAccess(role, overrides), 'ESTOQUE_GERENCIAR');
}
