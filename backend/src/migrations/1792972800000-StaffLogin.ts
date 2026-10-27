// Acesso de funcionário por usuário e senha, sem e-mail obrigatório (ver
// docs/plans/operacao-diaria-configuracoes.md, PR 2). Só ACRESCENTA e
// relaxa: nenhuma linha existente é reescrita, nenhum login existente muda.
//
// 1. `users.email` deixa de ser obrigatório. O índice único continua (vários
//    NULL não colidem). Nenhum e-mail fictício é gerado: a conta criada pelo
//    dono para um funcionário tem `email` NULL e `email_verified` false.
// 2. `users.username`: identificador de login próprio, minúsculo, único na
//    plataforma inteira (nunca ambíguo entre estabelecimentos), com o formato
//    conferido no banco. Sem `@`: o login decide pela presença do `@` se o
//    identificador é e-mail ou usuário.
// 3. Toda conta tem pelo menos um identificador de login (e-mail ou usuário).
// 4. `users.must_change_password`: senha temporária entregue pelo dono; a
//    pessoa troca antes de operar (conferido no servidor em toda requisição).
// 5. `staff_account_requests`: a chave do formulário de criação, para um
//    reenvio do mesmo pedido devolver o acesso já criado em vez de criar
//    outro (a senha temporária NUNCA é guardada aqui nem em lugar nenhum).
// 6. `audit_action` ganha as ações novas do histórico.
//
// COMPATIBILIDADE: a API anterior continua funcionando com o banco migrado
// enquanto nenhuma conta sem e-mail existir (só a API nova cria uma). Depois
// que existir, voltar a API para a versão anterior deixa essas contas sem
// login pela tela antiga e quebra telas que esperam e-mail (ver "Reversão"
// no plano).
//
// Sem entidade TypeORM para as colunas novas, como nas migrations anteriores:
// as specs estruturais amarram cada entidade à migration inicial. O acesso é
// por SQL explícito, provado contra o PostgreSQL descartável
// (test/staff-login-postgres.db-e2e-spec.ts).
import type { MigrationInterface, QueryRunner } from 'typeorm';

export const STAFF_LOGIN_AUDIT_ACTIONS = ['STAFF_ACCESS_CREATED', 'STAFF_PASSWORD_RESET', 'PASSWORD_CHANGED'] as const;

/** Mesmo formato de `usernameSchema` (team.dto.ts). */
export const USERNAME_PATTERN = '^[a-z0-9][a-z0-9._-]{2,39}$';

export class StaffLogin1792972800000 implements MigrationInterface {
  name = 'StaffLogin1792972800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const action of STAFF_LOGIN_AUDIT_ACTIONS) {
      await queryRunner.query(`ALTER TYPE audit_action ADD VALUE IF NOT EXISTS '${action}'`);
    }
    await queryRunner.query(`ALTER TABLE users ALTER COLUMN email DROP NOT NULL`);
    await queryRunner.query(`
      ALTER TABLE users
        ADD COLUMN username citext NULL,
        ADD COLUMN must_change_password boolean NOT NULL DEFAULT false
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX uq_users_username ON users (username)`);
    await queryRunner.query(
      `ALTER TABLE users ADD CONSTRAINT ck_users_username_format
        CHECK (username IS NULL OR (username::text ~ '${USERNAME_PATTERN}' AND username::text = lower(username::text)))`,
    );
    await queryRunner.query(
      `ALTER TABLE users ADD CONSTRAINT ck_users_login_identifier CHECK (email IS NOT NULL OR username IS NOT NULL)`,
    );
    await queryRunner.query(`
      CREATE TABLE staff_account_requests (
        actor_user_id varchar(30) NOT NULL,
        request_key varchar(80) NOT NULL,
        tenant_id varchar(30) NOT NULL,
        membership_id varchar(30) NOT NULL,
        user_id varchar(30) NOT NULL,
        created_at timestamptz(3) NOT NULL DEFAULT now(),
        CONSTRAINT pk_staff_account_requests PRIMARY KEY (actor_user_id, request_key),
        CONSTRAINT fk_staff_account_requests_actor FOREIGN KEY (actor_user_id) REFERENCES users (id) ON DELETE CASCADE,
        CONSTRAINT fk_staff_account_requests_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE,
        CONSTRAINT fk_staff_account_requests_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Só volta a exigir e-mail se nenhuma conta sem e-mail existir: o banco
    // recusa (e a reversão para) em vez de apagar ou inventar e-mails.
    await queryRunner.query(`ALTER TABLE users ALTER COLUMN email SET NOT NULL`);
    await queryRunner.query(`DROP TABLE staff_account_requests`);
    await queryRunner.query(`ALTER TABLE users DROP CONSTRAINT ck_users_login_identifier`);
    await queryRunner.query(`ALTER TABLE users DROP CONSTRAINT ck_users_username_format`);
    await queryRunner.query(`DROP INDEX uq_users_username`);
    await queryRunner.query(`ALTER TABLE users DROP COLUMN must_change_password, DROP COLUMN username`);
    // Os valores novos de `audit_action` ficam: o PostgreSQL não remove valor
    // de enum, e o histórico já gravado continua legível.
  }
}
