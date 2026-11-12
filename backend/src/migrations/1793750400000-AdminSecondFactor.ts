// Verificação em duas etapas (TOTP) das contas de plataforma (ver
// docs/plans/2fa-contas-administrativas.md). Só acréscimos: nenhuma linha
// existente muda de significado e nenhuma conta antiga perde acesso por esta
// migration (a exigência é decidida pela API, com `PLATFORM_2FA_ENFORCEMENT`).
//
// 1. `audit_action` ganha as ações do segundo fator. `ADD VALUE` não pode ser
//    desfeito no PostgreSQL; o `down` deixa os valores (inofensivos).
// 2. `user_second_factors`: o fator ATIVO de cada conta (um por conta). O
//    segredo TOTP fica cifrado (AES-256-GCM) com uma chave que existe só no
//    ambiente da API, nunca no banco; `key_version` diz qual chave cifrou.
//    `last_used_counter` impede reutilizar um código já aceito.
// 3. `second_factor_enrollments`: cadastro pendente (um por conta), preso à
//    sessão que o começou e com validade curta. Só vira fator ativo depois
//    de um código válido.
// 4. `second_factor_recovery_codes`: códigos de recuperação de uso único,
//    guardados só como SHA-256.
// 5. `second_factor_grants`: liberações de uso único para cadastrar um fator
//    novo (recuperação ou primeiro cadastro de quem foi promovido), enviadas
//    ao e-mail verificado do titular. Só o hash do token é guardado. Uma
//    liberação nunca remove o fator ativo nem dá acesso: só permite
//    cadastrar outro fator, depois da senha.
// 6. `second_factor_attempts`: falhas de segundo fator por conta, com trava
//    de 15 minutos. Trava só as tentativas de segundo fator, nunca o login.
// 7. `sessions`: quando ESTA sessão confirmou o segundo fator (e como), e até
//    quando ela pode cadastrar um fator (convite de plataforma aceito ou
//    liberação usada nesta sessão).
// 8. `users.second_factor_enrollment_required`: conta que precisa cadastrar
//    o fator antes de usar o portal mesmo na fase `optional` (masters novos,
//    por convite ou promoção). Masters existentes nascem `false`.
//
// O `down` APAGA todos os fatores e códigos: só para ensaio em banco
// descartável, nunca como rollback no piloto (ver o runbook do lote).
import type { MigrationInterface, QueryRunner } from 'typeorm';

export const SECOND_FACTOR_AUDIT_ACTIONS = [
  'SECOND_FACTOR_ENABLED',
  'SECOND_FACTOR_REPLACED',
  'SECOND_FACTOR_LOCKED',
  'SECOND_FACTOR_GRANT_ISSUED',
  'SECOND_FACTOR_GRANT_USED',
  'RECOVERY_CODE_USED',
  'RECOVERY_CODES_REGENERATED',
] as const;

