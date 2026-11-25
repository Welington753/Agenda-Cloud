// A parte 1 de vendas só acrescenta valores de enum, sem usá-los (QueryRunner
// falso; contra PostgreSQL real: test/sales-migrations.db-e2e-spec.ts).
import { describe, expect, it, vi } from 'vitest';
import type { QueryRunner } from 'typeorm';
import { SALES_AUDIT_ACTIONS, SALES_PERMISSIONS, SalesEnumValues1794528000000 } from './1794528000000-SalesEnumValues.js';
import { Permission } from '../entities/enums/permission.enum.js';
import { FeatureKey } from '../entities/enums/feature-key.enum.js';
import { MANAGER_PERMISSIONS } from '../common/manager-permissions.js';

function criarQueryRunnerFalso() {
  return { query: vi.fn().mockResolvedValue(undefined) } as unknown as QueryRunner & { query: ReturnType<typeof vi.fn> };
}

describe('SalesEnumValues1794528000000', () => {
  it('up() só faz ADD VALUE IF NOT EXISTS, na ordem: recurso, permissões, auditoria', async () => {
    const qr = criarQueryRunnerFalso();
    await new SalesEnumValues1794528000000().up(qr);
    const sqls = qr.query.mock.calls.map((c) => String(c[0]));
    expect(sqls).toEqual([
      `ALTER TYPE feature_key ADD VALUE IF NOT EXISTS 'VENDAS'`,
      ...SALES_PERMISSIONS.map((p) => `ALTER TYPE permission ADD VALUE IF NOT EXISTS '${p}'`),
      ...SALES_AUDIT_ACTIONS.map((a) => `ALTER TYPE audit_action ADD VALUE IF NOT EXISTS '${a}'`),
    ]);
  });

  it('os valores batem com os enums TypeScript e com o catálogo de concessões', () => {
    expect(Object.values(FeatureKey)).toContain('VENDAS');
    for (const p of SALES_PERMISSIONS) {
      expect(Object.values(Permission)).toContain(p);
      expect(MANAGER_PERMISSIONS).toContain(p);
    }
  });

  it('não declara transaction (o modo vem do runner) e o down não faz nada', async () => {
    const migration = new SalesEnumValues1794528000000() as SalesEnumValues1794528000000 & { transaction?: boolean };
    expect(migration.transaction).toBeUndefined();
    const qr = criarQueryRunnerFalso();
    await migration.down();
    expect(qr.query).not.toHaveBeenCalled();
  });
});
