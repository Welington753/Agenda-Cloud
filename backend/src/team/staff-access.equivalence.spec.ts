// Equivalência por ação e alcance entre as políticas de Equipe e agenda
// própria e a regra anterior à base comum (docs/plans/permissoes-individuais.md,
// etapa 1).
//
// A REFERÊNCIA é uma cópia congelada das regras como estavam em `251dc99`
// (iguais a `8f71335`, o piloto, salvo a lista das permissões de funcionário,
// que só mudou de arquivo): `team/staff-access.ts`, `grantedTeamPermissions`
// de `team/team.service.ts`, `effectiveOverrides` e a agenda própria da
// sessão (`auth/session-areas.ts`). As políticas do dono que decidem o que ele
// pode conceder estão escritas como as listas de DENIED que barram cada
// concessão (iguais às das áreas, conferidas pelos specs de equivalência
// delas). Usa só listas literais, sem importar `algumaNegada`,
// `staffPermissionGranted`, a base comum nem as políticas de outras áreas;
// dos catálogos, só a ORDEM de `MANAGER_PERMISSIONS` e
// `RECEPTIONIST_PERMISSIONS`, que a lista exibida segue.
//
// IMPRESSÃO: para cada vínculo sintético, o conjunto de pares (ação, alcance):
// - `agenda.ver:propria`: a agenda do profissional ligado
//   (`resolveStaffAccess`: agenda própria pelo papel e pela confirmação, depois
//   o profissional ligado e ativo);
// - `agenda.iniciar|concluir|falta:propria`: as ações sobre os próprios
//   atendimentos, com a agenda própria e a concessão;
// - `equipe.gerenciar:estabelecimento`: "Equipe e acessos" (vagas, vínculos,
//   convites, senhas e concessões passam todos por `resolveTeamManager`);
// - `equipe.concede:<permissão>`: o que este vínculo pode conceder;
// - `equipe.efetivas:<lista>`: as concessões que valem, como a tela mostra e
//   como a troca de permissões compara (ordem incluída);
// - `funcionario.efetivas:<lista>`: as permissões de funcionário efetivas.
//
// Entram como GUARDA as áreas da sessão (`TENANT_AREAS`: EQUIPE,
// AGENDA_PROPRIA_VER, AGENDA_PROPRIA_INICIAR, …_CONCLUIR e …_FALTA) e a regra
// da agenda própria no menu (profissional ligado e agenda própria pela
// confirmação).
//
// Fora das políticas e intocados por esta etapa: o vínculo ativo, a situação
// do estabelecimento, o recurso `EQUIPE` (e `COMISSOES`, adicionais), as
// vagas, a senha recente do dono, o profissional ligado e ativo, o que cada
// papel pode RECEBER (`validarConcessoes`), o SQL e o filtro por `tenant_id`.
import { describe, expect, it } from 'vitest';
import { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { Permission } from '../entities/enums/permission.enum.js';
import { PermissionMode } from '../entities/enums/permission-mode.enum.js';
import { effectiveOverrides, type PermissionOverrideLike } from '../common/tenant-authorization.js';
import { MANAGER_PERMISSIONS, RECEPTIONIST_PERMISSIONS } from '../common/manager-permissions.js';
import { TENANT_AREAS } from '../accounts/tenant-effective-access.js';
import { grantedTeamPermissions } from './team.service.js';
import * as equipe from './staff-access.js';

const AI = 'ATENDIMENTO_PROPRIO_INICIAR';
const AC = 'ATENDIMENTO_PROPRIO_CONCLUIR';
const AF = 'ATENDIMENTO_PROPRIO_FALTA';
const KP = 'COMISSOES_PROPRIAS_VISUALIZAR';
const EG = 'EQUIPE_GERENCIAR';
const AV = 'AGENDA_VISUALIZAR';
const AG = 'AGENDA_GERENCIAR';
const CA = 'AGENDAMENTO_CANCELAR';
const KV = 'COMISSOES_VISUALIZAR';
const PV = 'PROFISSIONAIS_VISUALIZAR';
const VR = 'VENDAS_REGISTRAR';
const VB = 'VENDAS_RECEBER';
const VP = 'VENDAS_ALTERAR_PRECO';
const VV = 'VENDAS_VISUALIZAR';

/** Literal: as permissões de funcionário, na ordem do catálogo. */
const FUNCIONARIO = [AI, AC, AF, KP] as const;
const ACOES = { iniciar: AI, concluir: AC, falta: AF } as const;

// ---- Referência congelada (251dc99 = 8f71335) ------------------------------

function refConcedida(ov: readonly PermissionOverrideLike[], p: string): boolean {
  return ov.some((o) => o.permission === p && o.mode === 'GRANTED') && !ov.some((o) => o.permission === p && o.mode === 'DENIED');
}

function refNegada(ov: readonly PermissionOverrideLike[], ps: readonly string[]): boolean {
  return ov.some((o) => o.mode === 'DENIED' && ps.includes(o.permission));
}

/** Gerente sem confirmação: os GRANTED gravados não valem. */
function refValem(role: string, confirmado: boolean, gravados: readonly PermissionOverrideLike[]): PermissionOverrideLike[] {
  return role === 'GERENTE' && !confirmado ? gravados.filter((o) => o.mode !== 'GRANTED') : [...gravados];
}

/** Agenda própria: o funcionário sempre; o gerente só confirmado. */
function refAgendaPropria(role: string, confirmado: boolean): boolean {
  return role === 'PROFISSIONAL' || (role === 'GERENTE' && confirmado);
}

/** Permissão de funcionário: funcionário ou gerente, GRANTED sem DENIED. */
function refFuncionario(role: string, ov: readonly PermissionOverrideLike[], p: string): boolean {
  return (role === 'PROFISSIONAL' || role === 'GERENTE') && refConcedida(ov, p);
}

/** Equipe e acessos: só o dono, sem `EQUIPE_GERENCIAR` negada. */
function refGerenciarEquipe(role: string, ov: readonly PermissionOverrideLike[]): boolean {
  return role === 'DONO' && !refNegada(ov, [EG]);
}

/** Para cada concessão, os DENIED do dono que o impedem de concedê-la (a
 * política do dono naquela ação), além de `EQUIPE_GERENCIAR`. */
const BARRA_CONCEDER: Readonly<Record<string, readonly string[]>> = {
  ATENDIMENTO_PROPRIO_INICIAR: [AV, AG],
  ATENDIMENTO_PROPRIO_CONCLUIR: [AV, AG],
  ATENDIMENTO_PROPRIO_FALTA: [AV, AG],
  COMISSOES_PROPRIAS_VISUALIZAR: [AV, KV],
  AGENDA_VISUALIZAR: [AV],
  AGENDA_GERENCIAR: [AV, AG],
  AGENDAMENTO_CRIAR: [AV, 'AGENDAMENTO_CRIAR', PV, 'SERVICOS_VISUALIZAR', 'CONSUMIDORES_VISUALIZAR'],
  AGENDAMENTO_EDITAR: [AV, 'AGENDAMENTO_EDITAR', PV, 'SERVICOS_VISUALIZAR'],
  AGENDAMENTO_CANCELAR: [AV, CA],
  SOLICITACOES_VISUALIZAR: [AV],
  SOLICITACOES_TRATAR: [AV, AG, CA],
  CONSUMIDORES_VISUALIZAR: ['CONSUMIDORES_VISUALIZAR'],
  CONSUMIDORES_GERENCIAR: ['CONSUMIDORES_VISUALIZAR', 'CONSUMIDORES_GERENCIAR'],
  SERVICOS_VISUALIZAR: ['SERVICOS_VISUALIZAR'],
  SERVICOS_GERENCIAR: ['SERVICOS_VISUALIZAR', 'SERVICOS_GERENCIAR'],
  PROFISSIONAIS_VISUALIZAR: [PV],
  PROFISSIONAIS_GERENCIAR: [PV, 'PROFISSIONAIS_GERENCIAR'],
  RECEBIMENTOS_VISUALIZAR: [AV],
  RECEBIMENTOS_REGISTRAR: [AV],
  RECEBIMENTOS_ESTORNAR: [AV],
  ESTOQUE_VISUALIZAR: ['ESTOQUE_VISUALIZAR'],
  ESTOQUE_GERENCIAR: ['ESTOQUE_VISUALIZAR', 'ESTOQUE_GERENCIAR'],
  VENDAS_REGISTRAR: [VR],
  VENDAS_RECEBER: [VR, VB],
  VENDAS_ALTERAR_PRECO: [VR, VP],
  VENDAS_VISUALIZAR: [VV],
  VENDAS_CANCELAR: [VV, 'VENDAS_CANCELAR'],
  VENDAS_ESTORNAR_RECEBIMENTO: [VV, 'VENDAS_ESTORNAR_RECEBIMENTO'],
};
const CONCESSOES = Object.keys(BARRA_CONCEDER);

function refConcede(role: string, ov: readonly PermissionOverrideLike[]): string[] {
  if (!refGerenciarEquipe(role, ov)) return [];
  return CONCESSOES.filter((p) => !refNegada(ov, BARRA_CONCEDER[p]));
}

/** As concessões que valem, na ordem exibida: a recepcionista só as dela
 * (cada uma GRANTED sem DENIED); funcionário e gerente as de funcionário e
 * depois as de gerente (só o gerente as tem); o dono e outros, nenhuma. */
function refEfetivas(role: string, confirmado: boolean, gravados: readonly PermissionOverrideLike[]): string[] {
  if (role === 'RECEPCIONISTA') return RECEPTIONIST_PERMISSIONS.filter((p) => refConcedida(gravados, p));
  if (role !== 'PROFISSIONAL' && role !== 'GERENTE') return [];
  const ov = refValem(role, confirmado, gravados);
  return [
    ...FUNCIONARIO.filter((p) => refConcedida(ov, p)),
    ...(role === 'GERENTE' ? MANAGER_PERMISSIONS.filter((p) => refConcedida(ov, p)) : []),
  ];
}

// ---- Impressão de acesso --------------------------------------------------

type Pol = (role: EstablishmentRole, ov: readonly PermissionOverrideLike[]) => boolean;
type Vinculo = 'sem profissional' | 'profissional inativo' | 'profissional ativo';
const VINCULOS: Vinculo[] = ['sem profissional', 'profissional inativo', 'profissional ativo'];

const AREAS_DA_SESSAO = [
  'EQUIPE',
  'AGENDA_PROPRIA_VER',
  'AGENDA_PROPRIA_INICIAR',
  'AGENDA_PROPRIA_CONCLUIR',
  'AGENDA_PROPRIA_FALTA',
] as const;
type AreaDaSessao = (typeof AREAS_DA_SESSAO)[number];

interface Fontes {
  valem: (role: EstablishmentRole, confirmado: boolean, gravados: readonly PermissionOverrideLike[]) => PermissionOverrideLike[];
  agendaPropria: (role: EstablishmentRole, confirmado: boolean) => boolean;
  /** Profissional ligado e ativo, como `resolveStaffAccess` confere. */
  vinculoValido: (vinculo: Vinculo) => boolean;
  funcionario: (role: EstablishmentRole, ov: readonly PermissionOverrideLike[], p: (typeof FUNCIONARIO)[number]) => boolean;
  funcionarioEfetivas: (role: EstablishmentRole, ov: readonly PermissionOverrideLike[]) => string[];
  gerenciarEquipe: Pol;
  concede: (role: EstablishmentRole, ov: readonly PermissionOverrideLike[]) => string[];
  efetivas: (role: EstablishmentRole, confirmado: boolean, gravados: readonly PermissionOverrideLike[]) => string[];
  sessao: Record<AreaDaSessao, Pol>;
  /** Menu: profissional ligado (ativo ou não) e agenda própria pela confirmação. */
  sessaoAgendaPropria: (role: EstablishmentRole, confirmado: boolean, vinculo: Vinculo) => boolean;
}

const REFERENCIA: Fontes = {
  valem: refValem,
  agendaPropria: refAgendaPropria,
  vinculoValido: (v) => v === 'profissional ativo',
  funcionario: refFuncionario,
  funcionarioEfetivas: (role, ov) => FUNCIONARIO.filter((p) => refFuncionario(role, ov, p)),
  gerenciarEquipe: refGerenciarEquipe,
  concede: refConcede,
  efetivas: refEfetivas,
  sessao: {
    EQUIPE: refGerenciarEquipe,
    AGENDA_PROPRIA_VER: (role) => refAgendaPropria(role, false),
    AGENDA_PROPRIA_INICIAR: (role, ov) => refFuncionario(role, ov, AI),
    AGENDA_PROPRIA_CONCLUIR: (role, ov) => refFuncionario(role, ov, AC),
    AGENDA_PROPRIA_FALTA: (role, ov) => refFuncionario(role, ov, AF),
  },
  sessaoAgendaPropria: (role, confirmado, vinculo) => vinculo !== 'sem profissional' && refAgendaPropria(role, confirmado),
};

function areaDaSessao(chave: AreaDaSessao): Pol {
  const area = TENANT_AREAS.find((a) => a.key === chave);
  if (!area) throw new Error(`área ${chave} ausente de TENANT_AREAS`);
  return area.policy;
}

/** Cada política exportada, com os pares que ela decide. */
const COBERTAS = [
  'canManageTeam',
  'canViewOwnAgenda',
  'grantableManagerPermissions',
  'grantableStaffPermissions',
  'staffGrantedPermissions',
  'staffPermissionGranted',
];

const ATUAL: Fontes = {
  valem: (role, confirmado, gravados) => effectiveOverrides(role, confirmado, gravados),
  agendaPropria: equipe.canViewOwnAgenda,
  vinculoValido: (v) => v === 'profissional ativo',
  funcionario: equipe.staffPermissionGranted,
  funcionarioEfetivas: equipe.staffGrantedPermissions,
  gerenciarEquipe: equipe.canManageTeam,
  concede: (role, ov) => [...equipe.grantableStaffPermissions(role, ov), ...equipe.grantableManagerPermissions(role, ov)],
  efetivas: grantedTeamPermissions,
  sessao: Object.fromEntries(AREAS_DA_SESSAO.map((k) => [k, areaDaSessao(k)])) as Record<AreaDaSessao, Pol>,
  // auth/session-areas.ts: `membership.professionalId && canViewOwnAgenda(role, confirmado)`.
  sessaoAgendaPropria: (role, confirmado, vinculo) => vinculo !== 'sem profissional' && equipe.canViewOwnAgenda(role, confirmado),
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
  const ov = f.valem(role, confirmado, gravados);
  const pares = new Set<string>();
  // A ordem de `resolveStaffAccess`: agenda própria, profissional ligado e
  // ativo, depois cada concessão sobre os ajustes que valem.
  const agenda = f.agendaPropria(role, confirmado) && f.vinculoValido(vinculo);
  if (agenda) pares.add('agenda.ver:propria');
  for (const [acao, p] of Object.entries(ACOES)) if (agenda && f.funcionario(role, ov, p)) pares.add(`agenda.${acao}:propria`);
  pares.add(`funcionario.efetivas:${f.funcionarioEfetivas(role, ov).join(',')}`);
  // `resolveTeamManager`: a política sobre os ajustes que valem; o que pode
  // conceder sobre os gravados do próprio vínculo (o dono não tem diferença).
  if (f.gerenciarEquipe(role, ov)) pares.add('equipe.gerenciar:estabelecimento');
  for (const p of f.concede(role, gravados)) pares.add(`equipe.concede:${p}`);
  pares.add(`equipe.efetivas:${f.efetivas(role, confirmado, gravados).join(',')}`);
  for (const k of AREAS_DA_SESSAO) if (f.sessao[k](role, ov)) pares.add(`guarda.sessao:${k}`);
  if (f.sessaoAgendaPropria(role, confirmado, vinculo)) pares.add('guarda.sessao.menu:AGENDA_PROPRIA_VER');
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

/** Troca a regra da permissão de funcionário só para um papel, em todos os
 * que a usam (`staffPermissionGranted`): as ações, a lista e a sessão. */
function funcionarioSo(alvo: EstablishmentRole, regra: Fontes['funcionario']): Fontes {
  const funcionario: Fontes['funcionario'] = (r, ov, p) => (r === alvo ? regra(r, ov, p) : ATUAL.funcionario(r, ov, p));
  return trocar({
    funcionario,
    funcionarioEfetivas: (r, ov) => FUNCIONARIO.filter((p) => funcionario(r, ov, p)),
    sessao: {
      ...ATUAL.sessao,
      AGENDA_PROPRIA_INICIAR: (r, ov) => funcionario(r, ov, AI),
      AGENDA_PROPRIA_CONCLUIR: (r, ov) => funcionario(r, ov, AC),
      AGENDA_PROPRIA_FALTA: (r, ov) => funcionario(r, ov, AF),
    },
  });
}

function concedeSem(alvo: string, negadasIgnoradas: readonly string[]): Fontes {
  return trocar({
    concede: (r, ov) => {
      const atual = ATUAL.concede(r, ov);
      if (!refGerenciarEquipe(r, ov) || atual.includes(alvo)) return atual;
      const resto = BARRA_CONCEDER[alvo].filter((p) => !negadasIgnoradas.includes(p));
      return refNegada(ov, resto) ? atual : [...atual, alvo];
    },
  });
}

const MUTANTES: Record<string, Fontes> = {
  'funcionário sem agenda própria': trocar({ agendaPropria: (r, c) => r !== PROFISSIONAL && ATUAL.agendaPropria(r, c) }),
  'gerente não confirmado com agenda própria': trocar({ agendaPropria: (r, c) => r === GERENTE || ATUAL.agendaPropria(r, c) }),
  'recepcionista com agenda própria': trocar({ agendaPropria: (r, c) => r === RECEPCIONISTA || ATUAL.agendaPropria(r, c) }),
  'dono com agenda própria': trocar({ agendaPropria: (r, c) => r === DONO || ATUAL.agendaPropria(r, c) }),
  'agenda própria com o profissional inativo': trocar({ vinculoValido: (v) => v !== 'sem profissional' }),
  'ação própria sem a concessão': funcionarioSo(PROFISSIONAL, () => true),
  'GRANTED passa a vencer DENIED na ação própria': funcionarioSo(PROFISSIONAL, (_r, ov, p) =>
    ov.some((o) => (o.permission as string) === p && o.mode === 'GRANTED'),
  ),
  'ação própria pela concessão de gerente (AGENDA_GERENCIAR)': funcionarioSo(GERENTE, (_r, ov) => refConcedida(ov, AG)),
  'recepcionista com ação própria': funcionarioSo(RECEPCIONISTA, (_r, ov, p) => refConcedida(ov, p)),
  'a confirmação do gerente deixa de ser aplicada': trocar({ valem: (_r, _c, g) => [...g] }),
  'dono gerencia a equipe com EQUIPE_GERENCIAR negada': trocar({ gerenciarEquipe: (r, ov) => r === DONO || ATUAL.gerenciarEquipe(r, ov) }),
  'gerente com EQUIPE_GERENCIAR concedida gerencia a equipe': trocar({
    gerenciarEquipe: (r, ov) => (r === GERENTE ? refConcedida(ov, EG) : ATUAL.gerenciarEquipe(r, ov)),
  }),
  'dono concede as ações próprias sem o andamento da agenda': concedeSem(AI, [AG]),
  'dono concede as próprias comissões sem ver as comissões': concedeSem(KP, [KV]),
  'dono concede tratar solicitações sem poder cancelar': concedeSem('SOLICITACOES_TRATAR', [CA]),
  'dono concede recebimentos sem ver a agenda': concedeSem('RECEBIMENTOS_REGISTRAR', [AV]),
  'dono concede com EQUIPE_GERENCIAR negada': trocar({
    concede: (r, ov) => (r === DONO && refNegada(ov, [EG]) ? refConcede(r, ov.filter((o) => o.permission !== EG)) : ATUAL.concede(r, ov)),
  }),
  'gerente concede o que tem': trocar({
    concede: (r, ov) => (r === GERENTE ? MANAGER_PERMISSIONS.filter((p) => refConcedida(ov, p)) : ATUAL.concede(r, ov)),
  }),
  'lista do gerente não confirmado mostra os GRANTED gravados': trocar({
    efetivas: (r, c, g) => ATUAL.efetivas(r, r === GERENTE ? true : c, g),
  }),
  'lista da recepcionista com áreas de gerente': trocar({
    efetivas: (r, c, g) => (r === RECEPCIONISTA ? MANAGER_PERMISSIONS.filter((p) => refConcedida(g, p)) : ATUAL.efetivas(r, c, g)),
  }),
  'lista do funcionário com áreas de gerente': trocar({
    efetivas: (r, c, g) =>
      r === PROFISSIONAL ? [...ATUAL.efetivas(r, c, g), ...MANAGER_PERMISSIONS.filter((p) => refConcedida(g, p))] : ATUAL.efetivas(r, c, g),
  }),
  'lista fora da ordem do catálogo': trocar({ efetivas: (r, c, g) => [...ATUAL.efetivas(r, c, g)].reverse() }),
  'menu com a agenda própria sem profissional ligado': trocar({
    sessaoAgendaPropria: (r, c) => ATUAL.agendaPropria(r, c),
  }),
};

// ---- Casos ----------------------------------------------------------------

const PAPEIS = [DONO, GERENTE, RECEPCIONISTA, PROFISSIONAL];
const ESTADOS = ['ausente', 'GRANTED', 'DENIED', 'ambos'] as const;
type Estado = (typeof ESTADOS)[number];

/** Grupos exaustivos: a agenda própria e as ações com as concessões que elas
 * olham e uma de gerente que não pode liberá-las; a gestão da equipe e o que
 * o dono concede com as negadas que mais barram; a lista efetiva com as de
 * vendas (recepcionista e gerente) e uma de funcionário. */
const GRUPOS: Record<string, { permissoes: readonly string[]; vinculos: readonly Vinculo[] }> = {
  'agenda própria e ações': { permissoes: [AI, AC, AF, AG, KP], vinculos: VINCULOS },
  'gerir a equipe e conceder': { permissoes: [EG, AV, AG, CA, KV, PV], vinculos: ['profissional ativo'] },
  'concessões efetivas': { permissoes: [VR, VB, VP, VV, AI], vinculos: ['profissional ativo'] },
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
  // Papel, confirmação e vínculo por dentro: todos aparecem desde o começo.
  for (const estados of combinacoes(permissoes.length)) {
    for (const role of PAPEIS) {
      for (const confirmado of [true, false]) {
        for (const vinculo of vinculos) {
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

const UNIVERSO = [...new Set<string>([...MANAGER_PERMISSIONS, ...FUNCIONARIO, ...Object.values(Permission)])];

function* casosSorteados(quantidade: number): Generator<Caso> {
  const sortear = sorteador(20261127);
  for (let i = 0; i < quantidade; i++) {
    const role = PAPEIS[Math.floor(sortear() * PAPEIS.length)];
    const confirmado = sortear() < 0.5;
    const vinculo = VINCULOS[Math.floor(sortear() * VINCULOS.length)];
    const estados = UNIVERSO.map(() => ESTADOS[Math.floor(sortear() * ESTADOS.length)]);
    yield { role, confirmado, vinculo, gravados: ajustes(estados, UNIVERSO), rotulo: `${role} ${confirmado} ${vinculo} caso ${i}` };
  }
}

/** O dono com cada negada sozinha e com cada par de negadas, de todas as
 * permissões: o que ele pode conceder depende só das negadas. */
function* casosDoDonoComNegadas(): Generator<Caso> {
  for (let i = 0; i < UNIVERSO.length; i++) {
    for (let j = i; j < UNIVERSO.length; j++) {
      const negadas = [...new Set([UNIVERSO[i], UNIVERSO[j]])];
      yield { role: DONO, confirmado: false, vinculo: 'sem profissional', gravados: D(...negadas), rotulo: `DONO negadas ${negadas.join(',')}` };
    }
  }
}

const G = (...ps: string[]) => ps.map((p) => ({ permission: p as Permission, mode: PermissionMode.GRANTED }));
const D = (...ps: string[]) => ps.map((p) => ({ permission: p as Permission, mode: PermissionMode.DENIED }));

describe('Equipe e agenda própria: equivalência com a regra anterior à base comum', () => {
  it('cobre todas as políticas exportadas (política nova exige caso novo)', () => {
    const politicas = Object.entries(equipe)
      .filter(([k, v]) => typeof v === 'function' && /^(can|staff|grantable)/.test(k))
      .map(([k]) => k);
    expect(politicas.sort()).toEqual([...COBERTAS].sort());
  });

  it('a referência cobre todas as concessões de funcionário e de gerente', () => {
    expect([...CONCESSOES].sort()).toEqual([...equipe.STAFF_PERMISSIONS, ...MANAGER_PERMISSIONS].sort());
    expect([...equipe.STAFF_PERMISSIONS]).toEqual([...FUNCIONARIO]);
  });

  for (const nome of Object.keys(GRUPOS)) {
    it(`todas as combinações do grupo "${nome}", nos quatro papéis, confirmado ou não`, () => {
      const casos = [...casosDoGrupo(nome)];
      expect(casos).toHaveLength(4 * 2 * GRUPOS[nome].vinculos.length * 4 ** GRUPOS[nome].permissoes.length);
      expect(diferencas(ATUAL, casos)).toEqual([]);
    });
  }

  it('o dono com cada negada e cada par de negadas, de todas as permissões', () => {
    expect(diferencas(ATUAL, casosDoDonoComNegadas())).toEqual([]);
  });

  it('lote pseudoaleatório com concessões conflitantes e ignoradas (todas as permissões)', () => {
    expect(diferencas(ATUAL, casosSorteados(10_000))).toEqual([]);
  });

  it('cada mutante é apanhado', () => {
    // Os mesmos casos, intercalados entre os grupos: cada mutante aparece
    // cedo, sem percorrer um grupo inteiro que não o alcança.
    const fontes = [...Object.keys(GRUPOS).map((nome) => [...casosDoGrupo(nome)]), [...casosDoDonoComNegadas()]];
    const casos: Caso[] = [];
    for (let i = 0; i < Math.max(...fontes.map((f) => f.length)); i++) for (const f of fontes) if (i < f.length) casos.push(f[i]);
    const referencia = casos.map((caso) => impressao(REFERENCIA, caso));
    const apanhado = (mutante: Fontes) =>
      casos.some((caso, i) => {
        const depois = impressao(mutante, caso);
        return depois.size !== referencia[i].size || [...depois].some((p) => !referencia[i].has(p));
      });
    expect(Object.entries(MUTANTES).filter(([, m]) => !apanhado(m)).map(([nome]) => nome)).toEqual([]);
  });

  it('sem ajustes ou confirmação informados vale o mesmo que lista vazia e não confirmado', () => {
    for (const role of PAPEIS) {
      expect(equipe.canViewOwnAgenda(role), role).toBe(refAgendaPropria(role, false));
      expect(equipe.canManageTeam(role), role).toBe(refGerenciarEquipe(role, []));
    }
  });

  it('recusas e limites nomeados', () => {
    const { canViewOwnAgenda: agenda, staffPermissionGranted: pode, canManageTeam: gerir } = equipe;
    // Agenda própria: pelo papel e pela confirmação, nunca pelos ajustes.
    expect(agenda(PROFISSIONAL)).toBe(true);
    expect(agenda(GERENTE)).toBe(false);
    expect(agenda(GERENTE, true)).toBe(true);
    expect(agenda(DONO, true)).toBe(false);
    expect(agenda(RECEPCIONISTA, true)).toBe(false);
    // Ações próprias: só a concessão própria, DENIED vence, nunca dono nem recepcionista.
    expect(pode(PROFISSIONAL, G(AI), AI)).toBe(true);
    expect(pode(PROFISSIONAL, G(AI), AC)).toBe(false);
    expect(pode(PROFISSIONAL, [...G(AI), ...D(AI)], AI)).toBe(false);
    expect(pode(PROFISSIONAL, G(AG), AI)).toBe(false);
    expect(pode(GERENTE, G(AF), AF)).toBe(true);
    expect(pode(GERENTE, effectiveOverrides(GERENTE, false, G(AF)), AF)).toBe(false);
    expect(pode(DONO, G(AI), AI)).toBe(false);
    expect(pode(RECEPCIONISTA, G(AI), AI)).toBe(false);
    // Equipe: só o dono, e só EQUIPE_GERENCIAR negada barra.
    expect(gerir(DONO)).toBe(true);
    expect(gerir(DONO, D(EG))).toBe(false);
    for (const p of [AV, AG, KV, 'CONFIGURACOES_GERENCIAR', 'EQUIPE_VISUALIZAR']) expect(gerir(DONO, D(p)), p).toBe(true);
    for (const role of [GERENTE, RECEPCIONISTA, PROFISSIONAL]) expect(gerir(role, G(EG)), role).toBe(false);
    // Concessões: nada sem gerir a equipe; o gerente nunca concede.
    expect(equipe.grantableStaffPermissions(DONO, D(EG))).toEqual([]);
    expect(equipe.grantableManagerPermissions(DONO, D(EG))).toEqual([]);
    expect(equipe.grantableManagerPermissions(GERENTE, G(...MANAGER_PERMISSIONS, EG))).toEqual([]);
    // Lista efetiva: recepcionista só as de vendas dela; dono nenhuma.
    expect(grantedTeamPermissions(RECEPCIONISTA, false, G(VR, VV, AI))).toEqual([VR]);
    expect(grantedTeamPermissions(DONO, true, G(VR, AI))).toEqual([]);
    expect(grantedTeamPermissions(GERENTE, false, G(AI, AV))).toEqual([]);
    expect(grantedTeamPermissions(GERENTE, true, G(AV, AI))).toEqual([AI, AV]);
  });
});
