// Assinatura modular de um estabelecimento e limite de usuários da equipe
// (docs/plans/assinatura-modular-e-limite-equipe.md).
//
// Regras:
// - só o proprietário da plataforma (`manageEstablishmentLifecycle`), com
//   senha confirmada há pouco nesta sessão (`lifecycleActor`);
// - cada alteração é uma VERSÃO nova (append-only) com instantâneo dos preços
//   do catálogo; mudar o catálogo nunca reajusta contrato existente;
// - vigência imediata, sem cobrança retroativa nem proporcional: a versão só
//   define o valor recorrente dos próximos períodos registrados; períodos e
//   pagamentos já registrados nunca mudam;
// - a liberação dos adicionais é a de sempre (`tenant_feature_overrides`),
//   gravada na MESMA transação da versão; overrides de outros recursos ficam
//   intactos;
// - o limite nunca fica abaixo do que está ocupado ou reservado, e nada é
//   desativado para caber;
// - a trava do estabelecimento é a mesma das vagas (`FOR NO KEY UPDATE`):
//   convite, criação de acesso ou reativação em paralelo ficam em fila.
//
// Estabelecimento no plano anterior: continua como está até a conversão
// explícita (primeira versão). Contrato ou período trimestral exige
// `cycleChange` confirmado: o período pago segue válido até o fim, e o
// contrato anterior fica no histórico, ligado ao plano anterior.
import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { loadActor, type Actor } from '../accounts/actor.js';
import { recordAudit } from '../accounts/audit.js';
import { isUniqueViolation } from '../auth/unique-violation.js';
import { featureEnabled } from '../commercial/commercial-gate.js';
import {
  currentBasePrice,
  ensureModularPlan,
  loadAddonCatalog,
  loadEssential,
  MODULAR_PLAN_ID,
  modularRefusal,
  type AddonModule,
} from '../commercial/modular-plan.js';
import {
  assertLimitCoversUsage,
  quoteSubscription,
  SubscriptionRuleError,
  subscriptionDiff,
  type SubscriptionChoice,
  type SubscriptionQuote,
} from '../commercial/subscription.js';
import { generateId } from '../entities/common/generate-id.js';
import type { FeatureKey } from '../entities/enums/feature-key.enum.js';
import { staffSeatUsage, unitsCount } from '../team/seats.js';
import { reais } from './access-validity.service.js';
import { lifecycleActor, lockEstablishment, writeEstablishment } from './establishment-admin.service.js';
import { insertContractPrice } from './pricing.service.js';
import type { AddonPriceDto, ChangeSubscriptionDto, TeamLimitDto } from './platform.dto.js';

const conflito = (code: string, message: string, extra: Record<string, unknown> = {}) =>
  new ConflictException({ code, message, ...extra });

const regra = (erro: unknown): never => {
  if (erro instanceof SubscriptionRuleError) {
    throw new ConflictException({ code: erro.code, message: erro.message, ...erro.details });
  }
  throw erro;
};

interface VersionRow {
  id: string;
  version: number;
  effective_at: Date;
  base_catalog_cents: number;
  catalog_total_cents: number;
  contracted_total_cents: number;
  reason: string | null;
  team_user_limit: number;
  previous_contract: Record<string, unknown> | null;
  recorded_at: Date;
  recorded_by_name: string;
  items: { code: string; name: string; catalogPriceCents: number }[];
}

export interface SubscriptionVersionView {
  id: string;
  version: number;
  effectiveAt: string;
  baseCatalogCents: number;
  catalogTotalCents: number;
  contractedTotalCents: number;
  negotiated: boolean;
  reason: string | null;
  teamUserLimit: number;
  previousContract: Record<string, unknown> | null;
  recordedAt: string;
  recordedBy: string;
  items: { code: string; name: string; catalogPriceCents: number }[];
}

