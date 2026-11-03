import { describe, expect, it } from 'vitest';
import { PlatformPermission } from '../entities/enums/platform-permission.enum.js';
import { PlatformRole } from '../entities/enums/platform-role.enum.js';
import { UserStatus } from '../entities/enums/user-status.enum.js';
import { ASSIGNABLE_PLATFORM_ROLES, EFFECTIVE_PLATFORM_PERMISSIONS, platformCapabilities } from './platform-access.js';

const conta = (platformRole?: PlatformRole, platformPermissions?: PlatformPermission[], status = UserStatus.ACTIVE) => ({
  status,
  platformRole,
  platformPermissions,
});
const EM = [PlatformPermission.ESTABLISHMENTS_MANAGE];

describe('capacidades da plataforma', () => {
  it('MASTER_OWNER faz tudo; só ele gerencia papéis da plataforma', () => {
    expect(platformCapabilities(conta(PlatformRole.MASTER_OWNER))).toEqual({
      viewDirectory: true,
      manageEstablishments: true,
      managePlatformAccess: true,
      manageEstablishmentLifecycle: true,
    });
    expect(platformCapabilities(conta(PlatformRole.MASTER_ADMIN, EM)).managePlatformAccess).toBe(false);
  });

  it('portal exclusivo do proprietário: MASTER_ADMIN e MASTER_SUPPORT não abrem nada, com ou sem permissão', () => {
    const nada = {
      viewDirectory: false,
      manageEstablishments: false,
      managePlatformAccess: false,
      manageEstablishmentLifecycle: false,
    };
    for (const papel of [PlatformRole.MASTER_ADMIN, PlatformRole.MASTER_SUPPORT]) {
      expect(platformCapabilities(conta(papel))).toEqual(nada);
      expect(platformCapabilities(conta(papel, EM))).toEqual(nada);
      expect(platformCapabilities(conta(papel, Object.values(PlatformPermission)))).toEqual(nada);
    }
    expect(ASSIGNABLE_PLATFORM_ROLES).toEqual([PlatformRole.MASTER_OWNER]);
  });

  it('sem papel, conta não ativa ou permissões sem efeito: nada', () => {
    const todas = Object.values(PlatformPermission);
    expect(platformCapabilities(conta(undefined, todas)).viewDirectory).toBe(false);
    expect(platformCapabilities(conta(PlatformRole.MASTER_OWNER, undefined, UserStatus.SUSPENDED)).viewDirectory).toBe(false);
    expect(platformCapabilities(conta(PlatformRole.MASTER_ADMIN, [PlatformPermission.SUPPORT_ACCESS, PlatformPermission.PLANS_MANAGE])).viewDirectory).toBe(false);
    expect(EFFECTIVE_PLATFORM_PERMISSIONS).toEqual([]);
  });
});
