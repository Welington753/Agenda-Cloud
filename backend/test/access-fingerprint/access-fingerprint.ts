// Impressão de acesso geral (docs/plans/permissoes-individuais.md, seção 5.4
// e etapa 1): o conjunto de pares (ação, alcance), campos visíveis, áreas da
// sessão e concessões de um vínculo, calculado por duas implementações:
//
// - ANTES: cópia congelada das políticas do piloto (`8f71335`, anterior à
//   refatoração), em `legacy/`. Os arquivos `*-access.ts`,
//   `manager-permissions.ts` e `session-areas.ts` são cópias byte a byte,
//   conferidas por hash (`legacy-manifest.ts`); os trechos que ficavam dentro
//   de serviços estão em `legacy/servicos-recortes.ts`.
// - DEPOIS: o código atual de `src/`.
//
// A comparação é de cada superfície antes e depois. Menu e API não precisam
// coincidir entre si: as diferenças antigas entre eles (registradas no plano)
// aparecem igualmente nos dois lados.
//
// Entrada de cada rota, como no código real:
// - `valem`: ajustes depois de `effectiveOverrides` (gerente não confirmado
//   sem nenhum `GRANTED`), o que `resolveAuthorizedTenant` entrega;
// - `gravados`: os ajustes sem a confirmação. Só a rota de serviços lê assim
//   (services.service.ts, pendência registrada no plano, preservada aqui);
// - `negadas`: só os `DENIED`, como o despachante dos avisos de solicitação.
//
// Fora da impressão, porque não mudaram na refatoração e são conferidos pelos
// testes com banco: a prova do vínculo (404 sem vínculo, 403 suspenso), a
// situação do estabelecimento, o gate comercial de cada rota e o SQL.
import type { EntityManager } from 'typeorm';
import { EstablishmentRole } from '../../src/entities/enums/establishment-role.enum.js';
import { FeatureKey } from '../../src/entities/enums/feature-key.enum.js';
import { Permission } from '../../src/entities/enums/permission.enum.js';
import { ENABLED_FEATURES_SQL } from '../../src/commercial/feature-areas.js';
import type { AppointmentView } from '../../src/appointments/appointments.service.js';
import type { AtendimentoResumido, ItemDoHistorico } from '../../src/consumers/consumer-profile.service.js';

// DEPOIS: código atual.
import * as dTenantAreas from '../../src/accounts/tenant-effective-access.js';
import * as dAgenda from '../../src/appointments/appointment-access.js';
import * as dDisponibilidade from '../../src/availability/availability-access.js';
import * as dComissoes from '../../src/commissions/commission-access.js';
import * as dGerente from '../../src/common/manager-permissions.js';
import * as dClientes from '../../src/consumers/consumer-access.js';
import * as dRecebimentos from '../../src/payments/payment-access.js';
import * as dProfissionais from '../../src/professionals/professional-access.js';
import * as dAgendamentoOnline from '../../src/public-booking/public-booking-access.js';
import * as dVendas from '../../src/sales/sales-access.js';
import * as dServicos from '../../src/services/service-access.js';
import * as dEstoque from '../../src/stock/stock-access.js';
import * as dEquipe from '../../src/team/staff-access.js';
import { effectiveOverrides as dEffectiveOverrides } from '../../src/common/tenant-authorization.js';
import { sessionAreas as dSessionAreas } from '../../src/auth/session-areas.js';
import { recortarParaQuemPediu as dRecorte } from '../../src/appointments/appointments.service.js';
import { precosParaQuemPediu as dPrecos } from '../../src/availability/availability.service.js';
import {
  itemDoHistoricoParaQuemPediu as dItemHistorico,
  oQueOHistoricoMostra as dHistorico,
} from '../../src/consumers/consumer-profile.service.js';
import { grantedTeamPermissions as dEfetivasEquipe } from '../../src/team/team.service.js';

// ANTES: cópia congelada de 8f71335.
import * as aTenantAreas from './legacy/accounts/tenant-effective-access.js';
import * as aAgenda from './legacy/appointments/appointment-access.js';
import * as aDisponibilidade from './legacy/availability/availability-access.js';
import * as aComissoes from './legacy/commissions/commission-access.js';
import * as aGerente from './legacy/common/manager-permissions.js';
import * as aClientes from './legacy/consumers/consumer-access.js';
import * as aRecebimentos from './legacy/payments/payment-access.js';
import * as aProfissionais from './legacy/professionals/professional-access.js';
import * as aAgendamentoOnline from './legacy/public-booking/public-booking-access.js';
import * as aVendas from './legacy/sales/sales-access.js';
import * as aServicos from './legacy/services/service-access.js';
import * as aEstoque from './legacy/stock/stock-access.js';
import * as aEquipe from './legacy/team/staff-access.js';
import { effectiveOverrides as aEffectiveOverrides } from './legacy/common/tenant-authorization.js';
import { sessionAreas as aSessionAreas } from './legacy/auth/session-areas.js';
import * as aServicosRecortes from './legacy/servicos-recortes.js';

