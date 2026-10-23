// Gestão de contas pela administração da plataforma (ver
// docs/plans/administracao-contas-convites.md). Só ACRESCENTA: nenhuma
// coluna existente muda de tipo, nenhuma linha existente é reescrita e
// nenhuma conta antiga perde acesso.
//
// 1. `audit_action` ganha as ações administrativas novas. `ADD VALUE` não
//    pode ser desfeito no PostgreSQL; o `down` deixa os valores (inofensivos,
//    nenhuma linha antiga os usa) e remove o resto.
// 2. `audit_logs.target_user_id`: a conta ATINGIDA pela ação, para o
//    histórico ser consultável por pessoa. O ator continua em
//    `actor_user_id`, sempre a conta autenticada que fez a ação.
// 3. `sessions.reauthenticated_at`: quando esta sessão confirmou a senha de
//    novo. Mudanças sensíveis exigem confirmação recente na MESMA sessão.
// 4. `invites` (tabela já existente, nunca escrita por código até aqui):
//    - `target_user_id`: a conta que o convite ativa (conta nova, criada
//      pendente) ou vincula (conta existente).
//    - `platform_permissions`: as permissões pretendidas num convite de
//      plataforma.
//    - estado do ENVIO do e-mail (`delivery_*`), separado do estado do
//      convite: "o provedor aceitou" não é "a pessoa recebeu".
//    - `send_count`: quantos links já foram emitidos (reenvio troca o token
//      e invalida o anterior; há teto no serviço).
//    - `request_key`: chave de idempotência do formulário, única por quem
//      criou. Repetir o envio com a mesma chave devolve o mesmo convite.
//    - no máximo UM convite pendente por e-mail e estabelecimento (ou por
//      e-mail, no convite de plataforma).
// 5. `password_resets`: pedidos de redefinição de senha feitos pela
//    administração. Só o hash do token é guardado; uso único; no máximo um
//    pendente por conta.
//
// Sem entidade TypeORM para as colunas e a tabela novas, como
// `push_subscriptions`: as specs estruturais amarram cada entidade à
// migration inicial. O acesso é por SQL explícito em src/accounts/, provado
// contra o PostgreSQL descartável (test/accounts-postgres.db-e2e-spec.ts).
import type { MigrationInterface, QueryRunner } from 'typeorm';

export const NEW_AUDIT_ACTIONS = [
  'USER_UPDATED',
  'USER_BLOCKED',
  'USER_REACTIVATED',
  'INVITE_RESENT',
  'INVITE_REVOKED',
  'INVITE_ACCEPTED',
  'MEMBERSHIP_REMOVED',
  'PASSWORD_RESET_REQUESTED',
  'PASSWORD_RESET_COMPLETED',
  'PLATFORM_ACCESS_CHANGED',
] as const;

export const DELIVERY_STATUSES = ['PENDING', 'SENT', 'FAILED', 'NOT_CONFIGURED'] as const;
export const PASSWORD_RESET_STATUSES = ['PENDING', 'USED', 'REVOKED', 'EXPIRED'] as const;

const lista = (valores: readonly string[]) => valores.map((v) => `'${v}'`).join(', ');

