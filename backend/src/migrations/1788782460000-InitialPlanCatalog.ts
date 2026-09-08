// Catálogo mínimo de planos/features (Lote 6B.2) — necessário antes do
// primeiro cadastro real: `tenants.plan_id` é FK NOT NULL RESTRICT para
// `plans` (ver entities/tenant.entity.ts), então um banco vazio sem nenhum
// plano bloqueia qualquer criação de tenant.
//
// Preços e descrições NÃO são inventados aqui — são os mesmos já aprovados e
// publicados no site comercial (`src/lib/planos.ts`, `DEFINICOES_PLANO`,
// mesclado no Lote 6A). Códigos (`essencial`/`equipe`/`pro`) também vêm de lá
// (`CodigoPlano` em src/lib/types.ts) — nomes diferentes ("Gestão"/"Rede")
// não existem no domínio atual e não foram criados por esta migration.
//
// IDs determinísticos (nunca `generateId()`/cuid2 aleatório) para que `up()`
// seja idempotente via `ON CONFLICT ... DO NOTHING` na chave de negócio real
// (`plans.code`, `features.key`, `plan_features.(plan_id, feature_id)`) e para
// que `down()` saiba exatamente quais linhas remover — nunca por CASCADE,
// nunca tocando em linha que esta migration não criou.
//
// `down()` nunca cria comportamento especial para "forçar" a remoção: se
// algum tenant já referenciar um destes planos, `DELETE FROM plans` falha
// naturalmente por `fk_tenants_plan` (ON DELETE RESTRICT, já definida na
// migration inicial) — a transação da migration inteira faz rollback, sem
// perda de dado nem exclusão parcial.
import type { MigrationInterface, QueryRunner } from 'typeorm';
import { FeatureKey } from '../entities/enums/feature-key.enum.js';

interface PlanRow {
  id: string;
  code: string;
  name: string;
  priceCents: number;
  shortDescription: string;
  maxProfessionals: number;
  maxUnits: number;
}

interface FeatureRow {
  id: string;
  key: FeatureKey;
  label: string;
}

interface PlanFeatureRow {
  id: string;
  planId: string;
  featureId: string;
}

// Mesmos 3 planos e mesmos valores de `DEFINICOES_PLANO` (src/lib/planos.ts).
export const PLAN_ROWS: readonly PlanRow[] = [
  {
    id: 'plan_essencial',
    code: 'essencial',
    name: 'Essencial',
    priceCents: 7900,
    shortDescription:
      'Agenda, agendamento público e serviços para um profissional só ou uma equipe pequena.',
    maxProfessionals: 2,
    maxUnits: 1,
  },
  {
    id: 'plan_equipe',
    code: 'equipe',
    name: 'Equipe',
    priceCents: 14900,
    shortDescription:
      'Tudo do Essencial, mais consumidores, relatórios básicos e gestão de equipe.',
    maxProfessionals: 5,
    maxUnits: 1,
  },
  {
    id: 'plan_pro',
    code: 'pro',
    name: 'Pro',
    priceCents: 24900,
    shortDescription:
      'Tudo do Equipe, mais unidades extras e personalização avançada. Alguns módulos aparecem como "em breve".',
    maxProfessionals: 20,
    maxUnits: 5,
  },
];

// Os 13 valores de FeatureKey (ver entities/enums/feature-key.enum.ts),
// mesmos rótulos de `ROTULO_FEATURE` (src/lib/planos.ts).
export const FEATURE_ROWS: readonly FeatureRow[] = [
  { id: 'feat_agenda', key: FeatureKey.AGENDA, label: 'Agenda' },
  { id: 'feat_agendamento_publico', key: FeatureKey.AGENDAMENTO_PUBLICO, label: 'Agendamento público' },
  { id: 'feat_profissionais', key: FeatureKey.PROFISSIONAIS, label: 'Cadastro de profissionais' },
  { id: 'feat_consumidores', key: FeatureKey.CONSUMIDORES, label: 'Cadastro de consumidores' },
  { id: 'feat_relatorios', key: FeatureKey.RELATORIOS, label: 'Relatórios' },
  { id: 'feat_equipe', key: FeatureKey.EQUIPE, label: 'Gestão de equipe' },
  { id: 'feat_personalizacao_avancada', key: FeatureKey.PERSONALIZACAO_AVANCADA, label: 'Personalização avançada' },
  { id: 'feat_multiplas_unidades', key: FeatureKey.MULTIPLAS_UNIDADES, label: 'Múltiplas unidades' },
  { id: 'feat_dominio_proprio', key: FeatureKey.DOMINIO_PROPRIO, label: 'Domínio próprio' },
  { id: 'feat_lista_de_espera', key: FeatureKey.LISTA_DE_ESPERA, label: 'Lista de espera' },
  { id: 'feat_comissoes', key: FeatureKey.COMISSOES, label: 'Comissões' },
  { id: 'feat_pagamentos', key: FeatureKey.PAGAMENTOS, label: 'Pagamentos' },
  { id: 'feat_assinaturas', key: FeatureKey.ASSINATURAS, label: 'Assinaturas' },
];

