// O que a migration da assinatura modular faz, com um QueryRunner falso
// (nunca conecta a banco nenhum). Contra PostgreSQL real:
// test/modular-subscription-postgres.db-e2e-spec.ts.
import { describe, expect, it, vi } from 'vitest';
import type { QueryRunner } from 'typeorm';
import { ADDON_MODULE_ROWS, ModularSubscription1793836800000 } from './1793836800000-ModularSubscription.js';

function criarQueryRunnerFalso(uso = { assinaturas: 0, limites: 0, precos: 0, modular: 0 }) {
  return {
    query: vi.fn().mockImplementation((sql: string) => Promise.resolve(sql.includes('AS assinaturas') ? [uso] : undefined)),
  } as unknown as QueryRunner & { query: ReturnType<typeof vi.fn> };
}

const sqlsDe = (qr: { query: ReturnType<typeof vi.fn> }) => qr.query.mock.calls.map((c) => String(c[0]));

describe('ModularSubscription', () => {
  it('up() não reescreve nem apaga linha existente', async () => {
    const qr = criarQueryRunnerFalso();
    await new ModularSubscription1793836800000().up(qr);
    const sqls = sqlsDe(qr);
    expect(sqls.some((s) => /^\s*(UPDATE|DELETE)\b/.test(s))).toBe(false);
    expect(sqls.some((s) => /DROP\s+(TABLE|COLUMN)/.test(s))).toBe(false);
  });

  it('up() não cria a linha do plano modular (a API anterior listaria o plano)', async () => {
    const qr = criarQueryRunnerFalso();
    await new ModularSubscription1793836800000().up(qr);
    expect(sqlsDe(qr).some((s) => /INSERT INTO plans\b/.test(s))).toBe(false);
  });

  it('up() não dá limite a ninguém: a coluna nasce NULL, sem preenchimento', async () => {
    const qr = criarQueryRunnerFalso();
    await new ModularSubscription1793836800000().up(qr);
    const sqls = sqlsDe(qr);
    expect(sqls).toContain('ALTER TABLE tenants ADD COLUMN team_user_limit integer NULL');
    expect(sqls.some((s) => /team_user_limit\s*=/.test(s))).toBe(false);
  });

  it('up() só insere catálogo de adicionais (sem preço) e RELATORIOS nos planos Básico e Pro', async () => {
    const qr = criarQueryRunnerFalso();
    await new ModularSubscription1793836800000().up(qr);
    const inserts = sqlsDe(qr).filter((s) => /^\s*INSERT/.test(s));
    expect(inserts.filter((s) => s.includes('INSERT INTO addon_modules'))).toHaveLength(ADDON_MODULE_ROWS.length);
    expect(inserts.filter((s) => s.includes('INSERT INTO plan_features'))).toHaveLength(2);
    expect(inserts.some((s) => s.includes('addon_module_prices'))).toBe(false);
    expect(inserts).toHaveLength(ADDON_MODULE_ROWS.length + 2);
  });

  it('só indicadores e comissões estão disponíveis; o resto é em desenvolvimento ou planejado', () => {
    expect(ADDON_MODULE_ROWS.filter((m) => m.availability === 'AVAILABLE').map((m) => m.code)).toEqual(['INDICADORES', 'COMISSOES']);
    expect(ADDON_MODULE_ROWS.find((m) => m.code === 'WHATSAPP')?.availability).toBe('IN_DEVELOPMENT');
    expect(ADDON_MODULE_ROWS.filter((m) => m.availability === 'PLANNED').every((m) => m.featureKey === null)).toBe(true);
  });

  it('down() recusa com assinatura, limite, preço ou plano modular gravado', async () => {
    for (const uso of [
      { assinaturas: 1, limites: 0, precos: 0, modular: 0 },
      { assinaturas: 0, limites: 1, precos: 0, modular: 0 },
      { assinaturas: 0, limites: 0, precos: 1, modular: 0 },
      { assinaturas: 0, limites: 0, precos: 0, modular: 1 },
    ]) {
      const qr = criarQueryRunnerFalso(uso);
      await expect(new ModularSubscription1793836800000().down(qr)).rejects.toThrow(/recusado/);
      expect(sqlsDe(qr).some((s) => /DROP|ALTER|DELETE/.test(s))).toBe(false);
    }
  });
});
