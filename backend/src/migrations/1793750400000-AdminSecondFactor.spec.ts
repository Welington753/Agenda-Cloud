// O que a migration do segundo fator faz, com um QueryRunner falso (nunca
// conecta a banco nenhum). Contra PostgreSQL real:
// test/second-factor-postgres.db-e2e-spec.ts.
import { describe, expect, it, vi } from 'vitest';
import type { QueryRunner } from 'typeorm';
import { AdminSecondFactor1793750400000, SECOND_FACTOR_AUDIT_ACTIONS } from './1793750400000-AdminSecondFactor.js';

function criarQueryRunnerFalso() {
  return { query: vi.fn().mockResolvedValue(undefined) } as unknown as QueryRunner & { query: ReturnType<typeof vi.fn> };
}

describe('AdminSecondFactor', () => {
  it('up() só acrescenta: valores de auditoria, tabelas novas e colunas anuláveis ou com padrão', async () => {
    const qr = criarQueryRunnerFalso();
    await new AdminSecondFactor1793750400000().up(qr);
    const sqls = qr.query.mock.calls.map((c) => String(c[0]));
    expect(sqls.slice(0, SECOND_FACTOR_AUDIT_ACTIONS.length)).toEqual(
      SECOND_FACTOR_AUDIT_ACTIONS.map((a) => `ALTER TYPE audit_action ADD VALUE IF NOT EXISTS '${a}'`),
    );
    expect(sqls.some((s) => /^\s*(UPDATE|INSERT|DELETE)\b|\bDROP\b/.test(s))).toBe(false);
    for (const tabela of [
      'user_second_factors',
      'second_factor_enrollments',
      'second_factor_recovery_codes',
      'second_factor_grants',
      'second_factor_attempts',
    ]) {
      expect(sqls.some((s) => s.includes(`CREATE TABLE ${tabela}`))).toBe(true);
    }
    const alteracoes = sqls.filter((s) => /ALTER TABLE (sessions|users)\s+ADD COLUMN/.test(s)).join('\n');
    expect(alteracoes).toMatch(/second_factor_verified_at timestamptz\(3\) NULL/);
    expect(alteracoes).toMatch(/second_factor_enrollment_allowed_until timestamptz\(3\) NULL/);
    expect(alteracoes).toMatch(/second_factor_enrollment_required boolean NOT NULL DEFAULT false/);
  });

  it('nenhuma coluna guarda segredo em texto: só bytea cifrado e hashes', async () => {
    const qr = criarQueryRunnerFalso();
    await new AdminSecondFactor1793750400000().up(qr);
    const sqls = qr.query.mock.calls.map((c) => String(c[0])).join('\n');
    expect(sqls).toMatch(/secret_ciphertext bytea NOT NULL/);
    expect(sqls).toMatch(/code_hash char\(64\) NOT NULL/);
    expect(sqls).toMatch(/token_hash char\(64\) NOT NULL/);
    expect(sqls).not.toMatch(/\b(secret|code|token) (varchar|text)\b/);
  });

  it('down() remove o que o up criou (apaga os fatores: só para ensaio)', async () => {
    const qr = criarQueryRunnerFalso();
    await new AdminSecondFactor1793750400000().down(qr);
    const sqls = qr.query.mock.calls.map((c) => String(c[0])).join('\n');
    for (const tabela of ['second_factor_attempts', 'second_factor_grants', 'second_factor_recovery_codes', 'second_factor_enrollments', 'user_second_factors']) {
      expect(sqls).toContain(`DROP TABLE ${tabela}`);
    }
    expect(sqls).not.toMatch(/audit_action/);
  });
});