const VERSIONS_SQL = `SELECT s.id, s.version, s.effective_at, s.base_catalog_cents, s.catalog_total_cents, s.contracted_total_cents,
    s.reason, s.team_user_limit, s.previous_contract, s.recorded_at, u.name AS recorded_by_name,
    COALESCE((SELECT json_agg(json_build_object('code', i.module_code, 'name', m.name, 'catalogPriceCents', i.catalog_price_cents)
                ORDER BY m.sort_order, i.module_code)
              FROM tenant_subscription_items i JOIN addon_modules m ON m.code = i.module_code
             WHERE i.subscription_id = s.id), '[]'::json) AS items
  FROM tenant_subscriptions s JOIN users u ON u.id = s.recorded_by_user_id
 WHERE s.tenant_id = $1`;

const toVersion = (l: VersionRow): SubscriptionVersionView => ({
  id: l.id,
  version: Number(l.version),
  effectiveAt: new Date(l.effective_at).toISOString(),
  baseCatalogCents: Number(l.base_catalog_cents),
  catalogTotalCents: Number(l.catalog_total_cents),
  contractedTotalCents: Number(l.contracted_total_cents),
  negotiated: Number(l.contracted_total_cents) !== Number(l.catalog_total_cents),
  reason: l.reason,
  teamUserLimit: Number(l.team_user_limit),
  previousContract: l.previous_contract,
  recordedAt: new Date(l.recorded_at).toISOString(),
  recordedBy: l.recorded_by_name,
  items: l.items.map((i) => ({ ...i, catalogPriceCents: Number(i.catalogPriceCents) })),
});

export async function listSubscriptionVersions(manager: EntityManager, tenantId: string): Promise<SubscriptionVersionView[]> {
  const linhas = await manager.query<VersionRow[]>(`${VERSIONS_SQL} ORDER BY s.version DESC LIMIT 50`, [tenantId]);
  return linhas.map(toVersion);
}

async function currentVersion(manager: EntityManager, tenantId: string): Promise<SubscriptionVersionView | null> {
  const [linha] = await manager.query<VersionRow[]>(`${VERSIONS_SQL} ORDER BY s.version DESC LIMIT 1`, [tenantId]);
  return linha ? toVersion(linha) : null;
}

/** Adicionais cujo recurso está liberado hoje (plano + overrides). */
async function enabledAddons(manager: EntityManager, tenantId: string, catalog: readonly AddonModule[]): Promise<string[]> {
  const ligados: string[] = [];
  for (const m of catalog) {
    if (m.featureKey && (await featureEnabled(manager, tenantId, m.featureKey as FeatureKey))) ligados.push(m.code);
  }
  return ligados;
}

export interface PreviousContract {
  planId: string;
  contractCycle: string | null;
  contractCents: number | null;
  lastPaidCycle: string | null;
  lastPaidCents: number | null;
  paidUntil: string | null;
}

/** Contrato e último período pago no plano anterior (para a conversão). */
async function previousContract(manager: EntityManager, tenantId: string, planId: string): Promise<PreviousContract> {
  const [contrato] = await manager.query<{ billing_cycle: string; amount_cents: number | null }[]>(
    `SELECT billing_cycle::text AS billing_cycle, amount_cents FROM tenant_contract_prices
      WHERE tenant_id = $1 AND plan_id = $2 ORDER BY recorded_at DESC, id DESC LIMIT 1`,
    [tenantId, planId],
  );
  const [pago] = await manager.query<{ billing_cycle: string; contracted_price_cents: number; ends_at: Date }[]>(
    `SELECT billing_cycle::text AS billing_cycle, contracted_price_cents, ends_at FROM tenant_access_periods
      WHERE tenant_id = $1 AND kind = 'PAID' AND canceled_at IS NULL ORDER BY starts_at DESC, id DESC LIMIT 1`,
    [tenantId],
  );
  return {
    planId,
    contractCycle: contrato?.billing_cycle ?? null,
    contractCents: contrato?.amount_cents === null || contrato?.amount_cents === undefined ? null : Number(contrato.amount_cents),
    lastPaidCycle: pago?.billing_cycle ?? null,
    lastPaidCents: pago ? Number(pago.contracted_price_cents) : null,
    paidUntil: pago ? new Date(pago.ends_at).toISOString() : null,
  };
}

