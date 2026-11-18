import { describe, expect, it } from 'vitest';
import { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { Permission } from '../entities/enums/permission.enum.js';
import { PermissionMode } from '../entities/enums/permission-mode.enum.js';
import { MANAGER_PERMISSIONS, MANAGER_PERMISSION_REQUIRES, missingManagerRequirements } from '../common/manager-permissions.js';
import { STAFF_PERMISSIONS, grantableManagerPermissions } from '../team/staff-access.js';
import { canManageStock, canViewStock } from './stock-access.js';

const negada = (...permissoes: string[]) => permissoes.map((p) => ({ permission: p as Permission, mode: PermissionMode.DENIED }));
const concedida = (...permissoes: string[]) => permissoes.map((p) => ({ permission: p as Permission, mode: PermissionMode.GRANTED }));
const tudoConcedido = concedida(...Object.values(Permission), ...MANAGER_PERMISSIONS, ...STAFF_PERMISSIONS);

describe('estoque: quem vê e quem opera', () => {
  it('DONO vê e opera; DENIED da administração tira o que deve', () => {
    expect(canViewStock(EstablishmentRole.DONO)).toBe(true);
    expect(canManageStock(EstablishmentRole.DONO)).toBe(true);
    expect(canViewStock(EstablishmentRole.DONO, negada('ESTOQUE_VISUALIZAR'))).toBe(false);
    expect(canManageStock(EstablishmentRole.DONO, negada('ESTOQUE_VISUALIZAR'))).toBe(false);
    expect(canViewStock(EstablishmentRole.DONO, negada('ESTOQUE_GERENCIAR'))).toBe(true);
    expect(canManageStock(EstablishmentRole.DONO, negada('ESTOQUE_GERENCIAR'))).toBe(false);
    // Outras áreas negadas não afetam o estoque.
    expect(canManageStock(EstablishmentRole.DONO, negada('AGENDA_VISUALIZAR', 'SERVICOS_VISUALIZAR'))).toBe(true);
  });

  it('GERENTE sem concessão não vê nem opera', () => {
    expect(canViewStock(EstablishmentRole.GERENTE)).toBe(false);
    expect(canManageStock(EstablishmentRole.GERENTE)).toBe(false);
  });

  it('GERENTE com "Ver estoque" só vê; com "Operar" (que inclui ver) vê e opera', () => {
    const ver = concedida('ESTOQUE_VISUALIZAR');
    expect(canViewStock(EstablishmentRole.GERENTE, ver)).toBe(true);
    expect(canManageStock(EstablishmentRole.GERENTE, ver)).toBe(false);
    const operar = concedida('ESTOQUE_VISUALIZAR', 'ESTOQUE_GERENCIAR');
    expect(canViewStock(EstablishmentRole.GERENTE, operar)).toBe(true);
    expect(canManageStock(EstablishmentRole.GERENTE, operar)).toBe(true);
    // Operar sem a dependência gravada não vale (o servidor nunca grava assim).
    expect(canManageStock(EstablishmentRole.GERENTE, concedida('ESTOQUE_GERENCIAR'))).toBe(false);
    // DENIED sempre vence.
    expect(canViewStock(EstablishmentRole.GERENTE, [...operar, ...negada('ESTOQUE_VISUALIZAR')])).toBe(false);
  });

  it('recepcionista e funcionário nunca, nem com tudo concedido', () => {
    for (const role of [EstablishmentRole.RECEPCIONISTA, EstablishmentRole.PROFISSIONAL]) {
      expect(canViewStock(role, tudoConcedido), role).toBe(false);
      expect(canManageStock(role, tudoConcedido), role).toBe(false);
    }
  });

  it('"Operar estoque" exige "Ver estoque" no conjunto concedido', () => {
    expect(MANAGER_PERMISSION_REQUIRES.ESTOQUE_GERENCIAR).toEqual(['ESTOQUE_VISUALIZAR']);
    expect(missingManagerRequirements(['ESTOQUE_GERENCIAR'])).toEqual(['ESTOQUE_VISUALIZAR']);
    expect(missingManagerRequirements(['ESTOQUE_VISUALIZAR', 'ESTOQUE_GERENCIAR'])).toEqual([]);
  });

  it('o dono só concede o estoque que ele mesmo pode', () => {
    expect(grantableManagerPermissions(EstablishmentRole.DONO, [])).toEqual(
      expect.arrayContaining(['ESTOQUE_VISUALIZAR', 'ESTOQUE_GERENCIAR']),
    );
    const semOperar = grantableManagerPermissions(EstablishmentRole.DONO, negada('ESTOQUE_GERENCIAR'));
    expect(semOperar).toContain('ESTOQUE_VISUALIZAR');
    expect(semOperar).not.toContain('ESTOQUE_GERENCIAR');
  });
});
