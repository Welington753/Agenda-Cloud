// Recuperação de senha pela própria pessoa ("Esqueci minha senha"). Ver
// docs/plans/recuperacao-de-senha.md.
//
// 1. `password_resets.origin`: quem originou o link. `ADMIN` (todas as linhas
//    existentes, pelo DEFAULT) exige `requested_by_user_id`, a conta
//    autenticada que pediu; `SELF_SERVICE` não tem autor: o pedido público é
//    anônimo e a conta encontrada é só o ALVO (`user_id`). A API anterior,
//    que não conhece a coluna, continua inserindo `ADMIN` com autor.
// 2. `password_resets.delivery_due_at`: o envio que o executor ainda deve
//    fazer (ou repetir) a partir desse instante, só em `SELF_SERVICE`. É a
//    fila persistente do envio: sobrevive a uma reinicialização. O token em
//    texto nunca é guardado: o executor emite um token novo a cada envio e
//    grava só o hash, antes de chamar o provedor.
// 3. `password_reset_requests`: cada pedido público, gravado como chegou e
//    resolvido depois pelo executor, fora da requisição. A resposta pública é
//    sempre a mesma (202) e não espera nem a busca da conta nem o provedor.
//    O identificador digitado é apagado ao processar; fica só o desfecho.
//
// Sem entidade TypeORM, como `password_resets`: acesso por SQL explícito em
// src/accounts/, provado contra PostgreSQL descartável
// (test/password-recovery-postgres.db-e2e-spec.ts).
import type { MigrationInterface, QueryRunner } from 'typeorm';

export const PASSWORD_RESET_ORIGINS = ['ADMIN', 'SELF_SERVICE'] as const;
export const PASSWORD_RESET_REQUEST_OUTCOMES = [
  'ISSUED',
  'NO_MATCH',
  'NOT_ELIGIBLE',
  'ACTIVE_LINK_KEPT',
  'ACCOUNT_LIMIT',
] as const;

const lista = (valores: readonly string[]) => valores.map((v) => `'${v}'`).join(', ');

export class SelfServicePasswordReset1794441600000 implements MigrationInterface {
  name = 'SelfServicePasswordReset1794441600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE password_resets
        ADD COLUMN origin varchar(20) NOT NULL DEFAULT 'ADMIN',
        ADD COLUMN delivery_due_at timestamptz(3) NULL,
        ALTER COLUMN requested_by_user_id DROP NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE password_resets
        ADD CONSTRAINT ck_password_resets_origin CHECK (origin IN (${lista(PASSWORD_RESET_ORIGINS)})),
        ADD CONSTRAINT ck_password_resets_origin_requester CHECK (
          (origin = 'ADMIN' AND requested_by_user_id IS NOT NULL)
          OR (origin = 'SELF_SERVICE' AND requested_by_user_id IS NULL)
        ),
        ADD CONSTRAINT ck_password_resets_delivery_due_self_service CHECK (
          delivery_due_at IS NULL OR origin = 'SELF_SERVICE'
        )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_password_resets_delivery_due ON password_resets (delivery_due_at)
        WHERE delivery_due_at IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_password_resets_self_service_user_created ON password_resets (user_id, created_at)
        WHERE origin = 'SELF_SERVICE'`,
    );
    await queryRunner.query(`
      CREATE TABLE password_reset_requests (
        id varchar(30) NOT NULL,
        identifier citext NULL,
        requested_at timestamptz(3) NOT NULL DEFAULT now(),
        processed_at timestamptz(3) NULL,
        outcome varchar(20) NULL,
        password_reset_id varchar(30) NULL,
        CONSTRAINT pk_password_reset_requests PRIMARY KEY (id),
        CONSTRAINT fk_password_reset_requests_reset FOREIGN KEY (password_reset_id)
          REFERENCES password_resets (id) ON DELETE RESTRICT,
        CONSTRAINT ck_password_reset_requests_identifier_length CHECK (char_length(identifier::text) <= 254),
        CONSTRAINT ck_password_reset_requests_outcome CHECK (outcome IN (${lista(PASSWORD_RESET_REQUEST_OUTCOMES)})),
        CONSTRAINT ck_password_reset_requests_state CHECK (
          (processed_at IS NULL AND outcome IS NULL AND identifier IS NOT NULL AND password_reset_id IS NULL)
          OR (processed_at IS NOT NULL AND outcome IS NOT NULL AND identifier IS NULL
              AND (outcome = 'ISSUED') = (password_reset_id IS NOT NULL))
        )
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_password_reset_requests_pending ON password_reset_requests (requested_at)
        WHERE processed_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_password_reset_requests_processed ON password_reset_requests (processed_at)
        WHERE processed_at IS NOT NULL`,
    );
  }

  /** Só para ensaio. Os links de autoatendimento (validade de 1 hora, sem
   * autor) não cabem no schema anterior, que exige autor: são apagados junto
   * com a fila de pedidos. Os links da administração ficam intactos. */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE password_reset_requests`);
    await queryRunner.query(`DELETE FROM password_resets WHERE origin = 'SELF_SERVICE'`);
    await queryRunner.query(`DROP INDEX idx_password_resets_self_service_user_created`);
    await queryRunner.query(`DROP INDEX idx_password_resets_delivery_due`);
    await queryRunner.query(`
      ALTER TABLE password_resets
        DROP CONSTRAINT ck_password_resets_delivery_due_self_service,
        DROP CONSTRAINT ck_password_resets_origin_requester,
        DROP CONSTRAINT ck_password_resets_origin,
        DROP COLUMN delivery_due_at,
        DROP COLUMN origin,
        ALTER COLUMN requested_by_user_id SET NOT NULL
    `);
  }
}
