import { describe, expect, it } from 'vitest';
import { Permission } from '../entities/enums/permission.enum.js';
import { PermissionMode } from '../entities/enums/permission-mode.enum.js';
import { algumaNegada } from './tenant-authorization.js';

const VER = Permission.SERVICOS_VISUALIZAR;
const GERENCIAR = Permission.SERVICOS_GERENCIAR;

describe('algumaNegada (ajustes do dono só restringem)', () => {
  it('sem ajuste nenhum, nada é negado', () => {
    expect(algumaNegada([], [VER, GERENCIAR])).toBe(false);
  });

  it('DENIED numa das permissões pedidas nega', () => {
    expect(algumaNegada([{ permission: GERENCIAR, mode: PermissionMode.DENIED }], [VER, GERENCIAR])).toBe(true);
  });

  it('GRANTED nunca conta como negação', () => {
    expect(algumaNegada([{ permission: VER, mode: PermissionMode.GRANTED }], [VER])).toBe(false);
  });

  it('DENIED em outra permissão não atinge as pedidas', () => {
    expect(algumaNegada([{ permission: Permission.CONSUMIDORES_VISUALIZAR, mode: PermissionMode.DENIED }], [VER])).toBe(
      false,
    );
  });

  it('lista de permissões vazia: nada a negar', () => {
    expect(algumaNegada([{ permission: VER, mode: PermissionMode.DENIED }], [])).toBe(false);
  });
});
