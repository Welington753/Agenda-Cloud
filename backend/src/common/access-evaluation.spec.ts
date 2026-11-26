// A base comum reproduz, para TODAS as permissões de gerente, as regras por
// papel de antes: `managerCan` (GERENTE), `receptionistCan` (RECEPCIONISTA),
// `algumaNegada` com as dependências (DONO) e nada para os demais papéis.
import { describe, expect, it } from 'vitest';
import { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { Permission } from '../entities/enums/permission.enum.js';
import { PermissionMode } from '../entities/enums/permission-mode.enum.js';
import { accessCan, effectiveAccess, legacyGrantedPermissions, requiredFor } from './access-evaluation.js';
import { MANAGER_PERMISSIONS, MANAGER_PERMISSION_REQUIRES, managerCan, receptionistCan } from './manager-permissions.js';
import { algumaNegada, type PermissionOverrideLike } from './tenant-authorization.js';

const PAPEIS = Object.values(EstablishmentRole);

function antes(role: string, ov: readonly PermissionOverrideLike[], p: (typeof MANAGER_PERMISSIONS)[number]): boolean {
  if (role === 'GERENTE') return managerCan(role, ov, p);
  if (role === 'RECEPCIONISTA') return receptionistCan(role, ov, p);
  if (role !== 'DONO') return false;
  return !algumaNegada(ov, [p, ...MANAGER_PERMISSION_REQUIRES[p]] as string[] as Permission[]);
}

function sorteador(semente: number) {
  let s = semente >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('access-evaluation (modelo LEGADO)', () => {
  it('requiredFor devolve a permissão e as dependências', () => {
    expect(requiredFor('VENDAS_CANCELAR')).toEqual(['VENDAS_CANCELAR', 'VENDAS_VISUALIZAR']);
  });

  it('cada permissão sozinha, em GRANTED, DENIED ou os dois, em todos os papéis', () => {
    for (const role of PAPEIS) {
      for (const alvo of MANAGER_PERMISSIONS) {
        for (const modos of [[PermissionMode.GRANTED], [PermissionMode.DENIED], [PermissionMode.GRANTED, PermissionMode.DENIED]]) {
          const ov = modos.map((mode) => ({ permission: alvo as Permission, mode }));
          for (const p of MANAGER_PERMISSIONS) expect(accessCan(effectiveAccess(role, ov), p), `${role} ${alvo} ${modos} ${p}`).toBe(antes(role, ov, p));
        }
      }
    }
  });

  it('lote pseudoaleatório de semente fixa com todas as permissões do enum', () => {
    const sortear = sorteador(1126);
    const universo = Object.values(Permission);
    for (let i = 0; i < 5_000; i++) {
      const role = PAPEIS[Math.floor(sortear() * PAPEIS.length)];
      const ov: PermissionOverrideLike[] = [];
      for (const permission of universo) {
        const r = sortear();
        if (r < 0.35) ov.push({ permission, mode: PermissionMode.GRANTED });
        else if (r < 0.45) ov.push({ permission, mode: PermissionMode.DENIED });
        else if (r < 0.5) ov.push({ permission, mode: PermissionMode.GRANTED }, { permission, mode: PermissionMode.DENIED });
      }
      const acesso = effectiveAccess(role, ov);
      for (const p of MANAGER_PERMISSIONS) expect(accessCan(acesso, p)).toBe(antes(role, ov, p));
    }
  });

  it('concessões fora do papel são ignoradas', () => {
    const tudo = MANAGER_PERMISSIONS.map((p) => ({ permission: p as Permission, mode: PermissionMode.GRANTED }));
    expect([...legacyGrantedPermissions('RECEPCIONISTA', tudo)].sort()).toEqual(
      ['VENDAS_ALTERAR_PRECO', 'VENDAS_RECEBER', 'VENDAS_REGISTRAR'],
    );
    expect(legacyGrantedPermissions('PROFISSIONAL', tudo).size).toBe(0);
    expect(legacyGrantedPermissions('DONO', tudo).size).toBe(0);
    expect(legacyGrantedPermissions('GERENTE', tudo).size).toBe(MANAGER_PERMISSIONS.length);
  });
});
