import { describe, expect, it } from 'vitest';
import { PlatformPermission } from '../entities/enums/platform-permission.enum.js';
import { PlatformRole } from '../entities/enums/platform-role.enum.js';
import { UserStatus } from '../entities/enums/user-status.enum.js';
import { EFFECTIVE_PLATFORM_PERMISSIONS, platformCapabilities } from './platform-access.js';

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

  it('MASTER_ADMIN só com a permissão explícita; suporte só consulta', () => {
    expect(platformCapabilities(conta(PlatformRole.MASTER_ADMIN))).toEqual({
      viewDirectory: false,
      manageEstablishments: false,
      managePlatformAccess: false,
      manageEstablishmentLifecycle: false,
    });
    expect(platformCapabilities(conta(PlatformRole.MASTER_ADMIN, EM)).manageEstablishments).toBe(true);
    expect(platformCapabilities(conta(PlatformRole.MASTER_SUPPORT, EM))).toEqual({
      viewDirectory: true,
      manageEstablishments: false,
      managePlatformAccess: false,
      manageEstablishmentLifecycle: false,
    });
  });

  it('sem papel, conta não ativa ou permissões sem efeito: nada', () => {
    const todas = Object.values(PlatformPermission);
    expect(platformCapabilities(conta(undefined, todas)).viewDirectory).toBe(false);
    expect(platformCapabilities(conta(PlatformRole.MASTER_OWNER, undefined, UserStatus.SUSPENDED)).viewDirectory).toBe(false);
    expect(platformCapabilities(conta(PlatformRole.MASTER_ADMIN, [PlatformPermission.SUPPORT_ACCESS, PlatformPermission.PLANS_MANAGE])).viewDirectory).toBe(false);
    expect(EFFECTIVE_PLATFORM_PERMISSIONS).toEqual([PlatformPermission.ESTABLISHMENTS_MANAGE]);
  });
});
