import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { User } from '../entities/user.entity.js';
import {
  computeTrialWindow,
  TRIAL_DURATION_DAYS,
} from '../auth/trial-policy.js';
import {
  canViewEstablishments,
  platformCapabilities,
  requirePlatformAccess,
} from './platform-access.js';
import type { EstablishmentQuery, ReportQuery } from './platform.dto.js';
import { staffSeatUsage } from '../team/seats.js';
import { planExcess } from './establishment-admin.service.js';
import { listAccessPeriods } from './access-validity.service.js';
import { accessSituation, localDate } from '../commercial/access-periods.js';
import { loadAccessFlags, loadAccessPeriods } from '../commercial/commercial-gate.js';
import { correctionPreview } from './access-correction.service.js';
import { listNoExpiryGrants, noExpiryRevokePreview } from './no-expiry.service.js';
import { tenantPricing } from './pricing.service.js';
import {
  ESTABLISHMENT_COLUMNS,
  ESTABLISHMENT_FROM,
  establishmentFilter,
  subscriptionPaymentWhere,
} from './platform.queries.js';
import { resolveReportPeriod, timestampInRangeSql } from './portal-reports.js';
import { loadDirectory } from './portal-directory.js';
import {
  attentionReason,
  compareAttention,
  DEFAULT_ESTABLISHMENT_SCOPE,
  directoryCounts,
  matchesFilter,
  matchesScope,
  monthRange,
  PLATFORM_TIME_ZONE,
  scopeSql,
  type AttentionReason,
  type EstablishmentScope,
  type TenantAccessView,
} from './portal-overview.js';

/** Itens da lista "Precisa de atenção" devolvidos de uma vez; o total vem à
 * parte, com o filtro da listagem para ver todos. */
export const ATTENTION_LIMIT = 20;

/**
 * Pagamentos de assinatura recebidos de `from` a `to` (datas inclusas), no
 * alcance: quantidade e soma dos registros NÃO anulados agora, e quantos do
 * mesmo intervalo estão anulados (fora da soma). Mesma regra do extrato
 * (`subscriptionPaymentWhere`). Soma o valor gravado em cada registro, nunca
 * recalculado pelo catálogo ou contrato.
 */
async function paymentTotals(
  manager: EntityManager,
  filter: { from: string; to: string; scope: EstablishmentScope },
): Promise<{ count: number; totalCents: number; canceledCount: number }> {
  const where = subscriptionPaymentWhere(filter);
  const [linha] = await manager.query<{ count: number; total_cents: string | number; canceled: number }[]>(
    `SELECT count(*) FILTER (WHERE ap.canceled_at IS NULL)::int AS count,
            COALESCE(sum(ap.contracted_price_cents) FILTER (WHERE ap.canceled_at IS NULL), 0)::bigint AS total_cents,
            count(*) FILTER (WHERE ap.canceled_at IS NOT NULL)::int AS canceled
       FROM tenant_access_periods ap
       JOIN tenants t ON t.id = ap.tenant_id
     ${where.sql}`,
    where.values,
  );
  return { count: linha.count, totalCents: Number(linha.total_cents), canceledCount: linha.canceled };
}

export interface EstablishmentRow {
  id: string;
  name: string;
  slug: string;
  category: string;
  timezone: string;
  status: string;
  createdAt: Date;
  plan: {
    id: string;
    code: string;
    name: string;
    catalogPriceCents: number | null;
    maxProfessionals: number;
    maxUnits: number;
  };
  owners: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    status: string;
  }[];
}

@Injectable()
export class PlatformService {
  constructor(private readonly dataSource: DataSource) {}

  async access(userId: string) {
    const user = await this.dataSource.manager.findOne(User, {
      where: { id: userId },
    });
    // `capabilities` diz à tela o que mostrar; o servidor confere de novo em
    // cada operação. O papel só aparece para quem tem acesso.
    const capabilities = platformCapabilities(user);
    return {
      canViewEstablishments: canViewEstablishments(user),
      capabilities,
      platformRole: capabilities.viewDirectory ? (user?.platformRole ?? null) : null,
    };
  }