const isQuarterly = (c: PreviousContract) => c.contractCycle === 'QUARTERLY' || c.lastPaidCycle === 'QUARTERLY';

export interface WriteSubscriptionInput {
  actor: Actor;
  tenant: { id: string; name: string; plan_id: string };
  choice: SubscriptionChoice;
  requestKey: string;
  confirmRemoval?: boolean;
  cycleChange?: { from: 'QUARTERLY'; acknowledged: true };
  /** Estabelecimento acabou de ser criado nesta transação. */
  creation: boolean;
  now: Date;
}

export interface WrittenSubscription {
  subscriptionId: string;
  version: number;
  quote: SubscriptionQuote;
  updatedAt: Date;
}

/** Grava uma versão da assinatura (já autorizado, estabelecimento travado,
 * dentro da transação). Usado pela criação e pela alteração. */
export async function writeSubscriptionVersion(
  manager: EntityManager,
  input: WriteSubscriptionInput,
): Promise<WrittenSubscription> {
  const { actor, tenant, choice, now } = input;
  await ensureModularPlan(manager);
  const catalog = await loadAddonCatalog(manager);
  const essencial = await loadEssential(manager);
  let quote: SubscriptionQuote;
  try {
    quote = quoteSubscription(essencial.priceCents, catalog, choice, essencial.name);
    assertLimitCoversUsage(choice.teamUserLimit, await staffSeatUsage(manager, tenant.id, choice.teamUserLimit, now));
  } catch (erro) {
    return regra(erro);
  }

  const anterior = input.creation ? null : await currentVersion(manager, tenant.id);
  const convertendo = !input.creation && tenant.plan_id !== MODULAR_PLAN_ID;
  let contratoAnterior: PreviousContract | null = null;

  if (!input.creation) {
    const ligados = await enabledAddons(manager, tenant.id, catalog);
    const escolhidos = new Set(quote.items.map((i) => i.code));
    const retirados = ligados.filter((c) => !escolhidos.has(c));
    if (retirados.length && input.confirmRemoval !== true) {
      throw conflito(
        'RECURSO_SERIA_RETIRADO',
        'Esta alteração retira recursos hoje liberados: ' +
          retirados.map((c) => catalog.find((m) => m.code === c)?.name ?? c).join(', ') +
          '. Confirme a retirada na revisão; o histórico desses recursos é preservado.',
        { modules: retirados },
      );
    }
  }

  if (convertendo) {
    const unidades = await unitsCount(manager, tenant.id);
    if (unidades > 1) {
      throw conflito(
        'PLANO_EXCEDIDO',
        `O estabelecimento tem ${unidades} unidades; a assinatura modular permite 1. Nada foi alterado.`,
      );
    }
    contratoAnterior = await previousContract(manager, tenant.id, tenant.plan_id);
    if (isQuarterly(contratoAnterior) && input.cycleChange?.acknowledged !== true) {
      throw conflito(
        'CONVERSAO_DE_CICLO',
        'Este estabelecimento tem contrato ou pagamento trimestral. Confirme a troca para a assinatura mensal: ' +
          'o período já pago continua válido até o fim, sem estorno nem cobrança proporcional.',
        { previousContract: contratoAnterior },
      );
    }
  }

  const versao = (anterior?.version ?? 0) + 1;
  const subscriptionId = generateId();
  await manager.query(
    `INSERT INTO tenant_subscriptions
       (id, tenant_id, version, effective_at, base_catalog_cents, catalog_total_cents, contracted_total_cents, reason,
        team_user_limit, previous_contract, recorded_at, recorded_by_user_id, request_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $4, $11, $12)`,
    [
      subscriptionId,
      tenant.id,
      versao,
      now,
      quote.baseCents,
      quote.catalogTotalCents,
      quote.contractedTotalCents,
      quote.reason,
      quote.teamUserLimit,
      contratoAnterior ? JSON.stringify(contratoAnterior) : null,
      actor.id,
      input.requestKey,
    ],
  );
  for (const item of quote.items) {
    await manager.query(
      `INSERT INTO tenant_subscription_items (id, subscription_id, module_code, catalog_price_cents) VALUES ($1, $2, $3, $4)`,
      [generateId(), subscriptionId, item.code, item.priceCents],
    );
  }

  const updatedAt = await writeEstablishment(manager, tenant.id, now, 'plan_id = $3, team_user_limit = $4', [
    MODULAR_PLAN_ID,
    quote.teamUserLimit,
  ]);

  // Só os recursos dos adicionais: os demais overrides ficam intactos.
  const escolhidos = new Set(quote.items.map((i) => i.code));
  for (const m of catalog) {
    if (!m.featureKey) continue;
    if (escolhidos.has(m.code)) {
      await manager.query(
        `INSERT INTO tenant_feature_overrides (id, tenant_id, feature_id, enabled)
         SELECT $1, $2, f.id, true FROM features f WHERE f.key::text = $3
         ON CONFLICT (tenant_id, feature_id) DO UPDATE SET enabled = true`,
        [generateId(), tenant.id, m.featureKey],
      );
    } else {
      await manager.query(
        `DELETE FROM tenant_feature_overrides o USING features f
          WHERE o.tenant_id = $1 AND o.feature_id = f.id AND f.key::text = $2`,
        [tenant.id, m.featureKey],
      );
    }
  }

  // Contrato mensal para a sugestão de valor do próximo período pago
  // (commercial/pricing.ts: contrato > catálogo).
  await insertContractPrice(manager, {
    tenantId: tenant.id,
    planId: MODULAR_PLAN_ID,
    cycle: 'MONTHLY',
    amountCents: quote.contractedTotalCents,
    reason: quote.reason ?? `Assinatura modular, versão ${versao}.`,
    accessPeriodId: null,
    // Mesma chave do formulário da assinatura (origem exigida pela tabela).
    requestKey: input.requestKey,
    actorId: actor.id,
    now,
  });

  const diff = subscriptionDiff(
    anterior
      ? { addons: anterior.items.map((i) => i.code), contractedTotalCents: anterior.contractedTotalCents, teamUserLimit: anterior.teamUserLimit }
      : null,
    { addons: quote.items.map((i) => i.code), contractedTotalCents: quote.contractedTotalCents, teamUserLimit: quote.teamUserLimit },
  );
  const nomes = quote.items.map((i) => i.name);
  await recordAudit(
    manager,
    {
      action: 'SUBSCRIPTION_CHANGED',
      actor,
      tenantId: tenant.id,
      summary:
        `Assinatura de ${tenant.name}, versão ${versao}` +
        (input.creation ? ' (criação)' : convertendo ? ' (conversão do plano anterior)' : '') +
        `: ${essencial.name}${nomes.length ? ` + ${nomes.join(', ')}` : ''}, ` +
        `${reais(quote.contractedTotalCents)}/mês` +
        (quote.negotiated ? ` (catálogo ${reais(quote.catalogTotalCents)}; motivo: ${quote.reason})` : '') +
        `, limite de ${quote.teamUserLimit} usuário(s) da equipe. ` +
        'Vale a partir de agora para os próximos períodos; sem cobrança retroativa nem proporcional.',
      previousData: anterior
        ? {
            version: anterior.version,
            addons: anterior.items.map((i) => i.code),
            contractedTotalCents: anterior.contractedTotalCents,
            teamUserLimit: anterior.teamUserLimit,
          }
        : contratoAnterior
          ? { previousContract: contratoAnterior }
          : null,
      newData: {
        version: versao,
        addons: quote.items.map((i) => i.code),
        baseCatalogCents: quote.baseCents,
        catalogTotalCents: quote.catalogTotalCents,
        contractedTotalCents: quote.contractedTotalCents,
        reason: quote.reason,
        teamUserLimit: quote.teamUserLimit,
        added: diff.added,
        removed: diff.removed,
        cycleChange: input.cycleChange ? 'QUARTERLY_TO_MONTHLY' : null,
      },
    },
    now,
  );
  return { subscriptionId, version: versao, quote, updatedAt };
}

