import { describe, expect, it } from 'vitest';
import { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { Permission } from '../entities/enums/permission.enum.js';
import { PermissionMode } from '../entities/enums/permission-mode.enum.js';
import { isMembershipActive } from '../common/tenant-authorization.js';
import {
  STAFF_PERMISSIONS,
  canManageTeam,
  canViewOwnAgenda,
  grantableStaffPermissions,
  staffGrantedPermissions,
  staffPermissionGranted,
} from './staff-access.js';

const granted = (permission: string) => ({ permission, mode: PermissionMode.GRANTED as string });
const denied = (permission: string) => ({ permission, mode: PermissionMode.DENIED as string });

describe('política do funcionário', () => {
  it('só PROFISSIONAL vê a própria agenda', () => {
    expect(canViewOwnAgenda(EstablishmentRole.PROFISSIONAL)).toBe(true);
    for (const role of [EstablishmentRole.DONO, EstablishmentRole.GERENTE, EstablishmentRole.RECEPCIONISTA]) {
      expect(canViewOwnAgenda(role)).toBe(false);
    }
  });

  it('ações começam desligadas; GRANTED liga uma a uma; DENIED sempre vence', () => {
    const role = EstablishmentRole.PROFISSIONAL;
    expect(staffGrantedPermissions(role, [])).toEqual([]);
    expect(staffGrantedPermissions(role, [granted('ATENDIMENTO_PROPRIO_INICIAR')])).toEqual([
      'ATENDIMENTO_PROPRIO_INICIAR',
    ]);
    expect(
      staffPermissionGranted(role, [granted('ATENDIMENTO_PROPRIO_FALTA'), denied('ATENDIMENTO_PROPRIO_FALTA')], 'ATENDIMENTO_PROPRIO_FALTA'),
    ).toBe(false);
  });

  it('permissões do dono com GRANTED não liberam nada ao funcionário', () => {
    const todas = Object.values(Permission).map(granted);
    expect(staffGrantedPermissions(EstablishmentRole.PROFISSIONAL, todas)).toEqual([]);
  });

  it('GRANTED de funcionário num DONO não vira ação de funcionário', () => {
    expect(staffGrantedPermissions(EstablishmentRole.DONO, STAFF_PERMISSIONS.map(granted))).toEqual([]);
  });
});

describe('gestão da equipe pelo dono', () => {
  it('só DONO, e EQUIPE_GERENCIAR negado tira a gestão', () => {
    expect(canManageTeam(EstablishmentRole.DONO)).toBe(true);
    expect(canManageTeam(EstablishmentRole.PROFISSIONAL)).toBe(false);
    expect(canManageTeam(EstablishmentRole.GERENTE)).toBe(false);
    expect(
      canManageTeam(EstablishmentRole.DONO, [{ permission: Permission.EQUIPE_GERENCIAR, mode: PermissionMode.DENIED }]),
    ).toBe(false);
  });

  it('o dono só concede o que ele mesmo pode fazer', () => {
    expect(grantableStaffPermissions(EstablishmentRole.DONO, [])).toEqual([...STAFF_PERMISSIONS]);
    expect(
      grantableStaffPermissions(EstablishmentRole.DONO, [
        { permission: Permission.AGENDA_GERENCIAR, mode: PermissionMode.DENIED },
      ]),
    ).toEqual([]);
    expect(grantableStaffPermissions(EstablishmentRole.PROFISSIONAL, [])).toEqual([]);
  });
});

describe('vínculo ativo', () => {
  it('só ACTIVE opera; suspenso, ausente ou desconhecido não', () => {
    expect(isMembershipActive({ status: 'ACTIVE' })).toBe(true);
    expect(isMembershipActive({ status: 'SUSPENDED' })).toBe(false);
    expect(isMembershipActive({ status: undefined })).toBe(false);
    expect(isMembershipActive({ status: 'OUTRO' })).toBe(false);
  });
});
