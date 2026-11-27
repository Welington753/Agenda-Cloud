// Equivalência por ação e alcance entre as políticas de Serviços e de
// Profissionais e a regra anterior à base comum
// (docs/plans/permissoes-individuais.md, etapa 1).
//
// A REFERÊNCIA é uma cópia congelada das regras de `services/service-access.ts`
// e `professionals/professional-access.ts` como estavam em `1a973a9` (iguais a
// `8f71335`, o piloto). Usa só listas literais, sem importar `managerCan`,
// `algumaNegada`, `MANAGER_PERMISSION_REQUIRES`, a base comum nem as políticas
// de outras áreas.
//
// IMPRESSÃO: para cada vínculo sintético, o conjunto de pares (ação, alcance).
// Nenhuma das duas áreas tem alcance próprio: quem vê, vê todos os serviços
// (ou profissionais e horários) do estabelecimento; ninguém vê só "os seus".
// As respostas não têm recorte de campos por papel: quem alcança recebe os
// mesmos campos (o preço do serviço inclusive), e esse código não mudou.
//
// Os ajustes chegam às políticas por dois caminhos, e os dois entram:
// - profissionais e horários (`professional-tenant-access.ts`) e as áreas da
//   sessão passam por `resolveAuthorizedTenant`, que aplica a confirmação do
//   gerente (`effectiveOverrides`);
// - a rota de serviços (`services.service.ts`, `resolveAuthorizedTenant`
//   privado) lê os ajustes gravados e os entrega SEM a confirmação. Por isso
//   a impressão também avalia serviços com os ajustes gravados.
//
// Entram como GUARDA as decisões de outras áreas que dependem destas políticas
// e NÃO foram convertidas aqui: as regras de comissão
// (`canManageCommissionRules`, que exige ver profissionais e serviços) e o que
// o dono pode conceder ao gerente nas duas áreas (`grantableManagerPermissions`).
//
// Fora das políticas e intocados por esta etapa: o vínculo, a situação do
// estabelecimento e o acesso comercial (em `resolveAuthorizedTenant` e no
// caminho próprio de serviços), o SQL, o filtro por `tenant_id`, cadastro,
// preço, duração, horários, disponibilidade, comissões e vagas.
import { describe, expect, it } from 'vitest';
import { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { Permission } from '../entities/enums/permission.enum.js';
import { PermissionMode } from '../entities/enums/permission-mode.enum.js';
import { effectiveOverrides, type PermissionOverrideLike } from '../common/tenant-authorization.js';
import { MANAGER_PERMISSIONS } from '../common/manager-permissions.js';
import { STAFF_PERMISSIONS, grantableManagerPermissions } from '../team/staff-access.js';
import { canManageCommissionRules } from '../commissions/commission-access.js';
import * as servicos from './service-access.js';
import * as profissionais from '../professionals/professional-access.js';

const SV = 'SERVICOS_VISUALIZAR';
const SG = 'SERVICOS_GERENCIAR';
const PV = 'PROFISSIONAIS_VISUALIZAR';
const PG = 'PROFISSIONAIS_GERENCIAR';
const EG = 'EQUIPE_GERENCIAR';
const AV = 'AGENDA_VISUALIZAR';
const KV = 'COMISSOES_VISUALIZAR';
const KG = 'COMISSOES_GERENCIAR';

// ---- Referência congelada (1a973a9 = 8f71335) ------------------------------

/** O que o gerente precisa concedido (já com as dependências) e o que barra
 * o dono se negado. Recepcionista, funcionário e qualquer outro papel: nunca. */
const REF = {
  'servicos.ver': { gerente: [SV], dono: [SV] },
  'servicos.gerenciar': { gerente: [SG, SV], dono: [SV, SG] },
  'profissionais.ver': { gerente: [PV], dono: [PV] },
  'profissionais.gerenciar': { gerente: [PG, PV], dono: [PV, PG] },
} as const satisfies Record<string, { gerente: readonly string[]; dono: readonly string[] }>;
type Acao = keyof typeof REF;
const ACOES = Object.keys(REF) as Acao[];

function refConcedida(ov: readonly PermissionOverrideLike[], p: string): boolean {
  return ov.some((o) => o.permission === p && o.mode === 'GRANTED') && !ov.some((o) => o.permission === p && o.mode === 'DENIED');
}

function refNegada(ov: readonly PermissionOverrideLike[], ps: readonly string[]): boolean {
  return ov.some((o) => o.mode === 'DENIED' && ps.includes(o.permission));
}

function refPode(role: string, ov: readonly PermissionOverrideLike[], acao: Acao): boolean {
  const { gerente, dono } = REF[acao];
  if (role === 'GERENTE') return gerente.every((p) => refConcedida(ov, p));
  return role === 'DONO' && !refNegada(ov, dono);
}

/** Guarda: regras de comissão. Só o dono, sem `COMISSOES_VISUALIZAR`,
 * `AGENDA_VISUALIZAR` (consulta de recebimentos) e `COMISSOES_GERENCIAR`
 * negadas, e vendo profissionais e serviços. */
function refRegrasDeComissao(role: string, ov: readonly PermissionOverrideLike[]): boolean {
  if (role !== 'DONO' || refNegada(ov, [KV]) || refNegada(ov, [AV]) || refNegada(ov, [KG])) return false;
  return refPode(role, ov, 'profissionais.ver') && refPode(role, ov, 'servicos.ver');
}

const CONCEDIVEIS = { [SV]: 'servicos.ver', [SG]: 'servicos.gerenciar', [PV]: 'profissionais.ver', [PG]: 'profissionais.gerenciar' } as const;
type Concedivel = keyof typeof CONCEDIVEIS;

/** Guarda: o dono (com a equipe) concede ao gerente o que ele mesmo pode. */
function refConcede(role: string, ov: readonly PermissionOverrideLike[], p: Concedivel): boolean {
  if (role !== 'DONO' || refNegada(ov, [EG])) return false;
  return refPode(role, ov, CONCEDIVEIS[p]);
}

// ---- Impressão de acesso --------------------------------------------------

type Pol = (role: EstablishmentRole, ov: readonly PermissionOverrideLike[]) => boolean;

interface Fontes {
  pode: Record<Acao, Pol>;
  regrasDeComissao: Pol;
  concede: (role: EstablishmentRole, ov: readonly PermissionOverrideLike[], p: Concedivel) => boolean;
}

const REFERENCIA: Fontes = {
  pode: Object.fromEntries(ACOES.map((a) => [a, (r: string, ov: readonly PermissionOverrideLike[]) => refPode(r, ov, a)])) as Record<Acao, Pol>,
  regrasDeComissao: refRegrasDeComissao,
  concede: refConcede,
};

/** Cada política `can*` exportada, com a ação que a usa. */
const COBERTAS: Record<string, Acao> = {
  canViewServices: 'servicos.ver',
  canManageServices: 'servicos.gerenciar',
  canViewProfessionals: 'profissionais.ver',
  canManageProfessionals: 'profissionais.gerenciar',
};

const ATUAL: Fontes = {
  pode: {
    'servicos.ver': servicos.canViewServices,
    'servicos.gerenciar': servicos.canManageServices,
    'profissionais.ver': profissionais.canViewProfessionals,
    'profissionais.gerenciar': profissionais.canManageProfessionals,
  },
  regrasDeComissao: canManageCommissionRules,
  concede: (role, ov, p) => grantableManagerPermissions(role, ov).includes(p),
};

interface Caso {
  role: EstablishmentRole;
  confirmado: boolean;
  gravados: PermissionOverrideLike[];
  rotulo: string;
}

function impressao(f: Fontes, caso: Caso): Set<string> {
  const { role, confirmado, gravados } = caso;
  const ov = effectiveOverrides(role, confirmado, gravados);
  const pares = new Set<string>();
  for (const a of ACOES) if (f.pode[a](role, ov)) pares.add(`${a}:todos`);
  // A rota de serviços entrega os ajustes gravados, sem a confirmação.
  if (f.pode['servicos.ver'](role, gravados)) pares.add('servicos.ver:todos:rotaDeServicos');
  if (f.pode['servicos.gerenciar'](role, gravados)) pares.add('servicos.gerenciar:todos:rotaDeServicos');
  if (f.regrasDeComissao(role, ov)) pares.add('guarda.comissoes.regras:todos');
  for (const p of Object.keys(CONCEDIVEIS) as Concedivel[]) if (f.concede(role, ov, p)) pares.add(`guarda.equipe.concede:${p}`);
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

function trocar(pecas: Partial<Omit<Fontes, 'pode'>> & { pode?: Partial<Record<Acao, Pol>> }): Fontes {
  return {
    pode: { ...ATUAL.pode, ...pecas.pode },
    regrasDeComissao: pecas.regrasDeComissao ?? ATUAL.regrasDeComissao,
    concede: pecas.concede ?? ATUAL.concede,
  };
}

const { DONO, GERENTE, RECEPCIONISTA, PROFISSIONAL } = EstablishmentRole;
const so = (alvo: EstablishmentRole, acao: Acao, regra: Pol): Fontes =>
  trocar({ pode: { [acao]: (r: EstablishmentRole, ov: readonly PermissionOverrideLike[]) => (r === alvo ? regra(r, ov) : ATUAL.pode[acao](r, ov)) } });

const MUTANTES: Record<string, Fontes> = {
  'gerente vê serviços sem a concessão': so(GERENTE, 'servicos.ver', () => true),
  'gerente gerencia serviços só com SERVICOS_GERENCIAR (sem a dependência)': so(GERENTE, 'servicos.gerenciar', (_r, ov) => refConcedida(ov, SG)),
  'gerente gerencia serviços só com SERVICOS_VISUALIZAR': so(GERENTE, 'servicos.gerenciar', (_r, ov) => refConcedida(ov, SV)),
  'dono gerencia serviços com SERVICOS_VISUALIZAR negada': so(DONO, 'servicos.gerenciar', (_r, ov) => !refNegada(ov, [SG])),
  'dono deixa de seguir a restrição de ver serviços': so(DONO, 'servicos.ver', () => true),
  'GRANTED passa a vencer DENIED no gerente (serviços)': so(GERENTE, 'servicos.ver', (_r, ov) => ov.some((o) => o.permission === SV && o.mode === 'GRANTED')),
  'serviços decididos pela permissão de profissionais': so(GERENTE, 'servicos.ver', (_r, ov) => refConcedida(ov, PV)),
  'recepcionista com GRANTED passa a ver serviços': so(RECEPCIONISTA, 'servicos.ver', (_r, ov) => refConcedida(ov, SV)),
  'gerente vê profissionais sem a concessão': so(GERENTE, 'profissionais.ver', () => true),
  'gerente gerencia profissionais só com PROFISSIONAIS_GERENCIAR (sem a dependência)': so(GERENTE, 'profissionais.gerenciar', (_r, ov) => refConcedida(ov, PG)),
  'dono gerencia profissionais com PROFISSIONAIS_VISUALIZAR negada': so(DONO, 'profissionais.gerenciar', (_r, ov) => !refNegada(ov, [PG])),
  'dono vê profissionais com PROFISSIONAIS_VISUALIZAR negada': so(DONO, 'profissionais.ver', () => true),
  'profissional com GRANTED passa a ver profissionais': so(PROFISSIONAL, 'profissionais.ver', (_r, ov) => refConcedida(ov, PV)),
  'gerente com tudo passa a operar como dono': so(GERENTE, 'profissionais.gerenciar', (_r, ov) => !refNegada(ov, [PV, PG])),
  'regras de comissão sem ver serviços': trocar({
    regrasDeComissao: (r, ov) => r === DONO && !refNegada(ov, [KV, AV, KG]) && refPode(r, ov, 'profissionais.ver'),
  }),
  'dono concede gerenciar profissionais com PROFISSIONAIS_VISUALIZAR negada': trocar({
    concede: (r, ov, p) => (r === DONO && p === PG ? !refNegada(ov, [EG, PG]) : ATUAL.concede(r, ov, p)),
  }),
};

// ---- Casos ----------------------------------------------------------------

const PAPEIS = [DONO, GERENTE, RECEPCIONISTA, PROFISSIONAL];
const ESTADOS = ['ausente', 'GRANTED', 'DENIED', 'ambos'] as const;
type Estado = (typeof ESTADOS)[number];

/** Grupos exaustivos: as quatro ações com a concessão pela equipe; as regras
 * de comissão com as permissões que elas olham. */
const GRUPOS: Record<string, readonly string[]> = {
  'ver e gerenciar serviços e profissionais, e concessão': [SV, SG, PV, PG, EG],
  'regras de comissão': [SV, PV, KV, KG, AV],
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
  const permissoes = GRUPOS[nome];
  for (const role of PAPEIS) {
    for (const confirmado of [true, false]) {
      for (const estados of combinacoes(permissoes.length)) {
        yield { role, confirmado, gravados: ajustes(estados, permissoes), rotulo: `${role} ${confirmado} ${estados.join(',')}` };
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
  const sortear = sorteador(20261127);
  for (let i = 0; i < quantidade; i++) {
    const role = PAPEIS[Math.floor(sortear() * PAPEIS.length)];
    const confirmado = sortear() < 0.5;
    const estados = UNIVERSO.map(() => ESTADOS[Math.floor(sortear() * ESTADOS.length)]);
    yield { role, confirmado, gravados: ajustes(estados, UNIVERSO), rotulo: `${role} ${confirmado} caso ${i}` };
  }
}

const G = (...ps: string[]) => ps.map((p) => ({ permission: p as Permission, mode: PermissionMode.GRANTED }));
const D = (...ps: string[]) => ps.map((p) => ({ permission: p as Permission, mode: PermissionMode.DENIED }));

describe('Serviços e Profissionais: equivalência com a regra anterior à base comum', () => {
  it('cobre todas as políticas can* exportadas (política nova exige caso novo)', () => {
    const exportadas = [...Object.keys(servicos), ...Object.keys(profissionais)].filter((k) => k.startsWith('can'));
    expect(exportadas.sort()).toEqual(Object.keys(COBERTAS).sort());
    expect(Object.values(COBERTAS).sort()).toEqual([...ACOES].sort());
  });

  for (const nome of Object.keys(GRUPOS)) {
    it(`todas as combinações do grupo "${nome}", nos quatro papéis, confirmado ou não`, () => {
      const casos = [...casosDoGrupo(nome)];
      expect(casos).toHaveLength(4 * 2 * 4 ** GRUPOS[nome].length);
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

  it('o gerente não confirmado é apanhado se a confirmação deixar de ser aplicada', () => {
    let apanhados = 0;
    for (const caso of casosDoGrupo('ver e gerenciar serviços e profissionais, e concessão')) {
      const valem = effectiveOverrides(caso.role, caso.confirmado, caso.gravados);
      for (const a of ACOES) if (refPode(caso.role, valem, a) !== ATUAL.pode[a](caso.role, caso.gravados)) apanhados++;
    }
    expect(apanhados).toBeGreaterThan(0);
  });

  it('a rota de serviços, sem a confirmação, segue deixando o gerente não confirmado com GRANTED ver e gerenciar (regra antiga, não corrigida)', () => {
    const gravados = G(SV, SG);
    const pares = impressao(ATUAL, { role: GERENTE, confirmado: false, gravados, rotulo: '' });
    expect([...pares].sort()).toEqual(['servicos.gerenciar:todos:rotaDeServicos', 'servicos.ver:todos:rotaDeServicos']);
    expect(impressao(REFERENCIA, { role: GERENTE, confirmado: false, gravados, rotulo: '' })).toEqual(pares);
  });

  it('sem ajustes informados vale o mesmo que lista vazia', () => {
    for (const role of PAPEIS) {
      for (const [nome, a] of Object.entries(COBERTAS)) {
        const modulo = (nome in servicos ? servicos : profissionais) as Record<string, (r: EstablishmentRole) => boolean>;
        expect(modulo[nome](role), `${role} ${nome}`).toBe(refPode(role, [], a));
      }
    }
  });

  it('nenhum alcance próprio: o funcionário e a recepcionista não alcançam serviço nem profissional, com tudo gravado', () => {
    const tudo = G(...MANAGER_PERMISSIONS, ...STAFF_PERMISSIONS);
    for (const role of [PROFISSIONAL, RECEPCIONISTA]) {
      for (const confirmado of [true, false]) {
        expect([...impressao(ATUAL, { role, confirmado, gravados: tudo, rotulo: '' })], `${role} ${confirmado}`).toEqual([]);
      }
    }
  });

  it('recusas e limites nomeados', () => {
    for (const [ver, gerenciar, V, Gr] of [
      [servicos.canViewServices, servicos.canManageServices, SV, SG],
      [profissionais.canViewProfessionals, profissionais.canManageProfessionals, PV, PG],
    ] as const) {
      // Dono: ver só com a própria negada; gerenciar com qualquer das duas.
      expect(ver(DONO, D(Gr))).toBe(true);
      expect(ver(DONO, D(V))).toBe(false);
      for (const p of [V, Gr]) expect(gerenciar(DONO, D(p)), p).toBe(false);
      // Negar outras áreas não tira esta do dono.
      for (const p of [SV, SG, PV, PG, AV, EG, KV].filter((x) => x !== V && x !== Gr)) expect(gerenciar(DONO, D(p)), p).toBe(true);
      // Gerente: cada ação com a sua concessão e a dependência; DENIED vence.
      expect(ver(GERENTE, G(V))).toBe(true);
      expect(gerenciar(GERENTE, G(Gr))).toBe(false);
      expect(gerenciar(GERENTE, G(Gr, V))).toBe(true);
      expect(gerenciar(GERENTE, [...G(Gr, V), ...D(V)])).toBe(false);
      expect(ver(GERENTE, effectiveOverrides(GERENTE, false, G(V)))).toBe(false);
    }
    expect(profissionais.canViewProfessionals(GERENTE, G(SV))).toBe(false);
    expect(servicos.canViewServices(GERENTE, G(PV))).toBe(false);
  });
});