export interface Ajuste {
  permission: string;
  mode: 'GRANTED' | 'DENIED';
}

export type SituacaoDoProfissional = 'sem' | 'ativo' | 'inativo';

export interface Cenario {
  role: EstablishmentRole;
  confirmado: boolean;
  profissional: SituacaoDoProfissional;
  gravados: readonly Ajuste[];
  recursos: ReadonlySet<string>;
  /** Há venda registrada no estabelecimento (manutenção das vendas no menu). */
  haVendas: boolean;
  rotulo: string;
}

type Modulo = Record<string, unknown>;
type Politica = (role: EstablishmentRole, overrides: readonly Ajuste[], extra?: unknown) => boolean;

/** Arquivos de política comparados, pelo caminho em `src/`. */
export const MODULOS_COMPARADOS = [
  'accounts/tenant-effective-access.ts',
  'appointments/appointment-access.ts',
  'availability/availability-access.ts',
  'commissions/commission-access.ts',
  'common/manager-permissions.ts',
  'consumers/consumer-access.ts',
  'payments/payment-access.ts',
  'professionals/professional-access.ts',
  'public-booking/public-booking-access.ts',
  'sales/sales-access.ts',
  'services/service-access.ts',
  'stock/stock-access.ts',
  'team/staff-access.ts',
] as const;
export type ModuloComparado = (typeof MODULOS_COMPARADOS)[number];

export type DecisaoDaAgendaPropria = aServicosRecortes.DecisaoDaAgendaPropria;
type LinhaDaAgendaPropria = Parameters<typeof aServicosRecortes.decisaoDaAgendaPropria>[0];
type Quem = { role: EstablishmentRole; overrides?: readonly Ajuste[] };
type Concessiveis = { grantable: string[]; grantableManager: string[]; managerWithoutFeature: string[] };

export interface Implementacao {
  nome: string;
  modulos: Readonly<Record<ModuloComparado, Modulo>>;
  effectiveOverrides: (role: string, confirmado: boolean, ov: readonly Ajuste[]) => Ajuste[];
  recorteDaAgenda: (view: AppointmentView, quem: Quem) => AppointmentView;
  precosDaConsulta: (servicos: readonly aServicosRecortes.ServicoDaConsulta[], quem: Quem) => unknown;
  historico: (quem: Quem, recursoDePagamentos: boolean) => { veDinheiro: boolean; veRecebimentos: boolean };
  itemDoHistorico: (
    item: AtendimentoResumido & { precos?: (number | null)[] },
    recebimento: NonNullable<ItemDoHistorico['payment']> | undefined,
    ve: { veDinheiro: boolean; veRecebimentos: boolean },
  ) => ItemDoHistorico;
  efetivasDaEquipe: (role: string, confirmado: boolean, gravados: readonly Ajuste[]) => string[];
  agendaPropria: (linha: LinhaDaAgendaPropria) => DecisaoDaAgendaPropria;
  concessiveis: (role: EstablishmentRole, ov: readonly Ajuste[], ligado: (recurso: string) => boolean) => Concessiveis;
  sessionAreas: (
    manager: EntityManager,
    membership: { id: string; tenantId: string; role: EstablishmentRole; professionalId?: string | null },
  ) => Promise<string[]>;
  /** Funções de política consultadas por nome (`modulo#nome`), para o inventário. */
  usadas: Set<string>;
}

function fn<T>(impl: Implementacao, modulo: ModuloComparado, nome: string): T {
  const valor = impl.modulos[modulo][nome];
  if (typeof valor !== 'function') throw new Error(`${impl.nome}: ${modulo} não exporta a função ${nome}`);
  impl.usadas.add(`${modulo}#${nome}`);
  return valor as T;
}

/** O que é concedível com os recursos ligados (team/team-authorization.ts,
 * sem mudança desde 8f71335), pelas políticas de cada implementação. */
function concessiveisPor(impl: Implementacao) {
  return (role: EstablishmentRole, ov: readonly Ajuste[], ligado: (recurso: string) => boolean): Concessiveis => {
    const equipe = 'team/staff-access.ts';
    const propriasComissoes = impl.modulos[equipe].OWN_COMMISSIONS_PERMISSION as string;
    const porRecurso = impl.modulos['common/manager-permissions.ts'].MANAGER_PERMISSION_FEATURE as Record<string, string>;
    const semRecurso = Object.entries(porRecurso)
      .filter(([, recurso]) => !ligado(recurso))
      .map(([permissao]) => permissao);
    const comissoes = ligado(FeatureKey.COMISSOES);
    const staff = fn<(r: EstablishmentRole, o: readonly Ajuste[]) => string[]>(impl, equipe, 'grantableStaffPermissions');
    const gerente = fn<(r: EstablishmentRole, o: readonly Ajuste[]) => string[]>(impl, equipe, 'grantableManagerPermissions');
    return {
      grantable: staff(role, ov).filter((p) => p !== propriasComissoes || comissoes),
      grantableManager: gerente(role, ov).filter((p) => !semRecurso.includes(p)),
      managerWithoutFeature: semRecurso,
    };
  };
}

