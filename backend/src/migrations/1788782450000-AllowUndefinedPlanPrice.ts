// Lote 6B.2 (correção): `plans.price_cents` foi criada NOT NULL pela migration
// inicial (1788782400000-InitialSchema.ts), quando ainda se assumia que todo
// plano teria preço definido desde o primeiro cadastro. A decisão de produto
// mudou: os preços de essencial/equipe/pro ainda não foram aprovados
// comercialmente, então o catálogo (1788782460000-InitialPlanCatalog.ts)
// precisa poder inserir price_cents = NULL — "não definido", nunca 0.
//
// Timestamp entre a migration inicial (1788782400000) e o catálogo
// (1788782460000) para que a coluna já aceite NULL quando o catálogo rodar.
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AllowUndefinedPlanPrice1788782450000 implements MigrationInterface {
  name = 'AllowUndefinedPlanPrice1788782450000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE plans ALTER COLUMN price_cents DROP NOT NULL`);
  }

  // Precisa rodar depois que InitialPlanCatalog.down() já removeu as linhas
  // com price_cents NULL que ele mesmo criou — senão SET NOT NULL falha
  // encontrando NULL em uso. A ordem de reversão do TypeORM (mais recente
  // primeiro) já garante isso: InitialPlanCatalog (1788782460000) reverte
  // antes desta migration (1788782450000).
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE plans ALTER COLUMN price_cents SET NOT NULL`);
  }
}
