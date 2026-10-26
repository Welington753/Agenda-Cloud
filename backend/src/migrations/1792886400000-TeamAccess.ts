// Equipe por estabelecimento e ciclo de vida do estabelecimento (ver
// docs/plans/equipe-acessos-e-plano.md). Só ACRESCENTA: nenhuma coluna
// existente muda de tipo, nenhuma linha existente é reescrita e nenhum
// vínculo antigo perde acesso (todos nascem `ACTIVE`).
//
// 1. `tenant_status` ganha `ARCHIVED` (arquivamento lógico: o
//    estabelecimento sai de operação, nada é apagado). `ADD VALUE` não pode
//    ser desfeito no PostgreSQL; o `down` deixa o valor.
// 2. `tenants.restore_status`: a situação (TRIAL ou ACTIVE) para a qual a
//    reativação devolve um estabelecimento suspenso ou arquivado. Sem ela, a
//    reativação teria de inventar a situação anterior.
// 3. `permission` ganha as três ações que o dono libera, uma a uma, para o
//    funcionário nos PRÓPRIOS atendimentos: iniciar, concluir e marcar falta.
// 4. `audit_action` ganha as ações novas do histórico.
// 5. `memberships.status` (`ACTIVE` | `SUSPENDED`) e quem/quando mudou:
//    suspender um acesso não apaga o vínculo nem a ligação com o
//    profissional. Só `ACTIVE` dá acesso (conferido em toda requisição).
// 6. `invites.professional_id`: o convite de funcionário reserva UM
//    profissional do estabelecimento (FK composta com o tenant, como as
//    demais). No máximo um convite pendente por profissional; o convite de
//    funcionário sempre tem profissional, e só ele.
//
// Sem entidade TypeORM para as colunas novas, como em AccountsAdministration:
// as specs estruturais amarram cada entidade à migration inicial. O acesso é
// por SQL explícito, provado contra o PostgreSQL descartável
// (test/team-access-postgres.db-e2e-spec.ts).
import type { MigrationInterface, QueryRunner } from 'typeorm';

export const NEW_TEAM_PERMISSIONS = [
  'ATENDIMENTO_PROPRIO_INICIAR',
  'ATENDIMENTO_PROPRIO_CONCLUIR',
  'ATENDIMENTO_PROPRIO_FALTA',
] as const;

export const NEW_TEAM_AUDIT_ACTIONS = [
  'TENANT_UPDATED',
  'TENANT_ARCHIVED',
  'MEMBERSHIP_SUSPENDED',
  'MEMBERSHIP_REACTIVATED',
] as const;

export const MEMBERSHIP_STATUSES = ['ACTIVE', 'SUSPENDED'] as const;

const lista = (valores: readonly string[]) => valores.map((v) => `'${v}'`).join(', ');

export class TeamAccess1792886400000 implements MigrationInterface {
  name = 'TeamAccess1792886400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE tenant_status ADD VALUE IF NOT EXISTS 'ARCHIVED'`);
    for (const permission of NEW_TEAM_PERMISSIONS) {
      await queryRunner.query(`ALTER TYPE permission ADD VALUE IF NOT EXISTS '${permission}'`);
    }
    for (const action of NEW_TEAM_AUDIT_ACTIONS) {
      await queryRunner.query(`ALTER TYPE audit_action ADD VALUE IF NOT EXISTS '${action}'`);
    }

    // Só TRIAL/ACTIVE: são as situações em que o estabelecimento opera. O
    // texto evita comparar com o valor novo do enum na mesma transação.
    await queryRunner.query(`ALTER TABLE tenants ADD COLUMN restore_status tenant_status NULL`);
    await queryRunner.query(
      `ALTER TABLE tenants ADD CONSTRAINT ck_tenants_restore_status
        CHECK (restore_status IS NULL OR restore_status::text IN ('TRIAL', 'ACTIVE'))`,
    );

    await queryRunner.query(`
      ALTER TABLE memberships
        ADD COLUMN status varchar(20) NOT NULL DEFAULT 'ACTIVE',
        ADD COLUMN status_changed_at timestamptz(3) NULL,
        ADD COLUMN status_changed_by_user_id varchar(30) NULL
    `);
    await queryRunner.query(
      `ALTER TABLE memberships ADD CONSTRAINT ck_memberships_status
        CHECK (status IN (${lista(MEMBERSHIP_STATUSES)}))`,
    );
    await queryRunner.query(
      `ALTER TABLE memberships ADD CONSTRAINT fk_memberships_status_changed_by_user
        FOREIGN KEY (status_changed_by_user_id) REFERENCES users (id) ON DELETE RESTRICT`,
    );

    await queryRunner.query(`ALTER TABLE invites ADD COLUMN professional_id varchar(30) NULL`);
    await queryRunner.query(
      `ALTER TABLE invites ADD CONSTRAINT fk_invites_tenant_professional
        FOREIGN KEY (tenant_id, professional_id) REFERENCES professionals (tenant_id, id) ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `ALTER TABLE invites ADD CONSTRAINT ck_invites_professional_scope CHECK (
        (professional_id IS NULL AND establishment_role IS DISTINCT FROM 'PROFISSIONAL')
        OR (professional_id IS NOT NULL AND establishment_role = 'PROFISSIONAL')
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_invites_pending_professional ON invites (tenant_id, professional_id)
        WHERE status = 'PENDING' AND professional_id IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX uq_invites_pending_professional`);
    await queryRunner.query(`
      ALTER TABLE invites
        DROP CONSTRAINT ck_invites_professional_scope,
        DROP CONSTRAINT fk_invites_tenant_professional,
        DROP COLUMN professional_id
    `);
    await queryRunner.query(`
      ALTER TABLE memberships
        DROP CONSTRAINT fk_memberships_status_changed_by_user,
        DROP CONSTRAINT ck_memberships_status,
        DROP COLUMN status_changed_by_user_id,
        DROP COLUMN status_changed_at,
        DROP COLUMN status
    `);
    await queryRunner.query(`ALTER TABLE tenants DROP CONSTRAINT ck_tenants_restore_status, DROP COLUMN restore_status`);
    // Os valores novos de `tenant_status`, `permission` e `audit_action`
    // ficam: o PostgreSQL não remove valor de enum. Um estabelecimento
    // `ARCHIVED` continua fora de operação depois da reversão (nenhum código
    // anterior o trata como utilizável).
  }
}
