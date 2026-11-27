// Equivalência por ação, alcance e campos devolvidos entre as políticas de
// Clientes e a regra anterior à base comum (docs/plans/permissoes-individuais.md,
// etapa 1).
//
// A REFERÊNCIA é uma cópia congelada das regras de `consumers/consumer-access.ts`
// e do recorte do histórico (`oQueOHistoricoMostra` e a montagem de cada item
// em `consumer-profile.service.ts`) como estavam em `9c904ea` (iguais a
// `8f71335`, o piloto). A política de recebimentos que o histórico chamava
// (`canViewPayments`: o gerente com a consulta e as dependências, o dono sem
// `AGENDA_VISUALIZAR` negada) está escrita por extenso. Usa só listas
// literais, sem importar `managerCan`, `algumaNegada`,
// `MANAGER_PERMISSION_REQUIRES`, a base comum nem as políticas de outras áreas.
//
// IMPRESSÃO: para cada vínculo sintético, o conjunto de pares (ação, alcance).
// Clientes não têm alcance próprio: quem busca vê todos os cadastros do
// estabelecimento (lista, busca, ficha e histórico); ninguém vê só "os seus".
// No histórico, o preço e o recebimento entram como "visível" com o recurso
// contratado ligado ou não. Entram como GUARDA as decisões de outras áreas que
// dependem das políticas de Clientes e NÃO foram convertidas aqui: as compras
// na ficha (`sales.service.ts`, consulta geral de vendas e de clientes) e o que
// o dono pode conceder ao gerente em clientes (`grantableManagerPermissions`).
//
// CAMPOS: a montagem de cada item do histórico (`itemDoHistoricoParaQuemPediu`)
// é comparada, campo a campo, com a transformação congelada.
//
// Fora das políticas e intocados por esta etapa: o vínculo, a situação do
// estabelecimento e o acesso comercial seguem em `resolveAuthorizedTenant`; o
// SQL, o filtro por `tenant_id` e a busca limitada de clientes da venda
// (`searchConsumers`, com a política de registrar vendas) não mudaram.
import { isDeepStrictEqual } from 'node:util';
import { describe, expect, it } from 'vitest';
import { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { Permission } from '../entities/enums/permission.enum.js';
import { PermissionMode } from '../entities/enums/permission-mode.enum.js';
import { effectiveOverrides, type PermissionOverrideLike } from '../common/tenant-authorization.js';
import { MANAGER_PERMISSIONS } from '../common/manager-permissions.js';
import { STAFF_PERMISSIONS, grantableManagerPermissions } from '../team/staff-access.js';
import { canViewAllSales } from '../sales/sales-access.js';
import { canSeeAppointmentPrices } from '../appointments/appointment-access.js';
import * as clientes from './consumer-access.js';
import { itemDoHistoricoParaQuemPediu, oQueOHistoricoMostra, type AtendimentoResumido, type ItemDoHistorico } from './consumer-profile.service.js';

const CV = 'CONSUMIDORES_VISUALIZAR';
const CG = 'CONSUMIDORES_GERENCIAR';
const AV = 'AGENDA_VISUALIZAR';
const PV = 'PROFISSIONAIS_VISUALIZAR';
const RV = 'RECEBIMENTOS_VISUALIZAR';
const VV = 'VENDAS_VISUALIZAR';
const EG = 'EQUIPE_GERENCIAR';

// ---- Referência congelada (9c904ea = 8f71335) ------------------------------

/** O que o gerente precisa concedido (já com as dependências; `null`, nunca)
 * e o que barra o dono se negado. Recepcionista, funcionário e qualquer outro
 * papel: nunca. */
const REF = {
  ver: { gerente: [CV], dono: [CV] },
  gerenciar: { gerente: [CG, CV], dono: [CV, CG] },
  unificar: { gerente: null, dono: [CV, CG] },
} as const satisfies Record<string, { gerente: readonly string[] | null; dono: readonly string[] }>;
type Acao = keyof typeof REF;
const ACOES = Object.keys(REF) as Acao[];

function refConcedida(ov: readonly PermissionOverrideLike[], p: string): boolean {
  return ov.some((o) => o.permission === p && o.mode === 'GRANTED') && !ov.some((o) => o.permission === p && o.mode === 'DENIED');
}

function refNegada(ov: readonly PermissionOverrideLike[], ps: readonly string[]): boolean {
  return ov.some((o) => o.mode === 'DENIED' && ps.includes(o.permission));
}

function refPode(role: string, ov: readonly PermissionOverrideLike[], acao: Acao): boolean {
  const { gerente, dono } = REF[acao] as { gerente: readonly string[] | null; dono: readonly string[] };
  if (role === 'GERENTE') return gerente !== null && gerente.every((p) => refConcedida(ov, p));
  return role === 'DONO' && !refNegada(ov, dono);
}

/** Histórico: preço como nas respostas de agendamento (o gerente com a
 * consulta de recebimentos e as dependências; os demais papéis, sempre);
 * recebimento com a consulta de recebimentos e o recurso contratado. */
function refHistorico(role: string, ov: readonly PermissionOverrideLike[], recurso: boolean) {
  const consultaRecebimentos =
    role === 'GERENTE' ? [RV, AV, PV].every((p) => refConcedida(ov, p)) : role === 'DONO' && !refNegada(ov, [AV]);
  return {
    veDinheiro: role !== 'GERENTE' || [RV, AV, PV].every((p) => refConcedida(ov, p)),
    veRecebimentos: recurso && consultaRecebimentos,
  };
}

/** Guarda: compras na ficha (consulta geral de vendas E de clientes). */
function refCompras(role: string, ov: readonly PermissionOverrideLike[]): boolean {
  const vendas = role === 'GERENTE' ? refConcedida(ov, VV) : role === 'DONO' && !refNegada(ov, [VV]);
  return vendas && refPode(role, ov, 'ver');
}

/** Guarda: o dono (com a equipe) concede ao gerente o que ele mesmo pode. */
function refConcede(role: string, ov: readonly PermissionOverrideLike[], p: typeof CV | typeof CG): boolean {
  if (role !== 'DONO' || refNegada(ov, [EG])) return false;
  return refPode(role, ov, p === CV ? 'ver' : 'gerenciar');
}

/** Cópia congelada da montagem de cada item do histórico. */
type ItemComPrecos = AtendimentoResumido & { precos?: (number | null)[] };
type Recebimento = NonNullable<ItemDoHistorico['payment']>;
function refItem(item: ItemComPrecos, recebimento: Recebimento | undefined, veDinheiro: boolean, veRecebimentos: boolean) {
  const hidden: ('price' | 'payment')[] = [];
  if (!veDinheiro) hidden.push('price');
  if (!veRecebimentos) hidden.push('payment');
  const { precos, ...resto } = item;
  const lista = precos ?? [];
  const total = lista.length === 0 || lista.some((p) => p === null) ? null : lista.reduce<number>((s, p) => s + (p ?? 0), 0);
  return {
    ...resto,
    priceCents: veDinheiro ? total : null,
    ...(veRecebimentos ? { payment: recebimento ?? null } : {}),
    hidden,
  };
}

// ---- Impressão de acesso --------------------------------------------------

type Pol = (role: EstablishmentRole, ov: readonly PermissionOverrideLike[]) => boolean;

interface Fontes {
  pode: Record<Acao, Pol>;
  historico: (role: EstablishmentRole, ov: readonly PermissionOverrideLike[], recurso: boolean) => { veDinheiro: boolean; veRecebimentos: boolean };
  compras: Pol;
  concede: (role: EstablishmentRole, ov: readonly PermissionOverrideLike[], p: typeof CV | typeof CG) => boolean;
}

const REFERENCIA: Fontes = {
  pode: Object.fromEntries(ACOES.map((a) => [a, (r: string, ov: readonly PermissionOverrideLike[]) => refPode(r, ov, a)])) as Record<Acao, Pol>,
  historico: refHistorico,
  compras: refCompras,
  concede: refConcede,
};

/** Cada política `can*` exportada, com a ação que a usa. */
const COBERTAS: Record<string, Acao> = {
  canViewConsumers: 'ver',
  canManageConsumers: 'gerenciar',
  canMergeConsumers: 'unificar',
};

const ATUAL: Fontes = {
  pode: {
    ver: clientes.canViewConsumers,
    gerenciar: clientes.canManageConsumers,
    unificar: clientes.canMergeConsumers,
  },
  historico: (role, ov, recurso) => oQueOHistoricoMostra({ role, overrides: ov }, recurso),
  // A mesma composição de `purchases` em sales/sales.service.ts.
  compras: (role, ov) => canViewAllSales(role, ov) && clientes.canViewConsumers(role, ov),
  concede: (role, ov, p) => grantableManagerPermissions(role, ov).includes(p),
};

interface Caso {
  role: EstablishmentRole;
  confirmado: boolean;
  gravados: PermissionOverrideLike[];
  rotulo: string;
}

function impressao(f: Fontes, caso: Caso): Set<string> {
  const { role, confirmado } = caso;
  const ov = effectiveOverrides(role, confirmado, caso.gravados);
  const pares = new Set<string>();
  if (f.pode.ver(role, ov)) pares.add('clientes.ver:todos');
  if (f.pode.gerenciar(role, ov)) pares.add('clientes.gerenciar:todos');
  if (f.pode.unificar(role, ov)) pares.add('clientes.unificar:todos');
  for (const recurso of [true, false]) {
    const h = f.historico(role, ov, recurso);
    if (h.veDinheiro) pares.add(`clientes.historicoPreco:visivel:recurso=${recurso}`);
    if (h.veRecebimentos) pares.add(`clientes.historicoRecebimentos:visivel:recurso=${recurso}`);
  }
  if (f.compras(role, ov)) pares.add('guarda.vendas.comprasNaFicha:todos');
  for (const p of [CV, CG] as const) if (f.concede(role, ov, p)) pares.add(`guarda.equipe.concede:${p}`);
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
    historico: pecas.historico ?? ATUAL.historico,
    compras: pecas.compras ?? ATUAL.compras,
    concede: pecas.concede ?? ATUAL.concede,
  };
}

