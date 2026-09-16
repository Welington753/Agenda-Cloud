// Política de acesso à consulta de disponibilidade (Lote 6D.4).
import { describe, expect, it } from 'vitest';
import { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { Permission } from '../entities/enums/permission.enum.js';
import { PermissionMode } from '../entities/enums/permission-mode.enum.js';
import { canViewAvailability } from './availability-access.js';

const negado = (permission: Permission) => [{ permission, mode: PermissionMode.DENIED }];
const concedido = (permission: Permission) => [{ permission, mode: PermissionMode.GRANTED }];

describe('canViewAvailability', () => {
  it('DONO consulta', () => {
    expect(canViewAvailability(EstablishmentRole.DONO)).toBe(true);
  });

  it.each([
    EstablishmentRole.GERENTE,
    EstablishmentRole.RECEPCIONISTA,
    EstablishmentRole.PROFISSIONAL,
  ])('%s não consulta neste lote', (role) => {
    expect(canViewAvailability(role)).toBe(false);
  });

  it.each([
    Permission.AGENDA_VISUALIZAR,
    Permission.PROFISSIONAIS_VISUALIZAR,
    Permission.SERVICOS_VISUALIZAR,
  ])('DENIED em %s tira o acesso do próprio DONO', (permission) => {
    expect(canViewAvailability(EstablishmentRole.DONO, negado(permission))).toBe(false);
  });

  it('DENIED em permissão de outra área não interfere', () => {
    expect(
      canViewAvailability(EstablishmentRole.DONO, negado(Permission.COMISSOES_VISUALIZAR)),
    ).toBe(true);
  });

  it('GRANTED nunca amplia: continua sem acesso quem não é DONO', () => {
    expect(
      canViewAvailability(EstablishmentRole.GERENTE, concedido(Permission.AGENDA_VISUALIZAR)),
    ).toBe(false);
  });
});
