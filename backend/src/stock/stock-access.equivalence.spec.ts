// Equivalência por ação entre as políticas do Estoque e a regra anterior à
// base comum (docs/plans/permissoes-individuais.md, etapa 1).
//
// A REFERÊNCIA é uma cópia congelada de `stock/stock-access.ts` como estava em
// `01a3c86` (igual a `8f71335`, o que está no piloto), escrita só com listas
// literais, sem importar `managerCan`, `algumaNegada` nem
// `MANAGER_PERMISSION_REQUIRES`: se alguém mudar essas fontes, este teste
// continua comparando com o comportamento de antes.
//
// Casos: os quatro papéis, gerente confirmado ou não (o descarte dos GRANTED
// acontece em `effectiveOverrides`, antes da política, como no serviço),
// TODAS as combinações de ausente, GRANTED, DENIED ou os dois para as duas
// permissões de estoque e para uma de cada vizinho que poderia vazar
// (recepcionista e vendas), mais um lote pseudoaleatório de semente fixa com
// todas as permissões, inclusive concessões ignoradas pelo papel.
//
// Mutantes: a mesma comparação roda contra versões erradas de propósito da
// política, e cada uma precisa ser apanhada. Isso prova que os casos acima
// distinguem uma diferença real.
//
// Fora da política e intocados por esta etapa: a recusa da saída manual por
// venda com o adicional Vendas (409 `USE_VENDAS`) e a do estorno de baixa
// ligada a venda (409 `BAIXA_DE_VENDA`) ficam em `stock-movements.service.ts`;
// o adicional `ESTOQUE` e o isolamento ficam em `resolveAuthorizedTenant`
// (`stock-common.ts`).
import { describe, expect, it } from 'vitest';
import { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { Permission } from '../entities/enums/permission.enum.js';
import { PermissionMode } from '../entities/enums/permission-mode.enum.js';
import { effectiveOverrides, type PermissionOverrideLike } from '../common/tenant-authorization.js';
import { MANAGER_PERMISSIONS } from '../common/manager-permissions.js';
import * as estoque from './stock-access.js';

// ---- Referência congelada (01a3c86 = 8f71335) -----------------------------

const REF_EXIGE = {
  consultar: ['ESTOQUE_VISUALIZAR'],
  operar: ['ESTOQUE_VISUALIZAR', 'ESTOQUE_GERENCIAR'],
} as const;
type Acao = keyof typeof REF_EXIGE;
const ACOES = Object.keys(REF_EXIGE) as Acao[];

function refConcedida(ov: readonly PermissionOverrideLike[], p: string): boolean {
  return ov.some((o) => o.permission === p && o.mode === 'GRANTED') && !ov.some((o) => o.permission === p && o.mode === 'DENIED');
}

/** Regra anterior: gerente com tudo concedido; dono sem nenhuma negada;
 * recepcionista, funcionário e qualquer outro papel, nunca. */
function refPode(role: string, ov: readonly PermissionOverrideLike[], acao: Acao): boolean {
  const exigidas: readonly string[] = REF_EXIGE[acao];
  if (role === 'GERENTE') return exigidas.every((p) => refConcedida(ov, p));
  if (role !== 'DONO') return false;
  return !ov.some((o) => o.mode === 'DENIED' && exigidas.includes(o.permission));
}

// ---- Código atual e mutantes ----------------------------------------------

type Politica = (role: EstablishmentRole, ov: readonly PermissionOverrideLike[], acao: Acao) => boolean;

/** Cada política `can*` exportada por stock-access.ts, com a ação. */
const COBERTAS: Record<Acao, string> = { consultar: 'canViewStock', operar: 'canManageStock' };

const atual: Politica = (role, ov, acao) => (acao === 'consultar' ? estoque.canViewStock(role, ov) : estoque.canManageStock(role, ov));

const MUTANTES: Record<string, Politica> = {
  'recepcionista passa a ver com GRANTED': (role, ov, acao) =>
    role === EstablishmentRole.RECEPCIONISTA ? REF_EXIGE[acao].every((p) => refConcedida(ov, p)) : atual(role, ov, acao),
  'operar deixa de exigir a consulta': (role, ov, acao) =>
    acao === 'operar' && role === EstablishmentRole.GERENTE ? refConcedida(ov, 'ESTOQUE_GERENCIAR') : atual(role, ov, acao),
  'GRANTED passa a vencer DENIED no gerente': (role, ov, acao) =>
    role === EstablishmentRole.GERENTE
      ? REF_EXIGE[acao].every((p) => ov.some((o) => o.permission === p && o.mode === 'GRANTED'))
      : atual(role, ov, acao),
  'dono ignora DENIED na dependência': (role, ov, acao) =>
    role === EstablishmentRole.DONO && acao === 'operar'
      ? !ov.some((o) => o.mode === 'DENIED' && o.permission === 'ESTOQUE_GERENCIAR')
      : atual(role, ov, acao),
  'funcionário com GRANTED passa a operar': (role, ov, acao) =>
    role === EstablishmentRole.PROFISSIONAL ? REF_EXIGE[acao].every((p) => refConcedida(ov, p)) : atual(role, ov, acao),
};

// ---- Casos ----------------------------------------------------------------

const PAPEIS = [EstablishmentRole.DONO, EstablishmentRole.GERENTE, EstablishmentRole.RECEPCIONISTA, EstablishmentRole.PROFISSIONAL];
// As duas de estoque e um vizinho de cada lado: uma da lista da recepcionista
// e uma de vendas fora dela (concessões que o estoque precisa ignorar).
const EXAUSTIVAS = ['ESTOQUE_VISUALIZAR', 'ESTOQUE_GERENCIAR', 'VENDAS_REGISTRAR', 'VENDAS_VISUALIZAR'];
const ESTADOS = ['ausente', 'GRANTED', 'DENIED', 'ambos'] as const;
type Estado = (typeof ESTADOS)[number];

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
  const total = ESTADOS.length ** n;
  for (let k = 0; k < total; k++) {
    const estados: Estado[] = [];
    let r = k;
    for (let i = 0; i < n; i++) {
      estados.push(ESTADOS[r % ESTADOS.length]);
      r = Math.floor(r / ESTADOS.length);
    }
    yield estados;
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

interface Caso {
  role: EstablishmentRole;
  confirmado: boolean;
  gravados: PermissionOverrideLike[];
  rotulo: string;
}

function* casosExaustivos(): Generator<Caso> {
  for (const role of PAPEIS) {
    for (const confirmado of [true, false]) {
      for (const estados of combinacoes(EXAUSTIVAS.length)) {
        yield { role, confirmado, gravados: ajustes(estados, EXAUSTIVAS), rotulo: `${role} ${confirmado} ${estados.join(',')}` };
      }
    }
  }
}

function* casosSorteados(quantidade: number): Generator<Caso> {
  const sortear = sorteador(20261126);
  const universo = [...new Set<string>([...MANAGER_PERMISSIONS, ...Object.values(Permission)])];
  for (let i = 0; i < quantidade; i++) {
    const role = PAPEIS[Math.floor(sortear() * PAPEIS.length)];
    const confirmado = sortear() < 0.5;
    const estados = universo.map(() => ESTADOS[Math.floor(sortear() * ESTADOS.length)]);
    yield { role, confirmado, gravados: ajustes(estados, universo), rotulo: `${role} ${confirmado} caso ${i}` };
  }
}

/** Ações em que a política difere da referência. O serviço aplica a
 * confirmação antes da política, igual para os dois. */
function comparar(politica: Politica, caso: Caso): Acao[] {
  const ov = effectiveOverrides(caso.role, caso.confirmado, caso.gravados);
  return ACOES.filter((acao) => refPode(caso.role, ov, acao) !== politica(caso.role, ov, acao));
}

function diferencas(politica: Politica, casos: Iterable<Caso>): { total: number; exemplos: string[] } {
  let total = 0;
  const exemplos: string[] = [];
  for (const caso of casos) {
    const dif = comparar(politica, caso);
    if (!dif.length) continue;
    total++;
    if (exemplos.length < 5) exemplos.push(`${caso.rotulo}: ${dif.join(', ')}`);
  }
  return { total, exemplos };
}

describe('Estoque: equivalência com a regra anterior à base comum', () => {
  it('cobre todas as políticas can* exportadas (política nova exige caso novo)', () => {
    const exportadas = Object.keys(estoque).filter((k) => k.startsWith('can')).sort();
    expect(exportadas).toEqual(Object.values(COBERTAS).sort());
  });

  it('todas as combinações de estoque e vizinhos, nos quatro papéis, confirmado ou não', () => {
    const casos = [...casosExaustivos()];
    expect(casos).toHaveLength(4 * 2 * 4 ** EXAUSTIVAS.length);
    expect(diferencas(atual, casos).exemplos).toEqual([]);
  });

  it('lote pseudoaleatório com concessões conflitantes e ignoradas (todas as permissões)', () => {
    expect(diferencas(atual, casosSorteados(20_000)).exemplos).toEqual([]);
  });

  it('sem ajustes informados vale o mesmo que lista vazia', () => {
    for (const role of PAPEIS) {
      expect(estoque.canViewStock(role), role).toBe(refPode(role, [], 'consultar'));
      expect(estoque.canManageStock(role), role).toBe(refPode(role, [], 'operar'));
    }
  });

  it('cada mutante é apanhado pelos casos exaustivos', () => {
    const casos = [...casosExaustivos()];
    for (const [nome, mutante] of Object.entries(MUTANTES)) {
      expect(diferencas(mutante, casos).total, nome).toBeGreaterThan(0);
    }
  });

  it('o gerente não confirmado é apanhado se a confirmação deixar de ser aplicada', () => {
    // Mesma política, mas lendo os ajustes gravados sem `effectiveOverrides`.
    let apanhados = 0;
    for (const caso of casosExaustivos()) {
      const valem = effectiveOverrides(caso.role, caso.confirmado, caso.gravados);
      for (const acao of ACOES) {
        if (refPode(caso.role, valem, acao) !== atual(caso.role, caso.gravados, acao)) apanhados++;
      }
    }
    expect(apanhados).toBeGreaterThan(0);
  });

  it('casos nomeados continuam com o mesmo resultado', () => {
    const G = (...ps: string[]) => ps.map((p) => ({ permission: p as Permission, mode: PermissionMode.GRANTED }));
    const D = (...ps: string[]) => ps.map((p) => ({ permission: p as Permission, mode: PermissionMode.DENIED }));
    const operar = G('ESTOQUE_VISUALIZAR', 'ESTOQUE_GERENCIAR');
    // Gerente não confirmado: os GRANTED somem antes da política.
    expect(estoque.canManageStock(EstablishmentRole.GERENTE, effectiveOverrides('GERENTE', false, operar))).toBe(false);
    expect(estoque.canManageStock(EstablishmentRole.GERENTE, effectiveOverrides('GERENTE', true, operar))).toBe(true);
    // Concedido e negado ao mesmo tempo: DENIED vence.
    expect(estoque.canViewStock(EstablishmentRole.GERENTE, [...operar, ...D('ESTOQUE_VISUALIZAR')])).toBe(false);
    // Dono: DENIED na consulta tira também operar; DENIED em operar mantém a consulta.
    expect(estoque.canManageStock(EstablishmentRole.DONO, D('ESTOQUE_VISUALIZAR'))).toBe(false);
    expect(estoque.canViewStock(EstablishmentRole.DONO, D('ESTOQUE_GERENCIAR'))).toBe(true);
    // Recepcionista com estoque gravado (e as de vendas dela): ignorado.
    const recepcao = G('ESTOQUE_VISUALIZAR', 'ESTOQUE_GERENCIAR', 'VENDAS_REGISTRAR', 'VENDAS_RECEBER');
    expect(estoque.canViewStock(EstablishmentRole.RECEPCIONISTA, recepcao)).toBe(false);
    expect(estoque.canManageStock(EstablishmentRole.RECEPCIONISTA, recepcao)).toBe(false);
    // Funcionário nunca, mesmo com tudo gravado.
    expect(estoque.canManageStock(EstablishmentRole.PROFISSIONAL, G(...MANAGER_PERMISSIONS))).toBe(false);
    // Mensagens do 403 iguais às de antes.
    expect(estoque.STOCK_FORBIDDEN_MESSAGE).toBe('Você não tem permissão para ver o estoque deste estabelecimento.');
    expect(estoque.STOCK_MANAGE_FORBIDDEN_MESSAGE).toBe('Você não tem permissão para operar o estoque deste estabelecimento.');
  });
});
