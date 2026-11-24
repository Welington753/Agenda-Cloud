// Forma da migration de "Esqueci minha senha" (QueryRunner falso). Contra
// PostgreSQL real, com linhas antigas e a API anterior:
// test/password-recovery-postgres.db-e2e-spec.ts.
import { describe, expect, it, vi } from 'vitest';
import type { QueryRunner } from 'typeorm';
import {
  PASSWORD_RESET_ORIGINS,
  PASSWORD_RESET_REQUEST_OUTCOMES,
  SelfServicePasswordReset1794441600000,
} from './1794441600000-SelfServicePasswordReset.js';

function criarQueryRunnerFalso() {
  const query = vi.fn().mockResolvedValue(undefined);
  return { query } as unknown as QueryRunner & { query: ReturnType<typeof vi.fn> };
}

const sqlDe = (qr: { query: ReturnType<typeof vi.fn> }) =>
  qr.query.mock.calls.map((c) => String(c[0]).replace(/\s+/g, ' ').trim());

describe('SelfServicePasswordReset1794441600000', () => {
  it('up() só acrescenta: origem com DEFAULT ADMIN (linhas antigas), autor opcional só no autoatendimento, fila de pedidos', async () => {
    const qr = criarQueryRunnerFalso();
    await new SelfServicePasswordReset1794441600000().up(qr);
    const sql = sqlDe(qr);
    expect(sql[0]).toContain("ADD COLUMN origin varchar(20) NOT NULL DEFAULT 'ADMIN'");
    expect(sql[0]).toContain('ADD COLUMN delivery_due_at timestamptz(3) NULL');
    expect(sql[0]).toContain('ALTER COLUMN requested_by_user_id DROP NOT NULL');
    expect(sql[1]).toContain(
      "(origin = 'ADMIN' AND requested_by_user_id IS NOT NULL) OR (origin = 'SELF_SERVICE' AND requested_by_user_id IS NULL)",
    );
    expect(sql[1]).toContain("delivery_due_at IS NULL OR origin = 'SELF_SERVICE'");
    expect(sql.some((s) => s.startsWith('CREATE TABLE password_reset_requests'))).toBe(true);
    // Nada é apagado nem reescrito na subida.
    expect(sql.some((s) => /^(DELETE|UPDATE|DROP)/.test(s))).toBe(false);
    expect(PASSWORD_RESET_ORIGINS).toEqual(['ADMIN', 'SELF_SERVICE']);
    expect(PASSWORD_RESET_REQUEST_OUTCOMES).toContain('ACTIVE_LINK_KEPT');
  });

  it('down() apaga só os links de autoatendimento e volta a exigir autor', async () => {
    const qr = criarQueryRunnerFalso();
    await new SelfServicePasswordReset1794441600000().down(qr);
    const sql = sqlDe(qr);
    expect(sql[0]).toBe('DROP TABLE password_reset_requests');
    expect(sql[1]).toBe("DELETE FROM password_resets WHERE origin = 'SELF_SERVICE'");
    expect(sql.at(-1)).toContain('ALTER COLUMN requested_by_user_id SET NOT NULL');
  });

  it('não declara transaction (o modo vem do runner)', () => {
    const migration = new SelfServicePasswordReset1794441600000() as SelfServicePasswordReset1794441600000 & {
      transaction?: boolean;
    };
    expect(migration.transaction).toBeUndefined();
  });
});
