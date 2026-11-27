// Alcance real por vínculo (docs/plans/permissoes-individuais.md, seção 5.4):
// chama os serviços de verdade, com o banco, para cada vínculo, e resume cada
// resposta: o que foi recusado (status e `code`), os IDs devolvidos, os
// totais e os campos escondidos. Serve a duas comparações:
//
// - dados fictícios (alcance-real-postgres.db-e2e-spec.ts): as respostas do
//   código atual batem com a impressão da referência congelada do piloto;
// - cópia restaurada (docs/runbooks/ensaio-alcance-real-permissoes.md): o
//   mesmo coletor roda com o código do piloto e com o atual sobre a mesma
//   cópia, e `comparar-alcance.mjs` compara as duas saídas.
//
// Nada aqui escreve no banco: só métodos de consulta. A saída não leva nome,
// telefone, e-mail ou texto digitado: só IDs, valores em centavos, contagens,
// marcas de campo escondido e o SHA-256 da resposta inteira (para provar
// igualdade sem guardar o conteúdo).
//
// Este arquivo só importa o que existe igual em 8f71335 e no código atual,
// para rodar nos dois.
import { createHash } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { sessionAreas } from '../../src/auth/session-areas.js';
import { AppointmentsService } from '../../src/appointments/appointments.service.js';
import { AvailabilityService } from '../../src/availability/availability.service.js';
import { CommissionsService } from '../../src/commissions/commissions.service.js';
import { ConsumerProfileService } from '../../src/consumers/consumer-profile.service.js';
import { ConsumersService } from '../../src/consumers/consumers.service.js';
import { DashboardService } from '../../src/dashboard/dashboard.service.js';
import { PaymentsService } from '../../src/payments/payments.service.js';
import { ProfessionalsService } from '../../src/professionals/professionals.service.js';
import { SalePaymentsService } from '../../src/sales/sale-payments.service.js';
import { SalesService } from '../../src/sales/sales.service.js';
import { ServicesService } from '../../src/services/services.service.js';
import { StockProductsService } from '../../src/stock/stock-products.service.js';
import { MyAgendaService } from '../../src/team/my-agenda.service.js';
import { TeamService } from '../../src/team/team.service.js';
import type { EstablishmentRole } from '../../src/entities/enums/establishment-role.enum.js';

export interface OpcoesDaColeta {
  /** Instante fixo passado aos serviços que aceitam `now`. */
  agora: Date;
  /** Período das listas (datas locais inclusivas, no máximo 366 dias). */
  de: string;
  ate: string;
  /** Dia da consulta de horários livres. */
  dia: string;
  /** Só estes estabelecimentos (dados fictícios); ausente: todos. */
  estabelecimentos?: readonly string[];
  /** Quantos clientes por estabelecimento têm o histórico consultado. */
  clientesPorEstabelecimento?: number;
}

export type Resposta =
  | { ok: true; sha256: string; resumo: unknown }
  | { ok: false; status: number | null; code: string | null; erro: string };

export interface VinculoColetado {
  membershipId: string;
  tenantId: string;
  role: string;
  status: string;
  professionalId: string | null;
  respostas: Record<string, Resposta>;
}

export interface Coleta {
  opcoes: { agora: string; de: string; ate: string; dia: string };
  vinculos: VinculoColetado[];
}

