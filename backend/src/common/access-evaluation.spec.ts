// A base comum reproduz, para TODAS as permissões de gerente, as regras por
// papel de antes: `managerCan` (GERENTE), `receptionistCan` (RECEPCIONISTA),
// `algumaNegada` com as dependências (DONO) e nada para os demais papéis; e,
// no alcance próprio, `staffPermissionGranted` para as permissões de funcionário.
import { describe, expect, it } from 'vitest';
import { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { Permission } from '../entities/enums/permission.enum.js';
import { PermissionMode } from '../entities/enums/permission-mode.enum.js';
import {
  accessAllows,
  accessCan,
  accessCanOwn,
  effectiveAccess,
  legacyGrantedPermissions,
  legacyOwnPermissions,
  requiredFor,
  type LegacyAction,
} from './access-evaluation.js';
import { MANAGER_PERMISSIONS, MANAGER_PERMISSION_REQUIRES, managerCan, receptionistCan } from './manager-permissions.js';
import { STAFF_PERMISSIONS } from './staff-permissions.js';
import { algumaNegada, type PermissionOverrideLike } from './tenant-authorization.js';
import { staffPermissionGranted } from '../team/staff-access.js';

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
    // Acumula as diferenças e afirma uma vez: um `expect` por comparação
    // passava de 5 s com a bateria inteira rodando em paralelo.
    const diferencas: string[] = [];
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
      for (const p of MANAGER_PERMISSIONS) {
        if (accessCan(acesso, p) !== antes(role, ov, p) && diferencas.length < 5) diferencas.push(`${role} caso ${i} ${p}`);
      }
    }
    expect(diferencas).toEqual([]);
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

  it('accessAllows: lista literal do dono e concessões com dependências para os demais', () => {
    const G = (...ps: string[]) => ps.map((p) => ({ permission: p as Permission, mode: PermissionMode.GRANTED }));
    const D = (...ps: string[]) => ps.map((p) => ({ permission: p as Permission, mode: PermissionMode.DENIED }));
    const ver: LegacyAction = { grants: ['AGENDA_VISUALIZAR'], ownerDenials: [Permission.AGENDA_VISUALIZAR] };
    // Dono: só a lista dele conta (a dependência do gerente não).
    expect(accessAllows(effectiveAccess('DONO', D('PROFISSIONAIS_VISUALIZAR')), ver)).toBe(true);
    expect(accessAllows(effectiveAccess('DONO', D('AGENDA_VISUALIZAR')), ver)).toBe(false);
    // Gerente: a concessão e as dependências dela.
    expect(accessAllows(effectiveAccess('GERENTE', G('AGENDA_VISUALIZAR')), ver)).toBe(false);
    expect(accessAllows(effectiveAccess('GERENTE', G('AGENDA_VISUALIZAR', 'PROFISSIONAIS_VISUALIZAR')), ver)).toBe(true);
    // `null` de um lado fecha aquele lado; concessões vazias nunca liberam.
    const tudo = G(...MANAGER_PERMISSIONS);
    expect(accessAllows(effectiveAccess('DONO'), { grants: ['SOLICITACOES_TRATAR'], ownerDenials: null })).toBe(false);
    expect(accessAllows(effectiveAccess('GERENTE', tudo), { grants: null, ownerDenials: [] })).toBe(false);
    expect(accessAllows(effectiveAccess('GERENTE', tudo), { grants: [], ownerDenials: [] })).toBe(false);
    expect(accessAllows(effectiveAccess('DONO'), { grants: null, ownerDenials: [] })).toBe(true);
    // Papéis sem concessão de gerente, nunca.
    for (const role of ['PROFISSIONAL', 'RECEPCIONISTA']) expect(accessAllows(effectiveAccess(role, tudo), ver), role).toBe(false);
  });

  it('accessAllows com a lista do dono igual às dependências vale o mesmo que accessCan', () => {
    for (const role of PAPEIS) {
      for (const alvo of MANAGER_PERMISSIONS) {
        for (const modo of [PermissionMode.GRANTED, PermissionMode.DENIED]) {
          const ov = [{ permission: alvo as Permission, mode: modo }];
          const acesso = effectiveAccess(role, ov);
          for (const p of MANAGER_PERMISSIONS) {
            const acao: LegacyAction = { grants: [p], ownerDenials: requiredFor(p) as readonly string[] as Permission[] };
            expect(accessAllows(acesso, acao), `${role} ${alvo} ${modo} ${p}`).toBe(accessCan(acesso, p));
          }
        }
      }
    }
  });

  it('accessCanOwn reproduz staffPermissionGranted para cada permissão de funcionário, em todos os papéis', () => {
    const estados = [[], [PermissionMode.GRANTED], [PermissionMode.DENIED], [PermissionMode.GRANTED, PermissionMode.DENIED]];
    for (const role of PAPEIS) {
      // Todas as combinações das quatro permissões de funcionário (4⁴).
      for (let k = 0; k < estados.length ** STAFF_PERMISSIONS.length; k++) {
        const ov: PermissionOverrideLike[] = [];
        STAFF_PERMISSIONS.forEach((permission, i) => {
          for (const mode of estados[Math.floor(k / estados.length ** i) % estados.length]) ov.push({ permission: permission as Permission, mode });
        });
        const acesso = effectiveAccess(role, ov);
        for (const p of STAFF_PERMISSIONS) expect(accessCanOwn(acesso, p), `${role} ${k} ${p}`).toBe(staffPermissionGranted(role, ov, p));
      }
    }
  });

  it('alcance próprio: o dono e a recepcionista nunca; concessões de gerente não entram nele, nem as de funcionário nas de gerente', () => {
    const tudo = [...MANAGER_PERMISSIONS, ...STAFF_PERMISSIONS].map((p) => ({ permission: p as Permission, mode: PermissionMode.GRANTED }));
    for (const role of ['DONO', 'RECEPCIONISTA']) {
      for (const p of STAFF_PERMISSIONS) expect(accessCanOwn(effectiveAccess(role, tudo), p), `${role} ${p}`).toBe(false);
    }
    expect(legacyOwnPermissions('GERENTE', tudo)).toEqual(new Set(STAFF_PERMISSIONS));
    expect(legacyOwnPermissions('PROFISSIONAL', tudo)).toEqual(new Set(STAFF_PERMISSIONS));
    expect(legacyGrantedPermissions('PROFISSIONAL', tudo).size).toBe(0);
    expect([...legacyGrantedPermissions('GERENTE', tudo)].some((p) => (STAFF_PERMISSIONS as readonly string[]).includes(p))).toBe(false);
  });
});