const { DONO, GERENTE, RECEPCIONISTA, PROFISSIONAL } = EstablishmentRole;

const MUTANTES: Record<string, Fontes> = {
  'gerente busca sem a concessão': trocar({ pode: { ver: (r, ov) => (r === GERENTE ? true : ATUAL.pode.ver(r, ov)) } }),
  'gerente cadastra só com CONSUMIDORES_GERENCIAR (sem a dependência)': trocar({
    pode: { gerenciar: (r, ov) => (r === GERENTE ? refConcedida(ov, CG) : ATUAL.pode.gerenciar(r, ov)) },
  }),
  'gerente cadastra só com CONSUMIDORES_VISUALIZAR': trocar({
    pode: { gerenciar: (r, ov) => (r === GERENTE ? refConcedida(ov, CV) : ATUAL.pode.gerenciar(r, ov)) },
  }),
  'dono cadastra com CONSUMIDORES_VISUALIZAR negada': trocar({
    pode: { gerenciar: (r, ov) => (r === DONO ? !refNegada(ov, [CG]) : ATUAL.pode.gerenciar(r, ov)) },
  }),
  'dono deixa de seguir a restrição de buscar': trocar({ pode: { ver: (r, ov) => (r === DONO ? true : ATUAL.pode.ver(r, ov)) } }),
  'GRANTED passa a vencer DENIED no gerente': trocar({
    pode: { ver: (r, ov) => (r === GERENTE ? ov.some((o) => o.permission === CV && o.mode === 'GRANTED') : ATUAL.pode.ver(r, ov)) },
  }),
  'gerente com tudo passa a unificar': trocar({
    pode: { unificar: (r, ov) => (r === GERENTE ? ATUAL.pode.gerenciar(r, ov) : ATUAL.pode.unificar(r, ov)) },
  }),
  'dono unifica com CONSUMIDORES_GERENCIAR negada': trocar({
    pode: { unificar: (r, ov) => (r === DONO ? !refNegada(ov, [CV]) : ATUAL.pode.unificar(r, ov)) },
  }),
  'recepcionista com GRANTED passa a buscar': trocar({
    pode: { ver: (r, ov) => (r === RECEPCIONISTA ? refConcedida(ov, CV) : ATUAL.pode.ver(r, ov)) },
  }),
  'profissional com GRANTED passa a buscar': trocar({
    pode: { ver: (r, ov) => (r === PROFISSIONAL ? refConcedida(ov, CV) : ATUAL.pode.ver(r, ov)) },
  }),
  'histórico mostra o preço ao gerente só com RECEBIMENTOS_VISUALIZAR (sem as dependências)': trocar({
    historico: (r, ov, recurso) => ({ ...ATUAL.historico(r, ov, recurso), veDinheiro: r !== GERENTE || refConcedida(ov, RV) }),
  }),
  'histórico esconde o preço do dono com a agenda negada': trocar({
    historico: (r, ov, recurso) => ({ ...ATUAL.historico(r, ov, recurso), veDinheiro: r === DONO ? !refNegada(ov, [AV]) : ATUAL.historico(r, ov, recurso).veDinheiro }),
  }),
  'histórico mostra o preço ao gerente com a consulta de clientes': trocar({
    historico: (r, ov, recurso) => ({ ...ATUAL.historico(r, ov, recurso), veDinheiro: r !== GERENTE || refConcedida(ov, CV) }),
  }),
  'histórico mostra recebimentos sem o recurso contratado': trocar({ historico: (r, ov) => ATUAL.historico(r, ov, true) }),
  'compras na ficha sem a consulta de clientes': trocar({ compras: (r, ov) => canViewAllSales(r, ov) }),
  'dono concede cadastrar clientes com CONSUMIDORES_VISUALIZAR negada': trocar({
    concede: (r, ov, p) => (r === DONO && p === CG ? !refNegada(ov, [EG, CG]) : ATUAL.concede(r, ov, p)),
  }),
};

