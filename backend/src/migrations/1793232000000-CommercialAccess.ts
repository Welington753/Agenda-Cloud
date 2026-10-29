// Planos Básico/Pro/Max e validade do acesso (ver
// docs/plans/planos-e-validade-do-acesso.md). Só ACRESCENTA: uma tabela
// nova, valores novos no histórico, linhas novas no catálogo de recursos e
// nomes novos para os três planos. Nenhum estabelecimento ganha período,
// muda de plano ou perde recurso.
//
// PERÍODOS (`tenant_access_periods`): uma linha por teste, período pago ou
// cortesia, nunca editada nem apagada. O valor contratado fica na linha do
// período pago: mudar o catálogo nunca reescreve o que foi registrado. O
// pagamento é sempre confirmado à mão pela administração
// (`confirmation_source = 'MANUAL'`), sem banco ou operadora.
//
// GARANTIAS NO BANCO:
// - pagos e cortesias de um estabelecimento nunca se sobrepõem, nem dois
//   testes entre si (exclusion constraints, `btree_gist` da migration
//   inicial). Teste e pago podem se sobrepor: o pago começa no fim do teste
//   pela regra da aplicação, mas um teste antigo não impede nada;
// - a chave do formulário é única por quem registrou (repetição idempotente);
// - cada tipo tem exatamente os campos que lhe cabem.
//
// ESTABELECIMENTOS EXISTENTES: nenhum período é criado. Sem período, a
// validade não é conferida (seção 2.6 do plano).
//
// PLANOS: só `name` e `short_description` mudam, pelas linhas de id e código
// conhecidos. Códigos e ids continuam `essencial`/`equipe`/`pro`.
//
// RECURSOS: o catálogo passa a dizer o que o código já fazia (clientes,
// equipe e recebimentos no Básico; recebimentos no Pro). Nada é concedido
// além do que já era usado.
import type { MigrationInterface, QueryRunner } from 'typeorm';

export const ACCESS_AUDIT_ACTIONS = [
  'ACCESS_PAID_PERIOD_RECORDED',
  'ACCESS_TRIAL_EXTENDED',
  'ACCESS_COURTESY_GRANTED',
] as const;

/** Formas de pagamento aceitas no registro manual da assinatura. */
export const ACCESS_PAYMENT_METHODS = [
  'PIX',
  'BOLETO',
  'TRANSFERENCIA',
  'CARTAO_CREDITO',
  'CARTAO_DEBITO',
  'DINHEIRO',
  'OUTRO',
] as const;

export const PLAN_RENAMES = [
  {
    id: 'plan_essencial',
    code: 'essencial',
    from: { name: 'Essencial', shortDescription: 'Agenda, agendamento público e serviços para um profissional só ou uma equipe pequena.' },
    to: { name: 'Básico', shortDescription: 'Agenda, agendamento público, clientes, equipe e recebimentos para até 2 profissionais.' },
  },
  {
    id: 'plan_equipe',
    code: 'equipe',
    from: { name: 'Gestão', shortDescription: 'Tudo do Essencial, mais consumidores, relatórios básicos e gestão de equipe.' },
    to: { name: 'Pro', shortDescription: 'Tudo do Básico para até 5 profissionais e acessos de equipe.' },
  },
  {
    id: 'plan_pro',
    code: 'pro',
    from: {
      name: 'Rede',
      shortDescription:
        'Tudo do Gestão, mais unidades extras e personalização avançada. Alguns módulos aparecem como "em breve".',
    },
    to: {
      name: 'Max',
      shortDescription:
        'Todos os módulos para o cliente, para até 20 profissionais e acessos de equipe. Módulos futuros aparecem como "em breve".',
    },
  },
] as const;

/** Linhas novas de `plan_features`, com ids fixos para o `down()`. */
export const PLAN_FEATURE_ADDITIONS = [
  { id: 'pf_ca_essencial_consumidores', planId: 'plan_essencial', featureId: 'feat_consumidores' },
  { id: 'pf_ca_essencial_equipe', planId: 'plan_essencial', featureId: 'feat_equipe' },
  { id: 'pf_ca_essencial_pagamentos', planId: 'plan_essencial', featureId: 'feat_pagamentos' },
  { id: 'pf_ca_equipe_pagamentos', planId: 'plan_equipe', featureId: 'feat_pagamentos' },
] as const;

const lista = (valores: readonly string[]) => valores.map((v) => `'${v}'`).join(', ');

