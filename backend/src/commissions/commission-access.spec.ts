import { describe, expect, it } from 'vitest';
import { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { Permission } from '../entities/enums/permission.enum.js';
import { PermissionMode } from '../entities/enums/permission-mode.enum.js';
import { MANAGER_PERMISSIONS } from '../common/manager-permissions.js';
import { STAFF_PERMISSIONS, staffPermissionGranted } from '../team/staff-access.js';
import { canManageCommissionRules, canViewCommissions } from './commission-access.js';

const negada = (permission: Permission) => [{ permission, mode: PermissionMode.DENIED }];
const tudoConcedido = [...Object.values(Permission), ...MANAGER_PERMISSIONS, ...STAFF_PERMISSIONS].map((permission) => ({
  permission: permission as Permission,
  mode: PermissionMode.GRANTED,
}));

describe('comissões: quem vê e quem configura', () => {
  it('DONO vê e configura; cada restrição tira o que deve', () => {
    expect(canViewCommissions(EstablishmentRole.DONO)).toBe(true);
    expect(canManageCommissionRules(EstablishmentRole.DONO)).toBe(true);
    expect(canViewCommissions(EstablishmentRole.DONO, negada(Permission.COMISSOES_VISUALIZAR))).toBe(false);
    expect(canManageCommissionRules(EstablishmentRole.DONO, negada(Permission.COMISSOES_VISUALIZAR))).toBe(false);
    expect(canViewCommissions(EstablishmentRole.DONO, negada(Permission.COMISSOES_GERENCIAR))).toBe(true);
    expect(canManageCommissionRules(EstablishmentRole.DONO, negada(Permission.COMISSOES_GERENCIAR))).toBe(false);
    // O relatório mostra atendimentos e dinheiro: segue a agenda e os recebimentos.
    expect(canViewCommissions(EstablishmentRole.DONO, negada(Permission.AGENDA_VISUALIZAR))).toBe(false);
    expect(canManageCommissionRules(EstablishmentRole.DONO, negada(Permission.SERVICOS_VISUALIZAR))).toBe(false);
    expect(canManageCommissionRules(EstablishmentRole.DONO, negada(Permission.PROFISSIONAIS_VISUALIZAR))).toBe(false);
  });

  it('gerente, recepcionista e funcionário não veem nem configuram, nem com tudo concedido', () => {
    for (const role of [EstablishmentRole.GERENTE, EstablishmentRole.RECEPCIONISTA, EstablishmentRole.PROFISSIONAL]) {
      expect(canViewCommissions(role, tudoConcedido), role).toBe(false);
      expect(canManageCommissionRules(role, tudoConcedido), role).toBe(false);
    }
  });

  it('as próprias comissões só com a concessão própria; a permissão do dono não libera', () => {
    const r = EstablishmentRole.PROFISSIONAL;
    expect(staffPermissionGranted(r, [], 'COMISSOES_PROPRIAS_VISUALIZAR')).toBe(false);
    expect(
      staffPermissionGranted(r, [{ permission: 'COMISSOES_VISUALIZAR', mode: 'GRANTED' }], 'COMISSOES_PROPRIAS_VISUALIZAR'),
    ).toBe(false);
    expect(
      staffPermissionGranted(r, [{ permission: 'COMISSOES_PROPRIAS_VISUALIZAR', mode: 'GRANTED' }], 'COMISSOES_PROPRIAS_VISUALIZAR'),
    ).toBe(true);
    expect(
      staffPermissionGranted(EstablishmentRole.DONO, [{ permission: 'COMISSOES_PROPRIAS_VISUALIZAR', mode: 'GRANTED' }], 'COMISSOES_PROPRIAS_VISUALIZAR'),
    ).toBe(false);
  });
});
