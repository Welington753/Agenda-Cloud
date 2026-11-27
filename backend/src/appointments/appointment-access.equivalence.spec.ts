// Equivalência por ação e alcance entre as políticas da Agenda e da
// disponibilidade e a regra anterior à base comum
// (docs/plans/permissoes-individuais.md, etapa 1).
//
// A REFERÊNCIA é uma cópia congelada das regras de
// `appointments/appointment-access.ts`, `availability/availability-access.ts`,
// do recorte de contato e preço (`recortarParaQuemPediu` e a consulta de
// horários) e da agenda própria (`team/staff-access.ts` e
// `team/my-agenda.service.ts`) como estavam em `be267cc` (iguais a `8f71335`,
// o piloto). Ela usa só listas literais, sem importar `managerCan`,
// `algumaNegada`, `MANAGER_PERMISSION_REQUIRES` nem a base comum. Se alguém
// mudar essas fontes, este teste continua comparando com o comportamento de
// antes.
//
// IMPRESSÃO: para cada vínculo sintético, o conjunto de pares (ação, alcance).
// Alcance "todos" vem das políticas do estabelecimento; "solicitações" é o
// cancelamento ou a confirmação restritos a reservas ainda pendentes (como o
// serviço decide); "próprios" é a agenda do profissional ligado ao vínculo e
// as ações opt-in sobre ela. Assim o limite entre registros próprios e de
// outras pessoas entra na comparação: o profissional enxerga só a própria
// agenda, e nenhuma concessão gravada para ele abre a dos outros.
//
// Casos: os quatro papéis, gerente confirmado ou não (o descarte dos GRANTED
// acontece em `effectiveOverrides`, antes da política, como no serviço), sem
// profissional, com profissional ativo ou inativo, e todas as combinações de
// ausente, GRANTED, DENIED ou os dois em três grupos de permissões, mais um
// lote pseudoaleatório de semente fixa com todas as permissões.
//
// Mutantes: a mesma comparação roda contra versões erradas de propósito, e
// cada uma precisa ser apanhada.
//
// Fora das políticas e intocados por esta etapa: o vínculo, a situação do
// estabelecimento, o acesso comercial e o recurso `AGENDA` seguem em
// `resolveAuthorizedTenant`; o motor de horários e as consultas de
// disponibilidade seguem em `availability.service.ts`; a agenda própria segue
// em `team/staff-access.ts` e `team/my-agenda.service.ts`.
import { describe, expect, it } from 'vitest';
import { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { Permission } from '../entities/enums/permission.enum.js';
import { PermissionMode } from '../entities/enums/permission-mode.enum.js';
import { effectiveOverrides, type PermissionOverrideLike } from '../common/tenant-authorization.js';
import { MANAGER_PERMISSIONS } from '../common/manager-permissions.js';
import { STAFF_PERMISSIONS, canViewOwnAgenda, staffPermissionGranted } from '../team/staff-access.js';
import * as agenda from './appointment-access.js';
import * as disponibilidade from '../availability/availability-access.js';

const AV = 'AGENDA_VISUALIZAR';
const AG = 'AGENDA_GERENCIAR';
const AC = 'AGENDAMENTO_CRIAR';
const AE = 'AGENDAMENTO_EDITAR';
const AX = 'AGENDAMENTO_CANCELAR';
const SV_ = 'SOLICITACOES_VISUALIZAR';
const ST = 'SOLICITACOES_TRATAR';
const CV = 'CONSUMIDORES_VISUALIZAR';
const SV = 'SERVICOS_VISUALIZAR';
const PV = 'PROFISSIONAIS_VISUALIZAR';
const RV = 'RECEBIMENTOS_VISUALIZAR';
const INICIAR = 'ATENDIMENTO_PROPRIO_INICIAR';
const CONCLUIR = 'ATENDIMENTO_PROPRIO_CONCLUIR';
const FALTA = 'ATENDIMENTO_PROPRIO_FALTA';

// ---- Referência congelada (be267cc = 8f71335) -----------------------------

/** Por política do estabelecimento: o que o gerente precisa concedido (já com
 * as dependências; `null`, nunca) e o que barra o dono se negado (`null`,
 * nunca). Recepcionista, funcionário e qualquer outro papel: nunca. */
const REF = {
  ver: { gerente: [AV, PV], dono: [AV] },
  criar: { gerente: [AC, AV, PV, SV, CV], dono: [AV, AC, PV, SV, CV] },
  cancelar: { gerente: [AX, AV, PV], dono: [AV, AX] },
  remarcar: { gerente: [AE, AV, PV, SV], dono: [AV, AE, PV, SV] },
  andamento: { gerente: [AG, AV, PV], dono: [AV, AG] },
  solicitacoesVer: { gerente: [SV_], dono: [AV] },
  solicitacoesTratar: { gerente: [ST, SV_], dono: null },
  avisos: { gerente: null, dono: [AV] },
  disponibilidade: { gerente: [AV, PV, SV], dono: [AV, PV, SV] },
} as const satisfies Record<string, { gerente: readonly string[] | null; dono: readonly string[] | null }>;
type Acao = keyof typeof REF;

/** Recorte da resposta: só o gerente tem; qualquer outro papel vê tudo. */
const REF_RECORTE = {
  agendaContato: [CV],
  agendaPreco: [RV, AV, PV],
  disponibilidadePreco: [RV, AV, PV],
} as const;
type Recorte = keyof typeof REF_RECORTE;

function refConcedida(ov: readonly PermissionOverrideLike[], p: string): boolean {
  return ov.some((o) => o.permission === p && o.mode === 'GRANTED') && !ov.some((o) => o.permission === p && o.mode === 'DENIED');
}

function refPode(role: string, ov: readonly PermissionOverrideLike[], acao: Acao): boolean {
  const { gerente, dono } = REF[acao] as { gerente: readonly string[] | null; dono: readonly string[] | null };
  if (role === 'GERENTE') return gerente !== null && gerente.every((p) => refConcedida(ov, p));
  if (role !== 'DONO' || dono === null) return false;
  return !ov.some((o) => o.mode === 'DENIED' && dono.includes(o.permission));
}

function refVe(role: string, ov: readonly PermissionOverrideLike[], recorte: Recorte): boolean {
  if (role !== 'GERENTE') return true;
  return REF_RECORTE[recorte].every((p) => refConcedida(ov, p));
}

type Profissional = 'sem' | 'ativo' | 'inativo';

/** Agenda própria: funcionário sempre; gerente só confirmado; os dois só com
 * profissional ligado e ativo (conferido em my-agenda.service.ts). */
function refAgendaPropria(role: string, confirmado: boolean, prof: Profissional): boolean {
  return (role === 'PROFISSIONAL' || (role === 'GERENTE' && confirmado)) && prof === 'ativo';
}

function refStaff(role: string, ov: readonly PermissionOverrideLike[], p: string): boolean {
  return (role === 'PROFISSIONAL' || role === 'GERENTE') && refConcedida(ov, p);
}

// ---- Impressão de acesso --------------------------------------------------

type Pol = (role: EstablishmentRole, ov: readonly PermissionOverrideLike[]) => boolean;

/** O que a impressão consulta. A referência e o código atual preenchem o
 * mesmo formato; os mutantes trocam uma peça. */
interface Fontes {
  pode: Record<Acao, Pol>;
  ve: Record<Recorte, Pol>;
  agendaPropria: (role: EstablishmentRole, confirmado: boolean, prof: Profissional) => boolean;
  staff: (role: EstablishmentRole, ov: readonly PermissionOverrideLike[], p: string) => boolean;
}

const ACOES = Object.keys(REF) as Acao[];
const RECORTES = Object.keys(REF_RECORTE) as Recorte[];

const REFERENCIA: Fontes = {
  pode: Object.fromEntries(ACOES.map((a) => [a, (r: string, ov: readonly PermissionOverrideLike[]) => refPode(r, ov, a)])) as Record<Acao, Pol>,
  ve: Object.fromEntries(RECORTES.map((x) => [x, (r: string, ov: readonly PermissionOverrideLike[]) => refVe(r, ov, x)])) as Record<Recorte, Pol>,
  agendaPropria: refAgendaPropria,
  staff: refStaff,
};

/** Cada política `can*` exportada pelos dois arquivos, com a peça que a usa. */
const COBERTAS = {
  agenda: {
    canViewAppointments: 'ver',
    canCreateAppointments: 'criar',
    canCancelAppointments: 'cancelar',
    canRescheduleAppointments: 'remarcar',
    canManageAppointmentStatus: 'andamento',
    canViewBookingRequests: 'solicitacoesVer',
    canHandleBookingRequests: 'solicitacoesTratar',
    canReceiveBookingAlerts: 'avisos',
    canSeeAppointmentContact: 'agendaContato',
    canSeeAppointmentPrices: 'agendaPreco',
  },
  disponibilidade: {
    canViewAvailability: 'disponibilidade',
    canSeeAvailabilityPrices: 'disponibilidadePreco',
  },
} as const;

const ATUAL: Fontes = {
  pode: {
    ver: agenda.canViewAppointments,
    criar: agenda.canCreateAppointments,
    cancelar: agenda.canCancelAppointments,
    remarcar: agenda.canRescheduleAppointments,
    andamento: agenda.canManageAppointmentStatus,
    solicitacoesVer: agenda.canViewBookingRequests,
    solicitacoesTratar: agenda.canHandleBookingRequests,
    avisos: agenda.canReceiveBookingAlerts,
    disponibilidade: disponibilidade.canViewAvailability,
  },
  ve: {
    agendaContato: agenda.canSeeAppointmentContact,
    agendaPreco: agenda.canSeeAppointmentPrices,
    disponibilidadePreco: disponibilidade.canSeeAvailabilityPrices,
  },
  agendaPropria: (role, confirmado, prof) => canViewOwnAgenda(role, confirmado) && prof === 'ativo',
  staff: (role, ov, p) => staffPermissionGranted(role, ov, p as (typeof STAFF_PERMISSIONS)[number]),
};

interface Caso {
  role: EstablishmentRole;
  confirmado: boolean;
  prof: Profissional;
  gravados: PermissionOverrideLike[];
  rotulo: string;
}

/** Pares (ação, alcance). Cancelar e confirmar só pendentes é o que o serviço
 * faz quando a pessoa trata solicitações sem o cancelamento ou o andamento
 * gerais (appointments.service.ts). */
function impressao(f: Fontes, caso: Caso): Set<string> {
  const { role, confirmado, prof } = caso;
  const ov = effectiveOverrides(role, confirmado, caso.gravados);
  const pares = new Set<string>();
  const pode = (a: Acao) => f.pode[a](role, ov);
  if (pode('ver')) pares.add('agenda.ver:todos');
  if (pode('criar')) pares.add('agenda.criar:todos');
  if (pode('remarcar')) pares.add('agenda.remarcar:todos');
  if (pode('cancelar')) pares.add('agenda.cancelar:todos');
  else if (pode('solicitacoesTratar')) pares.add('agenda.cancelar:solicitacoes');
  if (pode('andamento')) {
    for (const a of ['confirmar', 'iniciar', 'concluir', 'falta']) pares.add(`agenda.${a}:todos`);
  } else if (pode('solicitacoesTratar')) pares.add('agenda.confirmar:solicitacoes');
  if (pode('solicitacoesVer')) pares.add('solicitacoes.ver:todos');
  if (pode('solicitacoesTratar')) pares.add('solicitacoes.tratar:todos');
  if (pode('avisos')) pares.add('avisos.receber:todos');
  if (pode('disponibilidade')) pares.add('disponibilidade.consultar:todos');
  for (const x of RECORTES) if (f.ve[x](role, ov)) pares.add(`recorte.${x}:visivel`);
  if (f.agendaPropria(role, confirmado, prof)) {
    pares.add('agenda.ver:proprios');
    for (const [acao, p] of [['iniciar', INICIAR], ['concluir', CONCLUIR], ['falta', FALTA]] as const) {
      if (f.staff(role, ov, p)) pares.add(`agenda.${acao}:proprios`);
    }
  }
  return pares;
}

function comparar(f: Fontes, caso: Caso): string[] {
  const antes = impressao(REFERENCIA, caso);
  const depois = impressao(f, caso);
  return [...new Set([...antes, ...depois])].filter((p) => antes.has(p) !== depois.has(p));
}

function diferencas(f: Fontes, casos: Iterable<Caso>): { total: number; exemplos: string[] } {
  let total = 0;
  const exemplos: string[] = [];
  for (const caso of casos) {
    const dif = comparar(f, caso);
    if (!dif.length) continue;
    total++;
    if (exemplos.length < 5) exemplos.push(`${caso.rotulo}: ${dif.join(', ')}`);
  }
  return { total, exemplos };
}

// ---- Mutantes -------------------------------------------------------------

function trocar(pecas: Partial<Pick<Fontes, 'agendaPropria' | 'staff'>> & { pode?: Partial<Record<Acao, Pol>>; ve?: Partial<Record<Recorte, Pol>> }): Fontes {
  return {
    pode: { ...ATUAL.pode, ...pecas.pode },
    ve: { ...ATUAL.ve, ...pecas.ve },
    agendaPropria: pecas.agendaPropria ?? ATUAL.agendaPropria,
    staff: pecas.staff ?? ATUAL.staff,
  };
}

const negada = (ov: readonly PermissionOverrideLike[], ps: readonly string[]) => ov.some((o) => o.mode === 'DENIED' && ps.includes(o.permission));
const soDono = (role: EstablishmentRole, outro: () => boolean, doDono: () => boolean) => (role === EstablishmentRole.DONO ? doDono() : outro());

const MUTANTES: Record<string, Fontes> = {
  // O erro mais provável da conversão: aplicar ao dono as dependências do gerente.
  'dono passa a exigir PROFISSIONAIS_VISUALIZAR para ver a agenda': trocar({
    pode: { ver: (r, ov) => soDono(r, () => ATUAL.pode.ver(r, ov), () => !negada(ov, [AV, PV])) },
  }),
  'dono passa a exigir PROFISSIONAIS_VISUALIZAR para cancelar': trocar({
    pode: { cancelar: (r, ov) => soDono(r, () => ATUAL.pode.cancelar(r, ov), () => !negada(ov, [AV, AX, PV])) },
  }),
  'dono passa a exigir PROFISSIONAIS_VISUALIZAR para o andamento': trocar({
    pode: { andamento: (r, ov) => soDono(r, () => ATUAL.pode.andamento(r, ov), () => !negada(ov, [AV, AG, PV])) },
  }),
  'dono passa a tratar solicitações pela permissão de gerente': trocar({
    pode: { solicitacoesTratar: (r, ov) => soDono(r, () => ATUAL.pode.solicitacoesTratar(r, ov), () => !negada(ov, [ST, SV_])) },
  }),
  'gerente vê solicitações com a agenda, sem a permissão própria': trocar({
    pode: { solicitacoesVer: (r, ov) => (r === EstablishmentRole.GERENTE ? ATUAL.pode.ver(r, ov) : ATUAL.pode.solicitacoesVer(r, ov)) },
  }),
  'gerente passa a receber avisos': trocar({
    pode: { avisos: (r, ov) => (r === EstablishmentRole.GERENTE ? ATUAL.pode.ver(r, ov) : ATUAL.pode.avisos(r, ov)) },
  }),
  'disponibilidade deixa de exigir SERVICOS_VISUALIZAR do gerente': trocar({
    pode: { disponibilidade: (r, ov) => (r === EstablishmentRole.GERENTE ? ATUAL.pode.ver(r, ov) : ATUAL.pode.disponibilidade(r, ov)) },
  }),
  'recepcionista com GRANTED passa a ver a agenda': trocar({
    pode: { ver: (r, ov) => (r === EstablishmentRole.RECEPCIONISTA ? refConcedida(ov, AV) : ATUAL.pode.ver(r, ov)) },
  }),
  'profissional com GRANTED passa a ver a agenda de todos': trocar({
    pode: { ver: (r, ov) => (r === EstablishmentRole.PROFISSIONAL ? refConcedida(ov, AV) : ATUAL.pode.ver(r, ov)) },
  }),
  'GRANTED passa a vencer DENIED no gerente': trocar({
    pode: {
      criar: (r, ov) =>
        r === EstablishmentRole.GERENTE ? REF.criar.gerente.every((p) => ov.some((o) => o.permission === p && o.mode === 'GRANTED')) : ATUAL.pode.criar(r, ov),
    },
  }),
  'dono passa a ter o preço recortado': trocar({
    ve: { agendaPreco: (r, ov) => (r === EstablishmentRole.DONO ? !negada(ov, [RV]) : ATUAL.ve.agendaPreco(r, ov)) },
  }),
  'contato do gerente passa a sair com a agenda': trocar({
    ve: { agendaContato: (r, ov) => (r === EstablishmentRole.GERENTE ? ATUAL.pode.ver(r, ov) : ATUAL.ve.agendaContato(r, ov)) },
  }),
  'gerente não confirmado ganha a agenda própria': trocar({
    agendaPropria: (r, _c, prof) => (r === EstablishmentRole.GERENTE || r === EstablishmentRole.PROFISSIONAL) && prof === 'ativo',
  }),
  'profissional inativo mantém a agenda própria': trocar({
    agendaPropria: (r, c, prof) => canViewOwnAgenda(r, c) && prof !== 'sem',
  }),
  'ação própria passa a valer sem GRANTED': trocar({
    staff: (r, ov, p) => (r === EstablishmentRole.PROFISSIONAL || r === EstablishmentRole.GERENTE) && !negada(ov, [p]),
  }),
};

// ---- Casos ----------------------------------------------------------------

const PAPEIS = [EstablishmentRole.DONO, EstablishmentRole.GERENTE, EstablishmentRole.RECEPCIONISTA, EstablishmentRole.PROFISSIONAL];
const PROFISSIONAIS: readonly Profissional[] = ['sem', 'ativo', 'inativo'];
const ESTADOS = ['ausente', 'GRANTED', 'DENIED', 'ambos'] as const;
type Estado = (typeof ESTADOS)[number];

/** Três grupos exaustivos: onde a lista do dono difere das dependências do
 * gerente; reserva e consulta de horários; recorte e agenda própria (este
 * também com os três estados do profissional ligado). */
const GRUPOS: Record<string, { permissoes: readonly string[]; profissionais: readonly Profissional[] }> = {
  'andamento, cancelamento e solicitações': { permissoes: [AV, PV, AG, AX, SV_, ST], profissionais: ['ativo'] },
  'reserva, remarcação e horários': { permissoes: [AV, PV, AC, AE, SV, CV], profissionais: ['ativo'] },
  'recorte e agenda própria': { permissoes: [AV, CV, RV, INICIAR, FALTA], profissionais: PROFISSIONAIS },
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

function* casosDoGrupo(nome: string): Generator<Caso> {
  const { permissoes, profissionais } = GRUPOS[nome];
  for (const role of PAPEIS) {
    for (const confirmado of [true, false]) {
      for (const prof of profissionais) {
        for (const estados of combinacoes(permissoes.length)) {
          yield { role, confirmado, prof, gravados: ajustes(estados, permissoes), rotulo: `${role} ${confirmado} ${prof} ${estados.join(',')}` };
        }
      }
    }
  }
}

function* casosSorteados(quantidade: number): Generator<Caso> {
  const sortear = sorteador(20261127);
  const universo = [...new Set<string>([...MANAGER_PERMISSIONS, ...STAFF_PERMISSIONS, ...Object.values(Permission)])];
  for (let i = 0; i < quantidade; i++) {
    const role = PAPEIS[Math.floor(sortear() * PAPEIS.length)];
    const confirmado = sortear() < 0.5;
    const prof = PROFISSIONAIS[Math.floor(sortear() * PROFISSIONAIS.length)];
    const estados = universo.map(() => ESTADOS[Math.floor(sortear() * ESTADOS.length)]);
    yield { role, confirmado, prof, gravados: ajustes(estados, universo), rotulo: `${role} ${confirmado} ${prof} caso ${i}` };
  }
}

describe('Agenda e disponibilidade: equivalência com a regra anterior à base comum', () => {
  it('cobre todas as políticas can* exportadas (política nova exige caso novo)', () => {
    expect(Object.keys(agenda).filter((k) => k.startsWith('can')).sort()).toEqual(Object.keys(COBERTAS.agenda).sort());
    expect(Object.keys(disponibilidade).filter((k) => k.startsWith('can')).sort()).toEqual(Object.keys(COBERTAS.disponibilidade).sort());
    const pecas = [...Object.values(COBERTAS.agenda), ...Object.values(COBERTAS.disponibilidade)].sort();
    expect(pecas).toEqual([...ACOES, ...RECORTES].sort());
  });

  for (const nome of Object.keys(GRUPOS)) {
    it(`todas as combinações do grupo "${nome}", nos quatro papéis, confirmado ou não`, () => {
      const { permissoes, profissionais } = GRUPOS[nome];
      const casos = [...casosDoGrupo(nome)];
      expect(casos).toHaveLength(4 * 2 * profissionais.length * 4 ** permissoes.length);
      expect(diferencas(ATUAL, casos).exemplos).toEqual([]);
    });
  }

  it('lote pseudoaleatório com concessões conflitantes e ignoradas (todas as permissões)', () => {
    expect(diferencas(ATUAL, casosSorteados(10_000)).exemplos).toEqual([]);
  });

  it('a impressão separa registros próprios dos de outras pessoas', () => {
    // Funcionário com tudo gravado: só a própria agenda, nunca a de todos.
    const tudo = ajustes(
      [...MANAGER_PERMISSIONS, ...STAFF_PERMISSIONS].map(() => 'GRANTED' as const),
      [...MANAGER_PERMISSIONS, ...STAFF_PERMISSIONS],
    );
    const funcionario = impressao(ATUAL, { role: EstablishmentRole.PROFISSIONAL, confirmado: false, prof: 'ativo', gravados: tudo, rotulo: '' });
    expect([...funcionario].filter((p) => p.startsWith('agenda.')).sort()).toEqual([
      'agenda.concluir:proprios',
      'agenda.falta:proprios',
      'agenda.iniciar:proprios',
      'agenda.ver:proprios',
    ]);
    // Gerente confirmado com a agenda: os dois alcances; não confirmado: nenhum.
    const gerente = (confirmado: boolean) =>
      impressao(ATUAL, { role: EstablishmentRole.GERENTE, confirmado, prof: 'ativo', gravados: tudo, rotulo: '' });
    expect(gerente(true).has('agenda.ver:todos') && gerente(true).has('agenda.ver:proprios')).toBe(true);
    expect([...gerente(false)].filter((p) => p.startsWith('agenda.'))).toEqual([]);
    // Gerente só com solicitações: cancela e confirma apenas pendentes.
    const sol = ajustes(['GRANTED', 'GRANTED'], [SV_, ST]);
    const soSolicitacoes = impressao(ATUAL, { role: EstablishmentRole.GERENTE, confirmado: true, prof: 'sem', gravados: sol, rotulo: '' });
    expect([...soSolicitacoes].filter((p) => p.startsWith('agenda.')).sort()).toEqual(['agenda.cancelar:solicitacoes', 'agenda.confirmar:solicitacoes']);
  });

  it('sem ajustes informados vale o mesmo que lista vazia', () => {
    for (const role of PAPEIS) {
      for (const a of ACOES) expect(ATUAL.pode[a](role, []), `${role} ${a}`).toBe(refPode(role, [], a));
      for (const x of RECORTES) expect(ATUAL.ve[x](role, []), `${role} ${x}`).toBe(refVe(role, [], x));
      expect(agenda.canViewAppointments(role), role).toBe(refPode(role, [], 'ver'));
      expect(agenda.canHandleBookingRequests(role), role).toBe(refPode(role, [], 'solicitacoesTratar'));
      expect(agenda.canReceiveBookingAlerts(role), role).toBe(refPode(role, [], 'avisos'));
      expect(disponibilidade.canViewAvailability(role), role).toBe(refPode(role, [], 'disponibilidade'));
      expect(agenda.canSeeAppointmentPrices(role), role).toBe(refVe(role, [], 'agendaPreco'));
      expect(disponibilidade.canSeeAvailabilityPrices(role), role).toBe(refVe(role, [], 'disponibilidadePreco'));
    }
  });

  it('cada mutante é apanhado pelos casos exaustivos', () => {
    // Basta a primeira diferença de cada mutante. Os casos são intercalados
    // por grupo, papel, confirmação e profissional (os mesmos casos, noutra
    // ordem), e a impressão de referência é calculada uma vez, só quando
    // algum mutante chega ao caso.
    const filas = new Map<string, Caso[]>();
    for (const nome of Object.keys(GRUPOS)) {
      for (const caso of casosDoGrupo(nome)) {
        const chave = `${nome} ${caso.role} ${caso.confirmado} ${caso.prof}`;
        if (!filas.has(chave)) filas.set(chave, []);
        filas.get(chave)!.push(caso);
      }
    }
    const casos: Caso[] = [];
    const listas = [...filas.values()];
    for (let i = 0; i < Math.max(...listas.map((l) => l.length)); i++) for (const l of listas) if (i < l.length) casos.push(l[i]);
    const total = Object.values(GRUPOS).reduce((s, g) => s + 4 * 2 * g.profissionais.length * 4 ** g.permissoes.length, 0);
    expect(casos).toHaveLength(total);
    const referencia: Set<string>[] = [];
    const apanhado = (mutante: Fontes) =>
      casos.some((caso, i) => {
        const antes = (referencia[i] ??= impressao(REFERENCIA, caso));
        const depois = impressao(mutante, caso);
        return depois.size !== antes.size || [...depois].some((p) => !antes.has(p));
      });
    const escapam = Object.entries(MUTANTES)
      .filter(([, mutante]) => !apanhado(mutante))
      .map(([nome]) => nome);
    expect(escapam).toEqual([]);
  });

  it('o gerente não confirmado é apanhado se a confirmação deixar de ser aplicada', () => {
    // Mesmas políticas, mas lendo os ajustes gravados sem `effectiveOverrides`.
    let apanhados = 0;
    for (const caso of casosDoGrupo('andamento, cancelamento e solicitações')) {
      const valem = effectiveOverrides(caso.role, caso.confirmado, caso.gravados);
      for (const a of ACOES) if (refPode(caso.role, valem, a) !== ATUAL.pode[a](caso.role, caso.gravados)) apanhados++;
    }
    expect(apanhados).toBeGreaterThan(0);
  });

  it('casos nomeados e mensagens continuam iguais', () => {
    const G = (...ps: string[]) => ps.map((p) => ({ permission: p as Permission, mode: PermissionMode.GRANTED }));
    const D = (...ps: string[]) => ps.map((p) => ({ permission: p as Permission, mode: PermissionMode.DENIED }));
    const { DONO, GERENTE, RECEPCIONISTA, PROFISSIONAL } = EstablishmentRole;
    // Dono: DENIED só em PROFISSIONAIS_VISUALIZAR mantém ver, cancelar e o
    // andamento; tira criar, remarcar e a consulta de horários.
    expect(agenda.canViewAppointments(DONO, D(PV))).toBe(true);
    expect(agenda.canCancelAppointments(DONO, D(PV))).toBe(true);
    expect(agenda.canManageAppointmentStatus(DONO, D(PV))).toBe(true);
    expect(agenda.canCreateAppointments(DONO, D(PV))).toBe(false);
    expect(agenda.canRescheduleAppointments(DONO, D(PV))).toBe(false);
    expect(disponibilidade.canViewAvailability(DONO, D(PV))).toBe(false);
    // Dono trata solicitações pelas políticas gerais, nunca pela de gerente.
    expect(agenda.canHandleBookingRequests(DONO)).toBe(false);
    // Gerente: a agenda exige PROFISSIONAIS_VISUALIZAR concedida.
    expect(agenda.canViewAppointments(GERENTE, G(AV))).toBe(false);
    expect(agenda.canViewAppointments(GERENTE, G(AV, PV))).toBe(true);
    expect(agenda.canViewAppointments(GERENTE, effectiveOverrides(GERENTE, false, G(AV, PV)))).toBe(false);
    expect(agenda.canViewAppointments(GERENTE, [...G(AV, PV), ...D(AV)])).toBe(false);
    expect(agenda.canReceiveBookingAlerts(GERENTE, G(AV, PV))).toBe(false);
    // Recorte do gerente; o dono vê tudo mesmo com DENIED nos recebimentos.
    expect(agenda.canSeeAppointmentPrices(GERENTE, G(AV, PV))).toBe(false);
    expect(agenda.canSeeAppointmentPrices(GERENTE, G(RV, AV, PV))).toBe(true);
    expect(agenda.canSeeAppointmentPrices(DONO, D(RV))).toBe(true);
    expect(disponibilidade.canSeeAvailabilityPrices(DONO, D(RV))).toBe(true);
    // Recepcionista e funcionário, nunca, mesmo com tudo gravado.
    for (const role of [RECEPCIONISTA, PROFISSIONAL]) {
      expect(agenda.canViewAppointments(role, G(...MANAGER_PERMISSIONS)), role).toBe(false);
      expect(disponibilidade.canViewAvailability(role, G(...MANAGER_PERMISSIONS)), role).toBe(false);
    }
    expect(agenda.APPOINTMENTS_FORBIDDEN_MESSAGE).toBe('Você não tem permissão para acessar a agenda deste estabelecimento.');
    expect(agenda.APPOINTMENT_CREATE_FORBIDDEN_MESSAGE).toBe('Você não tem permissão para criar agendamentos neste estabelecimento.');
    expect(agenda.APPOINTMENT_CANCEL_FORBIDDEN_MESSAGE).toBe('Você não tem permissão para cancelar agendamentos neste estabelecimento.');
    expect(agenda.APPOINTMENT_STATUS_FORBIDDEN_MESSAGE).toBe(
      'Você não tem permissão para alterar o andamento dos atendimentos neste estabelecimento.',
    );
    expect(agenda.APPOINTMENT_RESCHEDULE_FORBIDDEN_MESSAGE).toBe('Você não tem permissão para remarcar agendamentos neste estabelecimento.');
    expect(disponibilidade.AVAILABILITY_FORBIDDEN_MESSAGE).toBe('Você não tem permissão para consultar a agenda deste estabelecimento.');
  });
});