export class CommercialAccess1793232000000 implements MigrationInterface {
  name = 'CommercialAccess1793232000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const action of ACCESS_AUDIT_ACTIONS) {
      await queryRunner.query(`ALTER TYPE audit_action ADD VALUE IF NOT EXISTS '${action}'`);
    }
    await queryRunner.query(`CREATE TYPE access_period_kind AS ENUM ('TRIAL', 'PAID', 'COURTESY')`);
    await queryRunner.query(`CREATE TYPE billing_cycle AS ENUM ('MONTHLY', 'QUARTERLY')`);
    await queryRunner.query(`
      CREATE TABLE tenant_access_periods (
        id varchar(30) NOT NULL,
        tenant_id varchar(30) NOT NULL,
        kind access_period_kind NOT NULL,
        plan_id varchar(30) NOT NULL,
        starts_at timestamptz(3) NOT NULL,
        ends_at timestamptz(3) NOT NULL,
        anchor_day smallint NULL,
        billing_cycle billing_cycle NULL,
        contracted_price_cents integer NULL,
        currency char(3) NULL,
        payment_method varchar(20) NULL,
        payment_received_on date NULL,
        payment_reference varchar(120) NULL,
        confirmation_source varchar(10) NULL,
        reason varchar(300) NULL,
        recorded_at timestamptz(3) NOT NULL DEFAULT now(),
        recorded_by_user_id varchar(30) NOT NULL,
        request_key varchar(80) NULL,
        CONSTRAINT pk_tenant_access_periods PRIMARY KEY (id),
        CONSTRAINT fk_tenant_access_periods_tenant FOREIGN KEY (tenant_id)
          REFERENCES tenants (id) ON DELETE RESTRICT,
        CONSTRAINT fk_tenant_access_periods_plan FOREIGN KEY (plan_id)
          REFERENCES plans (id) ON DELETE RESTRICT,
        CONSTRAINT fk_tenant_access_periods_recorded_by FOREIGN KEY (recorded_by_user_id)
          REFERENCES users (id) ON DELETE RESTRICT,
        CONSTRAINT ck_tenant_access_periods_dates CHECK (ends_at > starts_at),
        CONSTRAINT ck_tenant_access_periods_anchor CHECK (anchor_day IS NULL OR anchor_day BETWEEN 1 AND 31),
        CONSTRAINT ck_tenant_access_periods_method CHECK (
          payment_method IS NULL OR payment_method IN (${lista(ACCESS_PAYMENT_METHODS)})
        ),
        CONSTRAINT ck_tenant_access_periods_kind CHECK (
          (kind = 'PAID'
            AND billing_cycle IS NOT NULL AND anchor_day IS NOT NULL
            AND contracted_price_cents IS NOT NULL AND contracted_price_cents > 0
            AND contracted_price_cents <= 100000000 AND currency = 'BRL'
            AND payment_method IS NOT NULL AND payment_received_on IS NOT NULL
            AND confirmation_source = 'MANUAL' AND request_key IS NOT NULL)
          OR (kind <> 'PAID'
            AND billing_cycle IS NULL AND anchor_day IS NULL
            AND contracted_price_cents IS NULL AND currency IS NULL
            AND payment_method IS NULL AND payment_received_on IS NULL
            AND payment_reference IS NULL AND confirmation_source IS NULL)
        ),
        CONSTRAINT ck_tenant_access_periods_courtesy CHECK (
          kind <> 'COURTESY' OR (reason IS NOT NULL AND request_key IS NOT NULL)
        )
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_tenant_access_periods_request_key
         ON tenant_access_periods (recorded_by_user_id, request_key) WHERE request_key IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_tenant_access_periods_tenant_ends ON tenant_access_periods (tenant_id, ends_at)`,
    );
    await queryRunner.query(`
      ALTER TABLE tenant_access_periods ADD CONSTRAINT ex_tenant_access_periods_paid_overlap
        EXCLUDE USING gist (tenant_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&)
        WHERE (kind <> 'TRIAL')
    `);
    await queryRunner.query(`
      ALTER TABLE tenant_access_periods ADD CONSTRAINT ex_tenant_access_periods_trial_overlap
        EXCLUDE USING gist (tenant_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&)
        WHERE (kind = 'TRIAL')
    `);

    for (const plano of PLAN_RENAMES) {
      await queryRunner.query(
        'UPDATE plans SET name = $3, short_description = $4, updated_at = now() WHERE id = $1 AND code = $2',
        [plano.id, plano.code, plano.to.name, plano.to.shortDescription],
      );
    }
    for (const linha of PLAN_FEATURE_ADDITIONS) {
      await queryRunner.query(
        `INSERT INTO plan_features (id, plan_id, feature_id)
         SELECT $1, p.id, f.id FROM plans p, features f WHERE p.id = $2 AND f.id = $3
         ON CONFLICT (plan_id, feature_id) DO NOTHING`,
        [linha.id, linha.planId, linha.featureId],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM plan_features WHERE id = ANY($1)`, [
      PLAN_FEATURE_ADDITIONS.map((l) => l.id),
    ]);
    for (const plano of PLAN_RENAMES) {
      await queryRunner.query(
        'UPDATE plans SET name = $3, short_description = $4, updated_at = now() WHERE id = $1 AND code = $2',
        [plano.id, plano.code, plano.from.name, plano.from.shortDescription],
      );
    }
    await queryRunner.query(`DROP TABLE tenant_access_periods`);
    await queryRunner.query(`DROP TYPE billing_cycle`);
    await queryRunner.query(`DROP TYPE access_period_kind`);
    // Os valores novos de `audit_action` ficam: o PostgreSQL não remove valor
    // de enum, e o histórico já gravado continua legível.
  }
}