export function implementacaoAntes(): Implementacao {
  const impl: Implementacao = {
    nome: 'antes (8f71335)',
    modulos: {
      'accounts/tenant-effective-access.ts': aTenantAreas,
      'appointments/appointment-access.ts': aAgenda,
      'availability/availability-access.ts': aDisponibilidade,
      'commissions/commission-access.ts': aComissoes,
      'common/manager-permissions.ts': aGerente,
      'consumers/consumer-access.ts': aClientes,
      'payments/payment-access.ts': aRecebimentos,
      'professionals/professional-access.ts': aProfissionais,
      'public-booking/public-booking-access.ts': aAgendamentoOnline,
      'sales/sales-access.ts': aVendas,
      'services/service-access.ts': aServicos,
      'stock/stock-access.ts': aEstoque,
      'team/staff-access.ts': aEquipe,
    },
    effectiveOverrides: (role, confirmado, ov) => aEffectiveOverrides(role, confirmado, ov),
    recorteDaAgenda: (view, quem) => aServicosRecortes.recortarParaQuemPediu(view, quem as never),
    precosDaConsulta: (servicos, quem) => aServicosRecortes.precosParaQuemPediu(servicos, quem as never),
    historico: (quem, recurso) => aServicosRecortes.oQueOHistoricoMostra(quem as never, recurso),
    itemDoHistorico: (item, recebimento, ve) => aServicosRecortes.itemDoHistoricoParaQuemPediu(item, recebimento, ve),
    efetivasDaEquipe: (role, confirmado, gravados) => aServicosRecortes.grantedTeamPermissions(role, confirmado, gravados),
    agendaPropria: (linha) => aServicosRecortes.decisaoDaAgendaPropria(linha),
    concessiveis: () => {
      throw new Error('definido abaixo');
    },
    sessionAreas: (manager, membership) => aSessionAreas(manager, membership),
    usadas: new Set(),
  };
  impl.concessiveis = concessiveisPor(impl);
  return impl;
}

export function implementacaoDepois(): Implementacao {
  const impl: Implementacao = {
    nome: 'depois (atual)',
    modulos: {
      'accounts/tenant-effective-access.ts': dTenantAreas,
      'appointments/appointment-access.ts': dAgenda,
      'availability/availability-access.ts': dDisponibilidade,
      'commissions/commission-access.ts': dComissoes,
      'common/manager-permissions.ts': dGerente,
      'consumers/consumer-access.ts': dClientes,
      'payments/payment-access.ts': dRecebimentos,
      'professionals/professional-access.ts': dProfissionais,
      'public-booking/public-booking-access.ts': dAgendamentoOnline,
      'sales/sales-access.ts': dVendas,
      'services/service-access.ts': dServicos,
      'stock/stock-access.ts': dEstoque,
      'team/staff-access.ts': dEquipe,
    },
    effectiveOverrides: (role, confirmado, ov) => dEffectiveOverrides(role, confirmado, ov),
    recorteDaAgenda: (view, quem) => dRecorte(view, quem as never),
    precosDaConsulta: (servicos, quem) => dPrecos(servicos as never, quem as never),
    historico: (quem, recurso) => dHistorico(quem as never, recurso),
    itemDoHistorico: (item, recebimento, ve) => dItemHistorico(item, recebimento, ve),
    efetivasDaEquipe: (role, confirmado, gravados) => dEfetivasEquipe(role, confirmado, gravados),
    agendaPropria: () => {
      throw new Error('definido abaixo');
    },
    concessiveis: () => {
      throw new Error('definido abaixo');
    },
    sessionAreas: (manager, membership) => dSessionAreas(manager, membership),
    usadas: new Set(),
  };
  // team/my-agenda.service.ts (`resolveStaffAccess`), a mesma ordem de
  // recusas, com as políticas atuais. O serviço inteiro, com o banco, é
  // conferido por team-access-postgres e team-manager-postgres.
  impl.agendaPropria = (linha) => {
    const equipe = 'team/staff-access.ts';
    const agenda = fn<(r: EstablishmentRole, c: boolean) => boolean>(impl, equipe, 'canViewOwnAgenda');
    const concedida = fn<(r: EstablishmentRole, o: readonly Ajuste[], p: string) => boolean>(
      impl,
      equipe,
      'staffPermissionGranted',
    );
    const comissoes = fn<Politica>(impl, 'commissions/commission-access.ts', 'canViewOwnCommissions');
    if (!agenda(linha.role, linha.permissions_confirmed)) return { recusa: 'AGENDA_PROPRIA' };
    if (!linha.professional_id || !linha.professional_active) return { recusa: 'PROFISSIONAL_INATIVO' };
    const valem = impl.effectiveOverrides(linha.role, linha.permissions_confirmed, linha.overrides as Ajuste[]);
    const acoes = impl.modulos[equipe].STAFF_ACTIONS as readonly string[];
    const deAcao = impl.modulos[equipe].STAFF_PERMISSION_OF_ACTION as Record<string, string>;
    const allowed = Object.fromEntries(acoes.map((a) => [a, concedida(linha.role, valem, deAcao[a])]));
    return { recusa: null, allowed: allowed as never, ownCommissions: comissoes(linha.role, valem) };
  };
  impl.concessiveis = concessiveisPor(impl);
  return impl;
}

