// O que a parte 2 de vendas faz, com um QueryRunner falso (nunca conecta a
// banco nenhum). Contra PostgreSQL real (banco novo, a partir das 26, modo
// `all` indevido, gatilhos): test/sales-migrations.db-e2e-spec.ts e
// test/sales-integrity-postgres.db-e2e-spec.ts.
import { describe, expect, it, vi } from 'vitest';
import type { QueryRunner } from 'typeorm';
import {
  SALES_ENUMS_NOT_COMMITTED_MESSAGE,
  SALES_TABLES,
  SalesModule1794614400000,
} from './1794614400000-SalesModule.js';

function criarQueryRunnerFalso(respostas: (sql: string) => unknown = () => undefined) {
  return {
    query: vi.fn().mockImplementation(async (sql: string) => respostas(sql)),
  } as unknown as QueryRunner & { query: ReturnType<typeof vi.fn> };
}

async function sqlsDoUp(qr = criarQueryRunnerFalso()): Promise<string[]> {
  await new SalesModule1794614400000().up(qr);
  return qr.query.mock.calls.map((c) => String(c[0]));
}

const SEM_USO = { dados: 0, overrides: 0, planos: 0, contratos: 0, precos: 0, permissoes: 0, auditoria: 0 };

describe('SalesModule1794614400000', () => {
  it('a PRIMEIRA instrução usa os valores novos dos enums (confirma a 27 antes de tudo)', async () => {
    const sqls = await sqlsDoUp();
    expect(sqls[0]).toMatch(/^SELECT 'VENDAS'::feature_key/);
    for (const v of ['VENDAS_REGISTRAR', 'VENDAS_ESTORNAR_RECEBIMENTO']) expect(sqls[0]).toContain(`'${v}'::permission`);
    for (const v of ['SALE_RECORDED', 'SALE_PAYMENT_REFUNDED']) expect(sqls[0]).toContain(`'${v}'::audit_action`);
  });

  it.each([
    ['55P04', 'enum criado na mesma transação'],
    ['22P02', 'enum inexistente'],
  ])('erro %s (%s) vira a mensagem clara e para antes de criar qualquer coisa', async (code) => {
    const qr = criarQueryRunnerFalso((sql) => {
      if (sql.startsWith('SELECT')) throw Object.assign(new Error('falha'), { driverError: { code } });
      return undefined;
    });
    await expect(new SalesModule1794614400000().up(qr)).rejects.toThrow(SALES_ENUMS_NOT_COMMITTED_MESSAGE);
    expect(qr.query).toHaveBeenCalledTimes(1);
  });

  it('cria as três tabelas, o vínculo item ↔ movimento e a soma diferida (não um CHECK comum)', async () => {
    const sqls = (await sqlsDoUp()).join('\n');
    for (const tabela of SALES_TABLES) expect(sqls).toContain(`CREATE TABLE ${tabela}`);
    expect(sqls).toMatch(
      /CONSTRAINT fk_sale_items_movement FOREIGN KEY \(tenant_id, sale_id, stock_movement_id\)\s+REFERENCES stock_movements \(tenant_id, sale_id, id\)/,
    );
    expect(sqls).toContain('CONSTRAINT uq_sale_items_movement UNIQUE (stock_movement_id)');
    expect(sqls).toContain('ck_sale_items_line CHECK (line_total_cents = (unit_price_cents * quantity_milli + 500) / 1000)');
    expect(sqls).toMatch(/CREATE CONSTRAINT TRIGGER trg_sales_consistency AFTER INSERT OR UPDATE ON sales\s+DEFERRABLE INITIALLY DEFERRED/);
    expect(sqls).toMatch(/CREATE CONSTRAINT TRIGGER trg_sale_items_consistency AFTER INSERT ON sale_items\s+DEFERRABLE INITIALLY DEFERRED/);
    expect(sqls).toMatch(
      /trg_stock_movements_sale_consistency AFTER INSERT ON stock_movements\s+DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN \(NEW\.sale_id IS NOT NULL\)/,
    );
    expect(sqls).not.toMatch(/CHECK \([^)]*\bsum\(/i);
  });

  it('protege a baixa da venda: estorno só com o mesmo sale_id e a venda já cancelada', async () => {
    const sqls = (await sqlsDoUp()).join('\n');
    expect(sqls).toContain('CREATE TRIGGER trg_stock_movements_sale_link BEFORE INSERT ON stock_movements');
    expect(sqls).toContain('NEW.sale_id IS DISTINCT FROM venda');
    expect(sqls).toContain("situacao IS DISTINCT FROM 'CANCELADA'");
    expect(sqls).toContain("ck_stock_movements_sale_kind CHECK (sale_id IS NULL OR kind IN ('SAIDA_VENDA', 'ESTORNO'))");
  });

  it('adicional VENDAS disponível e SEM preço; nenhum plano, estabelecimento ou outro adicional muda', async () => {
    const sqls = await sqlsDoUp();
    const inserts = sqls.filter((s) => /^\s*INSERT\b/.test(s));
    expect(inserts).toHaveLength(2);
    expect(inserts[0]).toBe('INSERT INTO features (id, key, label) VALUES ($1, $2, $3)');
    expect(inserts[1]).toMatch(/INSERT INTO addon_modules \(code, name, description, feature_key, availability, sort_order\)/);
    const todas = sqls.join('\n');
    expect(todas).not.toMatch(/INSERT INTO addon_module_prices|INSERT INTO plan_features|INSERT INTO tenant_feature_overrides/);
    expect(sqls.some((s) => /^\s*(UPDATE|DELETE)\b/.test(s))).toBe(false);
  });

  it('não declara transaction (o modo vem do runner)', () => {
    expect((new SalesModule1794614400000() as { transaction?: boolean }).transaction).toBeUndefined();
  });

  it.each(Object.keys(SEM_USO))('down() recusa com uso em %s', async (campo) => {
    const qr = criarQueryRunnerFalso((sql) => (sql.includes('AS dados') ? [{ ...SEM_USO, [campo]: 1 }] : undefined));
    await expect(new SalesModule1794614400000().down(qr)).rejects.toThrow(/down apagaria dados/);
    expect(qr.query).toHaveBeenCalledTimes(1);
  });

  it('down() sem uso desfaz catálogo, recurso, colunas e tabelas', async () => {
    const qr = criarQueryRunnerFalso((sql) => (sql.includes('AS dados') ? [SEM_USO] : undefined));
    await new SalesModule1794614400000().down(qr);
    const sqls = qr.query.mock.calls.map((c) => String(c[0])).join('\n');
    expect(sqls).toContain('DELETE FROM addon_modules WHERE code = $1');
    expect(sqls).toContain('DELETE FROM features WHERE id = $1');
    for (const tabela of SALES_TABLES) expect(sqls).toContain(`DROP TABLE ${tabela}`);
    expect(sqls).toContain('DROP COLUMN sale_id');
    expect(sqls).toContain('DROP COLUMN sale_price_cents');
    expect(sqls).not.toMatch(/ALTER TYPE/);
  });
});
