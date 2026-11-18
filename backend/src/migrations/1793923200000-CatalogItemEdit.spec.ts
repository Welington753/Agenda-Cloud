// O que a migration da edição do catálogo modular faz, com um QueryRunner
// falso (nunca conecta a banco nenhum).
import { describe, expect, it, vi } from 'vitest';
import type { QueryRunner } from 'typeorm';
import { CATALOG_ITEM_AUDIT_ACTION, CatalogItemEdit1793923200000 } from './1793923200000-CatalogItemEdit.js';

function criarQueryRunnerFalso() {
  return { query: vi.fn().mockResolvedValue(undefined) } as unknown as QueryRunner & { query: ReturnType<typeof vi.fn> };
}

describe('CatalogItemEdit', () => {
  it('up() só acrescenta a ação do histórico, sem tocar em tabela ou linha', async () => {
    const qr = criarQueryRunnerFalso();
    await new CatalogItemEdit1793923200000().up(qr);
    const sqls = qr.query.mock.calls.map((c) => String(c[0]));
    expect(sqls).toEqual([`ALTER TYPE audit_action ADD VALUE IF NOT EXISTS '${CATALOG_ITEM_AUDIT_ACTION}'`]);
  });

  it('down() não executa nada (o valor do enum não pode ser removido)', async () => {
    const qr = criarQueryRunnerFalso();
    await new CatalogItemEdit1793923200000().down();
    expect(qr.query).not.toHaveBeenCalled();
  });
});
