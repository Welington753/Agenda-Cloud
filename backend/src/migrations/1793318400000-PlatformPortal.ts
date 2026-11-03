// Portal da plataforma: preços do catálogo, preço contratado por cliente e
// acesso sem vencimento (ver docs/plans/portal-da-plataforma.md). Só
// ACRESCENTA: três tabelas novas, uma coluna anulável num período e valores
// novos no histórico. Nenhum estabelecimento muda de plano, situação,
// validade ou preço; nenhum preço é gravado (a proposta não foi aprovada).
//
// PREÇOS DO CATÁLOGO (`plan_prices`): uma linha por mudança, nunca editada
// nem apagada. O preço em vigor de um plano num ciclo é a linha mais recente.
// Sem linha, o preço está PENDENTE (nunca gratuito).
//
// PREÇO CONTRATADO (`tenant_contract_prices`): o valor combinado com um
// cliente para um plano e um ciclo, também uma linha por mudança. `amount_cents`
// NULL registra a escolha do ciclo seguindo o catálogo. Mudar o catálogo ou o
// contrato nunca reescreve período já registrado: o valor de cada período pago
// continua em `tenant_access_periods.contracted_price_cents`.
//
// ORIGEM DO VALOR (`tenant_access_periods.amount_source`): de onde veio o
// valor de um período pago registrado a partir desta versão (contrato,
// catálogo ou ajuste só daquele pagamento). Os períodos anteriores ficam com
// NULL: a origem não foi registrada e não é inventada.
//
// SEM VENCIMENTO (`tenant_no_expiry_grants`): concessão e retirada pela
// administração, com motivo, na mesma linha (a retirada não apaga a
// concessão). No máximo uma concessão em vigor por estabelecimento. Não
// representa pagamento, não libera recurso fora do plano e não muda papel.
import type { MigrationInterface, QueryRunner } from 'typeorm';

export const PORTAL_AUDIT_ACTIONS = [
  'PLAN_PRICE_CHANGED',
  'CONTRACT_PRICE_CHANGED',
  'ACCESS_NO_EXPIRY_GRANTED',
  'ACCESS_NO_EXPIRY_REVOKED',
] as const;

/** Origem do valor de um período pago. */
export const AMOUNT_SOURCES = ['CONTRACT', 'CATALOG', 'ADJUSTED'] as const;

/** Maior valor aceito, em centavos (o mesmo limite do período pago). */
export const MAX_PRICE_CENTS = 100_000_000;

