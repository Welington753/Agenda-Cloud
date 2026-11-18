// A parte 1 do estoque só acrescenta valores de enum, sem usá-los (QueryRunner
// falso; contra PostgreSQL real: test/stock-migrations.db-e2e-spec.ts).
import { describe, expect, it, vi } from 'vitest';
import type { QueryRunner } from 'typeorm';
import { STOCK_AUDIT_ACTIONS, STOCK_PERMISSIONS, StockEnumValues1794009600000 } from './1794009600000-StockEnumValues.js';

function criarQueryRunnerFalso() {
  return { query: vi.fn().mockResolvedValue(undefined) } as unknown as QueryRunner & { query: ReturnType<typeof vi.fn> };
}

describe('StockEnumValues1794009600000', () => {
  it('up() só faz ADD VALUE IF NOT EXISTS, na ordem: recurso, permissões, auditoria', async () => {
    const qr = criarQueryRunnerFalso();
    await new StockEnumValues1794009600000().up(qr);
    const sqls = qr.query.mock.calls.map((c) => String(c[0]));
    expect(sqls).toEqual([
      `ALTER TYPE feature_key ADD VALUE IF NOT EXISTS 'ESTOQUE'`,
      ...STOCK_PERMISSIONS.map((p) => `ALTER TYPE permission ADD VALUE IF NOT EXISTS '${p}'`),
      ...STOCK_AUDIT_ACTIONS.map((a) => `ALTER TYPE audit_action ADD VALUE IF NOT EXISTS '${a}'`),
    ]);
  });

  it('não declara transaction (o modo vem do runner) e o down não faz nada', async () => {
    const migration = new StockEnumValues1794009600000() as StockEnumValues1794009600000 & { transaction?: boolean };
    expect(migration.transaction).toBeUndefined();
    const qr = criarQueryRunnerFalso();
    await migration.down();
    expect(qr.query).not.toHaveBeenCalled();
  });
});
