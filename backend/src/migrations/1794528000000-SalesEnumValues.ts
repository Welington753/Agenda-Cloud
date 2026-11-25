// Vendas v1, parte 1 de 2 (ver docs/plans/vendas-v1.md, seção 5.6): só os
// valores novos dos enums que a parte 2 (`SalesModule1794614400000`) usa.
//
// Por que separado: o PostgreSQL só deixa USAR um valor novo de enum depois
// que a transação que o criou foi confirmada (erro 55P04). Esta migration
// roda e é confirmada sozinha antes da 28:
// - CLI (CI, banco descartável, `migration:run:compiled`):
//   `migrationsTransactionMode: 'each'` em migrations-data-source.ts, uma
//   transação por migration (o TypeORM confirma a 27 antes de abrir a 28);
// - piloto: `aplicarSomenteAPendente` (scripts/operacao-piloto.mjs) com
//   `pendente` = esta e `posteriores` = [28]: a 28 sai do DataSource e esta é
//   confirmada ao fim da execução; a 28 vem numa execução seguinte.
// A 28 confere, antes de qualquer outra instrução, que estes valores já
// estão confirmados; se não estiverem, falha sem gravar nada.
//
// 1. `feature_key` ganha `VENDAS` (o recurso do adicional VENDAS).
// 2. `permission` ganha as seis permissões de vendas (o dono concede ao
//    gerente e, três delas, à recepcionista).
// 3. `audit_action` ganha as quatro ações de vendas e recebimentos de vendas.
//
// Nenhum valor é usado aqui, e nenhuma linha ou tabela muda. `ADD VALUE` não
// pode ser desfeito no PostgreSQL: o `down` deixa os valores (inofensivos
// para a API anterior, que nunca os grava).
import type { MigrationInterface, QueryRunner } from 'typeorm';

export const SALES_FEATURE_KEY = 'VENDAS';
export const SALES_PERMISSIONS = [
  'VENDAS_REGISTRAR',
  'VENDAS_RECEBER',
  'VENDAS_ALTERAR_PRECO',
  'VENDAS_VISUALIZAR',
  'VENDAS_CANCELAR',
  'VENDAS_ESTORNAR_RECEBIMENTO',
] as const;
export const SALES_AUDIT_ACTIONS = [
  'SALE_RECORDED',
  'SALE_CANCELLED',
  'SALE_PAYMENT_RECORDED',
  'SALE_PAYMENT_REFUNDED',
] as const;

export class SalesEnumValues1794528000000 implements MigrationInterface {
  name = 'SalesEnumValues1794528000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE feature_key ADD VALUE IF NOT EXISTS '${SALES_FEATURE_KEY}'`);
    for (const permission of SALES_PERMISSIONS) {
      await queryRunner.query(`ALTER TYPE permission ADD VALUE IF NOT EXISTS '${permission}'`);
    }
    for (const action of SALES_AUDIT_ACTIONS) {
      await queryRunner.query(`ALTER TYPE audit_action ADD VALUE IF NOT EXISTS '${action}'`);
    }
  }

  public async down(): Promise<void> {
    // Nada a desfazer: os valores dos enums ficam (ver o cabeçalho).
  }
}
