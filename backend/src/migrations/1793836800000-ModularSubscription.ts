// Assinatura modular por estabelecimento e limite de usuários da equipe (ver
// docs/plans/assinatura-modular-e-limite-equipe.md). Só acréscimos: nenhum
// estabelecimento existente muda de plano, de recurso ou de limite.
//
// 1. `audit_action` ganha SUBSCRIPTION_CHANGED, TEAM_LIMIT_CHANGED e
//    ADDON_PRICE_CHANGED (o `down` deixa os valores: o PostgreSQL não remove).
// 2. `plans.max_professionals` aceita NULL ("sem limite contratual de
//    profissionais"), mas SÓ para o plano modular (CHECK). Os planos atuais
//    continuam com 2/5/20.
// 3. `tenants.team_user_limit`: limite de usuários da equipe com login.
//    NULL = segue `plans.max_professionals` (compatibilidade dos planos
//    atuais, que já usavam esse número como vagas de login). Nunca é
//    preenchido aqui: nenhum cliente atual ganha limite zero.
// 4. Catálogo de adicionais (`addon_modules`) e preços (`addon_module_prices`,
//    uma linha por mudança, como `plan_prices`). Nenhum preço é semeado: os
//    valores não foram aprovados, e sem linha o preço fica PENDENTE.
//    Disponibilidade só muda por migration (código liberado e validado).
// 5. Versões da assinatura (`tenant_subscriptions` + itens): append-only,
//    com instantâneo dos preços do catálogo na data. Mudar o catálogo nunca
//    reescreve uma versão.
// 6. RELATORIOS entra no plano Básico (o Pro e o Max já tinham; a linha do
//    Pro fica como garantia idempotente): a Visão geral passa a separar os
//    indicadores (resumo do período e financeiro) pelo recurso RELATORIOS, e
//    quem já usa não pode perder.
// 7. Trava no banco (gatilho de constraint adiado): um estabelecimento só
//    fica no plano modular com limite preenchido e uma versão de assinatura.
//    Protege contra a API anterior, que não sabe gravar assinatura.
//
// A linha do plano modular NÃO é criada aqui: a API nova a cria na primeira
// gravação de assinatura ou de preço base (commercial/modular-plan.ts). Assim
// a API anterior, que lista `FROM plans` sem filtro, nunca a oferece.
import type { MigrationInterface, QueryRunner } from 'typeorm';
import { MAX_PRICE_CENTS } from './1793318400000-PlatformPortal.js';

export const MODULAR_AUDIT_ACTIONS = ['SUBSCRIPTION_CHANGED', 'TEAM_LIMIT_CHANGED', 'ADDON_PRICE_CHANGED'] as const;

/** Id fixo do plano modular (a linha nasce pela API nova). */
export const MODULAR_PLAN_ID = 'plan_modular';

export const MAX_TEAM_USER_LIMIT = 1000;

export const ADDON_MODULE_ROWS = [
  {
    code: 'INDICADORES',
    name: 'Indicadores avançados',
    description:
      'Resumo do período na Visão geral: atendimentos por situação, clientes atendidos e resumo financeiro dos recebimentos.',
    featureKey: 'RELATORIOS',
    availability: 'AVAILABLE',
    sortOrder: 10,
  },
  {
    code: 'COMISSOES',
    name: 'Comissões',
    description: 'Regras de comissão por profissional e serviço, com apuração por atendimento concluído.',
    featureKey: 'COMISSOES',
    availability: 'AVAILABLE',
    sortOrder: 20,
  },
  {
    code: 'WHATSAPP',
    name: 'WhatsApp automático',
    description: 'Confirmações e lembretes pelo WhatsApp. Franquia de mensagens a definir.',
    featureKey: null,
    availability: 'IN_DEVELOPMENT',
    sortOrder: 30,
  },
  {
    code: 'ESTOQUE',
    name: 'Controle de estoque',
    description: 'Produtos, movimentações e alertas.',
    featureKey: null,
    availability: 'PLANNED',
    sortOrder: 40,
  },
  {
    code: 'GESTAO_FINANCEIRA',
    name: 'Gestão financeira',
    description: 'Receitas, despesas e fluxo de caixa.',
    featureKey: null,
    availability: 'PLANNED',
    sortOrder: 50,
  },
  {
    code: 'MARKETING',
    name: 'Marketing e fidelização',
    description: 'Campanhas e retorno de clientes.',
    featureKey: null,
    availability: 'PLANNED',
    sortOrder: 60,
  },
] as const;

/** RELATORIOS nos planos atuais (ids fixos para o `down`; no Pro a linha
 * original já existe e o INSERT não faz nada). */
export const RELATORIOS_PLAN_FEATURES = [
  { id: 'pf_ms_essencial_relatorios', planId: 'plan_essencial' },
  { id: 'pf_ms_equipe_relatorios', planId: 'plan_equipe' },
] as const;