export class AdminSecondFactor1793750400000 implements MigrationInterface {
  name = 'AdminSecondFactor1793750400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const action of SECOND_FACTOR_AUDIT_ACTIONS) {
      await queryRunner.query(`ALTER TYPE audit_action ADD VALUE IF NOT EXISTS '${action}'`);
    }

    await queryRunner.query(`
      CREATE TABLE user_second_factors (
        user_id varchar(30) NOT NULL,
        method varchar(10) NOT NULL DEFAULT 'TOTP',
        secret_ciphertext bytea NOT NULL,
        secret_nonce bytea NOT NULL,
        secret_tag bytea NOT NULL,
        key_version smallint NOT NULL,
        confirmed_at timestamptz(3) NOT NULL,
        last_used_counter bigint NULL,
        created_at timestamptz(3) NOT NULL DEFAULT now(),
        updated_at timestamptz(3) NOT NULL DEFAULT now(),
        CONSTRAINT pk_user_second_factors PRIMARY KEY (user_id),
        CONSTRAINT fk_user_second_factors_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
        CONSTRAINT ck_user_second_factors_method CHECK (method IN ('TOTP')),
        CONSTRAINT ck_user_second_factors_key_version CHECK (key_version > 0),
        CONSTRAINT ck_user_second_factors_nonce CHECK (octet_length(secret_nonce) = 12),
        CONSTRAINT ck_user_second_factors_tag CHECK (octet_length(secret_tag) = 16),
        CONSTRAINT ck_user_second_factors_counter CHECK (last_used_counter IS NULL OR last_used_counter >= 0)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE second_factor_enrollments (
        id varchar(30) NOT NULL,
        user_id varchar(30) NOT NULL,
        session_id varchar(30) NOT NULL,
        secret_ciphertext bytea NOT NULL,
        secret_nonce bytea NOT NULL,
        secret_tag bytea NOT NULL,
        key_version smallint NOT NULL,
        created_at timestamptz(3) NOT NULL DEFAULT now(),
        expires_at timestamptz(3) NOT NULL,
        CONSTRAINT pk_second_factor_enrollments PRIMARY KEY (id),
        CONSTRAINT uq_second_factor_enrollments_user UNIQUE (user_id),
        CONSTRAINT fk_second_factor_enrollments_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        CONSTRAINT fk_second_factor_enrollments_session FOREIGN KEY (session_id) REFERENCES sessions (id) ON DELETE CASCADE,
        CONSTRAINT ck_second_factor_enrollments_expires CHECK (expires_at > created_at)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE second_factor_recovery_codes (
        id varchar(30) NOT NULL,
        user_id varchar(30) NOT NULL,
        code_hash char(64) NOT NULL,
        created_at timestamptz(3) NOT NULL DEFAULT now(),
        used_at timestamptz(3) NULL,
        CONSTRAINT pk_second_factor_recovery_codes PRIMARY KEY (id),
        CONSTRAINT uq_second_factor_recovery_codes_user_hash UNIQUE (user_id, code_hash),
        CONSTRAINT fk_second_factor_recovery_codes_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(`
      CREATE TABLE second_factor_grants (
        id varchar(30) NOT NULL,
        user_id varchar(30) NOT NULL,
        token_hash char(64) NOT NULL,
        issued_by_user_id varchar(30) NOT NULL,
        via varchar(10) NOT NULL,
        reason varchar(300) NOT NULL,
        request_key varchar(80) NULL,
        created_at timestamptz(3) NOT NULL DEFAULT now(),
        expires_at timestamptz(3) NOT NULL,
        used_at timestamptz(3) NULL,
        revoked_at timestamptz(3) NULL,
        delivery_status varchar(20) NOT NULL DEFAULT 'PENDING',
        delivery_attempts integer NOT NULL DEFAULT 0,
        last_delivery_at timestamptz(3) NULL,
        delivery_failure varchar(40) NULL,
        CONSTRAINT pk_second_factor_grants PRIMARY KEY (id),
        CONSTRAINT uq_second_factor_grants_token_hash UNIQUE (token_hash),
        CONSTRAINT fk_second_factor_grants_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
        CONSTRAINT fk_second_factor_grants_issued_by FOREIGN KEY (issued_by_user_id) REFERENCES users (id) ON DELETE RESTRICT,
        CONSTRAINT ck_second_factor_grants_via CHECK (via IN ('PORTAL', 'SCRIPT')),
        CONSTRAINT ck_second_factor_grants_expires CHECK (expires_at > created_at),
        CONSTRAINT ck_second_factor_grants_delivery_status
          CHECK (delivery_status IN ('PENDING', 'SENT', 'FAILED', 'NOT_CONFIGURED')),
        CONSTRAINT ck_second_factor_grants_delivery_attempts CHECK (delivery_attempts >= 0)
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_second_factor_grants_request_key
         ON second_factor_grants (issued_by_user_id, request_key) WHERE request_key IS NOT NULL`,
    );
    await queryRunner.query(`CREATE INDEX idx_second_factor_grants_user ON second_factor_grants (user_id)`);

    await queryRunner.query(`
      CREATE TABLE second_factor_attempts (
        user_id varchar(30) NOT NULL,
        failed_count smallint NOT NULL DEFAULT 0,
        window_started_at timestamptz(3) NULL,
        locked_until timestamptz(3) NULL,
        CONSTRAINT pk_second_factor_attempts PRIMARY KEY (user_id),
        CONSTRAINT fk_second_factor_attempts_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        CONSTRAINT ck_second_factor_attempts_count CHECK (failed_count >= 0)
      )
    `);

    await queryRunner.query(`
      ALTER TABLE sessions
        ADD COLUMN second_factor_verified_at timestamptz(3) NULL,
        ADD COLUMN second_factor_method varchar(20) NULL,
        ADD COLUMN second_factor_enrollment_allowed_until timestamptz(3) NULL
    `);
    await queryRunner.query(
      `ALTER TABLE sessions ADD CONSTRAINT ck_sessions_second_factor_method
        CHECK (second_factor_method IS NULL OR second_factor_method IN ('TOTP', 'RECOVERY_CODE'))`,
    );
    await queryRunner.query(
      `ALTER TABLE users ADD COLUMN second_factor_enrollment_required boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users DROP COLUMN second_factor_enrollment_required`);
    await queryRunner.query(`ALTER TABLE sessions DROP CONSTRAINT ck_sessions_second_factor_method`);
    await queryRunner.query(`
      ALTER TABLE sessions
        DROP COLUMN second_factor_enrollment_allowed_until,
        DROP COLUMN second_factor_method,
        DROP COLUMN second_factor_verified_at
    `);
    await queryRunner.query(`DROP TABLE second_factor_attempts`);
    await queryRunner.query(`DROP TABLE second_factor_grants`);
    await queryRunner.query(`DROP TABLE second_factor_recovery_codes`);
    await queryRunner.query(`DROP TABLE second_factor_enrollments`);
    await queryRunner.query(`DROP TABLE user_second_factors`);
  }
}
