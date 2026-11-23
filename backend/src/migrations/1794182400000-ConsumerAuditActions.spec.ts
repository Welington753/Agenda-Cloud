// A parte 1 dos clientes só acrescenta valores de enum, sem usá-los
// (QueryRunner falso; contra PostgreSQL real:
// test/consumer-migrations.db-e2e-spec.ts).
import { describe, expect, it, vi } from 'vitest';
import type { QueryRunner } from 'typeorm';
import { CONSUMER_AUDIT_ACTIONS, ConsumerAuditActions1794182400000 } from './1794182400000-ConsumerAuditActions.js';

function criarQueryRunnerFalso() {
  return { query: vi.fn().mockResolvedValue(undefined) } as unknown as QueryRunner & { query: ReturnType<typeof vi.fn> };
}

describe('ConsumerAuditActions1794182400000', () => {
  it('up() só faz ADD VALUE IF NOT EXISTS das duas ações de cliente', async () => {
    const qr = criarQueryRunnerFalso();
    await new ConsumerAuditActions1794182400000().up(qr);
    expect(qr.query.mock.calls.map((c) => String(c[0]))).toEqual(
      CONSUMER_AUDIT_ACTIONS.map((a) => `ALTER TYPE audit_action ADD VALUE IF NOT EXISTS '${a}'`),
    );
    expect(CONSUMER_AUDIT_ACTIONS).toEqual(['CONSUMER_UPDATED', 'CONSUMER_MERGED']);
  });

  it('não declara transaction (o modo vem do runner) e o down não faz nada', async () => {
    const migration = new ConsumerAuditActions1794182400000() as ConsumerAuditActions1794182400000 & { transaction?: boolean };
    expect(migration.transaction).toBeUndefined();
    const qr = criarQueryRunnerFalso();
    await migration.down();
    expect(qr.query).not.toHaveBeenCalled();
  });
});
