// Preços da assinatura no portal da plataforma: catálogo mensal e trimestral
// por plano e valor contratado por cliente (ver
// docs/plans/portal-da-plataforma.md, seção 4).
//
// Regras comuns (as mesmas da validade do acesso):
// - só o proprietário da plataforma (`manageEstablishmentLifecycle`), com
//   senha confirmada há pouco NESTA sessão;
// - cada mudança é uma linha nova, nunca editada nem apagada: o histórico de
//   preços fica. A mudança e o histórico administrativo entram na mesma
//   transação;
// - a chave do formulário (`requestKey`) é única por quem registrou: repetir
//   a mesma requisição devolve a linha já gravada; a mesma chave com outro
//   conteúdo é recusada;
// - nada aqui registra pagamento nem mexe em período: mudar catálogo ou
//   contrato nunca recalcula o que já foi registrado.
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { loadActor, type Actor } from '../accounts/actor.js';
import { recordAudit } from '../accounts/audit.js';
import { isUniqueViolation } from '../auth/unique-violation.js';
import { generateId } from '../entities/common/generate-id.js';
import type { BillingCycle } from '../commercial/access-periods.js';
import { BILLING_CYCLES, cyclePricing, type CyclePricing } from '../commercial/pricing.js';
import { lifecycleActor, lockEstablishment, writeEstablishment } from './establishment-admin.service.js';
import { conflito, reais } from './access-validity.service.js';
import type { CatalogPriceDto, ContractPriceDto, SubscriptionPaymentsQuery } from './platform.dto.js';
import { subscriptionPaymentWhere } from './platform.queries.js';

export const CICLO = { MONTHLY: 'mensal', QUARTERLY: 'trimestral' } as const;

export interface PriceChangeView {
  id: string;
  planId: string;
  planName: string;
  cycle: BillingCycle;
  amountCents: number | null;
  reason: string | null;
  recordedAt: string;
  recordedBy: { id: string; name: string };
}

interface PriceRow {
  id: string;
  plan_id: string;
  plan_name: string;
  billing_cycle: BillingCycle;
  amount_cents: number | null;
  reason: string | null;
  recorded_at: Date;
  recorded_by_user_id: string;
  recorded_by_name: string;
  request_key?: string | null;
  tenant_id?: string;
  access_period_id?: string | null;
}

const toChange = (l: PriceRow): PriceChangeView => ({
  id: l.id,
  planId: l.plan_id,
  planName: l.plan_name,
  cycle: l.billing_cycle,
  amountCents: l.amount_cents === null ? null : Number(l.amount_cents),
  reason: l.reason,
  recordedAt: new Date(l.recorded_at).toISOString(),
  recordedBy: { id: l.recorded_by_user_id, name: l.recorded_by_name },
});

const CATALOG_SELECT = `SELECT pp.id, pp.plan_id, p.name AS plan_name, pp.billing_cycle::text AS billing_cycle, pp.amount_cents,
    pp.reason, pp.recorded_at, pp.recorded_by_user_id, u.name AS recorded_by_name, pp.request_key
  FROM plan_prices pp JOIN plans p ON p.id = pp.plan_id JOIN users u ON u.id = pp.recorded_by_user_id`;

const CONTRACT_SELECT = `SELECT cp.id, cp.tenant_id, cp.plan_id, p.name AS plan_name, cp.billing_cycle::text AS billing_cycle,
    cp.amount_cents, cp.reason, cp.recorded_at, cp.recorded_by_user_id, u.name AS recorded_by_name, cp.request_key,
    cp.access_period_id
  FROM tenant_contract_prices cp JOIN plans p ON p.id = cp.plan_id JOIN users u ON u.id = cp.recorded_by_user_id`;

/** Preço do catálogo em vigor (a linha mais recente); `null`: pendente. */
export async function currentCatalogPrice(
  manager: EntityManager,
  planId: string,
  cycle: BillingCycle,
): Promise<number | null> {
  const [linha] = await manager.query<{ amount_cents: number }[]>(
    `SELECT amount_cents FROM plan_prices WHERE plan_id = $1 AND billing_cycle = $2::billing_cycle
      ORDER BY recorded_at DESC, id DESC LIMIT 1`,
    [planId, cycle],
  );
  return linha ? Number(linha.amount_cents) : null;
}

