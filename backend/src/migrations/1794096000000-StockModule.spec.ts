// O que a parte 2 do estoque faz, com um QueryRunner falso (nunca conecta a
// banco nenhum). Contra PostgreSQL real, inclusive banco novo, atualização a
// partir das 20, falha seguida de retomada e o modo `all` indevido:
// test/stock-migrations.db-e2e-spec.ts.
import { describe, expect, it, vi } from 'vitest';
import type { QueryRunner } from 'typeorm';
import {
  STOCK_ENUMS_NOT_COMMITTED_MESSAGE,
  STOCK_TABLES,
  StockModule1794096000000,
} from './1794096000000-StockModule.js';

function criarQueryRunnerFalso(respostas: (sql: string) => unknown = () => undefined) {
  return {
    query: vi.fn().mockImplementation(async (sql: string) => respostas(sql)),
  } as unknown as QueryRunner & { query: ReturnType<typeof vi.fn> };
}

const UPDATE_OK = (sql: string) => (/^\s*UPDATE addon_modules/.test(sql) ? [[{ code: 'ESTOQUE' }], 1] : undefined);

async function sqlsDoUp(qr = criarQueryRunnerFalso(UPDATE_OK)): Promise<string[]> {
  await new StockModule1794096000000().up(qr);
  return qr.query.mock.calls.map((c) => String(c[0]));
}

describe('StockModule1794096000000', () => {
  it('a PRIMEIRA instrução usa os valores novos dos enums (confirma a 21 antes de tudo)', async () => {
    const sqls = await sqlsDoUp();
    expect(sqls[0]).toMatch(/^SELECT 'ESTOQUE'::feature_key/);
    expect(sqls[0]).toContain(`'ESTOQUE_VISUALIZAR'::permission`);
    expect(sqls[0]).toContain(`'ESTOQUE_GERENCIAR'::permission`);
    expect(sqls[0]).toContain(`'STOCK_CATEGORY_CHANGED'::audit_action`);
    expect(sqls[0]).toContain(`'STOCK_PRODUCT_CHANGED'::audit_action`);
  });

  it.each([
    ['55P04', 'enum criado na mesma transação'],
    ['22P02', 'enum inexistente'],
  ])('erro %s (%s) vira a mensagem clara e para antes de criar qualquer coisa', async (code) => {
    const qr = criarQueryRunnerFalso((sql) => {
      if (sql.startsWith('SELECT')) throw Object.assign(new Error('falha'), { driverError: { code } });
      return undefined;
    });
    await expect(new StockModule1794096000000().up(qr)).rejects.toThrow(STOCK_ENUMS_NOT_COMMITTED_MESSAGE);
    expect(qr.query).toHaveBeenCalledTimes(1);
  });

  it('cria as seis tabelas, o gatilho de histórico e as FKs da categoria e da subcategoria', async () => {
    const sqls = (await sqlsDoUp()).join('\n');
    for (const tabela of STOCK_TABLES) expect(sqls).toContain(`CREATE TABLE ${tabela}`);
    expect(sqls).toMatch(
      /CONSTRAINT fk_stock_products_category FOREIGN KEY \(tenant_id, category_id\)\s+REFERENCES stock_categories \(tenant_id, id\)/,
    );
    expect(sqls).toMatch(
      /CONSTRAINT fk_stock_products_subcategory FOREIGN KEY \(tenant_id, category_id, subcategory_id\)\s+REFERENCES stock_subcategories \(tenant_id, category_id, id\)/,
    );
    expect(sqls).toMatch(/category_id varchar\(30\) NOT NULL,\s+subcategory_id varchar\(30\) NULL/);
    expect(sqls).toMatch(/balance_milli >= 0/);
    for (const tabela of ['stock_movements', 'stock_counts', 'stock_count_items']) {
      expect(sqls).toContain(`CREATE TRIGGER trg_${tabela}_append_only BEFORE UPDATE OR DELETE ON ${tabela}`);
    }
  });

  it('liga o adicional só por recurso e disponibilidade; nunca nome, descrição, preço, plano ou estabelecimento', async () => {
    const sqls = await sqlsDoUp();
    const updates = sqls.filter((s) => /^\s*UPDATE\b/.test(s));
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatch(/UPDATE addon_modules SET feature_key = \$1, availability = 'AVAILABLE'/);
    expect(updates[0]).toMatch(/feature_key IS NULL AND availability = 'PLANNED'/);
    expect(updates[0]).not.toMatch(/\b(name|description|sort_order)\s*=/);
    const todas = sqls.join('\n');
    expect(todas).not.toMatch(/addon_module_prices|plan_prices|INSERT INTO plan_features|INSERT INTO tenant_feature_overrides/);
    expect(sqls.filter((s) => /^\s*INSERT\b/.test(s))).toEqual([`INSERT INTO features (id, key, label) VALUES ($1, $2, $3)`]);
    expect(sqls.some((s) => /^\s*DELETE\b|\bDROP\b/.test(s))).toBe(false);
  });

  it('falha se o adicional não estiver planejado e sem recurso (UPDATE com 0 linhas)', async () => {
    const qr = criarQueryRunnerFalso((sql) => (/^\s*UPDATE addon_modules/.test(sql) ? [[], 0] : undefined));
    await expect(new StockModule1794096000000().up(qr)).rejects.toThrow(/ESTOQUE não está no estado esperado/);
  });

  it('não declara transaction (o modo vem do runner)', () => {
    expect((new StockModule1794096000000() as { transaction?: boolean }).transaction).toBeUndefined();
  });

  it('down() recusa quando há dado, contratação, concessão ou histórico', async () => {
    const qr = criarQueryRunnerFalso((sql) =>
      sql.includes('AS dados') ? [{ dados: 0, overrides: 1, planos: 0, permissoes: 0, auditoria: 0 }] : undefined,
    );
    await expect(new StockModule1794096000000().down(qr)).rejects.toThrow(/down apagaria dados/);
    expect(qr.query).toHaveBeenCalledTimes(1);
  });

  it('down() sem uso desfaz catálogo, recurso e tabelas', async () => {
    const qr = criarQueryRunnerFalso((sql) =>
      sql.includes('AS dados') ? [{ dados: 0, overrides: 0, planos: 0, permissoes: 0, auditoria: 0 }] : undefined,
    );
    await new StockModule1794096000000().down(qr);
    const sqls = qr.query.mock.calls.map((c) => String(c[0])).join('\n');
    expect(sqls).toMatch(/UPDATE addon_modules SET feature_key = NULL, availability = 'PLANNED'/);
    expect(sqls).toContain('DELETE FROM features WHERE id = $1');
    for (const tabela of STOCK_TABLES) expect(sqls).toContain(`DROP TABLE ${tabela}`);
    expect(sqls).not.toMatch(/ALTER TYPE/);
  });
});