export class AccountsAdministration1792800000000 implements MigrationInterface {
  name = 'AccountsAdministration1792800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const action of NEW_AUDIT_ACTIONS) {
      await queryRunner.query(`ALTER TYPE audit_action ADD VALUE IF NOT EXISTS '${action}'`);
    }

    await queryRunner.query(`ALTER TABLE audit_logs ADD COLUMN target_user_id varchar(30) NULL`);
    await queryRunner.query(
      `ALTER TABLE audit_logs ADD CONSTRAINT fk_audit_logs_target_user
        FOREIGN KEY (target_user_id) REFERENCES users (id) ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_audit_logs_target_user_occurred_at ON audit_logs (target_user_id, occurred_at)`,
    );
    await queryRunner.query(`CREATE INDEX idx_audit_logs_occurred_at ON audit_logs (occurred_at)`);

    await queryRunner.query(`ALTER TABLE sessions ADD COLUMN reauthenticated_at timestamptz(3) NULL`);

    await queryRunner.query(`
      ALTER TABLE invites
        ADD COLUMN target_user_id varchar(30) NULL,
        ADD COLUMN platform_permissions platform_permission[] NULL,
        ADD COLUMN delivery_status varchar(20) NOT NULL DEFAULT 'PENDING',
        ADD COLUMN delivery_attempts integer NOT NULL DEFAULT 0,
        ADD COLUMN last_delivery_at timestamptz(3) NULL,
        ADD COLUMN delivery_failure varchar(40) NULL,
        ADD COLUMN send_count integer NOT NULL DEFAULT 1,
        ADD COLUMN request_key varchar(64) NULL,
        ADD COLUMN updated_at timestamptz(3) NOT NULL DEFAULT now()
    `);
    await queryRunner.query(
      `ALTER TABLE invites ADD CONSTRAINT fk_invites_target_user
        FOREIGN KEY (target_user_id) REFERENCES users (id) ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `ALTER TABLE invites ADD CONSTRAINT ck_invites_delivery_status
        CHECK (delivery_status IN (${lista(DELIVERY_STATUSES)}))`,
    );
    await queryRunner.query(
      `ALTER TABLE invites ADD CONSTRAINT ck_invites_delivery_attempts CHECK (delivery_attempts >= 0)`,
    );
    await queryRunner.query(`ALTER TABLE invites ADD CONSTRAINT ck_invites_send_count CHECK (send_count >= 1)`);
    await queryRunner.query(
      `ALTER TABLE invites ADD CONSTRAINT ck_invites_type_scope CHECK (
        (type = 'ESTABLISHMENT' AND tenant_id IS NOT NULL AND establishment_role IS NOT NULL
          AND platform_role IS NULL AND platform_permissions IS NULL)
        OR (type = 'PLATFORM' AND tenant_id IS NULL AND establishment_role IS NULL
          AND platform_role IS NOT NULL)
      )`,
    );
    await queryRunner.query(
      `ALTER TABLE invites ADD CONSTRAINT uq_invites_created_by_request_key
        UNIQUE (created_by_user_id, request_key)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_invites_pending_establishment ON invites (tenant_id, target_email)
        WHERE status = 'PENDING' AND type = 'ESTABLISHMENT'`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_invites_pending_platform ON invites (target_email)
        WHERE status = 'PENDING' AND type = 'PLATFORM'`,
    );
    await queryRunner.query(`CREATE INDEX idx_invites_target_user_id ON invites (target_user_id)`);
    await queryRunner.query(`CREATE INDEX idx_invites_status_created_at ON invites (status, created_at)`);

    await queryRunner.query(`
      CREATE TABLE password_resets (
        id varchar(30) NOT NULL,
        user_id varchar(30) NOT NULL,
        requested_by_user_id varchar(30) NOT NULL,
        token_hash char(64) NOT NULL,
        status varchar(20) NOT NULL DEFAULT 'PENDING',
        created_at timestamptz(3) NOT NULL DEFAULT now(),
        expires_at timestamptz(3) NOT NULL,
        used_at timestamptz(3) NULL,
        revoked_at timestamptz(3) NULL,
        delivery_status varchar(20) NOT NULL DEFAULT 'PENDING',
        delivery_attempts integer NOT NULL DEFAULT 0,
        last_delivery_at timestamptz(3) NULL,
        delivery_failure varchar(40) NULL,
        request_key varchar(64) NULL,
        CONSTRAINT pk_password_resets PRIMARY KEY (id),
        CONSTRAINT uq_password_resets_token_hash UNIQUE (token_hash),
        CONSTRAINT uq_password_resets_requested_by_request_key UNIQUE (requested_by_user_id, request_key),
        CONSTRAINT fk_password_resets_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
        CONSTRAINT fk_password_resets_requested_by_user FOREIGN KEY (requested_by_user_id)
          REFERENCES users (id) ON DELETE RESTRICT,
        CONSTRAINT ck_password_resets_status CHECK (status IN (${lista(PASSWORD_RESET_STATUSES)})),
        CONSTRAINT ck_password_resets_delivery_status CHECK (delivery_status IN (${lista(DELIVERY_STATUSES)})),
        CONSTRAINT ck_password_resets_delivery_attempts CHECK (delivery_attempts >= 0),
        CONSTRAINT ck_password_resets_expires_after_created CHECK (expires_at > created_at)
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_password_resets_pending_user ON password_resets (user_id) WHERE status = 'PENDING'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE password_resets`);
    await queryRunner.query(`DROP INDEX idx_invites_status_created_at`);
    await queryRunner.query(`DROP INDEX idx_invites_target_user_id`);
    await queryRunner.query(`DROP INDEX uq_invites_pending_platform`);
    await queryRunner.query(`DROP INDEX uq_invites_pending_establishment`);
    await queryRunner.query(`
      ALTER TABLE invites
        DROP CONSTRAINT uq_invites_created_by_request_key,
        DROP CONSTRAINT ck_invites_type_scope,
        DROP CONSTRAINT ck_invites_send_count,
        DROP CONSTRAINT ck_invites_delivery_attempts,
        DROP CONSTRAINT ck_invites_delivery_status,
        DROP CONSTRAINT fk_invites_target_user,
        DROP COLUMN updated_at,
        DROP COLUMN request_key,
        DROP COLUMN send_count,
        DROP COLUMN delivery_failure,
        DROP COLUMN last_delivery_at,
        DROP COLUMN delivery_attempts,
        DROP COLUMN delivery_status,
        DROP COLUMN platform_permissions,
        DROP COLUMN target_user_id
    `);
    await queryRunner.query(`ALTER TABLE sessions DROP COLUMN reauthenticated_at`);
    await queryRunner.query(`DROP INDEX idx_audit_logs_occurred_at`);
    await queryRunner.query(`DROP INDEX idx_audit_logs_target_user_occurred_at`);
    await queryRunner.query(
      `ALTER TABLE audit_logs DROP CONSTRAINT fk_audit_logs_target_user, DROP COLUMN target_user_id`,
    );
    // Os valores novos de `audit_action` ficam: o PostgreSQL não remove valor
    // de enum. Nenhuma linha anterior a esta migration os usa.
  }
}
