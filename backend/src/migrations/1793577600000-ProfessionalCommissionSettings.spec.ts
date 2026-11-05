// O que a migration de "Recebe comissão" e regra geral faz, com um
// QueryRunner falso (nunca conecta a banco nenhum). O comportamento contra
// PostgreSQL real fica em test/commissions-postgres.db-e2e-spec.ts.
import { describe, expect, it, vi } from 'vitest';
import type { QueryRunner } from 'typeorm';
import { ProfessionalCommissionSettings1793577600000 } from './1793577600000-ProfessionalCommissionSettings.js';

function criarQueryRunnerFalso(total = 0) {
  return {
    query: vi.fn().mockImplementation((sql: string) => Promise.resolve(sql.includes('count(*)') ? [{ total }] : undefined)),
  } as unknown as QueryRunner & { query: ReturnType<typeof vi.fn> };
}

describe('ProfessionalCommissionSettings', () => {
  it('up() só acrescenta: tabela nova e coluna anulável, sem preencher nem mudar linha existente', async () => {
    const qr = criarQueryRunnerFalso();
    await new ProfessionalCommissionSettings1793577600000().up(qr);
    const sqls = qr.query.mock.calls.map((c) => String(c[0]));
    expect(sqls).toHaveLength(3);
    expect(sqls[0]).toMatch(/^CREATE TABLE professional_commission_settings/);
    expect(sqls[0]).toMatch(/FOREIGN KEY \(tenant_id, professional_id\) REFERENCES professionals \(tenant_id, id\) ON DELETE CASCADE/);
    expect(sqls[1]).toBe('ALTER TABLE commission_entries ADD COLUMN applied_rule_scope varchar(10) NULL');
    expect(sqls[2]).toMatch(/ADD CONSTRAINT ck_commission_entries_applied_rule_scope/);
    expect(sqls.some((s) => /^\s*(UPDATE|INSERT|DELETE)\b|commission_rules|plan_features|ALTER TYPE|DROP|SET NOT NULL/.test(s))).toBe(false);
  });

  it('down() recusa com configuração gravada ou apuração com escopo, sem apagar nada', async () => {
    const qr = criarQueryRunnerFalso(1);
    await expect(new ProfessionalCommissionSettings1793577600000().down(qr)).rejects.toThrow(/recusado/);
    expect(qr.query.mock.calls.map((c) => String(c[0])).some((s) => /DROP|ALTER/.test(s))).toBe(false);
  });

  it('down() sem dado novo desfaz só o que a migration criou', async () => {
    const qr = criarQueryRunnerFalso(0);
    await new ProfessionalCommissionSettings1793577600000().down(qr);
    const sqls = qr.query.mock.calls.map((c) => String(c[0])).slice(1);
    expect(sqls).toEqual([
      'ALTER TABLE commission_entries DROP CONSTRAINT ck_commission_entries_applied_rule_scope',
      'ALTER TABLE commission_entries DROP COLUMN applied_rule_scope',
      'DROP TABLE professional_commission_settings',
    ]);
  });
});
