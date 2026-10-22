import { ForbiddenException } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';
import { User } from '../entities/user.entity.js';
import { PlatformRole } from '../entities/enums/platform-role.enum.js';
import { PlatformPermission } from '../entities/enums/platform-permission.enum.js';
import { UserStatus } from '../entities/enums/user-status.enum.js';
import { canViewEstablishments } from './platform-access.js';
import { establishmentQuerySchema } from './platform.dto.js';
import { establishmentFilter } from './platform.queries.js';
import { PlatformService } from './platform.service.js';

describe('administração real da plataforma', () => {
  it.each([
    [undefined, [], false],
    [undefined, [PlatformPermission.ESTABLISHMENTS_MANAGE], false],
    [PlatformRole.MASTER_OWNER, [], true],
    [PlatformRole.MASTER_ADMIN, [], false],
    [PlatformRole.MASTER_SUPPORT, [PlatformPermission.SUPPORT_ACCESS], false],
    [
      PlatformRole.MASTER_ADMIN,
      [PlatformPermission.ESTABLISHMENTS_MANAGE],
      true,
    ],
    [
      PlatformRole.MASTER_SUPPORT,
      [PlatformPermission.ESTABLISHMENTS_MANAGE],
      true,
    ],
  ])(
    'papel %s com permissões %s => %s',
    (platformRole, platformPermissions, expected) => {
      expect(
        canViewEstablishments({
          status: UserStatus.ACTIVE,
          platformRole,
          platformPermissions,
        }),
      ).toBe(expected);
    },
  );
  it('suspensão, convite e usuário ausente nunca autorizam', () => {
    for (const status of [UserStatus.SUSPENDED, UserStatus.INVITED]) {
      expect(
        canViewEstablishments({
          status,
          platformRole: PlatformRole.MASTER_OWNER,
        }),
      ).toBe(false);
    }
    expect(canViewEstablishments(null)).toBe(false);
  });
  it.each([
    { page: '0' },
    { page: '-1' },
    { page: '1.5' },
    { page: ['1', '2'] },
    { pageSize: '101' },
    { pageSize: '0' },
    { q: 'a' },
    { q: 'x'.repeat(121) },
    { status: 'invalid' },
    { tenantId: 'outro' },
    { platformRole: 'MASTER_OWNER' },
    { planId: '' },
  ])('recusa filtros inválidos ou autoridade forjada %j', (query) => {
    expect(establishmentQuerySchema.safeParse(query).success).toBe(false);
  });
  it('limita a página e normaliza a busca, sem aceitar parâmetros desconhecidos', () => {
    expect(
      establishmentQuerySchema.parse({
        q: ' Clínica ',
        page: '2',
        pageSize: '5',
      }),
    ).toEqual({ q: 'Clínica', page: 2, pageSize: 5 });
    expect(establishmentQuerySchema.parse({})).toEqual({
      page: 1,
      pageSize: 20,
    });
  });
  it('SQL parametrizado: aspas e curingas do usuário nunca viram instrução SQL', () => {
    const query = establishmentQuerySchema.parse({
      q: "O'Brien%_\\",
      status: 'ACTIVE',
      planId: 'plan_a',
    });
    const filtro = establishmentFilter(query);
    expect(filtro.sql).not.toContain("O'Brien");
    expect(filtro.values).toEqual(["%O'Brien\\%\\_\\\\%", 'ACTIVE', 'plan_a']);
    expect(filtro.sql).toContain('t.status = $2');
    expect(filtro.sql).toContain('t.plan_id = $3');
  });
  it('lista e detalhe recusam antes de consultar estabelecimentos, inclusive depois de revogar o papel', async () => {
    const query = vi.fn().mockResolvedValue([]);
    const findOne = vi
      .fn()
      .mockResolvedValue({
        status: UserStatus.ACTIVE,
        platformRole: PlatformRole.MASTER_OWNER,
      });
    const manager = { query, findOne } as unknown as EntityManager;
    const service = new PlatformService({
      manager,
      transaction: async (
        _level: string,
        callback: (tx: EntityManager) => Promise<unknown>,
      ) => callback(manager),
    } as unknown as DataSource);
    expect(await service.access('u')).toEqual({ canViewEstablishments: true });
    findOne.mockResolvedValue({
      status: UserStatus.ACTIVE,
      platformRole: null,
    });
    await expect(service.list('u', { page: 1, pageSize: 20 })).rejects.toThrow(
      ForbiddenException,
    );
    await expect(service.detail('u', 'id_alheio')).rejects.toThrow(
      ForbiddenException,
    );
    expect(findOne).toHaveBeenCalledWith(User, { where: { id: 'u' } });
    expect(
      query.mock.calls.every(([sql]) => sql === 'SET TRANSACTION READ ONLY'),
    ).toBe(true);
  });
});