/** Ações por rota: chave (área.ação:alcance), módulo, função, entrada. */
export const ACOES: readonly {
  chave: string;
  modulo: ModuloComparado;
  nome: string;
  entrada: 'valem' | 'gravados' | 'negadas';
  extra?: unknown;
}[] = [
  { chave: 'agenda.ver:todos', modulo: 'appointments/appointment-access.ts', nome: 'canViewAppointments', entrada: 'valem' },
  { chave: 'agenda.criar:todos', modulo: 'appointments/appointment-access.ts', nome: 'canCreateAppointments', entrada: 'valem' },
  { chave: 'agenda.cancelar:todos', modulo: 'appointments/appointment-access.ts', nome: 'canCancelAppointments', entrada: 'valem' },
  { chave: 'agenda.remarcar:todos', modulo: 'appointments/appointment-access.ts', nome: 'canRescheduleAppointments', entrada: 'valem' },
  { chave: 'agenda.andamento:todos', modulo: 'appointments/appointment-access.ts', nome: 'canManageAppointmentStatus', entrada: 'valem' },
  { chave: 'solicitacoes.ver:pendentes', modulo: 'appointments/appointment-access.ts', nome: 'canViewBookingRequests', entrada: 'valem' },
  { chave: 'solicitacoes.tratar:pendentes', modulo: 'appointments/appointment-access.ts', nome: 'canHandleBookingRequests', entrada: 'valem' },
  { chave: 'solicitacoes.inscrever-avisos:pendentes', modulo: 'appointments/appointment-access.ts', nome: 'canReceiveBookingAlerts', entrada: 'valem' },
  { chave: 'solicitacoes.receber-aviso:pendentes', modulo: 'appointments/appointment-access.ts', nome: 'canReceiveBookingAlerts', entrada: 'negadas' },
  { chave: 'disponibilidade.ver:todos', modulo: 'availability/availability-access.ts', nome: 'canViewAvailability', entrada: 'valem' },
  { chave: 'recebimentos.ver:todos', modulo: 'payments/payment-access.ts', nome: 'canViewPayments', entrada: 'valem' },
  { chave: 'recebimentos.registrar:todos', modulo: 'payments/payment-access.ts', nome: 'canRecordPayments', entrada: 'valem' },
  { chave: 'recebimentos.estornar:todos', modulo: 'payments/payment-access.ts', nome: 'canRefundPayments', entrada: 'valem' },
  { chave: 'recebimentos.gerir:todos', modulo: 'payments/payment-access.ts', nome: 'canManagePayments', entrada: 'valem' },
  { chave: 'comissoes.ver:todos', modulo: 'commissions/commission-access.ts', nome: 'canViewCommissions', entrada: 'valem' },
  { chave: 'comissoes.configurar:estabelecimento', modulo: 'commissions/commission-access.ts', nome: 'canManageCommissionRules', entrada: 'valem' },
  { chave: 'clientes.ver:todos', modulo: 'consumers/consumer-access.ts', nome: 'canViewConsumers', entrada: 'valem' },
  { chave: 'clientes.gerenciar:todos', modulo: 'consumers/consumer-access.ts', nome: 'canManageConsumers', entrada: 'valem' },
  { chave: 'clientes.unificar:todos', modulo: 'consumers/consumer-access.ts', nome: 'canMergeConsumers', entrada: 'valem' },
  { chave: 'servicos.ver:todos', modulo: 'services/service-access.ts', nome: 'canViewServices', entrada: 'gravados' },
  { chave: 'servicos.gerenciar:todos', modulo: 'services/service-access.ts', nome: 'canManageServices', entrada: 'gravados' },
  { chave: 'profissionais.ver:todos', modulo: 'professionals/professional-access.ts', nome: 'canViewProfessionals', entrada: 'valem' },
  { chave: 'profissionais.gerenciar:todos', modulo: 'professionals/professional-access.ts', nome: 'canManageProfessionals', entrada: 'valem' },
  { chave: 'agendamento-online.configurar:estabelecimento', modulo: 'public-booking/public-booking-access.ts', nome: 'canManagePublicBooking', entrada: 'valem' },
  { chave: 'estoque.ver:todos', modulo: 'stock/stock-access.ts', nome: 'canViewStock', entrada: 'valem' },
  { chave: 'estoque.gerenciar:todos', modulo: 'stock/stock-access.ts', nome: 'canManageStock', entrada: 'valem' },
  { chave: 'vendas.registrar:proprias', modulo: 'sales/sales-access.ts', nome: 'canRegisterSales', entrada: 'valem' },
  { chave: 'vendas.alterar-preco:nova', modulo: 'sales/sales-access.ts', nome: 'canOverrideSalePrice', entrada: 'valem' },
  { chave: 'vendas.consultar:proprias', modulo: 'sales/sales-access.ts', nome: 'canAccessSalesHistory', entrada: 'valem' },
  { chave: 'vendas.consultar:todas', modulo: 'sales/sales-access.ts', nome: 'canViewAllSales', entrada: 'valem' },
  { chave: 'vendas.receber:alguma', modulo: 'sales/sales-access.ts', nome: 'canReceiveSales', entrada: 'valem' },
  { chave: 'vendas.receber:propria', modulo: 'sales/sales-access.ts', nome: 'canReceiveSale', entrada: 'valem', extra: { ownSale: true } },
  { chave: 'vendas.receber:de-outra-pessoa', modulo: 'sales/sales-access.ts', nome: 'canReceiveSale', entrada: 'valem', extra: { ownSale: false } },
  { chave: 'vendas.cancelar:todas', modulo: 'sales/sales-access.ts', nome: 'canCancelSales', entrada: 'valem' },
  { chave: 'vendas.estornar:todas', modulo: 'sales/sales-access.ts', nome: 'canRefundSalePayments', entrada: 'valem' },
  { chave: 'equipe.gerenciar:estabelecimento', modulo: 'team/staff-access.ts', nome: 'canManageTeam', entrada: 'valem' },
];