// ---- Casos ----------------------------------------------------------------

const PAPEIS = [DONO, GERENTE, RECEPCIONISTA, PROFISSIONAL];
const ESTADOS = ['ausente', 'GRANTED', 'DENIED', 'ambos'] as const;
type Estado = (typeof ESTADOS)[number];

/** Grupos exaustivos: as ações de clientes com as guardas de vendas e
 * equipe; o histórico (preço e recebimentos) com a consulta de clientes. */
const GRUPOS: Record<string, readonly string[]> = {
  'buscar, cadastrar, unificar, compras e concessão': [CV, CG, VV, EG],
  'histórico do cliente': [CV, AV, PV, RV],
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

// ---- Campos do histórico --------------------------------------------------

const BASE_DO_ITEM: AtendimentoResumido = {
  id: 'ag1',
  startAt: '2026-11-20T13:00:00.000Z',
  localDate: '2026-11-20',
  localStart: '10:00',
  status: 'COMPLETED',
  professionalName: 'Ana',
  services: ['Corte', 'Barba'],
};
const ITENS: Record<string, ItemComPrecos> = {
  'dois preços': { ...BASE_DO_ITEM, precos: [5000, 3000] },
  'um preço sob consulta': { ...BASE_DO_ITEM, precos: [5000, null] },
  'sem itens': { ...BASE_DO_ITEM, precos: [] },
  'sem preços lidos': { ...BASE_DO_ITEM },
};
const RECEBIMENTOS: Record<string, Recebimento | undefined> = {
  nenhum: undefined,
  ativo: { amountCents: 8000, method: 'PIX', receivedOn: '2026-11-20', refunded: false },
  estornado: { amountCents: 8000, method: 'DINHEIRO', receivedOn: '2026-11-20', refunded: true },
};

function* casosDosCampos(): Generator<{ caso: Caso; recurso: boolean; item: string; recebimento: string }> {
  for (const caso of casosDoGrupo('histórico do cliente')) {
    for (const recurso of [true, false]) {
      for (const item of Object.keys(ITENS)) {
        for (const recebimento of Object.keys(RECEBIMENTOS)) yield { caso, recurso, item, recebimento };
      }
    }
  }
}

function camposAtuais(caso: Caso, recurso: boolean, item: ItemComPrecos, recebimento: Recebimento | undefined) {
  const ov = effectiveOverrides(caso.role, caso.confirmado, caso.gravados);
  return itemDoHistoricoParaQuemPediu(item, recebimento, oQueOHistoricoMostra({ role: caso.role, overrides: ov }, recurso));
}

function camposDaReferencia(caso: Caso, recurso: boolean, item: ItemComPrecos, recebimento: Recebimento | undefined) {
  const ov = effectiveOverrides(caso.role, caso.confirmado, caso.gravados);
  const { veDinheiro, veRecebimentos } = refHistorico(caso.role, ov, recurso);
  return refItem(item, recebimento, veDinheiro, veRecebimentos);
}

describe('Clientes: equivalência com a regra anterior à base comum', () => {
  it('cobre todas as políticas can* exportadas (política nova exige caso novo)', () => {
    expect(Object.keys(clientes).filter((k) => k.startsWith('can')).sort()).toEqual(Object.keys(COBERTAS).sort());
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
    for (const caso of casosDoGrupo('buscar, cadastrar, unificar, compras e concessão')) {
      const valem = effectiveOverrides(caso.role, caso.confirmado, caso.gravados);
      for (const a of ACOES) if (refPode(caso.role, valem, a) !== ATUAL.pode[a](caso.role, caso.gravados)) apanhados++;
    }
    expect(apanhados).toBeGreaterThan(0);
  });

  it('sem ajustes informados vale o mesmo que lista vazia', () => {
    for (const role of PAPEIS) {
      for (const [nome, a] of Object.entries(COBERTAS)) {
        const politica = clientes[nome as keyof typeof clientes] as (r: EstablishmentRole) => boolean;
        expect(politica(role), `${role} ${nome}`).toBe(refPode(role, [], a));
      }
      expect(oQueOHistoricoMostra({ role }, true), role).toEqual(refHistorico(role, [], true));
    }
  });

  it('nenhum alcance próprio: o funcionário e a recepcionista não alcançam cliente algum, com tudo gravado', () => {
    const tudo = G(...MANAGER_PERMISSIONS, ...STAFF_PERMISSIONS);
    for (const role of [PROFISSIONAL, RECEPCIONISTA]) {
      for (const confirmado of [true, false]) {
        const pares = impressao(ATUAL, { role, confirmado, gravados: tudo, rotulo: '' });
        // O preço do histórico "visível" para quem não é gerente é a regra
        // antiga; ninguém além do dono e do gerente chega ao histórico.
        expect([...pares].filter((p) => !p.includes('historicoPreco')), `${role} ${confirmado}`).toEqual([]);
      }
    }
  });

  it('campos de cada item do histórico iguais à transformação anterior, em todas as combinações', () => {
    let total = 0;
    const desfechos = new Set<string>();
    const diferentes: string[] = [];
    // Entradas congeladas: alterar o item ou o recebimento recebido lança erro.
    const congelar = <T>(v: T): T => {
      if (v && typeof v === 'object') {
        for (const filho of Object.values(v)) congelar(filho);
        Object.freeze(v);
      }
      return v;
    };
    const entradas = congelar(structuredClone(ITENS));
    const recebidos = congelar(structuredClone(RECEBIMENTOS));
    for (const { caso, recurso, item, recebimento } of casosDosCampos()) {
      const depois = camposAtuais(caso, recurso, entradas[item], recebidos[recebimento]);
      const antes = camposDaReferencia(caso, recurso, ITENS[item], RECEBIMENTOS[recebimento]);
      if (!isDeepStrictEqual(depois, antes) && diferentes.length < 5) {
        diferentes.push(`${caso.rotulo} recurso=${recurso} ${item} ${recebimento}: ${JSON.stringify(depois)} != ${JSON.stringify(antes)}`);
      }
      desfechos.add(depois.hidden.join('+') || 'nada');
      total++;
    }
    expect(diferentes).toEqual([]);
    expect(entradas).toEqual(ITENS);
    expect(recebidos).toEqual(RECEBIMENTOS);
    expect(total).toBe(4 * 2 * 4 ** 4 * 2 * Object.keys(ITENS).length * Object.keys(RECEBIMENTOS).length);
    // Três desfechos: quem vê recebimentos sempre vê o preço (o gerente com a
    // consulta de recebimentos vê os dois; o dono sempre vê o preço), então
    // 'só o preço escondido' não acontece, antes nem depois.
    expect([...desfechos].sort()).toEqual(['nada', 'payment', 'price+payment'].sort());
  });

  it('campos nomeados: dono, gerente com e sem a consulta de recebimentos, recurso desligado', () => {
    const ativo = RECEBIMENTOS.ativo;
    const item = ITENS['dois preços'];
    const { precos: _precos, ...semPrecos } = item;
    void _precos;
    expect(itemDoHistoricoParaQuemPediu(item, ativo, oQueOHistoricoMostra({ role: DONO, overrides: [] }, true))).toEqual({
      ...semPrecos,
      priceCents: 8000,
      payment: ativo,
      hidden: [],
    });
    expect(itemDoHistoricoParaQuemPediu(item, ativo, oQueOHistoricoMostra({ role: DONO, overrides: [] }, false))).toEqual({
      ...semPrecos,
      priceCents: 8000,
      hidden: ['payment'],
    });
    expect(itemDoHistoricoParaQuemPediu(item, undefined, oQueOHistoricoMostra({ role: GERENTE, overrides: G(CV) }, true))).toEqual({
      ...semPrecos,
      priceCents: null,
      hidden: ['price', 'payment'],
    });
    expect(itemDoHistoricoParaQuemPediu(item, undefined, oQueOHistoricoMostra({ role: GERENTE, overrides: G(CV, RV, AV, PV) }, true))).toEqual({
      ...semPrecos,
      priceCents: 8000,
      payment: null,
      hidden: [],
    });
    // Dono com a agenda negada: vê o preço, não o recebimento.
    expect(oQueOHistoricoMostra({ role: DONO, overrides: D(AV) }, true)).toEqual({ veDinheiro: true, veRecebimentos: false });
  });

  it('recusas e limites nomeados, e mensagens iguais', () => {
    // Dono: buscar só com a própria negada; cadastrar e unificar com qualquer das duas.
    expect(clientes.canViewConsumers(DONO, D(CG))).toBe(true);
    expect(clientes.canViewConsumers(DONO, D(CV))).toBe(false);
    for (const p of [CV, CG]) {
      expect(clientes.canManageConsumers(DONO, D(p)), p).toBe(false);
      expect(clientes.canMergeConsumers(DONO, D(p)), p).toBe(false);
    }
    // Negar outras áreas não tira clientes do dono.
    for (const p of [AV, PV, RV, VV, EG]) expect(clientes.canViewConsumers(DONO, D(p)), p).toBe(true);
    // Gerente: cada ação com a sua concessão e a dependência; DENIED vence; nunca unifica.
    expect(clientes.canViewConsumers(GERENTE, G(CV))).toBe(true);
    expect(clientes.canManageConsumers(GERENTE, G(CG))).toBe(false);
    expect(clientes.canManageConsumers(GERENTE, G(CG, CV))).toBe(true);
    expect(clientes.canManageConsumers(GERENTE, [...G(CG, CV), ...D(CV)])).toBe(false);
    expect(clientes.canViewConsumers(GERENTE, effectiveOverrides(GERENTE, false, G(CV)))).toBe(false);
    expect(clientes.canMergeConsumers(GERENTE, G(...MANAGER_PERMISSIONS))).toBe(false);
    // O preço do histórico segue o mesmo recorte do preço na agenda.
    for (const role of PAPEIS) {
      for (const estados of combinacoes(4)) {
        const ov = ajustes(estados, [CV, AV, PV, RV]);
        expect(oQueOHistoricoMostra({ role, overrides: ov }, true).veDinheiro).toBe(canSeeAppointmentPrices(role, ov));
      }
    }
    expect(clientes.CONSUMERS_FORBIDDEN_MESSAGE).toBe('Você não tem permissão para acessar os clientes deste estabelecimento.');
    expect(clientes.CONSUMERS_MERGE_FORBIDDEN_MESSAGE).toBe('Só o dono do estabelecimento unifica cadastros de clientes.');
  });
});
