// Clientes, parte 1 de 2 (ver docs/plans/clientes-ficha-e-duplicados.md): só
// os valores novos de `audit_action` que a edição e a unificação de clientes
// gravam.
//
// Por que separado: o PostgreSQL só deixa USAR um valor novo de enum depois
// que a transação que o criou foi confirmada (erro 55P04). Mesmo molde de
// `StockEnumValues1794009600000`: esta roda e é confirmada sozinha antes da
// 24 (`ConsumerIdentity1794268800000`), no modo `each` do CLI e, no piloto,
// uma pendente por execução.
//
// Nenhum valor é usado aqui, e nenhuma linha ou tabela muda. `ADD VALUE` não
// pode ser desfeito no PostgreSQL: o `down` deixa os valores (inofensivos
// para a API anterior, que nunca os grava).
import type { MigrationInterface, QueryRunner } from 'typeorm';

export const CONSUMER_AUDIT_ACTIONS = ['CONSUMER_UPDATED', 'CONSUMER_MERGED'] as const;

export class ConsumerAuditActions1794182400000 implements MigrationInterface {
  name = 'ConsumerAuditActions1794182400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const action of CONSUMER_AUDIT_ACTIONS) {
      await queryRunner.query(`ALTER TYPE audit_action ADD VALUE IF NOT EXISTS '${action}'`);
    }
  }

  public async down(): Promise<void> {
    // Nada a desfazer: os valores do enum ficam (ver o cabeçalho).
  }
}
