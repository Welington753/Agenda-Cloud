import { describe, expect, it } from 'vitest';
import { PlatformRole } from '../entities/enums/platform-role.enum.js';
import { UserStatus } from '../entities/enums/user-status.enum.js';
import { platformCapabilities } from '../platform/platform-access.js';
import { canManageAccount, platformDataVisibility, type Actor } from './actor.js';

const actor = (caps: Partial<Actor['caps']>): Actor => ({
  id: 'quem-olha',
  name: 'Quem olha',
  status: UserStatus.ACTIVE,
  platformRole: null,
  platformPermissions: null,
  caps: { viewDirectory: true, manageEstablishments: true, managePlatformAccess: false, manageEstablishmentLifecycle: false, ...caps },
});

describe('dados de plataforma na ficha de uma conta', () => {
  const proprietario = actor(
    platformCapabilities({ status: UserStatus.ACTIVE, platformRole: PlatformRole.MASTER_OWNER, platformPermissions: [] }),
  );
  // Hoje só o proprietário entra no portal e ele tem todas as capacidades;
  // a regra é da capacidade, não do nome do papel, para continuar valendo se
  // um dia houver quem consulte sem cuidar dos acessos da plataforma.
  const semAcessoDePlataforma = actor({ managePlatformAccess: false });

  it('conta sem papel de plataforma: sempre visível', () => {
    expect(platformDataVisibility(semAcessoDePlataforma, { platformRole: null, hasEstablishmentLink: false })).toBe('VISIBLE');
  });

  it('quem cuida dos acessos da plataforma vê tudo', () => {
    for (const hasEstablishmentLink of [true, false]) {
      expect(platformDataVisibility(proprietario, { platformRole: PlatformRole.MASTER_OWNER, hasEstablishmentLink })).toBe('VISIBLE');
    }
  });

  it('sem essa capacidade: conta mista sai sem os dados administrativos; só administrativa não existe', () => {
    expect(
      platformDataVisibility(semAcessoDePlataforma, { platformRole: PlatformRole.MASTER_OWNER, hasEstablishmentLink: true }),
    ).toBe('HIDDEN');
    expect(
      platformDataVisibility(semAcessoDePlataforma, { platformRole: PlatformRole.MASTER_SUPPORT, hasEstablishmentLink: false }),
    ).toBe('NOT_FOUND');
    // Ocultar o dado nunca libera ação sobre a conta administrativa.
    expect(canManageAccount(semAcessoDePlataforma, { id: 'alvo', platformRole: PlatformRole.MASTER_OWNER })).toBe(false);
  });

  it('o papel de dono de estabelecimento não dá capacidade nenhuma no portal', () => {
    expect(platformCapabilities({ status: UserStatus.ACTIVE, platformRole: undefined, platformPermissions: [] }).managePlatformAccess).toBe(false);
  });
});
