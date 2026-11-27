// A base comum reproduz, para TODAS as permissões de gerente, as regras por
// papel de antes: `managerCan` (GERENTE), `receptionistCan` (RECEPCIONISTA),
// `algumaNegada` com as dependências (DONO) e nada para os demais papéis; no
// alcance próprio, a regra anterior de `staffPermissionGranted` (escrita por
// extenso) para as permissões de funcionário; e a agenda própria de
// `canViewOwnAgenda` (o funcionário sempre, o gerente só confirmado).
import { describe, expect, it } from 'vitest';
import { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { Permission } from '../entities/enums/permission.enum.js';
import { PermissionMode } from '../entities/enums/permission-mode.enum.js';
import {
  accessAllows,
  accessCan,
  accessCanOwn,
  accessGrantedPermissions,
  accessHasOwnAgenda,
  effectiveAccess,
  legacyGrantedPermissions,
  legacyOwnAgenda,
  legacyOwnPermissions,
  requiredFor,
  staffCan,
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

  it('accessCanOwn e staffCan reproduzem a regra anterior de cada permissão de funcionário, em todos os papéis', () => {
    // Regra de `staffPermissionGranted` antes da base comum, escrita por
    // extenso (a função agora decide pela própria base).
    const antesProprio = (role: string, ov: readonly PermissionOverrideLike[], p: string) =>
      (role === 'PROFISSIONAL' || role === 'GERENTE') &&
      ov.some((o) => o.permission === p && o.mode === 'GRANTED') &&
      !ov.some((o) => o.permission === p && o.mode === 'DENIED');
    const estados = [[], [PermissionMode.GRANTED], [PermissionMode.DENIED], [PermissionMode.GRANTED, PermissionMode.DENIED]];
    for (const role of PAPEIS) {
      // Todas as combinações das quatro permissões de funcionário (4⁴).
      for (let k = 0; k < estados.length ** STAFF_PERMISSIONS.length; k++) {
        const ov: PermissionOverrideLike[] = [];
        STAFF_PERMISSIONS.forEach((permission, i) => {
          for (const mode of estados[Math.floor(k / estados.length ** i) % estados.length]) ov.push({ permission: permission as Permission, mode });
        });
        const acesso = effectiveAccess(role, ov);
        for (const p of STAFF_PERMISSIONS) {
          expect(accessCanOwn(acesso, p), `${role} ${k} ${p}`).toBe(antesProprio(role, ov, p));
          expect(staffCan(acesso, p), `${role} ${k} ${p}`).toBe(antesProprio(role, ov, p));
          expect(staffPermissionGranted(role, ov, p), `${role} ${k} ${p}`).toBe(antesProprio(role, ov, p));
        }
      }
    }
  });

  it('staffCan com permissão de gerente vale o mesmo que accessCan (e que a regra anterior)', () => {
    const sortear = sorteador(20261127);
    const universo = [...new Set<string>([...MANAGER_PERMISSIONS, ...STAFF_PERMISSIONS, ...Object.values(Permission)])];
    const diferentes: string[] = [];
    for (let i = 0; i < 1000; i++) {
      const role = PAPEIS[Math.floor(sortear() * PAPEIS.length)];
      const ov: PermissionOverrideLike[] = [];
      for (const permission of universo) {
        const r = sortear();
        if (r < 0.3) ov.push({ permission: permission as Permission, mode: PermissionMode.GRANTED });
        else if (r < 0.4) ov.push({ permission: permission as Permission, mode: PermissionMode.DENIED });
      }
      const acesso = effectiveAccess(role, ov);
      for (const p of MANAGER_PERMISSIONS) {
        const pode = staffCan(acesso, p);
        if (pode !== accessCan(acesso, p) || pode !== antes(role, ov, p)) diferentes.push(`${role} ${i} ${p}`);
      }
    }
    expect(diferentes).toEqual([]);
  });

  it('agenda própria: o funcionário sempre, o gerente só confirmado, o dono e a recepcionista nunca; os ajustes não mudam isso', () => {
    const tudo = [...MANAGER_PERMISSIONS, ...STAFF_PERMISSIONS].map((p) => ({ permission: p as Permission, mode: PermissionMode.GRANTED }));
    for (const role of PAPEIS) {
      for (const permissionsConfirmed of [true, false]) {
        const esperado = role === 'PROFISSIONAL' || (role === 'GERENTE' && permissionsConfirmed);
        for (const ov of [[], tudo, tudo.map((o) => ({ ...o, mode: PermissionMode.DENIED }))]) {
          expect(accessHasOwnAgenda(effectiveAccess(role, ov, { permissionsConfirmed })), `${role} ${permissionsConfirmed}`).toBe(esperado);
        }
        expect(legacyOwnAgenda(role, permissionsConfirmed)).toBe(esperado);
      }
      // Sem a opção, como não confirmado.
      expect(accessHasOwnAgenda(effectiveAccess(role, tudo))).toBe(role === 'PROFISSIONAL');
    }
  });

  it('accessGrantedPermissions: as de funcionário e depois as de gerente ou da recepcionista, na ordem do catálogo; o dono nenhuma', () => {
    const tudo = [...MANAGER_PERMISSIONS, ...STAFF_PERMISSIONS].map((p) => ({ permission: p as Permission, mode: PermissionMode.GRANTED }));
    expect(accessGrantedPermissions(effectiveAccess('DONO', tudo))).toEqual([]);
    expect(accessGrantedPermissions(effectiveAccess('GERENTE', tudo))).toEqual([...STAFF_PERMISSIONS, ...MANAGER_PERMISSIONS]);
    expect(accessGrantedPermissions(effectiveAccess('PROFISSIONAL', tudo))).toEqual([...STAFF_PERMISSIONS]);
    expect(accessGrantedPermissions(effectiveAccess('RECEPCIONISTA', tudo))).toEqual(['VENDAS_REGISTRAR', 'VENDAS_RECEBER', 'VENDAS_ALTERAR_PRECO']);
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
