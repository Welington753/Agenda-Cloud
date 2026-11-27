// Equivalência por ação e alcance entre as políticas de Comissões e a regra
// anterior à base comum (docs/plans/permissoes-individuais.md, etapa 1).
//
// A REFERÊNCIA é uma cópia congelada das regras como estavam em `be1299c`
// (iguais a `8f71335`, o piloto): `commissions/commission-access.ts`, com as
// consultas de recebimentos, profissionais e serviços do dono escritas por
// extenso, e a consulta das próprias de `team/my-agenda.service.ts`
// (`resolveStaffAccess`: agenda própria, profissional ligado e ativo, e
// `staffPermissionGranted` com `COMISSOES_PROPRIAS_VISUALIZAR`). Usa só listas
// literais, sem importar `algumaNegada`, `staffPermissionGranted`, a base comum
// nem as políticas de outras áreas.
//
// IMPRESSÃO: para cada vínculo sintético, o conjunto de pares (ação, alcance):
// - `comissoes.ver:todos`: o relatório de todos os profissionais, com o
//   recebimento do cliente (`withClientPayment: true`, fixo no serviço);
// - `comissoes.configurar:todos`: regras, configuração e aplicação em massa;
// - `comissoes.ver:proprias`: só as do profissional ligado, sem o recebimento
//   do cliente (`professionalId` do vínculo e `withClientPayment: false`,
//   fixos no serviço).
// O alcance e os campos de cada consulta são decididos no serviço por código
// que esta etapa não mudou; a impressão confere quem chega a cada alcance.
//
// Entram como GUARDA as decisões de outras áreas que dependem destas
// políticas: o que o dono pode conceder (`grantableStaffPermissions`, a
// concessão das próprias pede ver todas) e as áreas da sessão
// (`TENANT_AREAS`: COMISSOES_VER, COMISSOES_CONFIGURAR e
// AGENDA_PROPRIA_COMISSOES).
//
// Fora das políticas e intocados por esta etapa: o vínculo, a situação do
// estabelecimento, o recurso `COMISSOES` (e `EQUIPE` na consulta das
// próprias), o SQL, o filtro por `tenant_id`, o cálculo, os percentuais e
// valores fixos, a precedência das regras, as apurações, as fotografias e a
// relação com os recebimentos.
import { describe, expect, it } from 'vitest';
import { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { Permission } from '../entities/enums/permission.enum.js';
import { PermissionMode } from '../entities/enums/permission-mode.enum.js';
import { effectiveOverrides, type PermissionOverrideLike } from '../common/tenant-authorization.js';
import { MANAGER_PERMISSIONS } from '../common/manager-permissions.js';
import { STAFF_PERMISSIONS, canViewOwnAgenda, grantableStaffPermissions } from '../team/staff-access.js';
import { TENANT_AREAS } from '../accounts/tenant-effective-access.js';
import * as comissoes from './commission-access.js';

const KV = 'COMISSOES_VISUALIZAR';
const KG = 'COMISSOES_GERENCIAR';
const KP = 'COMISSOES_PROPRIAS_VISUALIZAR';
const AV = 'AGENDA_VISUALIZAR';
const PV = 'PROFISSIONAIS_VISUALIZAR';
const SV = 'SERVICOS_VISUALIZAR';
const EG = 'EQUIPE_GERENCIAR';
const RV = 'RECEBIMENTOS_VISUALIZAR';

// ---- Referência congelada (be1299c = 8f71335) ------------------------------

function refConcedida(ov: readonly PermissionOverrideLike[], p: string): boolean {
  return ov.some((o) => o.permission === p && o.mode === 'GRANTED') && !ov.some((o) => o.permission === p && o.mode === 'DENIED');
}

function refNegada(ov: readonly PermissionOverrideLike[], ps: readonly string[]): boolean {
  return ov.some((o) => o.mode === 'DENIED' && ps.includes(o.permission));
}

/** Só o dono, sem `COMISSOES_VISUALIZAR` e sem a agenda (a consulta de
 * recebimentos do dono) negadas. */
function refVerTodas(role: string, ov: readonly PermissionOverrideLike[]): boolean {
  return role === 'DONO' && !refNegada(ov, [KV]) && !refNegada(ov, [AV]);
}

/** Ver todas, sem `COMISSOES_GERENCIAR` negada, vendo profissionais e serviços. */
function refConfigurar(role: string, ov: readonly PermissionOverrideLike[]): boolean {
  return refVerTodas(role, ov) && !refNegada(ov, [KG]) && !refNegada(ov, [PV]) && !refNegada(ov, [SV]);
}

/** A concessão das próprias: funcionário ou gerente, GRANTED sem DENIED. */
function refPropriasConcedida(role: string, ov: readonly PermissionOverrideLike[]): boolean {
  return (role === 'PROFISSIONAL' || role === 'GERENTE') && refConcedida(ov, KP);
}

/** Agenda própria: o funcionário sempre; o gerente só confirmado. */
function refAgendaPropria(role: string, confirmado: boolean): boolean {
  return role === 'PROFISSIONAL' || (role === 'GERENTE' && confirmado);
}

/** Guarda: o dono (com a equipe) concede as próprias se ele mesmo vê todas. */
function refConcedeProprias(role: string, ov: readonly PermissionOverrideLike[]): boolean {
  return role === 'DONO' && !refNegada(ov, [EG]) && refVerTodas(role, ov);
}

// ---- Impressão de acesso --------------------------------------------------

type Pol = (role: EstablishmentRole, ov: readonly PermissionOverrideLike[]) => boolean;

interface Fontes {
  verTodas: Pol;
  configurar: Pol;
  propriasConcedida: Pol;
  agendaPropria: (role: EstablishmentRole, confirmado: boolean) => boolean;
  /** Profissional ligado e ativo, como `resolveStaffAccess` confere. */
  vinculoValido: (vinculo: Vinculo) => boolean;
  concedeProprias: Pol;
  sessao: Record<AreaDaSessao, Pol>;
}

type Vinculo = 'sem profissional' | 'profissional inativo' | 'profissional ativo';
const VINCULOS: Vinculo[] = ['sem profissional', 'profissional inativo', 'profissional ativo'];

const AREAS_DA_SESSAO = ['COMISSOES_VER', 'COMISSOES_CONFIGURAR', 'AGENDA_PROPRIA_COMISSOES'] as const;
type AreaDaSessao = (typeof AREAS_DA_SESSAO)[number];

const REFERENCIA: Fontes = {
  verTodas: refVerTodas,
  configurar: refConfigurar,
  propriasConcedida: refPropriasConcedida,
  agendaPropria: refAgendaPropria,
  vinculoValido: (v) => v === 'profissional ativo',
  concedeProprias: refConcedeProprias,
  sessao: { COMISSOES_VER: refVerTodas, COMISSOES_CONFIGURAR: refConfigurar, AGENDA_PROPRIA_COMISSOES: refPropriasConcedida },
};

function areaDaSessao(chave: AreaDaSessao): Pol {
  const area = TENANT_AREAS.find((a) => a.key === chave);
  if (!area) throw new Error(`área ${chave} ausente de TENANT_AREAS`);
  return area.policy;
}

/** Cada política `can*` exportada, com o par que ela decide. */
const COBERTAS = ['canViewCommissions', 'canManageCommissionRules', 'canViewOwnCommissions'];

const ATUAL: Fontes = {
  verTodas: comissoes.canViewCommissions,
  configurar: comissoes.canManageCommissionRules,
  propriasConcedida: comissoes.canViewOwnCommissions,
  agendaPropria: canViewOwnAgenda,
  vinculoValido: (v) => v === 'profissional ativo',
  concedeProprias: (role, ov) => grantableStaffPermissions(role, ov).includes(KP),
  sessao: Object.fromEntries(AREAS_DA_SESSAO.map((k) => [k, areaDaSessao(k)])) as Record<AreaDaSessao, Pol>,
};

interface Caso {
  role: EstablishmentRole;
  confirmado: boolean;
  vinculo: Vinculo;
  gravados: PermissionOverrideLike[];
  rotulo: string;
}

function impressao(f: Fontes, caso: Caso): Set<string> {
  const { role, confirmado, vinculo, gravados } = caso;
  const ov = effectiveOverrides(role, confirmado, gravados);
  const pares = new Set<string>();
  if (f.verTodas(role, ov)) pares.add('comissoes.ver:todos');
  if (f.configurar(role, ov)) pares.add('comissoes.configurar:todos');
  // A ordem de `resolveStaffAccess` e de `commissions`: agenda própria,
  // profissional ligado e ativo, depois a concessão.
  if (f.agendaPropria(role, confirmado) && f.vinculoValido(vinculo) && f.propriasConcedida(role, ov)) {
    pares.add('comissoes.ver:proprias');
  }
  if (f.concedeProprias(role, ov)) pares.add('guarda.equipe.concede:COMISSOES_PROPRIAS_VISUALIZAR');
  for (const k of AREAS_DA_SESSAO) if (f.sessao[k](role, ov)) pares.add(`guarda.sessao:${k}`);
  return pares;
}

function comparar(f: Fontes, caso: Caso): string[] {
  const antes = impressao(REFERENCIA, caso);
  const depois = impressao(f, caso);
  return [...new Set([...antes, ...depois])].filter((p) => antes.has(p) !== depois.has(p));
}

function diferencas(f: Fontes, casos: Iterable<Caso>): string[] {
  const exemplos: string[] = [];
  for (const caso of casos) {
    const dif = comparar(f, caso);
    if (dif.length && exemplos.length < 5) exemplos.push(`${caso.rotulo}: ${dif.join(', ')}`);
  }
  return exemplos;
}

// ---- Mutantes -------------------------------------------------------------

const { DONO, GERENTE, RECEPCIONISTA, PROFISSIONAL } = EstablishmentRole;

function trocar(pecas: Partial<Fontes>): Fontes {
  return { ...ATUAL, ...pecas };
}

/** Troca a política só para um papel. */
function so(alvo: EstablishmentRole, chave: 'verTodas' | 'configurar' | 'propriasConcedida', regra: Pol): Fontes {
  return trocar({ [chave]: (r: EstablishmentRole, ov: readonly PermissionOverrideLike[]) => (r === alvo ? regra(r, ov) : ATUAL[chave](r, ov)) });
}

const MUTANTES: Record<string, Fontes> = {
  'dono vê todas sem olhar a agenda': so(DONO, 'verTodas', (_r, ov) => !refNegada(ov, [KV])),
  'dono vê todas com COMISSOES_VISUALIZAR negada': so(DONO, 'verTodas', (_r, ov) => !refNegada(ov, [AV])),
  'gerente com COMISSOES_VISUALIZAR concedida vê todas': so(GERENTE, 'verTodas', (_r, ov) => refConcedida(ov, KV)),
  'funcionário com a concessão das próprias vê todas': so(PROFISSIONAL, 'verTodas', (_r, ov) => refConcedida(ov, KP)),
  'dono configura com COMISSOES_GERENCIAR negada': so(DONO, 'configurar', (_r, ov) => refVerTodas(DONO, ov) && !refNegada(ov, [PV, SV])),
  'dono configura sem ver serviços': so(DONO, 'configurar', (_r, ov) => refVerTodas(DONO, ov) && !refNegada(ov, [KG, PV])),
  'dono configura sem ver profissionais': so(DONO, 'configurar', (_r, ov) => refVerTodas(DONO, ov) && !refNegada(ov, [KG, SV])),
  'dono configura sem poder ver as comissões': so(DONO, 'configurar', (_r, ov) => !refNegada(ov, [KG, PV, SV])),
  'gerente com COMISSOES_GERENCIAR concedida configura': so(GERENTE, 'configurar', (_r, ov) => refConcedida(ov, KG)),
  'funcionário vê as próprias sem a concessão': so(PROFISSIONAL, 'propriasConcedida', () => true),
  'as próprias pela permissão do dono (COMISSOES_VISUALIZAR)': so(PROFISSIONAL, 'propriasConcedida', (_r, ov) => refConcedida(ov, KV)),
  'GRANTED passa a vencer DENIED nas próprias': so(PROFISSIONAL, 'propriasConcedida', (_r, ov) => ov.some((o) => (o.permission as string) === KP && o.mode === 'GRANTED')),
  'recepcionista com a concessão vê as próprias': trocar({
    propriasConcedida: (r, ov) => (r === RECEPCIONISTA ? refConcedida(ov, KP) : ATUAL.propriasConcedida(r, ov)),
    agendaPropria: (r, c) => r === RECEPCIONISTA || ATUAL.agendaPropria(r, c),
  }),
  'gerente não confirmado vê as próprias': trocar({
    agendaPropria: (r, c) => r === GERENTE || ATUAL.agendaPropria(r, c),
    propriasConcedida: (r, ov) => (r === GERENTE ? true : ATUAL.propriasConcedida(r, ov)),
  }),
  'as próprias com o profissional inativo': trocar({ vinculoValido: (v) => v !== 'sem profissional' }),
  'dono concede as próprias sem poder ver todas': trocar({ concedeProprias: (r, ov) => r === DONO && !refNegada(ov, [EG]) }),
};

// ---- Casos ----------------------------------------------------------------

const PAPEIS = [DONO, GERENTE, RECEPCIONISTA, PROFISSIONAL];
const ESTADOS = ['ausente', 'GRANTED', 'DENIED', 'ambos'] as const;
type Estado = (typeof ESTADOS)[number];

/** Grupos exaustivos: a consulta de todos e a configuração com as permissões
 * que elas olham; a consulta das próprias com a concessão, as permissões do
 * dono que não podem liberá-la e a situação do vínculo. */
const GRUPOS: Record<string, { permissoes: readonly string[]; vinculos: readonly Vinculo[] }> = {
  'ver todas, configurar e conceder': { permissoes: [KV, KG, AV, PV, SV, EG], vinculos: ['profissional ativo'] },
  'ver as próprias': { permissoes: [KP, KV, AV, EG], vinculos: VINCULOS },
};

function ajustes(estados: readonly Estado[], permissoes: readonly string[]): PermissionOverrideLike[] {
  const ov: PermissionOverrideLike[] = [];
  estados.forEach((e, i) => {
    const permission = permissoes[i] as Permission;
    if (e === 'GRANTED' || e === 'ambos') ov.push({ permission, mode: PermissionMode.GRANTED });
    if (e === 'DENIED' || e === 'ambos') ov.push({ permission, mode: PermissionMode.DENIED });
  });
  return ov;
}

function* combinacoes(n: number): Generator<Estado[]> {
  for (let k = 0; k < ESTADOS.length ** n; k++) {
    const estados: Estado[] = [];
    let r = k;
    for (let i = 0; i < n; i++) {
      estados.push(ESTADOS[r % ESTADOS.length]);
      r = Math.floor(r / ESTADOS.length);
    }
    yield estados;
  }
}

function* casosDoGrupo(nome: string): Generator<Caso> {
  const { permissoes, vinculos } = GRUPOS[nome];
  for (const role of PAPEIS) {
    for (const confirmado of [true, false]) {
      for (const vinculo of vinculos) {
        for (const estados of combinacoes(permissoes.length)) {
          yield { role, confirmado, vinculo, gravados: ajustes(estados, permissoes), rotulo: `${role} ${confirmado} ${vinculo} ${estados.join(',')}` };
        }
      }
    }
  }
}

/** Gerador congruencial de semente fixa: o lote é sempre o mesmo. */
function sorteador(semente: number) {
  let s = semente >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const UNIVERSO = [...new Set<string>([...MANAGER_PERMISSIONS, ...STAFF_PERMISSIONS, ...Object.values(Permission)])];

function* casosSorteados(quantidade: number): Generator<Caso> {
  const sortear = sorteador(20261128);
  for (let i = 0; i < quantidade; i++) {
    const role = PAPEIS[Math.floor(sortear() * PAPEIS.length)];
    const confirmado = sortear() < 0.5;
    const vinculo = VINCULOS[Math.floor(sortear() * VINCULOS.length)];
    const estados = UNIVERSO.map(() => ESTADOS[Math.floor(sortear() * ESTADOS.length)]);
    yield { role, confirmado, vinculo, gravados: ajustes(estados, UNIVERSO), rotulo: `${role} ${confirmado} ${vinculo} caso ${i}` };
  }
}

const G = (...ps: string[]) => ps.map((p) => ({ permission: p as Permission, mode: PermissionMode.GRANTED }));
const D = (...ps: string[]) => ps.map((p) => ({ permission: p as Permission, mode: PermissionMode.DENIED }));

describe('Comissões: equivalência com a regra anterior à base comum', () => {
  it('cobre todas as políticas can* exportadas (política nova exige caso novo)', () => {
    expect(Object.keys(comissoes).filter((k) => k.startsWith('can')).sort()).toEqual([...COBERTAS].sort());
  });

  for (const nome of Object.keys(GRUPOS)) {
    it(`todas as combinações do grupo "${nome}", nos quatro papéis, confirmado ou não`, () => {
      const casos = [...casosDoGrupo(nome)];
      expect(casos).toHaveLength(4 * 2 * GRUPOS[nome].vinculos.length * 4 ** GRUPOS[nome].permissoes.length);
      expect(diferencas(ATUAL, casos)).toEqual([]);
    });
  }

  it('lote pseudoaleatório com concessões conflitantes e ignoradas (todas as permissões)', () => {
    expect(diferencas(ATUAL, casosSorteados(10_000))).toEqual([]);
  });

  it('cada mutante é apanhado pelos casos exaustivos', () => {
    const casos = Object.keys(GRUPOS).flatMap((nome) => [...casosDoGrupo(nome)]);
    const referencia = casos.map((caso) => impressao(REFERENCIA, caso));
    const apanhado = (mutante: Fontes) =>
      casos.some((caso, i) => {
        const depois = impressao(mutante, caso);
        return depois.size !== referencia[i].size || [...depois].some((p) => !referencia[i].has(p));
      });
    expect(Object.entries(MUTANTES).filter(([, m]) => !apanhado(m)).map(([nome]) => nome)).toEqual([]);
  });

  it('o gerente não confirmado é apanhado se a confirmação deixar de ser aplicada às próprias', () => {
    let apanhados = 0;
    for (const caso of casosDoGrupo('ver as próprias')) {
      const valem = effectiveOverrides(caso.role, caso.confirmado, caso.gravados);
      if (refPropriasConcedida(caso.role, valem) !== comissoes.canViewOwnCommissions(caso.role, caso.gravados)) apanhados++;
    }
    expect(apanhados).toBeGreaterThan(0);
  });

  it('sem ajustes informados vale o mesmo que lista vazia', () => {
    for (const role of PAPEIS) {
      expect(comissoes.canViewCommissions(role), role).toBe(refVerTodas(role, []));
      expect(comissoes.canManageCommissionRules(role), role).toBe(refConfigurar(role, []));
      expect(comissoes.canViewOwnCommissions(role), role).toBe(false);
    }
  });

  const SO_AS_PROPRIAS = ['comissoes.ver:proprias', 'guarda.sessao:AGENDA_PROPRIA_COMISSOES'];

  it('a consulta de todos continua só do dono: gerente, recepcionista e funcionário não chegam a ela com tudo gravado', () => {
    const tudo = G(...UNIVERSO);
    for (const role of [GERENTE, RECEPCIONISTA, PROFISSIONAL]) {
      for (const confirmado of [true, false]) {
        const pares = impressao(ATUAL, { role, confirmado, vinculo: 'profissional ativo', gravados: tudo, rotulo: '' });
        expect([...pares].filter((p) => !SO_AS_PROPRIAS.includes(p)), `${role} ${confirmado}`).toEqual([]);
      }
    }
  });

  it('recusas e limites nomeados', () => {
    const { canViewCommissions: ver, canManageCommissionRules: configurar, canViewOwnCommissions: proprias } = comissoes;
    // Dono: cada restrição tira o que deve; negar outras áreas não tira.
    expect(ver(DONO)).toBe(true);
    for (const p of [KV, AV]) expect(ver(DONO, D(p)), p).toBe(false);
    for (const p of [KG, PV, SV, EG, RV]) expect(ver(DONO, D(p)), p).toBe(true);
    for (const p of [KV, AV, KG, PV, SV]) expect(configurar(DONO, D(p)), p).toBe(false);
    for (const p of [EG, RV, KP]) expect(configurar(DONO, D(p)), p).toBe(true);
    // As próprias: só a concessão própria, DENIED vence, nunca para o dono.
    expect(proprias(PROFISSIONAL, G(KP))).toBe(true);
    expect(proprias(GERENTE, G(KP))).toBe(true);
    expect(proprias(PROFISSIONAL, G(KV))).toBe(false);
    expect(proprias(PROFISSIONAL, [...G(KP), ...D(KP)])).toBe(false);
    expect(proprias(DONO, G(KP))).toBe(false);
    expect(proprias(RECEPCIONISTA, G(KP))).toBe(false);
    expect(proprias(GERENTE, effectiveOverrides(GERENTE, false, G(KP)))).toBe(false);
    // A concessão das próprias não dá a consulta de todos.
    expect(ver(PROFISSIONAL, G(KP, KV))).toBe(false);
  });
});