const PROFISSIONAL_ID = 'prof-1';
const MEMBERSHIP_ID = 'vinculo-1';
const TENANT_ID = 'estabelecimento-1';

/** Gerenciador simulado: responde só às leituras conhecidas da sessão.
 * Consulta nova falha, para não passar sem ser vista. */
export function gerenciadorSimulado(c: Cenario): EntityManager {
  return {
    query: async (sql: string) => {
      if (sql.includes('membership_permission_overrides')) return c.gravados.map((o) => ({ ...o }));
      if (sql.includes('permissions_confirmed_at')) return [{ confirmed: c.confirmado }];
      if (sql === ENABLED_FEATURES_SQL) return [...c.recursos].map((key) => ({ key }));
      if (sql.includes('FROM sales')) return [{ existe: c.haVendas }];
      throw new Error(`consulta não simulada: ${sql.slice(0, 80)}`);
    },
  } as unknown as EntityManager;
}

function vistaDaAgenda(precos: readonly (number | null)[]): AppointmentView {
  const services = precos.map((priceCents, i) => ({ id: `s${i}`, name: `Serviço ${i}`, durationMinutes: 30, priceCents }));
  return {
    id: 'a1',
    startAt: '2026-12-01T13:00:00.000Z',
    serviceEndAt: '2026-12-01T14:00:00.000Z',
    occupancyEndAt: '2026-12-01T14:10:00.000Z',
    localStart: '2026-12-01T10:00',
    localServiceEnd: '2026-12-01T11:00',
    timezone: 'America/Sao_Paulo',
    status: 'CONFIRMED' as AppointmentView['status'],
    durationMinutes: 30 * precos.length,
    priceCents: precos.some((p) => p === null) ? null : precos.reduce<number>((t, p) => t + (p ?? 0), 0),
    notes: 'observação interna',
    professional: { id: 'p1', name: 'Profissional' },
    service: { id: 's0', name: 'Serviço 0' },
    services: services as AppointmentView['services'],
    consumer: { id: 'c1', name: 'Cliente Fictício', whatsapp: '11999990000' },
    unitId: 'u1',
    createdAt: '2026-11-27T12:00:00.000Z',
  };
}

const PRECOS: readonly (readonly (number | null)[])[] = [[5000, 2500], [5000, null], []];

function itemDoHistorico(precos: readonly (number | null)[]): AtendimentoResumido & { precos: (number | null)[] } {
  return {
    id: 'h1',
    startAt: '2026-11-20T13:00:00.000Z',
    localDate: '2026-11-20',
    localStart: '10:00',
    status: 'COMPLETED',
    professionalName: 'Profissional',
    services: ['Corte'],
    precos: [...precos],
  };
}