const FEATURE_ID_BY_KEY: ReadonlyMap<FeatureKey, string> = new Map(
  FEATURE_ROWS.map((feature) => [feature.key, feature.id]),
);
const PLAN_ID_BY_CODE: ReadonlyMap<string, string> = new Map(
  PLAN_ROWS.map((plan) => [plan.code, plan.id]),
);

// Mesmo vínculo plano -> features de `DEFINICOES_PLANO.features`
// (src/lib/planos.ts) — inclui as features "contratuais, sem implementação
// real ainda" do plano Pro (a UI mostra "Em breve"; o catálogo de dados não
// finge nem omite o que o plano já inclui).
const PLAN_FEATURE_KEYS: Readonly<Record<string, readonly FeatureKey[]>> = {
  essencial: [FeatureKey.AGENDA, FeatureKey.AGENDAMENTO_PUBLICO, FeatureKey.PROFISSIONAIS],
  equipe: [
    FeatureKey.AGENDA,
    FeatureKey.AGENDAMENTO_PUBLICO,
    FeatureKey.PROFISSIONAIS,
    FeatureKey.CONSUMIDORES,
    FeatureKey.RELATORIOS,
    FeatureKey.EQUIPE,
  ],
  pro: [
    FeatureKey.AGENDA,
    FeatureKey.AGENDAMENTO_PUBLICO,
    FeatureKey.PROFISSIONAIS,
    FeatureKey.CONSUMIDORES,
    FeatureKey.RELATORIOS,
    FeatureKey.EQUIPE,
    FeatureKey.PERSONALIZACAO_AVANCADA,
    FeatureKey.MULTIPLAS_UNIDADES,
    FeatureKey.LISTA_DE_ESPERA,
    FeatureKey.COMISSOES,
    FeatureKey.PAGAMENTOS,
    FeatureKey.ASSINATURAS,
    FeatureKey.DOMINIO_PROPRIO,
  ],
};

// Gerado a partir de PLAN_FEATURE_KEYS — id `pf_<code>_<posição>`, nunca
// aleatório, nunca recalculado a cada execução (a ordem de cada array acima é
// fixa no código-fonte, não em runtime).
export const PLAN_FEATURE_ROWS: readonly PlanFeatureRow[] = Object.entries(
  PLAN_FEATURE_KEYS,
).flatMap(([planCode, featureKeys]) =>
  featureKeys.map((featureKey, index) => ({
    id: `pf_${planCode}_${String(index + 1).padStart(2, '0')}`,
    planId: PLAN_ID_BY_CODE.get(planCode)!,
    featureId: FEATURE_ID_BY_KEY.get(featureKey)!,
  })),
);

export class InitialPlanCatalog1788782460000 implements MigrationInterface {
  name = 'InitialPlanCatalog1788782460000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const feature of FEATURE_ROWS) {
      await queryRunner.query(
        `INSERT INTO features (id, key, label) VALUES ($1, $2, $3)
         ON CONFLICT (key) DO NOTHING`,
        [feature.id, feature.key, feature.label],
      );
    }

    for (const plan of PLAN_ROWS) {
      await queryRunner.query(
        `INSERT INTO plans (id, code, name, price_cents, short_description, max_professionals, max_units)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (code) DO NOTHING`,
        [
          plan.id,
          plan.code,
          plan.name,
          plan.priceCents,
          plan.shortDescription,
          plan.maxProfessionals,
          plan.maxUnits,
        ],
      );
    }

    for (const planFeature of PLAN_FEATURE_ROWS) {
      await queryRunner.query(
        `INSERT INTO plan_features (id, plan_id, feature_id) VALUES ($1, $2, $3)
         ON CONFLICT (plan_id, feature_id) DO NOTHING`,
        [planFeature.id, planFeature.planId, planFeature.featureId],
      );
    }
  }

  // Ordem inversa de `up()`. Nunca `CASCADE`: se `plans`/`features` já
  // tiverem sido referenciados por dado real (tenant, override), o `DELETE`
  // correspondente falha por FK RESTRICT/CASCADE já definida na migration
  // inicial — rollback automático, nenhuma linha órfã.
  public async down(queryRunner: QueryRunner): Promise<void> {
    const planFeatureIds = PLAN_FEATURE_ROWS.map((row) => row.id);
    if (planFeatureIds.length > 0) {
      await queryRunner.query(`DELETE FROM plan_features WHERE id = ANY($1)`, [
        planFeatureIds,
      ]);
    }

    const featureIds = FEATURE_ROWS.map((row) => row.id);
    await queryRunner.query(`DELETE FROM features WHERE id = ANY($1)`, [
      featureIds,
    ]);

    const planIds = PLAN_ROWS.map((row) => row.id);
    await queryRunner.query(`DELETE FROM plans WHERE id = ANY($1)`, [planIds]);
  }
}
