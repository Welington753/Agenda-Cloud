// O que a migration da marca de teste faz, com um QueryRunner falso (nunca
// conecta a banco nenhum). Contra PostgreSQL real:
// test/tenant-test-flag.db-e2e-spec.ts.
import { describe, expect, it, vi } from 'vitest';
import type { QueryRunner } from 'typeorm';
import { TenantTestFlag1793664000000 } from './1793664000000-TenantTestFlag.js';

function criarQueryRunnerFalso(total = 0) {
  return {
    query: vi.fn().mockImplementation((sql: string) => Promise.resolve(sql.includes('count(*)') ? [{ total }] : undefined)),
  } as unknown as QueryRunner & { query: ReturnType<typeof vi.fn> };
}

describe('TenantTestFlag', () => {
  it('up() só acrescenta: valor de auditoria e coluna com padrão false, sem reescrever linha', async () => {
    const qr = criarQueryRunnerFalso();
    await new TenantTestFlag1793664000000().up(qr);
    const sqls = qr.query.mock.calls.map((c) => String(c[0]));
    expect(sqls).toEqual([
      "ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'TENANT_TEST_FLAG_CHANGED'",
      'ALTER TABLE tenants ADD COLUMN is_test boolean NOT NULL DEFAULT false',
    ]);
    expect(sqls.some((s) => /^\s*(UPDATE|INSERT|DELETE)\b|DROP/.test(s))).toBe(false);
  });

  it('down() recusa com estabelecimento marcado, sem apagar nada', async () => {
    const qr = criarQueryRunnerFalso(1);
    await expect(new TenantTestFlag1793664000000().down(qr)).rejects.toThrow(/recusado/);
    expect(qr.query.mock.calls.map((c) => String(c[0])).some((s) => /DROP|ALTER/.test(s))).toBe(false);
  });

  it('down() sem marca remove só a coluna', async () => {
    const qr = criarQueryRunnerFalso(0);
    await new TenantTestFlag1793664000000().down(qr);
    expect(qr.query.mock.calls.map((c) => String(c[0])).slice(1)).toEqual(['ALTER TABLE tenants DROP COLUMN is_test']);
  });
});