  /** Autorização relida em TODA consulta. Nenhum papel/tenantId do navegador
   * decide o acesso global; nenhuma sessão de suporte é aberta aqui. */
  private read<T>(
    userId: string,
    operation: (manager: EntityManager, actor: User | null) => Promise<T>,
  ): Promise<T> {
    return this.dataSource.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');
      await requirePlatformAccess(manager, userId);
      const actor = await manager.findOne(User, { where: { id: userId } });
      return operation(manager, actor);
    });
  }

  list(userId: string, query: EstablishmentQuery, now = new Date()) {
    return this.read(userId, async (manager) => {
      // Situação do acesso e condição contratada de todos, em lote: o filtro
      // usa a regra central e vira uma lista de ids na consulta paginada.
      const scope = query.scope ?? DEFAULT_ESTABLISHMENT_SCOPE;
      const diretorio = await loadDirectory(manager, now);
      const ids = query.filter
        ? [...diretorio.values()]
            .filter((e) => matchesScope(scope, e.isTest) && matchesFilter(query.filter!, e.access, e.commercial))
            .map((e) => e.id)
        : undefined;
      const filter = establishmentFilter({ ...query, scope }, ids);
      const alcance = scopeSql(scope, 'tenants');
      const [count] = await manager.query<{ total: number }[]>(
        `SELECT count(*)::int AS total ${ESTABLISHMENT_FROM} ${filter.sql}`,
        filter.values,
      );
      const items = await manager.query<EstablishmentRow[]>(
        `SELECT ${ESTABLISHMENT_COLUMNS} ${ESTABLISHMENT_FROM} ${filter.sql}
         ORDER BY t.created_at DESC, t.id DESC LIMIT $${filter.values.length + 1} OFFSET $${filter.values.length + 2}`,
        [...filter.values, query.pageSize, (query.page - 1) * query.pageSize],
      );
      // Contagens do banco no mesmo alcance da lista (sem busca nem filtros),
      // nunca somas da página atual.
      const [summary] = await manager.query<
        { total: number; active: number; trial: number; restricted: number }[]
      >(
        `SELECT count(*)::int AS total,
         count(*) FILTER (WHERE status = 'ACTIVE')::int AS active,
         count(*) FILTER (WHERE status = 'TRIAL')::int AS trial,
         count(*) FILTER (WHERE status::text IN ('SUSPENDED', 'PAST_DUE', 'CANCELED', 'ARCHIVED'))::int AS restricted
         FROM tenants ${alcance ? `WHERE ${alcance}` : ''}`,
      );
      const plans = await manager.query<{ id: string; name: string }[]>(
        'SELECT id, name FROM plans ORDER BY name, id',
      );
      return {
        // Campos acrescentados (a lista anterior continua igual): situação
        // administrativa, acesso efetivo com modalidade e validade, e a
        // condição contratada de cada ciclo do plano atual.
        items: items.map((item) => {
          const entrada = diretorio.get(item.id);
          return {
            ...item,
            operational: entrada?.access.operational ?? 'INACTIVE',
            access: entrada?.access ?? null,
            commercial: entrada?.commercial ?? null,
          };
        }),
        total: count.total,
        /** Alcance aplicado a `items`, `total` e `summary`. A tela só afirma
         * "somente clientes" quando este campo vem. */
        scope,
        /** Período de cadastro aplicado a `items` e `total` (não ao
         * `summary`); `null` sem restrição. A tela só afirma o filtro quando
         * este campo confirma o pedido. */
        created:
          query.createdFrom && query.createdTo
            ? { from: query.createdFrom, to: query.createdTo, timeZone: PLATFORM_TIME_ZONE }
            : null,
        page: query.page,
        pageSize: query.pageSize,
        summary,
        plans,
      };
    });
  }

  /**
   * Visão geral do portal: totais dos estabelecimentos no alcance pedido
   * (padrão: só clientes, `is_test = false`; ver `matchesScope`), com a regra
   * central de acesso, a lista "Precisa de atenção" e os pagamentos de
   * assinatura do mês, todos no mesmo alcance.
   *
   * Pagamentos do mês: períodos pagos confirmados manualmente e não anulados,
   * pela data de recebimento registrada, do dia 1 ao último dia do mês
   * corrente em America/Sao_Paulo. Soma o valor gravado em cada período,
   * nunca recalculado pelo catálogo ou contrato. Não é receita recorrente,
   * previsão nem inadimplência.
   */
  overview(userId: string, scope: EstablishmentScope = DEFAULT_ESTABLISHMENT_SCOPE, now = new Date()) {
    return this.read(userId, async (manager) => {
      const noAlcance = [...(await loadDirectory(manager, now)).values()].filter((e) => matchesScope(scope, e.isTest));
      const counts = directoryCounts(noAlcance);

      const atencao: { id: string; timezone: string; reason: AttentionReason; view: TenantAccessView }[] = [];
      for (const e of noAlcance) {
        const reason = attentionReason(e.access);
        if (reason) atencao.push({ id: e.id, timezone: e.timezone, reason, view: e.access });
      }
      atencao.sort(compareAttention);
      const primeiros = atencao.slice(0, ATTENTION_LIMIT);
      const nomes = new Map<string, string>();
      if (primeiros.length) {
        const linhas = await manager.query<{ id: string; name: string }[]>(
          `SELECT t.id, COALESCE(main_unit.name, t.slug::text) AS name ${ESTABLISHMENT_FROM} WHERE t.id = ANY($1::varchar[])`,
          [primeiros.map((a) => a.id)],
        );
        for (const l of linhas) nomes.set(l.id, l.name);
      }

      const mes = monthRange(now, PLATFORM_TIME_ZONE);
      const pagamentos = await paymentTotals(manager, { from: mes.from, to: mes.to, scope });

      return {
        generatedAt: now.toISOString(),
        /** Alcance de `establishments`, `attention` e `payments`. */
        scope,
        establishments: counts,
        payments: {
          timeZone: PLATFORM_TIME_ZONE,
          month: mes.month,
          from: mes.from,
          to: mes.to,
          currency: 'BRL' as const,
          count: pagamentos.count,
          totalCents: pagamentos.totalCents,
          /** Registros anulados no mesmo intervalo, fora da soma. */
          canceledCount: pagamentos.canceledCount,
        },
        attention: {
          total: atencao.length,
          byReason: {
            VALIDITY_BLOCKED: atencao.filter((a) => a.reason === 'VALIDITY_BLOCKED').length,
            EXPIRING_SOON: atencao.filter((a) => a.reason === 'EXPIRING_SOON').length,
          },
          items: primeiros.map((a) => ({
            tenant: { id: a.id, name: nomes.get(a.id) ?? a.id, timezone: a.timezone },
            reason: a.reason,
            state: a.view.state,
            lastDay: a.view.lastDay,
            daysLeft: a.view.daysLeft,
            expiredAt: a.view.expiredAt,
          })),
        },
      };
    });
  }

  /**
   * Relatório por período da administração do SaaS (docs/plans/
   * portal-relatorios-por-periodo.md), no alcance pela marca `is_test` ATUAL
   * (reclassificar muda também períodos passados):
   * - pagamentos de assinatura recebidos (registrados à mão e não anulados
   *   agora), pela data de recebimento, com os anulados à parte e o
   *   detalhamento por plano e ciclo gravados no pagamento;
   * - cadastros registrados no período (`tenants.created_at` em São Paulo).
   * Sem datas: mês atual em São Paulo pelo relógio do servidor; a resposta
   * traz o período aplicado.
   */
  report(userId: string, query: ReportQuery, now = new Date()) {
    return this.read(userId, async (manager) => {
      const scope = query.scope ?? DEFAULT_ESTABLISHMENT_SCOPE;
      const period = resolveReportPeriod(query, now);
      const filtro = { from: period.from, to: period.to, scope };
      const pagamentos = await paymentTotals(manager, filtro);

      const recebidos = subscriptionPaymentWhere({ ...filtro, status: 'RECEIVED' });
      const grupos = await manager.query<
        { plan_id: string; plan_name: string; cycle: string; count: number; total_cents: string | number }[]
      >(
        `SELECT ap.plan_id, p.name AS plan_name, ap.billing_cycle::text AS cycle, count(*)::int AS count,
                COALESCE(sum(ap.contracted_price_cents), 0)::bigint AS total_cents
           FROM tenant_access_periods ap
           JOIN tenants t ON t.id = ap.tenant_id
           JOIN plans p ON p.id = ap.plan_id
         ${recebidos.sql}
          GROUP BY ap.plan_id, p.name, ap.billing_cycle
          ORDER BY p.name, ap.plan_id, ap.billing_cycle`,
        recebidos.values,
      );

      const alcance = scopeSql(scope, 't');
      const [cadastros] = await manager.query<{ count: number }[]>(
        `SELECT count(*)::int AS count FROM tenants t
          WHERE ${timestampInRangeSql('t.created_at', '$1', '$2')} ${alcance ? `AND ${alcance}` : ''}`,
        [period.from, period.to],
      );

      return {
        generatedAt: now.toISOString(),
        scope,
        timeZone: PLATFORM_TIME_ZONE,
        period,
        currency: 'BRL' as const,
        payments: pagamentos,
        byPlanCycle: grupos.map((g) => ({
          planId: g.plan_id,
          planName: g.plan_name,
          cycle: g.cycle,
          count: g.count,
          totalCents: Number(g.total_cents),
        })),
        registrations: { count: cadastros.count },
      };
    });
  }

  detail(userId: string, tenantId: string, now = new Date()) {
    return this.read(userId, async (manager, actor) => {
      const [establishment] = await manager.query<EstablishmentRow[]>(
        `SELECT ${ESTABLISHMENT_COLUMNS} ${ESTABLISHMENT_FROM} WHERE t.id = $1`,
        [tenantId],
      );
      if (!establishment)
        throw new NotFoundException('Estabelecimento não encontrado.');
      const units = await manager.query<
        { id: string; name: string; address: string; isPrimary: boolean }[]
      >(
        'SELECT id, name, address, is_primary AS "isPrimary" FROM units WHERE tenant_id = $1 ORDER BY is_primary DESC, name, id',
        [tenantId],
      );
      const [usage] = await manager.query<
        { professionals: number; services: number; consumers: number; units: number }[]
      >(
        `SELECT (SELECT count(*)::int FROM professionals WHERE tenant_id = $1 AND active = true) AS professionals,
         (SELECT count(*)::int FROM services WHERE tenant_id = $1 AND active = true) AS services,
         (SELECT count(*)::int FROM consumers WHERE tenant_id = $1) AS consumers,
         (SELECT count(*)::int FROM units WHERE tenant_id = $1) AS units`,
        [tenantId],
      );
      const staffSeats = await staffSeatUsage(manager, tenantId, establishment.plan.maxProfessionals, now);
      const [extra] = await manager.query<
        { updatedAt: Date; restoreStatus: string | null; suspensionReason: string | null; taxDocument: string | null }[]
      >(
        `SELECT updated_at AS "updatedAt", restore_status AS "restoreStatus", suspension_reason AS "suspensionReason",
                tax_document AS "taxDocument" FROM tenants WHERE id = $1`,
        [tenantId],
      );
      const caps = platformCapabilities(actor);
      // Cada plano do catálogo com o que passaria do limite com o uso atual:
      // a tela mostra antes, o servidor confere de novo na troca.
      const catalogo = await manager.query<
        { id: string; code: string; name: string; catalogPriceCents: number | null; max_professionals: number; max_units: number }[]
      >(
        `SELECT id, code, name, price_cents AS "catalogPriceCents", max_professionals, max_units FROM plans ORDER BY max_professionals, name, id`,
      );
      const planOptions = [];
      for (const plano of catalogo) {
        planOptions.push({
          id: plano.id,
          code: plano.code,
          name: plano.name,
          catalogPriceCents: plano.catalogPriceCents,
          maxProfessionals: plano.max_professionals,
          maxUnits: plano.max_units,
          excess: await planExcess(manager, tenantId, plano, now),
        });
      }
      const status = establishment.status;
      const operando = status === 'TRIAL' || status === 'ACTIVE';
      // Validade do acesso (assinatura do Agenda Cloud), separada da
      // situação administrativa acima.
      const periodos = await loadAccessPeriods(manager, tenantId);
      const legado = await loadAccessFlags(manager, tenantId);
      const situacao = accessSituation(periodos, now, legado);
      const historico = await listAccessPeriods(manager, tenantId);
      const ultimoDia = situacao.validUntil
        ? localDate(new Date(situacao.validUntil.getTime() - 1), establishment.timezone)
        : null;
      const registraValidade = caps.manageEstablishmentLifecycle && (operando || status === 'SUSPENDED');
      const concessoes = await listNoExpiryGrants(manager, tenantId);
      const concessaoVigente = concessoes.find((c) => !c.revoked) ?? null;
      const depoisDeRetirar = concessaoVigente ? noExpiryRevokePreview(periodos, now) : null;
      const ultimoDiaDepois = depoisDeRetirar?.validUntil
        ? localDate(new Date(depoisDeRetirar.validUntil.getTime() - 1), establishment.timezone)
        : null;
      return {
        ...establishment,
        ...extra,
        units,
        usage: { ...usage, staffSeats },
        planOptions,
        /** O que a conta que está olhando pode fazer aqui (o servidor confere
         * de novo em cada operação). */
        allowedActions: {
          edit: caps.manageEstablishments,
          markTest: caps.manageEstablishments,
          suspend: caps.manageEstablishmentLifecycle && operando,
          archive: caps.manageEstablishmentLifecycle && (operando || status === 'SUSPENDED'),
          reactivate:
            caps.manageEstablishmentLifecycle && (status === 'SUSPENDED' || status === 'ARCHIVED') && !!extra.restoreStatus,
          changePlan: caps.manageEstablishmentLifecycle,
          recordPayment: registraValidade,
          extendTrial: registraValidade && !periodos.some((p) => p.kind !== 'TRIAL'),
          grantCourtesy: registraValidade,
          correctPeriod: registraValidade,
          grantNoExpiry: registraValidade && !concessaoVigente,
          revokeNoExpiry: registraValidade && !!concessaoVigente,
          changeContract: registraValidade,
        },
        /** Ativo/Inativo: a situação administrativa, separada da validade
         * comercial e dos papéis da plataforma. Inativo (suspenso ou
         * arquivado) prevalece sobre pagamento, teste e "sem vencimento". */
        operational: operando ? 'ACTIVE' : 'INACTIVE',
        /** Concessões "sem vencimento" (em vigor e retiradas, nunca apagadas)
         * e, com uma em vigor, como fica a validade se for retirada agora. */
        noExpiry: {
          active: concessaoVigente,
          history: concessoes,
          revokePreview: depoisDeRetirar
            ? {
                state: depoisDeRetirar.state,
                blocked: depoisDeRetirar.blocked,
                validUntil: depoisDeRetirar.validUntil,
                lastDay: ultimoDiaDepois
                  ? `${ultimoDiaDepois.year}-${String(ultimoDiaDepois.month).padStart(2, '0')}-${String(ultimoDiaDepois.day).padStart(2, '0')}`
                  : null,
                expiredAt: depoisDeRetirar.expiredAt,
              }
            : null,
        },
        /** Preço do plano atual: catálogo, contrato do cliente e o valor que o
         * formulário "Registrar pagamento" preenche, com a origem. */
        pricing: await tenantPricing(manager, tenantId, establishment.plan.id),
        access: {
          state: situacao.state,
          /** Marcado como anterior ao controle de validade (migration
           * CommercialAccess). Sem período, "Validade ainda não definida". */
          legacy: legado.legacy,
          /** Concessão "sem vencimento" em vigor. */
          noExpiry: legado.noExpiry,
          blocked: situacao.blocked,
          validUntil: situacao.validUntil,
          /** Último dia coberto, na data local do estabelecimento. */
          lastDay: ultimoDia
            ? `${ultimoDia.year}-${String(ultimoDia.month).padStart(2, '0')}-${String(ultimoDia.day).padStart(2, '0')}`
            : null,
          expiredAt: situacao.expiredAt,
          expiredKind: situacao.expiredKind,
        },
        // Cada registro com a prévia da correção (só para quem pode corrigir):
        // a tela mostra o impacto antes de confirmar.
        accessPeriods: historico.map((p) => ({
          ...p,
          correction: registraValidade ? correctionPreview(periodos, p, now, legado) : null,
        })),
        trial: {
          ...computeTrialWindow(establishment.createdAt),
          durationDays: TRIAL_DURATION_DAYS,
        },
        // Compatibilidade com o web anterior a este lote, que exige este campo
        // e mostra "Ainda não há registro financeiro nesta área": durante a
        // publicação (API nova, web anterior) a ficha precisa continuar
        // abrindo. Significa só que o financeiro da assinatura não vem por
        // este campo; a validade e os períodos vêm em `access` e
        // `accessPeriods`. Nunca leva valor nem pagamento.
        billing: { available: false as const },
      };
    });
  }
}