@Injectable()
export class SubscriptionService {
  constructor(private readonly dataSource: DataSource) {}

  private read<T>(actorId: string, operation: (manager: EntityManager, actor: Actor) => Promise<T>): Promise<T> {
    return this.dataSource.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');
      const actor = await loadActor(manager, actorId);
      if (!actor.caps.viewDirectory) throw new ForbiddenException('Sem acesso à administração da plataforma.');
      return operation(manager, actor);
    });
  }

  /** Catálogo: preço base, adicionais com disponibilidade e preço, e as
   * últimas mudanças de preço dos adicionais. */
  catalog(actorId: string) {
    return this.read(actorId, async (manager, actor) => ({
      basePriceCents: await currentBasePrice(manager),
      basePlanId: MODULAR_PLAN_ID,
      // Nome, descrição e preço atuais do essencial (editáveis aqui).
      essential: await loadEssential(manager),
      addons: await loadAddonCatalog(manager),
      history: (
        await manager.query<
          { id: string; module_code: string; name: string; amount_cents: number; reason: string | null; recorded_at: Date; recorded_by: string }[]
        >(
          `SELECT ap.id, ap.module_code, m.name, ap.amount_cents, ap.reason, ap.recorded_at, u.name AS recorded_by
             FROM addon_module_prices ap JOIN addon_modules m ON m.code = ap.module_code
             JOIN users u ON u.id = ap.recorded_by_user_id
            ORDER BY ap.recorded_at DESC, ap.id DESC LIMIT 100`,
        )
      ).map((l) => ({
        id: l.id,
        moduleCode: l.module_code,
        moduleName: l.name,
        amountCents: Number(l.amount_cents),
        reason: l.reason,
        recordedAt: new Date(l.recorded_at).toISOString(),
        recordedBy: l.recorded_by,
      })),
      canManage: actor.caps.manageEstablishmentLifecycle,
    }));
  }

  /** O que a aba "Plano e adicionais" mostra. */
  view(actorId: string, tenantId: string, now = new Date()) {
    return this.read(actorId, async (manager, actor) => {
      const [tenant] = await manager.query<
        { id: string; plan_id: string; plan_name: string; max_professionals: number | null; team_user_limit: number | null; updated_at: Date; status: string }[]
      >(
        `SELECT t.id, t.plan_id, p.name AS plan_name, p.max_professionals, t.team_user_limit, t.updated_at, t.status::text AS status
           FROM tenants t JOIN plans p ON p.id = t.plan_id WHERE t.id = $1`,
        [tenantId],
      );
      if (!tenant) throw new NotFoundException('Estabelecimento não encontrado.');
      const catalog = await loadAddonCatalog(manager);
      const limite = tenant.team_user_limit ?? tenant.max_professionals ?? 0;
      const modular = tenant.plan_id === MODULAR_PLAN_ID;
      const contrato = modular ? null : await previousContract(manager, tenantId, tenant.plan_id);
      return {
        tenantId,
        updatedAt: new Date(tenant.updated_at).toISOString(),
        status: tenant.status,
        modular,
        plan: { id: tenant.plan_id, name: tenant.plan_name, maxProfessionals: tenant.max_professionals },
        teamUserLimit: { value: Number(limite), source: tenant.team_user_limit === null ? 'PLAN' : 'TENANT' },
        seats: await staffSeatUsage(manager, tenantId, Number(limite), now),
        enabledAddons: await enabledAddons(manager, tenantId, catalog),
        current: await currentVersion(manager, tenantId),
        history: await listSubscriptionVersions(manager, tenantId),
        catalog: { basePriceCents: await currentBasePrice(manager), essential: await loadEssential(manager), addons: catalog },
        conversion: contrato ? { previousContract: contrato, requiresCycleChange: isQuarterly(contrato) } : null,
        canManage: actor.caps.manageEstablishmentLifecycle,
      };
    });
  }

  async change(actorId: string, sessionId: string, tenantId: string, dto: ChangeSubscriptionDto, now = new Date()) {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const actor = await lifecycleActor(manager, actorId, sessionId, now);
        const repetida = await this.replay(manager, actor.id, dto.requestKey, tenantId);
        if (repetida) return repetida;
        const atual = await lockEstablishment(manager, tenantId, dto.expectedUpdatedAt);
        if (atual.status === 'ARCHIVED') {
          throw conflito('ESTABELECIMENTO_ARQUIVADO', 'Estabelecimento arquivado: reative antes de mudar a assinatura.');
        }
        const gravada = await writeSubscriptionVersion(manager, {
          actor,
          tenant: { id: atual.id, name: atual.name, plan_id: atual.plan_id },
          choice: dto,
          requestKey: dto.requestKey,
          confirmRemoval: dto.confirmRemoval,
          cycleChange: dto.cycleChange,
          creation: false,
          now,
        });
        return {
          created: true,
          updatedAt: gravada.updatedAt.toISOString(),
          version: gravada.version,
          contractedTotalCents: gravada.quote.contractedTotalCents,
        };
      });
    } catch (erro) {
      if (isUniqueViolation(erro, 'uq_tenant_subscriptions_request_key')) {
        const repetida = await this.replay(this.dataSource.manager, actorId, dto.requestKey, tenantId);
        if (repetida) return repetida;
      }
      throw erro;
    }
  }

  private async replay(manager: EntityManager, actorId: string, requestKey: string, tenantId: string) {
    const [linha] = await manager.query<{ tenant_id: string; version: number; contracted_total_cents: number }[]>(
      `SELECT tenant_id, version, contracted_total_cents FROM tenant_subscriptions
        WHERE recorded_by_user_id = $1 AND request_key = $2`,
      [actorId, requestKey],
    );
    if (!linha) return null;
    if (linha.tenant_id !== tenantId) {
      throw conflito('CHAVE_REPETIDA', 'Este formulário já foi usado para outro estabelecimento. Recarregue a tela.');
    }
    const [t] = await manager.query<{ updated_at: Date }[]>('SELECT updated_at FROM tenants WHERE id = $1', [tenantId]);
    return {
      created: false,
      updatedAt: new Date(t.updated_at).toISOString(),
      version: Number(linha.version),
      contractedTotalCents: Number(linha.contracted_total_cents),
    };
  }

  /** Limite de usuários de um estabelecimento ainda no plano anterior. O
   * modular muda o limite pela assinatura (fica na versão). */
  async setTeamLimit(actorId: string, sessionId: string, tenantId: string, dto: TeamLimitDto, now = new Date()) {
    return this.dataSource.transaction(async (manager) => {
      const actor = await lifecycleActor(manager, actorId, sessionId, now);
      const atual = await lockEstablishment(manager, tenantId, dto.expectedUpdatedAt);
      if (atual.plan_id === MODULAR_PLAN_ID) throw modularRefusal();
      const [linha] = await manager.query<{ team_user_limit: number | null; max_professionals: number }[]>(
        `SELECT t.team_user_limit, p.max_professionals FROM tenants t JOIN plans p ON p.id = t.plan_id WHERE t.id = $1`,
        [atual.id],
      );
      if (linha.team_user_limit === dto.teamUserLimit) {
        return { updatedAt: new Date(atual.updated_at).toISOString(), teamUserLimit: dto.teamUserLimit };
      }
      try {
        assertLimitCoversUsage(dto.teamUserLimit, await staffSeatUsage(manager, atual.id, dto.teamUserLimit, now));
      } catch (erro) {
        regra(erro);
      }
      const versao = await writeEstablishment(manager, atual.id, now, 'team_user_limit = $3', [dto.teamUserLimit]);
      const antes = linha.team_user_limit ?? linha.max_professionals;
      await recordAudit(
        manager,
        {
          action: 'TEAM_LIMIT_CHANGED',
          actor,
          tenantId: atual.id,
          summary:
            `Limite de usuários da equipe de ${atual.name}: ${antes}` +
            (linha.team_user_limit === null ? ' (do plano)' : '') +
            ` para ${dto.teamUserLimit}. A mensalidade não muda.` +
            (dto.reason ? ` Motivo: ${dto.reason}` : ''),
          previousData: { teamUserLimit: linha.team_user_limit, planLimit: linha.max_professionals },
          newData: { teamUserLimit: dto.teamUserLimit, reason: dto.reason ?? null },
        },
        now,
      );
      return { updatedAt: versao.toISOString(), teamUserLimit: dto.teamUserLimit };
    });
  }

  /** Novo preço mensal de um adicional. Nenhuma assinatura existente muda:
   * cada versão guarda o preço da data. */
  async setAddonPrice(actorId: string, sessionId: string, code: string, dto: AddonPriceDto, now = new Date()) {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const actor = await lifecycleActor(manager, actorId, sessionId, now);
        const repetida = await this.replayAddonPrice(manager, actor.id, dto.requestKey, code, dto.amountCents);
        if (repetida) return repetida;
        const [modulo] = await manager.query<{ code: string; name: string }[]>(
          'SELECT code, name FROM addon_modules WHERE code = $1 FOR UPDATE',
          [code],
        );
        if (!modulo) throw new NotFoundException('Adicional não encontrado no catálogo.');
        const [atualRow] = await manager.query<{ amount_cents: number }[]>(
          `SELECT amount_cents FROM addon_module_prices WHERE module_code = $1 ORDER BY recorded_at DESC, id DESC LIMIT 1`,
          [code],
        );
        const atual = atualRow ? Number(atualRow.amount_cents) : null;
        if (atual !== dto.expectedCurrentCents) {
          throw conflito('ALTERADO_POR_OUTRA_TELA', 'O preço mudou desde que você abriu a tela. Recarregue e confira.');
        }
        if (atual === dto.amountCents) throw conflito('PRECO_IGUAL', 'Este já é o preço em vigor.');
        const id = generateId();
        await manager.query(
          `INSERT INTO addon_module_prices (id, module_code, amount_cents, reason, recorded_at, recorded_by_user_id, request_key)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [id, code, dto.amountCents, dto.reason ?? null, now, actor.id, dto.requestKey],
        );
        await recordAudit(
          manager,
          {
            action: 'ADDON_PRICE_CHANGED',
            actor,
            summary:
              `Preço mensal do adicional ${modulo.name} no catálogo: ` +
              `${atual === null ? 'pendente' : reais(atual)} para ${reais(dto.amountCents)}. ` +
              'Assinaturas já contratadas não mudam.',
            previousData: { module: code, amountCents: atual },
            newData: { module: code, amountCents: dto.amountCents, reason: dto.reason ?? null },
          },
          now,
        );
        return { created: true, moduleCode: code, amountCents: dto.amountCents };
      });
    } catch (erro) {
      if (isUniqueViolation(erro, 'uq_addon_module_prices_request_key')) {
        const repetida = await this.replayAddonPrice(this.dataSource.manager, actorId, dto.requestKey, code, dto.amountCents);
        if (repetida) return repetida;
      }
      throw erro;
    }
  }

  private async replayAddonPrice(manager: EntityManager, actorId: string, requestKey: string, code: string, amount: number) {
    const [linha] = await manager.query<{ module_code: string; amount_cents: number }[]>(
      'SELECT module_code, amount_cents FROM addon_module_prices WHERE recorded_by_user_id = $1 AND request_key = $2',
      [actorId, requestKey],
    );
    if (!linha) return null;
    if (linha.module_code !== code || Number(linha.amount_cents) !== amount) {
      throw conflito('CHAVE_REPETIDA', 'Este formulário já foi usado com outro conteúdo. Recarregue a tela.');
    }
    return { created: false, moduleCode: code, amountCents: amount };
  }
}
