// Estoque v1, parte 1 de 2 (ver docs/plans/estoque-v1.md): só os valores
// novos dos enums que a parte 2 (`StockModule1794096000000`) usa.
//
// Por que separado: o PostgreSQL só deixa USAR um valor novo de enum depois
// que a transação que o criou foi confirmada (erro 55P04). Esta migration
// roda e é confirmada sozinha antes da 22:
// - CLI (CI, banco descartável, `migration:run:compiled`):
//   `migrationsTransactionMode: 'each'` em migrations-data-source.ts, uma
//   transação por migration;
// - piloto: `scripts/operacao-piloto.mjs` aplica uma pendente por execução.
// A 22 confere, antes de qualquer outra instrução, que estes valores já
// estão confirmados; se não estiverem, falha sem gravar nada.
//
// 1. `feature_key` ganha `ESTOQUE` (o recurso do adicional ESTOQUE).
// 2. `permission` ganha `ESTOQUE_VISUALIZAR` e `ESTOQUE_GERENCIAR` (o dono
//    concede ao gerente; operar inclui visualizar).
// 3. `audit_action` ganha as duas ações de cadastro do estoque.
//
// Nenhum valor é usado aqui, e nenhuma linha ou tabela muda. `ADD VALUE` não
// pode ser desfeito no PostgreSQL: o `down` deixa os valores (inofensivos
// para a API anterior, que nunca os grava).
import type { MigrationInterface, QueryRunner } from 'typeorm';

export const STOCK_FEATURE_KEY = 'ESTOQUE';
export const STOCK_PERMISSIONS = ['ESTOQUE_VISUALIZAR', 'ESTOQUE_GERENCIAR'] as const;
export const STOCK_AUDIT_ACTIONS = ['STOCK_CATEGORY_CHANGED', 'STOCK_PRODUCT_CHANGED'] as const;

export class StockEnumValues1794009600000 implements MigrationInterface {
  name = 'StockEnumValues1794009600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE feature_key ADD VALUE IF NOT EXISTS '${STOCK_FEATURE_KEY}'`);
    for (const permission of STOCK_PERMISSIONS) {
      await queryRunner.query(`ALTER TYPE permission ADD VALUE IF NOT EXISTS '${permission}'`);
    }
    for (const action of STOCK_AUDIT_ACTIONS) {
      await queryRunner.query(`ALTER TYPE audit_action ADD VALUE IF NOT EXISTS '${action}'`);
    }
  }

  public async down(): Promise<void> {
    // Nada a desfazer: os valores dos enums ficam (ver o cabeçalho).
  }
}