/** Valor contratado em vigor para este cliente, plano e ciclo; `null`:
 * segue o catálogo (sem linha, ou a última linha sem valor específico). */
export async function currentContractPrice(
  manager: EntityManager,
  tenantId: string,
  planId: string,
  cycle: BillingCycle,
): Promise<number | null> {
  const [linha] = await manager.query<{ amount_cents: number | null }[]>(
    `SELECT amount_cents FROM tenant_contract_prices WHERE tenant_id = $1 AND plan_id = $2 AND billing_cycle = $3::billing_cycle
      ORDER BY recorded_at DESC, id DESC LIMIT 1`,
    [tenantId, planId, cycle],
  );
  return linha?.amount_cents === null || linha?.amount_cents === undefined ? null : Number(linha.amount_cents);
}

export async function pricingFor(
  manager: EntityManager,
  tenantId: string,
  planId: string,
  cycle: BillingCycle,
): Promise<CyclePricing> {
  return cyclePricing(
    cycle,
    await currentCatalogPrice(manager, planId, cycle),
    await currentContractPrice(manager, tenantId, planId, cycle),
  );
}

export interface TenantPricing {
  planId: string;
  /** Ciclo combinado por último com o cliente (contrato) ou o do último
   * pagamento; `null` se nada foi combinado. */
  preferredCycle: BillingCycle | null;
  cycles: CyclePricing[];
  contractHistory: PriceChangeView[];
}

/** O que a ficha mostra e o formulário "Registrar pagamento" preenche. */
export async function tenantPricing(manager: EntityManager, tenantId: string, planId: string): Promise<TenantPricing> {
  const cycles: CyclePricing[] = [];
  for (const cycle of BILLING_CYCLES) cycles.push(await pricingFor(manager, tenantId, planId, cycle));
  const [contrato] = await manager.query<{ billing_cycle: BillingCycle }[]>(
    `SELECT billing_cycle::text AS billing_cycle FROM tenant_contract_prices WHERE tenant_id = $1 AND plan_id = $2
      ORDER BY recorded_at DESC, id DESC LIMIT 1`,
    [tenantId, planId],
  );
  const [pago] = contrato
    ? []
    : await manager.query<{ billing_cycle: BillingCycle }[]>(
        `SELECT billing_cycle::text AS billing_cycle FROM tenant_access_periods
          WHERE tenant_id = $1 AND kind = 'PAID' AND canceled_at IS NULL ORDER BY starts_at DESC, id DESC LIMIT 1`,
        [tenantId],
      );
  const historico = await manager.query<PriceRow[]>(
    `${CONTRACT_SELECT} WHERE cp.tenant_id = $1 ORDER BY cp.recorded_at DESC, cp.id DESC LIMIT 50`,
    [tenantId],
  );
  return {
    planId,
    preferredCycle: contrato?.billing_cycle ?? pago?.billing_cycle ?? null,
    cycles,
    contractHistory: historico.map(toChange),
  };
}

/** Grava uma linha de contrato (já autorizado e dentro da transação). */
export async function insertContractPrice(
  manager: EntityManager,
  linha: {
    tenantId: string;
    planId: string;
    cycle: BillingCycle;
    amountCents: number | null;
    reason: string | null;
    accessPeriodId: string | null;
    requestKey: string | null;
    actorId: string;
    now: Date;
  },
): Promise<string> {
  const id = generateId();
  await manager.query(
    `INSERT INTO tenant_contract_prices
       (id, tenant_id, plan_id, billing_cycle, amount_cents, reason, access_period_id, recorded_at, recorded_by_user_id, request_key)
     VALUES ($1, $2, $3, $4::billing_cycle, $5, $6, $7, $8, $9, $10)`,
    [
      id,
      linha.tenantId,
      linha.planId,
      linha.cycle,
      linha.amountCents,
      linha.reason,
      linha.accessPeriodId,
      linha.now,
      linha.actorId,
      linha.requestKey,
    ],
  );
  return id;
}

export const valorOuCatalogo = (centavos: number | null) => (centavos === null ? 'preço do catálogo' : reais(centavos));

@Injectable()
export class PricingService {
  constructor(private readonly dataSource: DataSource) {}

