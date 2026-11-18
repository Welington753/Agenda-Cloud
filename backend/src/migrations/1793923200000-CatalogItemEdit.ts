// Edição do catálogo modular em "Planos e adicionais" (ver
// docs/plans/edicao-catalogo-modular.md). Só acréscimo:
//
// 1. `audit_action` ganha `CATALOG_ITEM_CHANGED`, a linha do histórico
//    administrativo de cada edição de nome, descrição ou preço padrão do
//    Agendamento essencial ou de um adicional.
//
// Nome e descrição já moram em `addon_modules` e em `plans` (essencial);
// preços continuam em `addon_module_prices` e `plan_prices`, uma linha por
// mudança. Nenhuma tabela, coluna ou linha muda aqui.
//
// `ADD VALUE` não pode ser desfeito no PostgreSQL: o `down` deixa o valor
// (inofensivo para a API anterior, que nunca o grava nem o lê como enum).
import type { MigrationInterface, QueryRunner } from 'typeorm';

export const CATALOG_ITEM_AUDIT_ACTION = 'CATALOG_ITEM_CHANGED';

export class CatalogItemEdit1793923200000 implements MigrationInterface {
  name = 'CatalogItemEdit1793923200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE audit_action ADD VALUE IF NOT EXISTS '${CATALOG_ITEM_AUDIT_ACTION}'`);
  }

  public async down(): Promise<void> {
    // Nada a desfazer: o valor do enum fica (ver o cabeçalho).
  }
}