const RECEBIMENTO = { amountCents: 7500, method: 'PIX', receivedOn: '2026-11-20', refunded: false };

/** A impressão de um vínculo: pares ordenados, um por linha. */
export async function accessFingerprint(impl: Implementacao, c: Cenario): Promise<string[]> {
  const pares: string[] = [];
  const gravados = c.gravados;
  const valem = impl.effectiveOverrides(c.role, c.confirmado, gravados);
  const negadas = gravados.filter((o) => o.mode === 'DENIED');
  const entradas = { valem, gravados, negadas };

  for (const acao of ACOES) {
    const politica = fn<Politica>(impl, acao.modulo, acao.nome);
    const ov = entradas[acao.entrada];
    const pode = acao.extra === undefined ? politica(c.role, ov) : politica(c.role, ov, acao.extra);
    pares.push(`${acao.chave}=${pode ? 'sim' : 'nao'}`);
  }

  // Agenda própria (rota /me/agenda e as ações e comissões dela).
  const linha: LinhaDaAgendaPropria = {
    role: c.role,
    permissions_confirmed: c.confirmado,
    professional_id: c.profissional === 'sem' ? null : PROFISSIONAL_ID,
    professional_active: c.profissional === 'sem' ? null : c.profissional === 'ativo',
    overrides: [...gravados],
  };
  const propria = impl.agendaPropria(linha);
  if (propria.recusa) pares.push(`agenda.ver:propria=recusa:${propria.recusa}`);
  else {
    pares.push('agenda.ver:propria=sim');
    for (const [acao, pode] of Object.entries(propria.allowed)) pares.push(`agenda.${acao}:propria=${pode ? 'sim' : 'nao'}`);
    pares.push(`comissoes.ver:propria=${propria.ownCommissions ? 'sim' : 'nao'}`);
  }

  // Funções de funcionário sem a rota (usadas pela lista de Equipe e pela sessão).
  const equipe = 'team/staff-access.ts';
  const staffEfetivas = fn<(r: EstablishmentRole, o: readonly Ajuste[]) => string[]>(impl, equipe, 'staffGrantedPermissions');
  pares.push(`funcionario.efetivas=${staffEfetivas(c.role, valem).join(',')}`);
  const agendaSemProfissional = fn<(r: EstablishmentRole, conf?: boolean) => boolean>(impl, equipe, 'canViewOwnAgenda');
  pares.push(`funcionario.agenda-propria=${agendaSemProfissional(c.role, c.confirmado) ? 'sim' : 'nao'}`);

  // Equipe: o que vale para o vínculo (tela de Equipe) e o que é concedível.
  pares.push(`equipe.efetivas=${impl.efetivasDaEquipe(c.role, c.confirmado, gravados).join(',')}`);
  const conc = impl.concessiveis(c.role, valem, (recurso) => c.recursos.has(recurso));
  pares.push(`equipe.concede-funcionario=${conc.grantable.join(',')}`);
  pares.push(`equipe.concede-gerente=${conc.grantableManager.join(',')}`);
  pares.push(`equipe.sem-recurso=${conc.managerWithoutFeature.join(',')}`);

  // Portal: o acesso efetivo do vínculo e o padrão do papel (accounts-directory.service.ts).
  const efetivo = fn<(r: EstablishmentRole, o: readonly Ajuste[]) => { key: string; allowed: boolean }[]>(
    impl,
    'accounts/tenant-effective-access.ts',
    'tenantEffectiveAccess',
  );
  pares.push(`portal.acesso=${efetivo(c.role, valem).filter((a) => a.allowed).map((a) => a.key).join(',')}`);
  pares.push(`portal.padrao-do-papel=${efetivo(c.role, []).filter((a) => a.allowed).map((a) => a.key).join(',')}`);

  // Sessão: as áreas do menu, pela composição real com o gerenciador simulado.
  const areas = await impl.sessionAreas(gerenciadorSimulado(c), {
    id: MEMBERSHIP_ID,
    tenantId: TENANT_ID,
    role: c.role,
    professionalId: c.profissional === 'sem' ? null : PROFISSIONAL_ID,
  });
  pares.push(`sessao=${areas.join(',')}`);

  // Campos e totais visíveis.
  const quem = { role: c.role, overrides: valem };
  for (const precos of PRECOS) {
    const vista = vistaDaAgenda(precos);
    pares.push(`campos.agenda[${precos.join('|')}]=${JSON.stringify(impl.recorteDaAgenda(vista, quem))}`);
    const servicos = precos.map((priceCents, i) => ({ id: `s${i}`, name: `Serviço ${i}`, durationMinutes: 30, priceCents }));
    pares.push(`campos.disponibilidade[${precos.join('|')}]=${JSON.stringify(impl.precosDaConsulta(servicos, quem))}`);
  }
  const ve = impl.historico(quem, c.recursos.has(FeatureKey.PAGAMENTOS));
  pares.push(`campos.historico.mostra=${JSON.stringify(ve)}`);
  for (const precos of PRECOS) {
    for (const recebimento of [RECEBIMENTO, undefined]) {
      const item = impl.itemDoHistorico(itemDoHistorico(precos), recebimento, ve);
      pares.push(`campos.historico[${precos.join('|')}|${recebimento ? 'recebido' : 'sem'}]=${JSON.stringify(item)}`);
    }
  }
  return pares;
}

