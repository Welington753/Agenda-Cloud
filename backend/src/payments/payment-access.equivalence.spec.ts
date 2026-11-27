// Equivalência por ação e alcance entre as políticas de Recebimentos e a
// regra anterior à base comum (docs/plans/permissoes-individuais.md, etapa 1).
//
// A REFERÊNCIA é uma cópia congelada de `payments/payment-access.ts` como
// estava em `264d31d` (igual a `8f71335`, o piloto), com a política de ver a
// agenda do dono que ela chamava (`canViewAppointments`: só
// `AGENDA_VISUALIZAR` negada barra) escrita por extenso. Usa só listas
// literais, sem importar `managerCan`, `algumaNegada`,
// `MANAGER_PERMISSION_REQUIRES`, a base comum nem as políticas da Agenda.
//
// IMPRESSÃO: para cada vínculo sintético, o conjunto de pares (ação, alcance).
// Recebimentos não têm alcance próprio: quem consulta vê todos os do
// estabelecimento, e o funcionário nunca vê nenhum, nem dos próprios
// atendimentos. Entram também, como GUARDA, as decisões de outras áreas que
// dependem de `canViewPayments` e NÃO foram convertidas aqui: a consulta de
// comissões (`canViewCommissions`, etapa de Comissões) e o que o histórico do
// cliente mostra (`oQueOHistoricoMostra`, etapa de Clientes), com o recurso
// contratado ligado ou não.
//
// Casos: os quatro papéis, gerente confirmado ou não (o descarte dos GRANTED
// acontece em `effectiveOverrides`, antes da política, como no serviço) e
// todas as combinações de ausente, GRANTED, DENIED ou os dois em dois grupos
// de permissões, mais um lote pseudoaleatório de semente fixa com todas as
// permissões.
//
// Fora das políticas e intocados por esta etapa: o vínculo, a situação do
// estabelecimento, o acesso comercial e o recurso `PAGAMENTOS` seguem em
// `resolveAuthorizedTenant`; a senha confirmada há pouco do estorno
// (`requireRecentReauth`), as travas e o isolamento por `tenant_id` seguem em
// `payments.service.ts`.
import { describe, expect, it } from 'vitest';
import { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { Permission } from '../entities/enums/permission.enum.js';
import { PermissionMode } from '../entities/enums/permission-mode.enum.js';
import { effectiveOverrides, type PermissionOverrideLike } from '../common/tenant-authorization.js';
import { MANAGER_PERMISSIONS } from '../common/manager-permissions.js';
import { STAFF_PERMISSIONS } from '../team/staff-access.js';
import { canViewAppointments } from '../appointments/appointment-access.js';
import { canViewCommissions } from '../commissions/commission-access.js';
import { oQueOHistoricoMostra } from '../consumers/consumer-profile.service.js';
import * as recebimentos from './payment-access.js';

const AV = 'AGENDA_VISUALIZAR';
const PV = 'PROFISSIONAIS_VISUALIZAR';
const RV = 'RECEBIMENTOS_VISUALIZAR';
const RR = 'RECEBIMENTOS_REGISTRAR';
const RE = 'RECEBIMENTOS_ESTORNAR';
const CMV = 'COMISSOES_VISUALIZAR';

// ---- Referência congelada (264d31d = 8f71335) -----------------------------

/** O que o gerente precisa concedido (já com as dependências; `null`, nunca)
 * e o que barra o dono se negado. Recepcionista, funcionário e qualquer outro
 * papel: nunca. */
const REF = {
  consultar: { gerente: [RV, AV, PV], dono: [AV] },
  registrar: { gerente: [RR, RV, AV, PV], dono: [AV] },
  estornar: { gerente: [RE, RV, AV, PV], dono: [AV] },
  operarComoDono: { gerente: null, dono: [AV] },
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

/** Guarda: comissões (só o dono, sem `COMISSOES_VISUALIZAR` negada e com a
 * consulta de recebimentos) e o histórico do cliente (preço como na agenda;
 * recebimentos com a consulta e o recurso contratado). */
function refComissoes(role: string, ov: readonly PermissionOverrideLike[]): boolean {
  return role === 'DONO' && !refNegada(ov, [CMV]) && refPode(role, ov, 'consultar');
}

function refHistorico(role: string, ov: readonly PermissionOverrideLike[], recurso: boolean) {
  return {
    veDinheiro: role !== 'GERENTE' || [RV, AV, PV].every((p) => refConcedida(ov, p)),
    veRecebimentos: recurso && refPode(role, ov, 'consultar'),
  };
}

// ---- Impressão de acesso --------------------------------------------------

type Pol = (role: EstablishmentRole, ov: readonly PermissionOverrideLike[]) => boolean;

interface Fontes {
  pode: Record<Acao, Pol>;
  comissoes: Pol;
  historico: (role: EstablishmentRole, ov: readonly PermissionOverrideLike[], recurso: boolean) => { veDinheiro: boolean; veRecebimentos: boolean };
}

const REFERENCIA: Fontes = {
  pode: Object.fromEntries(ACOES.map((a) => [a, (r: string, ov: readonly PermissionOverrideLike[]) => refPode(r, ov, a)])) as Record<Acao, Pol>,
  comissoes: refComissoes,
  historico: refHistorico,
};

/** Cada política `can*` exportada, com a ação que a usa. */
const COBERTAS: Record<string, Acao> = {
  canViewPayments: 'consultar',
  canRecordPayments: 'registrar',
  canRefundPayments: 'estornar',
  canManagePayments: 'operarComoDono',
};

const ATUAL: Fontes = {
  pode: {
    consultar: recebimentos.canViewPayments,
    registrar: recebimentos.canRecordPayments,
    estornar: recebimentos.canRefundPayments,
    operarComoDono: recebimentos.canManagePayments,
  },
  comissoes: canViewCommissions,
  historico: (role, ov, recurso) => oQueOHistoricoMostra({ role, overrides: ov }, recurso),
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
  if (f.pode.consultar(role, ov)) pares.add('recebimentos.consultar:todos');
  if (f.pode.registrar(role, ov)) pares.add('recebimentos.registrar:todos');
  if (f.pode.estornar(role, ov)) pares.add('recebimentos.estornar:todos');
  if (f.pode.operarComoDono(role, ov)) pares.add('recebimentos.operarComoDono:todos');
  if (f.comissoes(role, ov)) pares.add('guarda.comissoes.ver:todos');
  for (const recurso of [true, false]) {
    const h = f.historico(role, ov, recurso);
    if (h.veDinheiro) pares.add(`guarda.cliente.historicoPreco:visivel:recurso=${recurso}`);
    if (h.veRecebimentos) pares.add(`guarda.cliente.historicoRecebimentos:visivel:recurso=${recurso}`);
  }
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

function trocar(pecas: { pode?: Partial<Record<Acao, Pol>>; comissoes?: Pol; historico?: Fontes['historico'] }): Fontes {
  return {
    pode: { ...ATUAL.pode, ...pecas.pode },
    comissoes: pecas.comissoes ?? ATUAL.comissoes,
    historico: pecas.historico ?? ATUAL.historico,
  };
}

const { DONO, GERENTE, RECEPCIONISTA, PROFISSIONAL } = EstablishmentRole;
const doDono = (r: EstablishmentRole, ov: readonly PermissionOverrideLike[], lista: readonly string[], outro: () => boolean) =>
  r === DONO ? !refNegada(ov, lista) : outro();
const doGerente = (r: EstablishmentRole, ov: readonly PermissionOverrideLike[], lista: readonly string[], outro: () => boolean) =>
  r === GERENTE ? lista.every((p) => refConcedida(ov, p)) : outro();

const MUTANTES: Record<string, Fontes> = {
  // O erro mais provável da conversão: aplicar ao dono as dependências do gerente.
  'dono passa a exigir RECEBIMENTOS_VISUALIZAR e as dependências para consultar': trocar({
    pode: { consultar: (r, ov) => doDono(r, ov, [RV, AV, PV], () => ATUAL.pode.consultar(r, ov)) },
  }),
  'dono passa a exigir PROFISSIONAIS_VISUALIZAR para registrar': trocar({
    pode: { registrar: (r, ov) => doDono(r, ov, [AV, PV], () => ATUAL.pode.registrar(r, ov)) },
  }),
  'dono passa a exigir RECEBIMENTOS_ESTORNAR para estornar': trocar({
    pode: { estornar: (r, ov) => doDono(r, ov, [AV, RE], () => ATUAL.pode.estornar(r, ov)) },
  }),
  'dono deixa de seguir a restrição da agenda': trocar({
    pode: { consultar: (r, ov) => (r === DONO ? true : ATUAL.pode.consultar(r, ov)) },
  }),
  'gerente registra sem a consulta de recebimentos': trocar({
    pode: { registrar: (r, ov) => doGerente(r, ov, [RR, AV, PV], () => ATUAL.pode.registrar(r, ov)) },
  }),
  'gerente estorna com a permissão de registrar': trocar({
    pode: { estornar: (r, ov) => doGerente(r, ov, [RR, RV, AV, PV], () => ATUAL.pode.estornar(r, ov)) },
  }),
  'gerente consulta sem PROFISSIONAIS_VISUALIZAR': trocar({
    pode: { consultar: (r, ov) => doGerente(r, ov, [RV, AV], () => ATUAL.pode.consultar(r, ov)) },
  }),
  'GRANTED passa a vencer DENIED no gerente': trocar({
    pode: {
      estornar: (r, ov) =>
        r === GERENTE ? REF.estornar.gerente.every((p) => ov.some((o) => o.permission === p && o.mode === 'GRANTED')) : ATUAL.pode.estornar(r, ov),
    },
  }),
  'gerente passa a operar como dono': trocar({
    pode: { operarComoDono: (r, ov) => (r === GERENTE ? ATUAL.pode.consultar(r, ov) : ATUAL.pode.operarComoDono(r, ov)) },
  }),
  'recepcionista com GRANTED passa a consultar': trocar({
    pode: { consultar: (r, ov) => (r === RECEPCIONISTA ? refConcedida(ov, RV) : ATUAL.pode.consultar(r, ov)) },
  }),
  'profissional com GRANTED passa a consultar': trocar({
    pode: { consultar: (r, ov) => (r === PROFISSIONAL ? refConcedida(ov, RV) : ATUAL.pode.consultar(r, ov)) },
  }),
  'comissões passam a valer para o gerente com recebimentos': trocar({
    comissoes: (r, ov) => (r === GERENTE ? ATUAL.pode.consultar(r, ov) : ATUAL.comissoes(r, ov)),
  }),
  'histórico mostra recebimentos sem o recurso contratado': trocar({
    historico: (r, ov) => ATUAL.historico(r, ov, true),
  }),
};

// ---- Casos ----------------------------------------------------------------

const PAPEIS = [DONO, GERENTE, RECEPCIONISTA, PROFISSIONAL];
const ESTADOS = ['ausente', 'GRANTED', 'DENIED', 'ambos'] as const;
type Estado = (typeof ESTADOS)[number];

/** Dois grupos exaustivos: as três ações com as dependências; a guarda de
 * comissões e do histórico. */
const GRUPOS: Record<string, readonly string[]> = {
  'consultar, registrar e estornar': [AV, PV, RV, RR, RE],
  'comissões e histórico do cliente': [AV, PV, RV, CMV],
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

function* casosSorteados(quantidade: number): Generator<Caso> {
  const sortear = sorteador(20261127);
  const universo = [...new Set<string>([...MANAGER_PERMISSIONS, ...STAFF_PERMISSIONS, ...Object.values(Permission)])];
  for (let i = 0; i < quantidade; i++) {
    const role = PAPEIS[Math.floor(sortear() * PAPEIS.length)];
    const confirmado = sortear() < 0.5;
    const estados = universo.map(() => ESTADOS[Math.floor(sortear() * ESTADOS.length)]);
    yield { role, confirmado, gravados: ajustes(estados, universo), rotulo: `${role} ${confirmado} caso ${i}` };
  }
}

const G = (...ps: string[]) => ps.map((p) => ({ permission: p as Permission, mode: PermissionMode.GRANTED }));
const D = (...ps: string[]) => ps.map((p) => ({ permission: p as Permission, mode: PermissionMode.DENIED }));

describe('Recebimentos: equivalência com a regra anterior à base comum', () => {
  it('cobre todas as políticas can* exportadas (política nova exige caso novo)', () => {
    expect(Object.keys(recebimentos).filter((k) => k.startsWith('can')).sort()).toEqual(Object.keys(COBERTAS).sort());
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
    for (const caso of casosDoGrupo('consultar, registrar e estornar')) {
      const valem = effectiveOverrides(caso.role, caso.confirmado, caso.gravados);
      for (const a of ACOES) if (refPode(caso.role, valem, a) !== ATUAL.pode[a](caso.role, caso.gravados)) apanhados++;
    }
    expect(apanhados).toBeGreaterThan(0);
  });

  it('sem ajustes informados vale o mesmo que lista vazia', () => {
    for (const role of PAPEIS) {
      for (const [nome, a] of Object.entries(COBERTAS)) {
        const politica = recebimentos[nome as keyof typeof recebimentos] as (r: EstablishmentRole) => boolean;
        expect(politica(role), `${role} ${nome}`).toBe(refPode(role, [], a));
      }
    }
  });

  it('nenhum alcance próprio: o funcionário e a recepcionista não veem recebimento algum, com tudo gravado', () => {
    const tudo = G(...MANAGER_PERMISSIONS, ...STAFF_PERMISSIONS);
    for (const role of [PROFISSIONAL, RECEPCIONISTA]) {
      for (const confirmado of [true, false]) {
        const pares = impressao(ATUAL, { role, confirmado, gravados: tudo, rotulo: '' });
        expect([...pares].filter((p) => !p.includes('historicoPreco')), `${role} ${confirmado}`).toEqual([]);
      }
    }
  });

  it('recusas e limites nomeados, e mensagens iguais', () => {
    // Dono: só a restrição da agenda tira os recebimentos; negar as próprias
    // permissões de recebimentos ou as dependências do gerente não tira.
    for (const p of [RV, RR, RE, PV]) {
      expect(recebimentos.canViewPayments(DONO, D(p)), p).toBe(true);
      expect(recebimentos.canRecordPayments(DONO, D(p)), p).toBe(true);
      expect(recebimentos.canRefundPayments(DONO, D(p)), p).toBe(true);
    }
    for (const politica of Object.values(ATUAL.pode)) expect(politica(DONO, D(AV))).toBe(false);
    // Gerente: cada ação com a sua concessão e as dependências; DENIED vence.
    expect(recebimentos.canViewPayments(GERENTE, G(RV, AV))).toBe(false);
    expect(recebimentos.canViewPayments(GERENTE, G(RV, AV, PV))).toBe(true);
    expect(recebimentos.canRecordPayments(GERENTE, G(RR, AV, PV))).toBe(false);
    expect(recebimentos.canRecordPayments(GERENTE, G(RR, RV, AV, PV))).toBe(true);
    expect(recebimentos.canRefundPayments(GERENTE, G(RR, RV, AV, PV))).toBe(false);
    expect(recebimentos.canRefundPayments(GERENTE, G(RE, RV, AV, PV))).toBe(true);
    expect(recebimentos.canRefundPayments(GERENTE, [...G(RE, RV, AV, PV), ...D(RE)])).toBe(false);
    expect(recebimentos.canViewPayments(GERENTE, effectiveOverrides(GERENTE, false, G(RV, AV, PV)))).toBe(false);
    expect(recebimentos.canManagePayments(GERENTE, G(...MANAGER_PERMISSIONS))).toBe(false);
    // A lista do dono continua igual à de ver a agenda.
    for (const estados of combinacoes(5)) {
      const ov = ajustes(estados, [AV, PV, RV, RR, RE]);
      expect(recebimentos.canViewPayments(DONO, ov)).toBe(canViewAppointments(DONO, ov));
    }
    expect(recebimentos.PAYMENTS_FORBIDDEN_MESSAGE).toBe('Você não tem permissão para ver ou registrar recebimentos deste estabelecimento.');
    expect(recebimentos.PAYMENT_RECORD_FORBIDDEN_MESSAGE).toBe(recebimentos.PAYMENTS_FORBIDDEN_MESSAGE);
    expect(recebimentos.PAYMENT_REFUND_FORBIDDEN_MESSAGE).toBe(recebimentos.PAYMENTS_FORBIDDEN_MESSAGE);
  });
});