export class ModularSubscription1793836800000 implements MigrationInterface {
  name = 'ModularSubscription1793836800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const action of MODULAR_AUDIT_ACTIONS) {
      await queryRunner.query(`ALTER TYPE audit_action ADD VALUE IF NOT EXISTS '${action}'`);
    }

    await queryRunner.query(`ALTER TABLE plans ALTER COLUMN max_professionals DROP NOT NULL`);
    await queryRunner.query(
      `ALTER TABLE plans ADD CONSTRAINT ck_plans_max_professionals_modular
         CHECK (max_professionals IS NOT NULL OR id = '${MODULAR_PLAN_ID}')`,
    );

    await queryRunner.query(`ALTER TABLE tenants ADD COLUMN team_user_limit integer NULL`);
    await queryRunner.query(
      `ALTER TABLE tenants ADD CONSTRAINT ck_tenants_team_user_limit
         CHECK (team_user_limit IS NULL OR (team_user_limit >= 0 AND team_user_limit <= ${MAX_TEAM_USER_LIMIT}))`,
    );

    await queryRunner.query(`
      CREATE TABLE addon_modules (
        code varchar(40) NOT NULL,
        name varchar(80) NOT NULL,
        description varchar(300) NOT NULL,
        feature_key varchar(40) NULL,
        availability varchar(20) NOT NULL,
        sort_order integer NOT NULL,
        CONSTRAINT pk_addon_modules PRIMARY KEY (code),
        CONSTRAINT ck_addon_modules_availability CHECK (availability IN ('AVAILABLE', 'IN_DEVELOPMENT', 'PLANNED')),
        CONSTRAINT ck_addon_modules_available_feature CHECK (availability <> 'AVAILABLE' OR feature_key IS NOT NULL),
        CONSTRAINT uq_addon_modules_feature UNIQUE (feature_key)
      )
    `);
    for (const m of ADDON_MODULE_ROWS) {
      await queryRunner.query(
        `INSERT INTO addon_modules (code, name, description, feature_key, availability, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [m.code, m.name, m.description, m.featureKey, m.availability, m.sortOrder],
      );
    }

    await queryRunner.query(`
      CREATE TABLE addon_module_prices (
        id varchar(30) NOT NULL,
        module_code varchar(40) NOT NULL,
        amount_cents integer NOT NULL,
        reason varchar(300) NULL,
        recorded_at timestamptz(3) NOT NULL DEFAULT now(),
        recorded_by_user_id varchar(30) NOT NULL,
        request_key varchar(80) NOT NULL,
        CONSTRAINT pk_addon_module_prices PRIMARY KEY (id),
        CONSTRAINT fk_addon_module_prices_module FOREIGN KEY (module_code) REFERENCES addon_modules (code) ON DELETE RESTRICT,
        CONSTRAINT fk_addon_module_prices_recorded_by FOREIGN KEY (recorded_by_user_id) REFERENCES users (id) ON DELETE RESTRICT,
        CONSTRAINT ck_addon_module_prices_amount CHECK (amount_cents > 0 AND amount_cents <= ${MAX_PRICE_CENTS})
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_addon_module_prices_request_key ON addon_module_prices (recorded_by_user_id, request_key)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_addon_module_prices_current ON addon_module_prices (module_code, recorded_at DESC, id DESC)`,
    );

    await queryRunner.query(`
      CREATE TABLE tenant_subscriptions (
        id varchar(30) NOT NULL,
        tenant_id varchar(30) NOT NULL,
        version integer NOT NULL,
        effective_at timestamptz(3) NOT NULL,
        base_catalog_cents integer NOT NULL,
        catalog_total_cents integer NOT NULL,
        contracted_total_cents integer NOT NULL,
        reason varchar(300) NULL,
        team_user_limit integer NOT NULL,
        previous_contract jsonb NULL,
        recorded_at timestamptz(3) NOT NULL DEFAULT now(),
        recorded_by_user_id varchar(30) NOT NULL,
        request_key varchar(80) NOT NULL,
        CONSTRAINT pk_tenant_subscriptions PRIMARY KEY (id),
        CONSTRAINT fk_tenant_subscriptions_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
        CONSTRAINT fk_tenant_subscriptions_recorded_by FOREIGN KEY (recorded_by_user_id) REFERENCES users (id) ON DELETE RESTRICT,
        CONSTRAINT uq_tenant_subscriptions_version UNIQUE (tenant_id, version),
        CONSTRAINT ck_tenant_subscriptions_version CHECK (version >= 1),
        CONSTRAINT ck_tenant_subscriptions_amounts CHECK (
          base_catalog_cents > 0 AND catalog_total_cents >= base_catalog_cents
          AND contracted_total_cents > 0 AND contracted_total_cents <= ${MAX_PRICE_CENTS}
        ),
        CONSTRAINT ck_tenant_subscriptions_reason CHECK (
          contracted_total_cents = catalog_total_cents OR (reason IS NOT NULL AND length(btrim(reason)) >= 3)
        ),
        CONSTRAINT ck_tenant_subscriptions_team_limit CHECK (team_user_limit >= 0 AND team_user_limit <= ${MAX_TEAM_USER_LIMIT})
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_tenant_subscriptions_request_key ON tenant_subscriptions (recorded_by_user_id, request_key)`,
    );

    await queryRunner.query(`
      CREATE TABLE tenant_subscription_items (
        id varchar(30) NOT NULL,
        subscription_id varchar(30) NOT NULL,
        module_code varchar(40) NOT NULL,
        catalog_price_cents integer NOT NULL,
        CONSTRAINT pk_tenant_subscription_items PRIMARY KEY (id),
        CONSTRAINT fk_tenant_subscription_items_subscription FOREIGN KEY (subscription_id)
          REFERENCES tenant_subscriptions (id) ON DELETE RESTRICT,
        CONSTRAINT fk_tenant_subscription_items_module FOREIGN KEY (module_code) REFERENCES addon_modules (code) ON DELETE RESTRICT,
        CONSTRAINT uq_tenant_subscription_items_module UNIQUE (subscription_id, module_code),
        CONSTRAINT ck_tenant_subscription_items_price CHECK (catalog_price_cents > 0)
      )
    `);

    for (const pf of RELATORIOS_PLAN_FEATURES) {
      await queryRunner.query(
        `INSERT INTO plan_features (id, plan_id, feature_id)
         SELECT $1, p.id, 'feat_relatorios' FROM plans p WHERE p.id = $2
         ON CONFLICT (plan_id, feature_id) DO NOTHING`,
        [pf.id, pf.planId],
      );
    }

    await queryRunner.query(`
      CREATE FUNCTION tenants_modular_requires_subscription() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF EXISTS (SELECT 1 FROM tenants t WHERE t.id = NEW.id AND t.plan_id = '${MODULAR_PLAN_ID}'
                     AND (t.team_user_limit IS NULL
                          OR NOT EXISTS (SELECT 1 FROM tenant_subscriptions s WHERE s.tenant_id = t.id))) THEN
          RAISE EXCEPTION 'Estabelecimento no plano modular exige limite de usuários e versão de assinatura.'
            USING ERRCODE = 'check_violation', CONSTRAINT = 'ck_tenants_modular_subscription';
        END IF;
        RETURN NULL;
      END $$
    `);
    await queryRunner.query(`
      CREATE CONSTRAINT TRIGGER trg_tenants_modular_subscription
        AFTER INSERT OR UPDATE OF plan_id, team_user_limit ON tenants
        DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW EXECUTE FUNCTION tenants_modular_requires_subscription()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const [uso] = (await queryRunner.query(
      `SELECT (SELECT count(*)::int FROM tenant_subscriptions) AS assinaturas,
              (SELECT count(*)::int FROM tenants WHERE team_user_limit IS NOT NULL) AS limites,
              (SELECT count(*)::int FROM addon_module_prices) AS precos,
              (SELECT count(*)::int FROM plans WHERE id = '${MODULAR_PLAN_ID}') AS modular`,
    )) as { assinaturas: number; limites: number; precos: number; modular: number }[];
    if (uso.assinaturas > 0 || uso.limites > 0 || uso.precos > 0 || uso.modular > 0) {
      throw new Error('Há assinatura, limite, preço de adicional ou plano modular gravado; o down apagaria dados e foi recusado.');
    }
    await queryRunner.query(`DROP TRIGGER trg_tenants_modular_subscription ON tenants`);
    await queryRunner.query(`DROP FUNCTION tenants_modular_requires_subscription()`);
    for (const pf of RELATORIOS_PLAN_FEATURES) {
      await queryRunner.query(`DELETE FROM plan_features WHERE id = $1`, [pf.id]);
    }
    await queryRunner.query(`DROP TABLE tenant_subscription_items`);
    await queryRunner.query(`DROP TABLE tenant_subscriptions`);
    await queryRunner.query(`DROP TABLE addon_module_prices`);
    await queryRunner.query(`DROP TABLE addon_modules`);
    await queryRunner.query(`ALTER TABLE tenants DROP CONSTRAINT ck_tenants_team_user_limit`);
    await queryRunner.query(`ALTER TABLE tenants DROP COLUMN team_user_limit`);
    await queryRunner.query(`ALTER TABLE plans DROP CONSTRAINT ck_plans_max_professionals_modular`);
    await queryRunner.query(`ALTER TABLE plans ALTER COLUMN max_professionals SET NOT NULL`);
  }
}
