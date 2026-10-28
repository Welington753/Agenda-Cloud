// Gerente com permissões dadas pelo dono e login interno com aparência de
// e-mail (ver docs/plans/equipe-gerente-login-interno.md). Só ACRESCENTA e
// relaxa: nenhuma linha existente é reescrita, nenhum login existente muda,
// nenhum vínculo antigo ganha acesso.
//
// 1. `permission` ganha as ações que ainda não tinham valor próprio:
//    consultar e tratar solicitações; consultar, registrar e estornar
//    recebimentos. As demais áreas reaproveitam os valores já existentes.
// 2. `memberships.permissions_confirmed_at`: quando o dono confirmou, na tela
//    nova, as permissões de um GERENTE. Enquanto for NULL, nenhuma `GRANTED`
//    do vínculo vale (ver common/tenant-authorization.ts). Um vínculo GERENTE
//    antigo, com ou sem ajustes gravados, continua sem área nenhuma até o
//    dono confirmar o que concede.
// 3. `users.username` passa a aceitar o formato de e-mail (uma `@` e um
//    domínio): `maria@salao`, `recepcao@barbearia.com`. Todo nome de usuário
//    que o formato anterior aceitava continua aceito.
// 4. Unicidade CRUZADA entre `users.email` e `users.username`: o mesmo
//    identificador nunca é o e-mail de uma conta e o login de outra, então
//    o login acha no máximo uma conta. Um gatilho confere, com uma trava
//    consultiva por identificador (`pg_advisory_xact_lock`), toda gravação
//    que muda e-mail ou login: duas gravações simultâneas do mesmo texto
//    ficam em fila, e a segunda vê a primeira. A colisão é recusada com
//    `unique_violation` e a restrição `uq_users_login_identifier`.
//
// Antes de mudar qualquer coisa, a migration CONFERE que não existe colisão
// cruzada no banco. Se existir, ela para com a lista de contas, sem escolher
// nem alterar nenhuma (a decisão é humana).
//
// COMPATIBILIDADE: a API anterior continua funcionando com o banco migrado.
// Ela não lê a coluna nova, trata GERENTE como papel sem área e só cria logins
// sem `@`. Um login com `@` criado pela API nova não entra pela tela anterior
// (que o trataria como e-mail): voltar a API depois disso exige trocar esses
// logins antes (ver "Reversão" no plano).
import type { MigrationInterface, QueryRunner } from 'typeorm';

export const MANAGER_NEW_PERMISSIONS = [
  'SOLICITACOES_VISUALIZAR',
  'SOLICITACOES_TRATAR',
  'RECEBIMENTOS_VISUALIZAR',
  'RECEBIMENTOS_REGISTRAR',
  'RECEBIMENTOS_ESTORNAR',
] as const;

/** Mesmo formato de `usernameSchema` (auth/login.dto.ts): parte local que o
 * formato anterior já aceitava (mais `+`), e opcionalmente `@` e um domínio
 * que começa e termina por letra ou número. Tamanho conferido à parte. */
export const LOGIN_USERNAME_PATTERN = '^[a-z0-9][a-z0-9._+-]*(@[a-z0-9]([a-z0-9.-]*[a-z0-9])?)?$';
export const LOGIN_USERNAME_MIN = 3;
export const LOGIN_USERNAME_MAX = 80;

/** Formato da migration StaffLogin, para a reversão. */
const PREVIOUS_USERNAME_PATTERN = '^[a-z0-9][a-z0-9._-]{2,39}$';

export class TeamManagerAccess1793145600000 implements MigrationInterface {
  name = 'TeamManagerAccess1793145600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const colisoes = (await queryRunner.query(
      `SELECT a.id AS login_user_id, b.id AS email_user_id
         FROM users a JOIN users b ON b.id <> a.id AND b.email = a.username
        ORDER BY a.id, b.id LIMIT 20`,
    )) as { login_user_id: string; email_user_id: string }[];
    if (colisoes.length) {
      const lista = colisoes.map((c) => `${c.login_user_id} (login) x ${c.email_user_id} (e-mail)`).join('; ');
      throw new Error(
        `Existem contas cujo login é o e-mail de outra conta: ${lista}. Resolva cada caso à mão antes de migrar.`,
      );
    }

    for (const permission of MANAGER_NEW_PERMISSIONS) {
      await queryRunner.query(`ALTER TYPE permission ADD VALUE IF NOT EXISTS '${permission}'`);
    }

    await queryRunner.query(`ALTER TABLE memberships ADD COLUMN permissions_confirmed_at timestamptz(3) NULL`);

    await queryRunner.query(`ALTER TABLE users DROP CONSTRAINT ck_users_username_format`);
    await queryRunner.query(
      `ALTER TABLE users ADD CONSTRAINT ck_users_username_format CHECK (username IS NULL OR (
        username::text ~ '${LOGIN_USERNAME_PATTERN}'
        AND char_length(username::text) BETWEEN ${LOGIN_USERNAME_MIN} AND ${LOGIN_USERNAME_MAX}
        AND username::text = lower(username::text)))`,
    );

    await queryRunner.query(`
      CREATE FUNCTION users_login_identifier_guard() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE
        chave text;
      BEGIN
        -- Trava cada identificador em ordem fixa (sem impasse entre duas
        -- gravações que mexem nos mesmos dois textos).
        FOR chave IN
          SELECT DISTINCT lower(v) FROM unnest(ARRAY[NEW.email::text, NEW.username::text]) AS v
           WHERE v IS NOT NULL ORDER BY 1
        LOOP
          PERFORM pg_advisory_xact_lock(hashtextextended('users.login:' || chave, 0));
        END LOOP;
        IF NEW.username IS NOT NULL
           AND EXISTS (SELECT 1 FROM users u WHERE u.id <> NEW.id AND u.email = NEW.username) THEN
          RAISE EXCEPTION 'Identificador de login já usado por outra conta.'
            USING ERRCODE = 'unique_violation', CONSTRAINT = 'uq_users_login_identifier';
        END IF;
        IF NEW.email IS NOT NULL
           AND EXISTS (SELECT 1 FROM users u WHERE u.id <> NEW.id AND u.username = NEW.email) THEN
          RAISE EXCEPTION 'Identificador de login já usado por outra conta.'
            USING ERRCODE = 'unique_violation', CONSTRAINT = 'uq_users_login_identifier';
        END IF;
        RETURN NEW;
      END
      $$
    `);
    await queryRunner.query(
      `CREATE TRIGGER trg_users_login_identifier BEFORE INSERT OR UPDATE OF email, username ON users
        FOR EACH ROW EXECUTE FUNCTION users_login_identifier_guard()`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER trg_users_login_identifier ON users`);
    await queryRunner.query(`DROP FUNCTION users_login_identifier_guard()`);
    // Volta ao formato anterior só se nenhum login novo o violar: o banco
    // recusa (e a reversão para) em vez de apagar ou reescrever logins.
    await queryRunner.query(`ALTER TABLE users DROP CONSTRAINT ck_users_username_format`);
    await queryRunner.query(
      `ALTER TABLE users ADD CONSTRAINT ck_users_username_format
        CHECK (username IS NULL OR (username::text ~ '${PREVIOUS_USERNAME_PATTERN}' AND username::text = lower(username::text)))`,
    );
    await queryRunner.query(`ALTER TABLE memberships DROP COLUMN permissions_confirmed_at`);
    // Os valores novos de `permission` ficam: o PostgreSQL não remove valor de
    // enum. Ajustes já gravados com eles deixam de valer (nenhum código
    // anterior os consulta).
  }
}
