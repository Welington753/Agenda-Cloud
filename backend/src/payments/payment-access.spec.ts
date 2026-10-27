// Política de acesso aos recebimentos manuais.
import { describe, expect, it } from 'vitest';
import { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { Permission } from '../entities/enums/permission.enum.js';
import { PermissionMode } from '../entities/enums/permission-mode.enum.js';
import { canManagePayments } from './payment-access.js';

const negado = (permission: Permission) => [{ permission, mode: PermissionMode.DENIED }];
const concedido = (permission: Permission) => [{ permission, mode: PermissionMode.GRANTED }];

describe('canManagePayments', () => {
  it('DONO registra e consulta recebimentos', () => {
    expect(canManagePayments(EstablishmentRole.DONO)).toBe(true);
  });

  it.each([EstablishmentRole.GERENTE, EstablishmentRole.RECEPCIONISTA, EstablishmentRole.PROFISSIONAL])(
    '%s nunca vê dinheiro',
    (role) => {
      expect(canManagePayments(role)).toBe(false);
      expect(canManagePayments(role, concedido(Permission.AGENDA_VISUALIZAR))).toBe(false);
    },
  );

  it('DENIED em AGENDA_VISUALIZAR tira os recebimentos do próprio DONO', () => {
    expect(canManagePayments(EstablishmentRole.DONO, negado(Permission.AGENDA_VISUALIZAR))).toBe(false);
  });

  it('restrição de outra área não tira os recebimentos', () => {
    expect(canManagePayments(EstablishmentRole.DONO, negado(Permission.SERVICOS_GERENCIAR))).toBe(true);
  });
});
