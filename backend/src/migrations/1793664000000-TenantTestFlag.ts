// Marca de estabelecimento de teste (ver
// docs/plans/estabelecimento-teste-e-slugs-reservados.md). Só acréscimos:
// nenhuma linha existente muda de significado.
//
// 1. `audit_action` ganha `TENANT_TEST_FLAG_CHANGED`. `ADD VALUE` não pode
//    ser desfeito no PostgreSQL; o `down` deixa o valor (inofensivo, nenhuma
//    linha antiga o usa).
// 2. `tenants.is_test boolean NOT NULL DEFAULT false`. O padrão NÃO
//    identifica testes antigos: todo estabelecimento existente nasce como
//    real (indexável, como hoje). Os testes precisam ser marcados pelo
//    portal (runbook publicacao-tenant-teste-slugs.md).
//
// O `down` só é seguro sem marca gravada: recusa se algum estabelecimento
// estiver marcado como teste, em vez de apagar a classificação.
import type { MigrationInterface, QueryRunner } from 'typeorm';

export const TENANT_TEST_FLAG_AUDIT_ACTION = 'TENANT_TEST_FLAG_CHANGED';

export class TenantTestFlag1793664000000 implements MigrationInterface {
  name = 'TenantTestFlag1793664000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE audit_action ADD VALUE IF NOT EXISTS '${TENANT_TEST_FLAG_AUDIT_ACTION}'`);
    await queryRunner.query(`ALTER TABLE tenants ADD COLUMN is_test boolean NOT NULL DEFAULT false`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const [marcados] = (await queryRunner.query(
      `SELECT count(*)::int AS total FROM tenants WHERE is_test`,
    )) as { total: number }[];
    if (marcados.total > 0) {
      throw new Error('Há estabelecimento marcado como teste; o down apagaria a classificação e foi recusado.');
    }
    await queryRunner.query(`ALTER TABLE tenants DROP COLUMN is_test`);
  }
}