// ------------------------------------------------------------------ casos

export const PAPEIS: readonly EstablishmentRole[] = [
  EstablishmentRole.DONO,
  EstablishmentRole.GERENTE,
  EstablishmentRole.RECEPCIONISTA,
  EstablishmentRole.PROFISSIONAL,
];
export const SITUACOES: readonly SituacaoDoProfissional[] = ['sem', 'ativo', 'inativo'];

/** Todas as permissões conhecidas: o enum e os dois catálogos (o enum
 * TypeScript não tem nove valores do banco; ver a dívida no plano). */
export const TODAS_AS_PERMISSOES: readonly string[] = [
  ...new Set([
    ...Object.values(Permission),
    ...(dGerente.MANAGER_PERMISSIONS as readonly string[]),
    ...(aGerente.MANAGER_PERMISSIONS as readonly string[]),
    ...(dEquipe.STAFF_PERMISSIONS as readonly string[]),
    ...(aEquipe.STAFF_PERMISSIONS as readonly string[]),
  ]),
].sort();

const TODOS_OS_RECURSOS: readonly string[] = Object.values(FeatureKey);
const sem = (...fora: string[]) => new Set(TODOS_OS_RECURSOS.filter((r) => !fora.includes(r)));

/** Perfis de recursos contratados ou retirados. */
export const PERFIS_DE_RECURSOS: readonly { nome: string; recursos: ReadonlySet<string>; haVendas: boolean }[] = [
  { nome: 'completo', recursos: new Set(TODOS_OS_RECURSOS), haVendas: true },
  { nome: 'sem estoque e vendas', recursos: sem(FeatureKey.ESTOQUE, FeatureKey.VENDAS), haVendas: false },
  { nome: 'vendas retirada com vendas', recursos: sem(FeatureKey.VENDAS), haVendas: true },
  { nome: 'vendas retirada sem vendas', recursos: sem(FeatureKey.VENDAS), haVendas: false },
  { nome: 'sem equipe, comissões e pagamentos', recursos: sem(FeatureKey.EQUIPE, FeatureKey.COMISSOES, FeatureKey.PAGAMENTOS), haVendas: true },
  { nome: 'sem agenda, clientes e profissionais', recursos: sem(FeatureKey.AGENDA, FeatureKey.CONSUMIDORES, FeatureKey.PROFISSIONAIS, FeatureKey.AGENDAMENTO_PUBLICO), haVendas: false },
];

const G = (permission: string): Ajuste => ({ permission, mode: 'GRANTED' });
const D = (permission: string): Ajuste => ({ permission, mode: 'DENIED' });

function* base(
  gravados: readonly Ajuste[],
  rotulo: string,
  perfis: typeof PERFIS_DE_RECURSOS = PERFIS_DE_RECURSOS.slice(0, 1),
): Generator<Cenario> {
  for (const role of PAPEIS) {
    for (const confirmado of [true, false]) {
      for (const profissional of SITUACOES) {
        for (const perfil of perfis) {
          yield {
            role,
            confirmado,
            profissional,
            gravados,
            recursos: perfil.recursos,
            haVendas: perfil.haVendas,
            rotulo: `${role} conf=${confirmado} prof=${profissional} recursos=${perfil.nome} ${rotulo}`,
          };
        }
      }
    }
  }
}

