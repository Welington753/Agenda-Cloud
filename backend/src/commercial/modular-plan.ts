// Plano modular ("Agendamento essencial") e catálogo de adicionais (ver
// docs/plans/assinatura-modular-e-limite-equipe.md).
//
// A linha do plano modular em `plans` NÃO vem da migration: nasce aqui, na
// primeira gravação de assinatura ou de preço base, dentro da transação de
// quem grava. Motivo: a API anterior lista `FROM plans` sem filtro e o web
// anterior recusa a lista inteira se algum `maxProfessionals` não for inteiro.
// Enquanto só a migration nova estiver aplicada (API anterior no ar), o
// plano não existe para ninguém. Depois, a API nova o tira das listas que o
// web anterior lê (`GET platform/plans`, catálogo de preços, troca de plano).
//
// Liberação de recurso continua sendo só `commercial-gate.ts`
// (`COALESCE(override, plan_features)`): o essencial está em `plan_features`
// do plano modular; cada adicional contratado é uma linha em
// `tenant_feature_overrides` com `enabled = true`, gravada pela assinatura.
import { ConflictException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { FeatureKey } from '../entities/enums/feature-key.enum.js';
import { MODULAR_PLAN_ID } from '../migrations/1793836800000-ModularSubscription.js';

export { MODULAR_PLAN_ID, MAX_TEAM_USER_LIMIT } from '../migrations/1793836800000-ModularSubscription.js';

export const MODULAR_SUBSCRIPTION_CODE = 'ASSINATURA_MODULAR';
export const MODULAR_SUBSCRIPTION_MESSAGE =
  'Este estabelecimento tem assinatura modular: altere plano, adicionais e valor em "Plano e adicionais".';
export const CYCLE_NOT_AVAILABLE_CODE = 'CICLO_NAO_DISPONIVEL';
export const CYCLE_NOT_AVAILABLE_MESSAGE = 'A assinatura modular é somente mensal.';

/** Recusa das rotas antigas (troca de plano, valor contratado, contrato pelo
 * pagamento) para estabelecimento modular. */
export function modularRefusal(): ConflictException {
  return new ConflictException({ code: MODULAR_SUBSCRIPTION_CODE, message: MODULAR_SUBSCRIPTION_MESSAGE });
}

export const MODULAR_PLAN_CODE = 'modular';
/** Nome e descrição com que a linha do plano nasce. Depois, os atuais vêm
 * de `plans` (editáveis em Planos e adicionais; ver `loadEssential`). */
export const MODULAR_PLAN_NAME = 'Agendamento essencial';
export const MODULAR_PLAN_DESCRIPTION =
  'Agenda, link de agendamento, profissionais, serviços, clientes, equipe e recebimentos.';

/** O que o essencial libera sozinho: agenda, link público, profissionais,
 * clientes, equipe (controlada pelo limite de usuários) e recebimentos
 * manuais. Serviços não têm recurso próprio (só a validade do acesso). */
export const MODULAR_BASE_FEATURES = [
  FeatureKey.AGENDA,
  FeatureKey.AGENDAMENTO_PUBLICO,
  FeatureKey.PROFISSIONAIS,
  FeatureKey.CONSUMIDORES,
  FeatureKey.EQUIPE,
  FeatureKey.PAGAMENTOS,
] as const;

const featureId = (key: FeatureKey) => `feat_${key.toLowerCase()}`;

/** Cria o plano modular se ainda não existir (idempotente; corre na
 * transação de quem chama). */
export async function ensureModularPlan(manager: EntityManager): Promise<void> {
  await manager.query(
    `INSERT INTO plans (id, code, name, price_cents, short_description, max_professionals, max_units)
     VALUES ($1, $2, $3, NULL, $4, NULL, 1)
     ON CONFLICT (id) DO NOTHING`,
    [
      MODULAR_PLAN_ID,
      MODULAR_PLAN_CODE,
      MODULAR_PLAN_NAME,
      MODULAR_PLAN_DESCRIPTION,
    ],
  );
  for (const key of MODULAR_BASE_FEATURES) {
    await manager.query(
      `INSERT INTO plan_features (id, plan_id, feature_id) VALUES ($1, $2, $3)
       ON CONFLICT (plan_id, feature_id) DO NOTHING`,
      [`pf_modular_${key.toLowerCase()}`, MODULAR_PLAN_ID, featureId(key)],
    );
  }
}

export type AddonAvailability = 'AVAILABLE' | 'IN_DEVELOPMENT' | 'PLANNED';

export interface AddonModule {
  code: string;
  name: string;
  description: string;
  featureKey: FeatureKey | null;
  availability: AddonAvailability;
  /** Preço mensal em vigor no catálogo; `null`: pendente. */
  priceCents: number | null;
}

export const ADDON_CATALOG_SQL = `SELECT m.code, m.name, m.description, m.feature_key AS "featureKey", m.availability,
    (SELECT ap.amount_cents FROM addon_module_prices ap WHERE ap.module_code = m.code
      ORDER BY ap.recorded_at DESC, ap.id DESC LIMIT 1) AS "priceCents"
  FROM addon_modules m ORDER BY m.sort_order, m.code`;

export async function loadAddonCatalog(manager: EntityManager): Promise<AddonModule[]> {
  const linhas = await manager.query<AddonModule[]>(ADDON_CATALOG_SQL);
  return linhas.map((l) => ({ ...l, priceCents: l.priceCents === null ? null : Number(l.priceCents) }));
}

/** Preço base mensal em vigor (`plan_prices` do plano modular); `null`:
 * pendente (inclusive antes de o plano existir). */
export async function currentBasePrice(manager: EntityManager): Promise<number | null> {
  const [linha] = await manager.query<{ amount_cents: number }[]>(
    `SELECT amount_cents FROM plan_prices WHERE plan_id = $1 AND billing_cycle = 'MONTHLY'
      ORDER BY recorded_at DESC, id DESC LIMIT 1`,
    [MODULAR_PLAN_ID],
  );
  return linha ? Number(linha.amount_cents) : null;
}

export interface EssentialItem {
  planId: string;
  name: string;
  description: string;
  /** Preço mensal padrão em vigor; `null`: pendente. */
  priceCents: number | null;
}

/** Agendamento essencial como o catálogo o mostra hoje: nome e descrição
 * atuais da linha do plano (ou os de nascimento, se ela ainda não existe) e
 * o preço padrão em vigor. */
export async function loadEssential(manager: EntityManager): Promise<EssentialItem> {
  const [plano] = await manager.query<{ name: string; short_description: string }[]>(
    'SELECT name, short_description FROM plans WHERE id = $1',
    [MODULAR_PLAN_ID],
  );
  return {
    planId: MODULAR_PLAN_ID,
    name: plano?.name ?? MODULAR_PLAN_NAME,
    description: plano?.short_description ?? MODULAR_PLAN_DESCRIPTION,
    priceCents: await currentBasePrice(manager),
  };
}