  private read<T>(actorId: string, operation: (manager: EntityManager, actor: Actor) => Promise<T>): Promise<T> {
    return this.dataSource.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');
      const actor = await loadActor(manager, actorId);
      if (!actor.caps.viewDirectory) throw new ForbiddenException('Sem acesso à administração da plataforma.');
      return operation(manager, actor);
    });
  }

  /** Catálogo: cada plano com o preço em vigor de cada ciclo (ou pendente)
   * e as últimas mudanças. */
  catalog(actorId: string) {
    return this.read(actorId, async (manager, actor) => {
      const planos = await manager.query<{ id: string; code: string; name: string; maxProfessionals: number }[]>(
        `SELECT id, code, name, max_professionals AS "maxProfessionals" FROM plans ORDER BY max_professionals, name, id`,
      );
      const items = [];
      for (const plano of planos) {
        const prices = [];
        for (const cycle of BILLING_CYCLES) {
          const [linha] = await manager.query<PriceRow[]>(
            `${CATALOG_SELECT} WHERE pp.plan_id = $1 AND pp.billing_cycle = $2::billing_cycle
              ORDER BY pp.recorded_at DESC, pp.id DESC LIMIT 1`,
            [plano.id, cycle],
          );
          prices.push({ cycle, current: linha ? toChange(linha) : null });
        }
        items.push({ ...plano, prices });
      }
      const historico = await manager.query<PriceRow[]>(`${CATALOG_SELECT} ORDER BY pp.recorded_at DESC, pp.id DESC LIMIT 100`);
      return {
        items,
        history: historico.map(toChange),
        canManage: actor.caps.manageEstablishmentLifecycle,
      };
    });
  }

  /** Novo preço do catálogo para um plano e ciclo. Vale para os próximos
   * registros que seguirem o catálogo; nada já registrado muda. */
  async setCatalogPrice(actorId: string, sessionId: string, planId: string, cycle: BillingCycle, dto: CatalogPriceDto, now = new Date()) {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const actor = await lifecycleActor(manager, actorId, sessionId, now);
        const repetida = await this.replayCatalog(manager, actor.id, dto.requestKey, planId, cycle, dto.amountCents);
        if (repetida) return repetida;
        const [plano] = await manager.query<{ id: string; name: string }[]>(
          'SELECT id, name FROM plans WHERE id = $1 FOR UPDATE',
          [planId],
        );
        if (!plano) throw new NotFoundException('Plano não encontrado no catálogo.');
        const atual = await currentCatalogPrice(manager, plano.id, cycle);
        if (atual !== dto.expectedCurrentCents) {
          throw conflito('ALTERADO_POR_OUTRA_TELA', 'O preço mudou desde que você abriu a tela. Recarregue e confira.');
        }
        if (atual === dto.amountCents) {
          throw conflito('PRECO_IGUAL', 'Este já é o preço em vigor.');
        }
        const id = generateId();
        await manager.query(
          `INSERT INTO plan_prices (id, plan_id, billing_cycle, amount_cents, reason, recorded_at, recorded_by_user_id, request_key)
           VALUES ($1, $2, $3::billing_cycle, $4, $5, $6, $7, $8)`,
          [id, plano.id, cycle, dto.amountCents, dto.reason ?? null, now, actor.id, dto.requestKey],
        );
        await recordAudit(
          manager,
          {
            action: 'PLAN_PRICE_CHANGED',
            actor,
            summary:
              `Preço ${CICLO[cycle]} do plano ${plano.name} no catálogo: ` +
              `${atual === null ? 'pendente' : reais(atual)} para ${reais(dto.amountCents)}. ` +
              'Períodos e pagamentos já registrados não mudam.',
            previousData: { planId: plano.id, cycle, amountCents: atual },
            newData: { planId: plano.id, cycle, amountCents: dto.amountCents, reason: dto.reason ?? null },
          },
          now,
        );
        const [linha] = await manager.query<PriceRow[]>(`${CATALOG_SELECT} WHERE pp.id = $1`, [id]);
        return { created: true, price: toChange(linha) };
      });
    } catch (erro) {
      if (isUniqueViolation(erro, 'uq_plan_prices_request_key')) {
        const repetida = await this.replayCatalog(this.dataSource.manager, actorId, dto.requestKey, planId, cycle, dto.amountCents);
        if (repetida) return repetida;
      }
      throw erro;
    }
  }

  /** Valor contratado com um cliente para o plano atual dele, num ciclo.
   * `amountCents: null` volta a seguir o catálogo. Não registra pagamento. */
  async setContractPrice(actorId: string, sessionId: string, tenantId: string, dto: ContractPriceDto, now = new Date()) {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const actor = await lifecycleActor(manager, actorId, sessionId, now);
        const repetida = await this.replayContract(manager, actor.id, dto.requestKey, tenantId, dto);
        if (repetida) return repetida;
        const atual = await lockEstablishment(manager, tenantId, dto.expectedUpdatedAt);
        if (atual.status === 'ARCHIVED') {
          throw conflito('ESTABELECIMENTO_ARQUIVADO', 'Estabelecimento arquivado: reative antes de mudar o contrato.');
        }
        const anterior = await currentContractPrice(manager, atual.id, atual.plan_id, dto.cycle);
        if (anterior === dto.amountCents) {
          throw conflito('PRECO_IGUAL', 'Este já é o valor contratado em vigor.');
        }
        const [plano] = await manager.query<{ name: string }[]>('SELECT name FROM plans WHERE id = $1', [atual.plan_id]);
        const id = await insertContractPrice(manager, {
          tenantId: atual.id,
          planId: atual.plan_id,
          cycle: dto.cycle,
          amountCents: dto.amountCents,
          reason: dto.reason,
          accessPeriodId: null,
          requestKey: dto.requestKey,
          actorId: actor.id,
          now,
        });
        const versao = await writeEstablishment(manager, atual.id, now, 'status = status', []);
        await recordAudit(
          manager,
          {
            action: 'CONTRACT_PRICE_CHANGED',
            actor,
            tenantId: atual.id,
            summary:
              `Valor contratado ${CICLO[dto.cycle]} de ${atual.name} (plano ${plano?.name ?? atual.plan_id}): ` +
              `${valorOuCatalogo(anterior)} para ${valorOuCatalogo(dto.amountCents)}, nas próximas renovações. ` +
              `Nenhum pagamento registrado. Motivo: ${dto.reason}`,
            previousData: { planId: atual.plan_id, cycle: dto.cycle, amountCents: anterior },
            newData: { planId: atual.plan_id, cycle: dto.cycle, amountCents: dto.amountCents, reason: dto.reason },
          },
          now,
        );
        const [linha] = await manager.query<PriceRow[]>(`${CONTRACT_SELECT} WHERE cp.id = $1`, [id]);
        return { created: true, updatedAt: versao, contract: toChange(linha) };
      });
    } catch (erro) {
      if (isUniqueViolation(erro, 'uq_tenant_contract_prices_request_key')) {
        const repetida = await this.replayContract(this.dataSource.manager, actorId, dto.requestKey, tenantId, dto);
        if (repetida) return repetida;
      }
      throw erro;
    }
  }

  /** Pagamentos das assinaturas (períodos pagos), do mais recente ao mais
   * antigo, com os anulados marcados. Filtros opcionais de data de
   * recebimento, alcance e situação, pela MESMA regra da Visão geral e do
   * relatório (`subscriptionPaymentWhere`); contagem e página usam o mesmo
   * WHERE. Nunca inclui recebimentos dos atendimentos. */
  subscriptionPayments(actorId: string, query: SubscriptionPaymentsQuery) {
    return this.read(actorId, async (manager) => {
      const scope = query.scope ?? 'ALL';
      const periodo = query.from && query.to ? { from: query.from, to: query.to } : null;
      const filtro = subscriptionPaymentWhere({ tenantId: query.tenantId, ...periodo, scope, status: query.status });
      const where = filtro.sql;
      const valores = filtro.values;
      const [contagem] = await manager.query<{ total: number }[]>(
        `SELECT count(*)::int AS total FROM tenant_access_periods ap JOIN tenants t ON t.id = ap.tenant_id ${where}`,
        valores,
      );
      const itens = await manager.query<
        {
          id: string;
          tenant_id: string;
          tenant_name: string;
          plan_name: string;
          billing_cycle: BillingCycle;
          contracted_price_cents: number;
          amount_source: string | null;
          payment_method: string;
          payment_received_on: string;
          payment_reference: string | null;
          starts_at: Date;
          ends_at: Date;
          timezone: string;
          recorded_at: Date;
          recorded_by_name: string;
          canceled_at: Date | null;
          cancel_reason: string | null;
        }[]
      >(
        `SELECT ap.id, ap.tenant_id, COALESCE(un.name, t.slug::text) AS tenant_name, p.name AS plan_name,
                ap.billing_cycle::text AS billing_cycle, ap.contracted_price_cents, ap.amount_source, ap.payment_method,
                to_char(ap.payment_received_on, 'YYYY-MM-DD') AS payment_received_on, ap.payment_reference,
                ap.starts_at, ap.ends_at, t.timezone, ap.recorded_at, u.name AS recorded_by_name, ap.canceled_at, ap.cancel_reason
           FROM tenant_access_periods ap
           JOIN tenants t ON t.id = ap.tenant_id
           JOIN plans p ON p.id = ap.plan_id
           JOIN users u ON u.id = ap.recorded_by_user_id
           LEFT JOIN LATERAL (
             SELECT name FROM units WHERE tenant_id = t.id AND is_primary = true ORDER BY created_at, id LIMIT 1
           ) un ON true
           ${where}
          ORDER BY ap.payment_received_on DESC, ap.recorded_at DESC, ap.id DESC
          LIMIT $${valores.length + 1} OFFSET $${valores.length + 2}`,
        [...valores, query.pageSize, (query.page - 1) * query.pageSize],
      );
      return {
        items: itens.map((l) => ({
          id: l.id,
          tenant: { id: l.tenant_id, name: l.tenant_name },
          planName: l.plan_name,
          cycle: l.billing_cycle,
          amountCents: Number(l.contracted_price_cents),
          amountSource: l.amount_source,
          paymentMethod: l.payment_method,
          receivedOn: l.payment_received_on,
          reference: l.payment_reference,
          startsAt: new Date(l.starts_at).toISOString(),
          endsAt: new Date(l.ends_at).toISOString(),
          recordedAt: new Date(l.recorded_at).toISOString(),
          recordedBy: l.recorded_by_name,
          canceled: l.canceled_at ? { at: new Date(l.canceled_at).toISOString(), reason: l.cancel_reason } : null,
        })),
        total: contagem.total,
        page: query.page,
        pageSize: query.pageSize,
        /** Filtros aplicados a `items` e `total`. `null`: sem restrição. A
         * tela só afirma um filtro quando ele vem aqui. */
        from: periodo?.from ?? null,
        to: periodo?.to ?? null,
        scope,
        status: query.status ?? null,
      };
    });
  }

  private async replayCatalog(
    manager: EntityManager,
    actorId: string,
    requestKey: string,
    planId: string,
    cycle: BillingCycle,
    amountCents: number,
  ) {
    const [linha] = await manager.query<PriceRow[]>(
      `${CATALOG_SELECT} WHERE pp.recorded_by_user_id = $1 AND pp.request_key = $2`,
      [actorId, requestKey],
    );
    if (!linha) return null;
    if (linha.plan_id !== planId || linha.billing_cycle !== cycle || Number(linha.amount_cents) !== amountCents) {
      throw conflito('CHAVE_REUTILIZADA', 'Este formulário já foi usado para outro registro. Recarregue a tela.');
    }
    return { created: false, price: toChange(linha) };
  }

  private async replayContract(manager: EntityManager, actorId: string, requestKey: string, tenantId: string, dto: ContractPriceDto) {
    const [linha] = await manager.query<PriceRow[]>(
      `${CONTRACT_SELECT} WHERE cp.recorded_by_user_id = $1 AND cp.request_key = $2`,
      [actorId, requestKey],
    );
    if (!linha) return null;
    const valor = linha.amount_cents === null ? null : Number(linha.amount_cents);
    if (linha.tenant_id !== tenantId || linha.billing_cycle !== dto.cycle || valor !== dto.amountCents) {
      throw conflito('CHAVE_REUTILIZADA', 'Este formulário já foi usado para outro registro. Recarregue a tela.');
    }
    return { created: false, updatedAt: null, contract: toChange(linha) };
  }
}