/** JSON com chaves ordenadas, para o hash não depender da ordem das chaves. */
function estavel(valor: unknown): string {
  return JSON.stringify(valor, (_k, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : typeof v === 'bigint'
        ? v.toString()
        : v,
  );
}

const sha = (valor: unknown) => createHash('sha256').update(estavel(valor)).digest('hex');

async function responder(chamada: () => Promise<unknown>, resumir: (r: any) => unknown): Promise<Resposta> {
  try {
    const r = await chamada();
    return { ok: true, sha256: sha(r), resumo: resumir(r) };
  } catch (error) {
    const e = error as { getStatus?: () => number; getResponse?: () => unknown; name?: string };
    const corpo = e.getResponse?.();
    const code = corpo && typeof corpo === 'object' && 'code' in corpo ? String((corpo as { code: unknown }).code) : null;
    return { ok: false, status: e.getStatus?.() ?? null, code, erro: e.name ?? 'Error' };
  }
}

const ids = (lista: readonly { id: string }[] | undefined) => (lista ?? []).map((x) => x.id).sort();

/** Campos escondidos e valores de uma reserva, sem dados pessoais. */
function reserva(a: any) {
  return {
    id: a.id,
    status: a.status,
    hidden: a.hidden ?? [],
    priceCents: a.priceCents ?? null,
    servicePrices: (a.services ?? []).map((s: { priceCents: number | null }) => s.priceCents ?? null),
    temObservacao: a.notes !== null && a.notes !== undefined && a.notes !== '',
    temContato: Boolean(a.consumer?.whatsapp),
  };
}

export async function coletarAlcance(db: DataSource, opcoes: OpcoesDaColeta): Promise<Coleta> {
  const relogio = () => opcoes.agora;
  const consumers = new ConsumersService(db);
  const availability = new AvailabilityService(db, relogio);
  const appointments = new AppointmentsService(db, availability, consumers, relogio);
  const servicos = {
    appointments,
    availability,
    consumers,
    profile: new ConsumerProfileService(db),
    agenda: new MyAgendaService(db, appointments),
    commissions: new CommissionsService(db),
    payments: new PaymentsService(db),
    dashboard: new DashboardService(db),
    professionals: new ProfessionalsService(db),
    services: new ServicesService(db),
    stock: new StockProductsService(db),
    sales: new SalesService(db),
    salePayments: new SalePaymentsService(db),
    team: new TeamService(db),
  };
  const filtro = opcoes.estabelecimentos;
  const vinculos = (await db.query(
    `SELECT m.id, m.user_id, m.tenant_id, m.role::text AS role, m.status::text AS status, m.professional_id
       FROM memberships m
      WHERE ($1::text[] IS NULL OR m.tenant_id = ANY($1::text[]))
      ORDER BY m.tenant_id, m.id`,
    [filtro ? [...filtro] : null],
  )) as { id: string; user_id: string; tenant_id: string; role: string; status: string; professional_id: string | null }[];

  const porEstabelecimento = new Map<string, { clientes: string[]; consulta: { professionalId: string; serviceId: string } | null }>();
  const alvos = async (tenantId: string) => {
    if (!porEstabelecimento.has(tenantId)) {
      const clientes = (
        (await db.query(`SELECT id FROM consumers WHERE tenant_id = $1 ORDER BY id LIMIT $2`, [
          tenantId,
          opcoes.clientesPorEstabelecimento ?? 3,
        ])) as { id: string }[]
      ).map((c) => c.id);
      const [consulta] = (await db.query(
        `SELECT ps.professional_id, ps.service_id FROM professional_services ps
           JOIN professionals p ON p.tenant_id = ps.tenant_id AND p.id = ps.professional_id AND p.active
           JOIN services s ON s.tenant_id = ps.tenant_id AND s.id = ps.service_id AND s.active
          WHERE ps.tenant_id = $1 ORDER BY ps.professional_id, ps.service_id LIMIT 1`,
        [tenantId],
      )) as { professional_id: string; service_id: string }[];
      porEstabelecimento.set(tenantId, {
        clientes,
        consulta: consulta ? { professionalId: consulta.professional_id, serviceId: consulta.service_id } : null,
      });
    }
    return porEstabelecimento.get(tenantId)!;
  };

  const periodo = { from: opcoes.de, to: opcoes.ate };
  const saida: VinculoColetado[] = [];
  for (const v of vinculos) {
    const u = v.user_id;
    const t = v.tenant_id;
    const alvo = await alvos(t);
    const r: Record<string, Resposta> = {};
    r['sessao.areas'] = await responder(
      () => sessionAreas(db.manager, { id: v.id, tenantId: t, role: v.role as EstablishmentRole, professionalId: v.professional_id }),
      (areas: string[]) => [...areas].sort(),
    );
    r['agenda.periodo'] = await responder(
      () => servicos.appointments.listRange(u, t, periodo as never),
      (x) => (x.appointments ?? x).map(reserva).sort((a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id)),
    );
    r['agenda.propria'] = await responder(
      () => servicos.agenda.range(u, t, periodo as never, opcoes.agora),
      (x) => ({
        professional: x.professional?.id ?? null,
        permissions: x.permissions ?? null,
        appointments: (x.appointments ?? []).map(reserva).sort((a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id)),
      }),
    );
    r['comissoes.proprias'] = await responder(
      () => servicos.agenda.commissions(u, t, periodo as never, opcoes.agora),
      (x) => x,
    );
    r['comissoes.relatorio'] = await responder(() => servicos.commissions.report(u, t, periodo as never, opcoes.agora), (x) => x);
    r['recebimentos.lista'] = await responder(() => servicos.payments.list(u, t, periodo as never, opcoes.agora), (x) => ({
      ids: ids(x.payments),
      totais: x.totals ?? x.summary ?? null,
    }));
    r['painel.resumo'] = await responder(() => servicos.dashboard.summary(u, t, periodo as never, opcoes.agora), () => null);
    r['clientes.pagina'] = await responder(() => servicos.consumers.listPage(u, t, { limit: 100 } as never), (x) => ({
      ids: ids(x.consumers),
      total: x.total,
    }));
    for (const [i, consumerId] of alvo.clientes.entries()) {
      r[`clientes.historico.${i}`] = await responder(
        () => servicos.profile.history(u, t, consumerId, { limit: 100 } as never),
        (x) =>
          x.appointments.map((h: any) => ({
            id: h.id,
            hidden: h.hidden,
            priceCents: h.priceCents,
            payment: h.payment === undefined ? 'ausente' : h.payment === null ? null : { amountCents: h.payment.amountCents, refunded: h.payment.refunded },
          })),
      );
    }
    if (alvo.consulta) {
      r['disponibilidade.consulta'] = await responder(
        () =>
          servicos.availability.consult(u, t, alvo.consulta!.professionalId, {
            serviceId: alvo.consulta!.serviceId,
            date: opcoes.dia,
          } as never),
        (x) => ({
          services: x.services.map((s: { id: string; priceCents: number | null }) => [s.id, s.priceCents]),
          totalPriceCents: x.totalPriceCents,
          priceHidden: x.priceHidden,
        }),
      );
    }
    r['servicos.lista'] = await responder(() => servicos.services.list(u, t), (x) => x.map((s: any) => [s.id, s.priceCents ?? null]).sort());
    r['profissionais.lista'] = await responder(() => servicos.professionals.list(u, t), (x) => ids(x));
    r['estoque.produtos'] = await responder(() => servicos.stock.list(u, t, { status: 'ALL' } as never), (x) => ids(x.products));
    for (const scope of ['mine', 'all'] as const) {
      r[`vendas.lista.${scope}`] = await responder(
        () => servicos.sales.list(u, t, { scope, ...periodo } as never, opcoes.agora),
        (x) => ids(x.sales),
      );
      r[`vendas.recebimentos.${scope}`] = await responder(
        () => servicos.salePayments.list(u, t, { scope, ...periodo } as never, opcoes.agora),
        (x) => ids(x.payments),
      );
    }
    r['equipe.visao'] = await responder(() => servicos.team.overview(u, t, opcoes.agora), (x) => ({
      acessos: (x.accesses ?? [])
        .map((a: any) => [a.membershipId, a.role, a.situation, [...(a.grantedPermissions ?? [])].sort()])
        .sort(),
      concedivel: [...(x.grantablePermissions ?? [])].map((p: { permission: string }) => p.permission).sort(),
      vagas: x.seats ?? null,
    }));
    saida.push({ membershipId: v.id, tenantId: t, role: v.role, status: v.status, professionalId: v.professional_id, respostas: r });
  }
  return {
    opcoes: { agora: opcoes.agora.toISOString(), de: opcoes.de, ate: opcoes.ate, dia: opcoes.dia },
    vinculos: saida,
  };
}
