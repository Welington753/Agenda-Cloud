import { describe, expect, it } from 'vitest';
import { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { Permission } from '../entities/enums/permission.enum.js';
import { PermissionMode } from '../entities/enums/permission-mode.enum.js';
import {
  EFFECTIVE_TENANT_PERMISSIONS,
  TENANT_AREAS,
  tenantEffectiveAccess,
} from './tenant-effective-access.js';

const allowed = (role: EstablishmentRole, overrides = [] as { permission: Permission; mode: PermissionMode }[]) =>
  tenantEffectiveAccess(role, overrides)
    .filter((area) => area.allowed)
    .map((area) => area.key);

describe('acesso efetivo de um vínculo', () => {
  it('DONO sem restrição tem todas as áreas', () => {
    expect(allowed(EstablishmentRole.DONO)).toHaveLength(TENANT_AREAS.length);
  });

  it('outros papéis não têm área nenhuma, nem com GRANTED (as rotas não ampliam)', () => {
    for (const role of [EstablishmentRole.GERENTE, EstablishmentRole.RECEPCIONISTA, EstablishmentRole.PROFISSIONAL]) {
      const grants = Object.values(Permission).map((permission) => ({ permission, mode: PermissionMode.GRANTED }));
      expect(allowed(role, grants)).toEqual([]);
    }
  });

  it('cada permissão ajustável restringe pelo menos uma área do DONO', () => {
    const total = TENANT_AREAS.length;
    for (const permission of EFFECTIVE_TENANT_PERMISSIONS) {
      const restante = allowed(EstablishmentRole.DONO, [{ permission, mode: PermissionMode.DENIED }]);
      expect(restante.length, permission).toBeLessThan(total);
    }
  });

  it('uma permissão sem efeito em nenhuma política não é ajustável', () => {
    for (const permission of Object.values(Permission)) {
      if (EFFECTIVE_TENANT_PERMISSIONS.includes(permission)) continue;
      expect(allowed(EstablishmentRole.DONO, [{ permission, mode: PermissionMode.DENIED }]), permission).toHaveLength(
        TENANT_AREAS.length,
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
