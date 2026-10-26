import { describe, expect, it } from 'vitest';
import { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { Permission } from '../entities/enums/permission.enum.js';
import { PermissionMode } from '../entities/enums/permission-mode.enum.js';
import {
  EFFECTIVE_TENANT_PERMISSIONS,
  TENANT_AREAS,
  tenantEffectiveAccess,
} from './tenant-effective-access.js';
import { STAFF_PERMISSIONS } from '../team/staff-access.js';

const allowed = (role: EstablishmentRole, overrides = [] as { permission: Permission; mode: PermissionMode }[]) =>
  tenantEffectiveAccess(role, overrides)
    .filter((area) => area.allowed)
    .map((area) => area.key);

/** Áreas do funcionário (agenda própria): nunca do DONO. */
const AREAS_DO_FUNCIONARIO = TENANT_AREAS.filter((area) => area.key.startsWith('AGENDA_PROPRIA_')).map((a) => a.key);
const AREAS_DO_DONO = TENANT_AREAS.filter((area) => !AREAS_DO_FUNCIONARIO.includes(area.key)).map((a) => a.key);
const GRANTED_DE_DONO = Object.values(Permission).map((permission) => ({ permission, mode: PermissionMode.GRANTED }));
const GRANTED_DE_FUNCIONARIO = STAFF_PERMISSIONS.map((permission) => ({
  permission: permission as unknown as Permission,
  mode: PermissionMode.GRANTED,
}));

describe('acesso efetivo de um vínculo', () => {
  it('DONO sem restrição tem todas as áreas de dono e nenhuma de funcionário', () => {
    expect(allowed(EstablishmentRole.DONO)).toEqual(AREAS_DO_DONO);
    expect(allowed(EstablishmentRole.DONO, GRANTED_DE_FUNCIONARIO)).toEqual(AREAS_DO_DONO);
  });

  it('GERENTE e RECEPCIONISTA não têm área nenhuma, nem com GRANTED (as rotas não ampliam)', () => {
    for (const role of [EstablishmentRole.GERENTE, EstablishmentRole.RECEPCIONISTA]) {
      expect(allowed(role, [...GRANTED_DE_DONO, ...GRANTED_DE_FUNCIONARIO])).toEqual([]);
    }
  });

  it('PROFISSIONAL vê só a própria agenda; as ações só com GRANTED do dono; nunca áreas de dono', () => {
    expect(allowed(EstablishmentRole.PROFISSIONAL)).toEqual(['AGENDA_PROPRIA_VER']);
    expect(allowed(EstablishmentRole.PROFISSIONAL, GRANTED_DE_DONO)).toEqual(['AGENDA_PROPRIA_VER']);
    expect(allowed(EstablishmentRole.PROFISSIONAL, GRANTED_DE_FUNCIONARIO)).toEqual(AREAS_DO_FUNCIONARIO);
    const negadaUma = [
      ...GRANTED_DE_FUNCIONARIO.filter((g) => (g.permission as string) !== 'ATENDIMENTO_PROPRIO_FALTA'),
      { permission: 'ATENDIMENTO_PROPRIO_FALTA' as unknown as Permission, mode: PermissionMode.DENIED },
    ];
    expect(allowed(EstablishmentRole.PROFISSIONAL, negadaUma)).not.toContain('AGENDA_PROPRIA_FALTA');
  });

  it('cada permissão ajustável restringe pelo menos uma área do DONO', () => {
    const total = AREAS_DO_DONO.length;
    for (const permission of EFFECTIVE_TENANT_PERMISSIONS) {
      const restante = allowed(EstablishmentRole.DONO, [{ permission, mode: PermissionMode.DENIED }]);
      expect(restante.length, permission).toBeLessThan(total);
    }
  });

  it('uma permissão sem efeito em nenhuma política não é ajustável', () => {
    for (const permission of Object.values(Permission)) {
      if (EFFECTIVE_TENANT_PERMISSIONS.includes(permission)) continue;
      expect(allowed(EstablishmentRole.DONO, [{ permission, mode: PermissionMode.DENIED }]), permission).toHaveLength(
        AREAS_DO_DONO.length,
      );
    }
  });

  it('negar ver clientes também tira cadastrar clientes', () => {
    const areas = allowed(EstablishmentRole.DONO, [
      { permission: Permission.CONSUMIDORES_VISUALIZAR, mode: PermissionMode.DENIED },
    ]);
    expect(areas).not.toContain('CLIENTES_VER');
    expect(areas).not.toContain('CLIENTES_GERENCIAR');
    expect(areas).toContain('SERVICOS_VER');
  });
});