export class PlatformPortal1793318400000 implements MigrationInterface {
  name = 'PlatformPortal1793318400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const action of PORTAL_AUDIT_ACTIONS) {
      await queryRunner.query(`ALTER TYPE audit_action ADD VALUE IF NOT EXISTS '${action}'`);
    }

    await queryRunner.query(`
      CREATE TABLE plan_prices (
        id varchar(30) NOT NULL,
        plan_id varchar(30) NOT NULL,
        billing_cycle billing_cycle NOT NULL,
        amount_cents integer NOT NULL,
        currency char(3) NOT NULL DEFAULT 'BRL',
        reason varchar(300) NULL,
        recorded_at timestamptz(3) NOT NULL DEFAULT now(),
        recorded_by_user_id varchar(30) NOT NULL,
        request_key varchar(80) NOT NULL,
        CONSTRAINT pk_plan_prices PRIMARY KEY (id),
        CONSTRAINT fk_plan_prices_plan FOREIGN KEY (plan_id) REFERENCES plans (id) ON DELETE RESTRICT,
        CONSTRAINT fk_plan_prices_recorded_by FOREIGN KEY (recorded_by_user_id)
          REFERENCES users (id) ON DELETE RESTRICT,
        CONSTRAINT ck_plan_prices_amount CHECK (amount_cents > 0 AND amount_cents <= ${MAX_PRICE_CENTS}),
        CONSTRAINT ck_plan_prices_currency CHECK (currency = 'BRL')
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_plan_prices_request_key ON plan_prices (recorded_by_user_id, request_key)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_plan_prices_current ON plan_prices (plan_id, billing_cycle, recorded_at DESC, id DESC)`,
    );

    await queryRunner.query(`
      CREATE TABLE tenant_contract_prices (
        id varchar(30) NOT NULL,
        tenant_id varchar(30) NOT NULL,
        plan_id varchar(30) NOT NULL,
        billing_cycle billing_cycle NOT NULL,
        amount_cents integer NULL,
        currency char(3) NOT NULL DEFAULT 'BRL',
        reason varchar(300) NULL,
        access_period_id varchar(30) NULL,
        recorded_at timestamptz(3) NOT NULL DEFAULT now(),
        recorded_by_user_id varchar(30) NOT NULL,
        request_key varchar(80) NULL,
        CONSTRAINT pk_tenant_contract_prices PRIMARY KEY (id),
        CONSTRAINT fk_tenant_contract_prices_tenant FOREIGN KEY (tenant_id)
          REFERENCES tenants (id) ON DELETE RESTRICT,
        CONSTRAINT fk_tenant_contract_prices_plan FOREIGN KEY (plan_id) REFERENCES plans (id) ON DELETE RESTRICT,
        CONSTRAINT fk_tenant_contract_prices_period FOREIGN KEY (access_period_id)
          REFERENCES tenant_access_periods (id) ON DELETE RESTRICT,
        CONSTRAINT fk_tenant_contract_prices_recorded_by FOREIGN KEY (recorded_by_user_id)
          REFERENCES users (id) ON DELETE RESTRICT,
        CONSTRAINT ck_tenant_contract_prices_amount CHECK (
          amount_cents IS NULL OR (amount_cents > 0 AND amount_cents <= ${MAX_PRICE_CENTS})
        ),
        CONSTRAINT ck_tenant_contract_prices_currency CHECK (currency = 'BRL'),
        CONSTRAINT ck_tenant_contract_prices_origin CHECK (request_key IS NOT NULL OR access_period_id IS NOT NULL)
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_tenant_contract_prices_request_key
         ON tenant_contract_prices (recorded_by_user_id, request_key) WHERE request_key IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_tenant_contract_prices_period ON tenant_contract_prices (access_period_id)
         WHERE access_period_id IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_tenant_contract_prices_current
         ON tenant_contract_prices (tenant_id, plan_id, billing_cycle, recorded_at DESC, id DESC)`,
    );

    await queryRunner.query(`ALTER TABLE tenant_access_periods ADD COLUMN amount_source varchar(10) NULL`);
    await queryRunner.query(`
      ALTER TABLE tenant_access_periods ADD CONSTRAINT ck_tenant_access_periods_amount_source CHECK (
        amount_source IS NULL OR (kind = 'PAID' AND amount_source IN (${AMOUNT_SOURCES.map((s) => `'${s}'`).join(', ')}))
      )
    `);

    await queryRunner.query(`
      CREATE TABLE tenant_no_expiry_grants (
        id varchar(30) NOT NULL,
        tenant_id varchar(30) NOT NULL,
        granted_at timestamptz(3) NOT NULL DEFAULT now(),
        granted_by_user_id varchar(30) NOT NULL,
        grant_reason varchar(300) NOT NULL,
        grant_request_key varchar(80) NOT NULL,
        revoked_at timestamptz(3) NULL,
        revoked_by_user_id varchar(30) NULL,
        revoke_reason varchar(300) NULL,
        revoke_request_key varchar(80) NULL,
        CONSTRAINT pk_tenant_no_expiry_grants PRIMARY KEY (id),
        CONSTRAINT fk_tenant_no_expiry_grants_tenant FOREIGN KEY (tenant_id)
          REFERENCES tenants (id) ON DELETE RESTRICT,
        CONSTRAINT fk_tenant_no_expiry_grants_granted_by FOREIGN KEY (granted_by_user_id)
          REFERENCES users (id) ON DELETE RESTRICT,
        CONSTRAINT fk_tenant_no_expiry_grants_revoked_by FOREIGN KEY (revoked_by_user_id)
          REFERENCES users (id) ON DELETE RESTRICT,
        CONSTRAINT ck_tenant_no_expiry_grants_revoke CHECK (
          (revoked_at IS NULL AND revoked_by_user_id IS NULL AND revoke_reason IS NULL AND revoke_request_key IS NULL)
          OR (revoked_at IS NOT NULL AND revoked_by_user_id IS NOT NULL AND revoke_reason IS NOT NULL
            AND revoke_request_key IS NOT NULL AND revoked_at >= granted_at)
        )
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_tenant_no_expiry_grants_active ON tenant_no_expiry_grants (tenant_id) WHERE revoked_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_tenant_no_expiry_grants_grant_key
         ON tenant_no_expiry_grants (granted_by_user_id, grant_request_key)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_tenant_no_expiry_grants_revoke_key
         ON tenant_no_expiry_grants (revoked_by_user_id, revoke_request_key) WHERE revoke_request_key IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE tenant_no_expiry_grants`);
    await queryRunner.query(
      `ALTER TABLE tenant_access_periods DROP CONSTRAINT ck_tenant_access_periods_amount_source`,
    );
    await queryRunner.query(`ALTER TABLE tenant_access_periods DROP COLUMN amount_source`);
    await queryRunner.query(`DROP TABLE tenant_contract_prices`);
    await queryRunner.query(`DROP TABLE plan_prices`);
    // Os valores novos de `audit_action` ficam: o PostgreSQL não remove valor
    // de enum, e o histórico já gravado continua legível.
  }
}