/** Grupos de casos, cada um com o motivo. */
export function* gruposDeCasos(): Generator<{ grupo: string; caso: Cenario }> {
  // Sem ajuste e com tudo concedido ou negado, em todos os perfis de recursos.
  for (const [rotulo, gravados] of [
    ['sem ajustes', []],
    ['tudo GRANTED', TODAS_AS_PERMISSOES.map(G)],
    ['tudo DENIED', TODAS_AS_PERMISSOES.map(D)],
    ['tudo GRANTED e DENIED', TODAS_AS_PERMISSOES.flatMap((p) => [G(p), D(p)])],
  ] as const) {
    for (const caso of base(gravados, rotulo, PERFIS_DE_RECURSOS)) yield { grupo: 'recursos', caso };
  }
  // Cada permissão sozinha: GRANTED, DENIED e as duas.
  for (const p of TODAS_AS_PERMISSOES) {
    for (const [modo, gravados] of [
      ['G', [G(p)]],
      ['D', [D(p)]],
      ['GD', [G(p), D(p)]],
    ] as const) {
      for (const caso of base(gravados, `${p}:${modo}`)) yield { grupo: 'cada permissão', caso };
    }
  }
  // Concedida com as dependências e só uma dependência negada.
  const requer = dGerente.MANAGER_PERMISSION_REQUIRES as Readonly<Record<string, readonly string[]>>;
  for (const [p, deps] of Object.entries(requer)) {
    for (const dep of deps) {
      for (const caso of base([G(p), ...deps.map(G), D(dep)], `${p} com ${dep} negada`)) {
        yield { grupo: 'dependência negada', caso };
      }
    }
    for (const caso of base([G(p)], `${p} sem dependências`)) yield { grupo: 'dependência ausente', caso };
  }
  // Concessões ignoradas pelo papel e combinações citadas no plano.
  const estoque = TODAS_AS_PERMISSOES.filter((p) => p.startsWith('ESTOQUE_'));
  const vendas = TODAS_AS_PERMISSOES.filter((p) => p.startsWith('VENDAS_'));
  const funcionario = dEquipe.STAFF_PERMISSIONS as readonly string[];
  for (const [rotulo, gravados] of [
    ['estoque concedido', estoque.map(G)],
    ['vendas concedidas', vendas.map(G)],
    ['ações próprias concedidas', funcionario.map(G)],
    ['ESTOQUE_GERENCIAR sem ESTOQUE_VISUALIZAR', [G('ESTOQUE_GERENCIAR')]],
    ['ESTOQUE_GERENCIAR com ESTOQUE_VISUALIZAR', [G('ESTOQUE_GERENCIAR'), G('ESTOQUE_VISUALIZAR')]],
    ['VENDAS_RECEBER sem VENDAS_VISUALIZAR', [G('VENDAS_RECEBER')]],
    ['VENDAS_RECEBER com VENDAS_VISUALIZAR', [G('VENDAS_RECEBER'), G('VENDAS_VISUALIZAR')]],
    ['VENDAS_RECEBER com VENDAS_VISUALIZAR negada', [G('VENDAS_RECEBER'), G('VENDAS_VISUALIZAR'), D('VENDAS_VISUALIZAR')]],
    ['VENDAS_RECEBER negada com VENDAS_VISUALIZAR', [G('VENDAS_RECEBER'), D('VENDAS_RECEBER'), G('VENDAS_VISUALIZAR')]],
  ] as const) {
    for (const caso of base(gravados, rotulo, PERFIS_DE_RECURSOS)) yield { grupo: 'ignoradas e plano', caso };
  }
  // Pares de permissões: o gerente e a recepcionista com as duas concedidas,
  // o dono com as duas negadas.
  for (let i = 0; i < TODAS_AS_PERMISSOES.length; i++) {
    for (let j = i + 1; j < TODAS_AS_PERMISSOES.length; j++) {
      const [p, q] = [TODAS_AS_PERMISSOES[i], TODAS_AS_PERMISSOES[j]];
      for (const role of [EstablishmentRole.GERENTE, EstablishmentRole.RECEPCIONISTA, EstablishmentRole.PROFISSIONAL]) {
        yield {
          grupo: 'pares',
          caso: {
            role,
            confirmado: true,
            profissional: 'ativo',
            gravados: [G(p), G(q)],
            recursos: PERFIS_DE_RECURSOS[0].recursos,
            haVendas: true,
            rotulo: `${role} ${p}+${q} GRANTED`,
          },
        };
      }
      yield {
        grupo: 'pares',
        caso: {
          role: EstablishmentRole.DONO,
          confirmado: false,
          profissional: 'sem',
          gravados: [D(p), D(q)],
          recursos: PERFIS_DE_RECURSOS[0].recursos,
          haVendas: true,
          rotulo: `DONO ${p}+${q} DENIED`,
        },
      };
    }
  }
}

/** Gerador congruente simples, com semente fixa (reprodutível no CI). */
export function sorteador(semente: number): () => number {
  let s = semente >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

export function* casosSorteados(semente: number, quantidade: number): Generator<Cenario> {
  const r = sorteador(semente);
  const um = <T>(lista: readonly T[]): T => lista[Math.floor(r() * lista.length)];
  for (let n = 0; n < quantidade; n++) {
    const gravados: Ajuste[] = [];
    for (const p of TODAS_AS_PERMISSOES) {
      const x = r();
      if (x < 0.3) gravados.push(G(p));
      else if (x < 0.4) gravados.push(D(p));
      else if (x < 0.45) gravados.push(G(p), D(p));
    }
    const recursos = new Set(TODOS_OS_RECURSOS.filter(() => r() < 0.8));
    yield {
      role: um(PAPEIS),
      confirmado: r() < 0.5,
      profissional: um(SITUACOES),
      gravados,
      recursos,
      haVendas: r() < 0.5,
      rotulo: `sorteado ${semente}#${n}`,
    };
  }
}
