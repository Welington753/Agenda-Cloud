// Vendas v1, PR 2 (docs/plans/vendas-v1.md, seções 3 e 5): schema, integridade
// e acesso contra PostgreSQL DESCARTÁVEL (migrations 27 e 28), com dados
// fictícios. As rotas de venda são do PR 3: aqui a venda é gravada em SQL,
// na mesma ordem que o fluxo de vendas vai usar (venda, baixas, itens; no
// cancelamento, a venda cancelada antes dos estornos), para provar as
// garantias do BANCO, que valem para qualquer versão da API:
// - vínculo item ↔ baixa, soma dos itens = total (gatilho diferido, não
//   CHECK), uma baixa por item, venda só de inserção;
// - estorno manual da baixa recusado (serviço e SQL direto, como a API
//   anterior faria); cancelamento integral pelo fluxo permitido, inclusive
//   com produto arquivado; cancelamento parcial ou repetido recusado;
// - recebimento integral, um ativo por venda, cancelamento só sem
//   recebimento ativo;
// - concorrência pelo último saldo; isolamento entre estabelecimentos;
// - saída manual `USE_VENDAS` só com o adicional;
// - gate: nova venda pede VENDAS e ESTOQUE, manutenção não pede recurso;
// - recepcionista convidável, vaga contada, concessões proibidas recusadas;
// - unificação de clientes com venda simultânea (as duas ordens) e pela API
//   anterior (o gatilho leva as vendas).
// Sem GERENTE neste arquivo (o check do piloto de gerentes lê o mesmo banco).
import type { DataSource, EntityManager } from 'typeorm';
import { Client } from 'pg';
import { StockCategoriesService } from '../src/stock/stock-categories.service.js';
import { StockMovementsService } from '../src/stock/stock-movements.service.js';
import { StockProductsService } from '../src/stock/stock-products.service.js';
import { ConsumersService } from '../src/consumers/consumers.service.js';
import { ConsumerMergeService } from '../src/consumers/consumer-merge.service.js';
import { TeamService } from '../src/team/team.service.js';
import { StaffAccountsService } from '../src/team/staff-accounts.service.js';
import { staffSeatUsage } from '../src/team/seats.js';
import { resolveAuthorizedTenant } from '../src/common/tenant-authorization.js';
import { sessionAreas } from '../src/auth/session-areas.js';
import {
  SALES_MAINTENANCE_FEATURES,
  SALES_NEW_SALE_FEATURES,
  canAccessSalesHistory,
  canRegisterSales,
} from '../src/sales/sales-access.js';
import { EstablishmentRole } from '../src/entities/enums/establishment-role.enum.js';
import {
  abrirBanco,
  codigoDe,
  erroDe,
  novaChave,
  novoId,
  semeador,
  urlDoBancoDescartavel,
  type Estabelecimento,
  type Pessoa,
} from './support/estoque.js';

const url = urlDoBancoDescartavel();

interface ItemDaVenda {
  productId: string;
  quantityMilli: number;
  unitPriceCents: number;
}

/** Erro do PostgreSQL: SQLSTATE e restrição (o gatilho informa a dele). */
async function erroDoBanco(promessa: Promise<unknown>): Promise<{ code?: string; constraint?: string; message: string }> {
  const e = (await erroDe(promessa)) as Error & { code?: string; constraint?: string; driverError?: { code?: string; constraint?: string } };
  return { code: e.driverError?.code ?? e.code, constraint: e.driverError?.constraint ?? e.constraint, message: e.message };
}

const linha = (preco: number, quantidade: number) => Math.floor((preco * quantidade + 500) / 1000);

describe.skipIf(!url)('vendas, PR 2: integridade e acesso contra PostgreSQL descartável', () => {
  let db: DataSource;
  let dados: ReturnType<typeof semeador>;
  let produtos: StockProductsService;
  let movimentos: StockMovementsService;
  let clientes: ConsumersService;
  let unificacao: ConsumerMergeService;
  let equipe: TeamService;
  let contas: StaffAccountsService;
  let est: Estabelecimento;
  let outro: Estabelecimento;
  let categoria: string;
  let categoriaDoOutro: string;

  const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => dados.q<T>(sql, params);
  const dono = () => est.dono.userId;

  async function ligarVendas(tenantId: string) {
    await q(
      `INSERT INTO tenant_feature_overrides (id, tenant_id, feature_id, enabled) VALUES ($1, $2, 'feat_vendas', true)
       ON CONFLICT (tenant_id, feature_id) DO UPDATE SET enabled = true`,
      [novoId(), tenantId],
    );
  }
  const desligarVendas = (tenantId: string) =>
    q(`DELETE FROM tenant_feature_overrides WHERE tenant_id = $1 AND feature_id = 'feat_vendas'`, [tenantId]);

  async function produto(e: Estabelecimento, cat: string, nome: string, saldoMilli: number, unit = 'UN') {
    const r = await produtos.create(e.dono.userId, e.tenantId, {
      requestKey: novaChave(),
      name: nome,
      description: null,
      internalCode: null,
      categoryId: cat,
      subcategoryId: null,
      purpose: 'VENDA',
      unit,
      minQuantityMilli: 0,
      initialQuantityMilli: saldoMilli,
    } as never);
    return r.product.id as string;
  }

  const saldo = async (productId: string) =>
    Number((await q<{ s: string }>(`SELECT balance_milli::text AS s FROM stock_products WHERE id = $1`, [productId]))[0].s);

  /** Baixa ou devolução de um produto na transação, como `registrarMovimentacao`
   * (produto travado, saldo e versão no produto), com `sale_id`. */
  async function movimentar(
    tx: EntityManager,
    tenantId: string,
    userId: string,
    productId: string,
    deltaMilli: number,
    extra: { kind: 'SAIDA_VENDA' | 'ESTORNO'; saleId: string | null; reverses?: string; reason?: string },
  ): Promise<string> {
    const [p] = (await tx.query(`SELECT balance_milli::text AS b, unit FROM stock_products WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [
      tenantId,
      productId,
    ])) as { b: string; unit: string }[];
    const antes = Number(p.b);
    const id = novoId();
    await tx.query(
      `INSERT INTO stock_movements (id, tenant_id, product_id, kind, quantity_milli, delta_milli, balance_before_milli,
         balance_after_milli, unit, reason, reverses_movement_id, recorded_by_user_id, sale_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [id, tenantId, productId, extra.kind, Math.abs(deltaMilli), deltaMilli, antes, antes + deltaMilli, p.unit, extra.reason ?? null, extra.reverses ?? null, userId, extra.saleId],
    );
    await tx.query(`UPDATE stock_products SET balance_milli = $3, balance_version = balance_version + 1 WHERE tenant_id = $1 AND id = $2`, [
      tenantId,
      productId,
      antes + deltaMilli,
    ]);
    return id;
  }

  /** A venda na ordem do fluxo: venda, baixas, itens. `ajuste` corrompe de
   * propósito para provar as recusas. */
  async function gravarVenda(
    tx: EntityManager,
    e: Estabelecimento,
    itens: ItemDaVenda[],
    opcoes: { consumerId?: string | null; userId?: string; totalCents?: number; semItens?: boolean } = {},
  ): Promise<{ saleId: string; movimentos: string[] }> {
    const userId = opcoes.userId ?? e.dono.userId;
    const saleId = novoId();
    const total = opcoes.totalCents ?? itens.reduce((s, i) => s + linha(i.unitPriceCents, i.quantityMilli), 0);
    await tx.query(
      `INSERT INTO sales (id, tenant_id, consumer_id, total_cents, recorded_by_user_id, request_key, request_fingerprint)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [saleId, e.tenantId, opcoes.consumerId ?? null, total, userId, novaChave(), 'f'.repeat(64)],
    );
    const ordem = [...itens].sort((a, b) => (a.productId < b.productId ? -1 : 1));
    const movs: string[] = [];
    for (const item of ordem) movs.push(await movimentar(tx, e.tenantId, userId, item.productId, -item.quantityMilli, { kind: 'SAIDA_VENDA', saleId }));
    if (!opcoes.semItens) {
      for (const [i, item] of ordem.entries()) {
        const [p] = (await tx.query(`SELECT name, unit, sale_price_cents FROM stock_products WHERE id = $1`, [item.productId])) as {
          name: string;
          unit: string;
          sale_price_cents: string | null;
        }[];
        await tx.query(
          `INSERT INTO sale_items (id, tenant_id, sale_id, position, product_id, stock_movement_id, product_name, unit,
             quantity_milli, unit_price_cents, suggested_price_cents, line_total_cents)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [novoId(), e.tenantId, saleId, i + 1, item.productId, movs[i], p.name, p.unit, item.quantityMilli, item.unitPriceCents, p.sale_price_cents, linha(item.unitPriceCents, item.quantityMilli)],
        );
      }
    }
    return { saleId, movimentos: movs };
  }

  const vender = (e: Estabelecimento, itens: ItemDaVenda[], opcoes: Parameters<typeof gravarVenda>[3] = {}) =>
    db.transaction((tx) => gravarVenda(tx, e, itens, opcoes));

  /** Cancelamento pelo fluxo: a venda cancelada ANTES dos estornos, um por
   * baixa, com o mesmo `sale_id`. `apenas` estorna só algumas (para provar a
   * recusa do cancelamento parcial). */
  async function cancelar(e: Estabelecimento, saleId: string, opcoes: { apenas?: number; motivo?: string } = {}) {
    return db.transaction(async (tx) => {
      await tx.query(`SELECT id FROM sales WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [e.tenantId, saleId]);
      await tx.query(
        `UPDATE sales SET status = 'CANCELADA', cancelled_at = now(), cancelled_by_user_id = $3, cancel_reason = $4
          WHERE tenant_id = $1 AND id = $2`,
        [e.tenantId, saleId, e.dono.userId, opcoes.motivo ?? 'Cliente desistiu da compra'],
      );
      const baixas = (await tx.query(
        `SELECT id, product_id, quantity_milli::text AS q FROM stock_movements
          WHERE tenant_id = $1 AND sale_id = $2 AND kind = 'SAIDA_VENDA' ORDER BY product_id`,
        [e.tenantId, saleId],
      )) as { id: string; product_id: string; q: string }[];
      for (const b of baixas.slice(0, opcoes.apenas ?? baixas.length)) {
        await movimentar(tx, e.tenantId, e.dono.userId, b.product_id, Number(b.q), {
          kind: 'ESTORNO',
          saleId,
          reverses: b.id,
          reason: opcoes.motivo ?? 'Cliente desistiu da compra',
        });
      }
    });
  }

  async function receber(e: Estabelecimento, saleId: string, valor: number) {
    const id = novoId();
    await q(
      `INSERT INTO sale_payments (id, tenant_id, sale_id, amount_cents, method, received_on, recorded_by_user_id, request_key)
       VALUES ($1, $2, $3, $4, 'PIX', current_date, $5, $6)`,
      [id, e.tenantId, saleId, valor, e.dono.userId, novaChave()],
    );
    return id;
  }

  const estornarRecebimento = (paymentId: string, userId: string) =>
    q(
      `UPDATE sale_payments SET refunded_at = now(), refunded_on = current_date, refund_reason = 'Pagamento duplicado', refunded_by_user_id = $2
        WHERE id = $1`,
      [paymentId, userId],
    );

  beforeAll(async () => {
    db = await abrirBanco(url!);
    dados = semeador(db, `vendas-${novoId()}`);
    produtos = new StockProductsService(db);
    movimentos = new StockMovementsService(db);
    clientes = new ConsumersService(db);
    unificacao = new ConsumerMergeService(db);
    equipe = new TeamService(db);
    contas = new StaffAccountsService(db);
    const categorias = new StockCategoriesService(db);
    est = await dados.estabelecimento('loja');
    outro = await dados.estabelecimento('vizinha');
    await ligarVendas(est.tenantId);
    await ligarVendas(outro.tenantId);
    categoria = (await categorias.create(dono(), est.tenantId, { name: 'Revenda' })).id;
    categoriaDoOutro = (await categorias.create(outro.dono.userId, outro.tenantId, { name: 'Revenda' })).id;
  }, 120_000);

  afterAll(async () => {
    await db?.destroy();
  });

  describe('venda, itens e baixas', () => {
    it('venda válida: uma baixa por item, soma = total, preço e nome congelados, saldo baixado', async () => {
      const pomada = await produto(est, categoria, 'Pomada modeladora', 10_000);
      const oleo = await produto(est, categoria, 'Óleo para barba', 5_500, 'L');
      const { saleId, movimentos: baixas } = await vender(est, [
        { productId: pomada, quantityMilli: 2_000, unitPriceCents: 3_990 },
        { productId: oleo, quantityMilli: 1_250, unitPriceCents: 4_999 },
      ]);
      const [v] = await q<{ total: string; itens: number; soma: string; status: string }>(
        `SELECT s.total_cents::text AS total, s.status, (SELECT count(*)::int FROM sale_items i WHERE i.sale_id = s.id) AS itens,
                (SELECT sum(line_total_cents)::text FROM sale_items i WHERE i.sale_id = s.id) AS soma
           FROM sales s WHERE s.id = $1`,
        [saleId],
      );
      expect(v).toEqual({ total: String(7_980 + 6_249), itens: 2, soma: String(7_980 + 6_249), status: 'ATIVA' });
      expect(baixas).toHaveLength(2);
      expect(await saldo(pomada)).toBe(8_000);
      expect(await saldo(oleo)).toBe(4_250);
      // 1,250 L × R$ 49,99 = 62,4875 → 6.249 centavos (metade para cima, por item).
      expect(linha(4_999, 1_250)).toBe(6_249);
    });

    it('total diferente da soma dos itens: recusado no commit (gatilho diferido), nada gravado', async () => {
      const p = await produto(est, categoria, 'Shampoo', 5_000);
      const r = await erroDoBanco(vender(est, [{ productId: p, quantityMilli: 1_000, unitPriceCents: 2_500 }], { totalCents: 2_600 }));
      expect(r).toMatchObject({ code: 'AC013', constraint: 'ck_sales_consistency' });
      expect(await saldo(p)).toBe(5_000);
    });

    it('venda sem itens (baixa sem item) é recusada no commit', async () => {
      const p = await produto(est, categoria, 'Condicionador', 5_000);
      const r = await erroDoBanco(vender(est, [{ productId: p, quantityMilli: 1_000, unitPriceCents: 2_500 }], { semItens: true }));
      expect(r).toMatchObject({ code: 'AC013', constraint: 'ck_sales_consistency' });
      expect(await saldo(p)).toBe(5_000);
    });

    it('linha com total fora da fórmula de arredondamento: CHECK da linha', async () => {
      const p = await produto(est, categoria, 'Gel', 5_000);
      const r = await erroDoBanco(
        db.transaction(async (tx) => {
          const { saleId, movimentos: [mov] } = await gravarVenda(tx, est, [{ productId: p, quantityMilli: 1_000, unitPriceCents: 1_000 }], {
            semItens: true,
          });
          await tx.query(
            `INSERT INTO sale_items (id, tenant_id, sale_id, position, product_id, stock_movement_id, product_name, unit,
               quantity_milli, unit_price_cents, line_total_cents)
             VALUES ($1, $2, $3, 1, $4, $5, 'Gel', 'UN', 1000, 1000, 999)`,
            [novoId(), est.tenantId, saleId, p, mov],
          );
        }),
      );
      expect(r.constraint).toBe('ck_sale_items_line');
    });

    it('item ligado a baixa de outro produto ou de outra quantidade: recusado pelo gatilho do item', async () => {
      const a = await produto(est, categoria, 'Cera A', 5_000);
      const b = await produto(est, categoria, 'Cera B', 5_000);
      const r = await erroDoBanco(
        db.transaction(async (tx) => {
          const { saleId, movimentos: [mov] } = await gravarVenda(tx, est, [{ productId: a, quantityMilli: 1_000, unitPriceCents: 1_000 }], {
            semItens: true,
          });
          await tx.query(
            `INSERT INTO sale_items (id, tenant_id, sale_id, position, product_id, stock_movement_id, product_name, unit,
               quantity_milli, unit_price_cents, line_total_cents)
             VALUES ($1, $2, $3, 1, $4, $5, 'Cera B', 'UN', 1000, 1000, 1000)`,
            [novoId(), est.tenantId, saleId, b, mov],
          );
        }),
      );
      expect(r).toMatchObject({ code: 'AC015', constraint: 'ck_sale_items_movement' });
      expect([await saldo(a), await saldo(b)]).toEqual([5_000, 5_000]);
    });

    it('baixa servindo a dois itens: UNIQUE do movimento', async () => {
      const p = await produto(est, categoria, 'Cera C', 5_000);
      const { saleId, movimentos: [mov] } = await vender(est, [{ productId: p, quantityMilli: 1_000, unitPriceCents: 1_000 }]);
      const r = await erroDoBanco(
        q(
          `INSERT INTO sale_items (id, tenant_id, sale_id, position, product_id, stock_movement_id, product_name, unit,
             quantity_milli, unit_price_cents, line_total_cents)
           VALUES ($1, $2, $3, 2, $4, $5, 'Cera C', 'UN', 1000, 1000, 1000)`,
          [novoId(), est.tenantId, saleId, p, mov],
        ),
      );
      expect(r.code).toBe('23505');
    });

    it('acrescentar baixa e item a uma venda já confirmada: recusado no commit (o total não muda)', async () => {
      const p = await produto(est, categoria, 'Spray', 5_000);
      const outroP = await produto(est, categoria, 'Spray fixador', 5_000);
      const { saleId } = await vender(est, [{ productId: p, quantityMilli: 1_000, unitPriceCents: 1_000 }]);
      const r = await erroDoBanco(
        db.transaction(async (tx) => {
          const mov = await movimentar(tx, est.tenantId, dono(), outroP, -1_000, { kind: 'SAIDA_VENDA', saleId });
          await tx.query(
            `INSERT INTO sale_items (id, tenant_id, sale_id, position, product_id, stock_movement_id, product_name, unit,
               quantity_milli, unit_price_cents, line_total_cents)
             VALUES ($1, $2, $3, 2, $4, $5, 'Spray fixador', 'UN', 1000, 1000, 1000)`,
            [novoId(), est.tenantId, saleId, outroP, mov],
          );
        }),
      );
      expect(r).toMatchObject({ code: 'AC013', constraint: 'ck_sales_consistency' });
      expect(await saldo(outroP)).toBe(5_000);
    });

    it('saldo insuficiente em um item recusa a venda inteira (nenhum saldo muda)', async () => {
      const a = await produto(est, categoria, 'Navalha', 5_000);
      const b = await produto(est, categoria, 'Lâmina', 1_000);
      const r = await erroDoBanco(
        vender(est, [
          { productId: a, quantityMilli: 1_000, unitPriceCents: 1_000 },
          { productId: b, quantityMilli: 2_000, unitPriceCents: 1_000 },
        ]),
      );
      expect(r.code).toBe('23514');
      expect([await saldo(a), await saldo(b)]).toEqual([5_000, 1_000]);
    });

    it('venda e itens só de inserção: itens não mudam nem somem, venda não some, total não muda', async () => {
      const p = await produto(est, categoria, 'Tônico', 5_000);
      const { saleId } = await vender(est, [{ productId: p, quantityMilli: 1_000, unitPriceCents: 1_000 }]);
      expect((await erroDoBanco(q(`UPDATE sale_items SET unit_price_cents = 1 WHERE sale_id = $1`, [saleId]))).code).toBe('AC002');
      expect((await erroDoBanco(q(`DELETE FROM sale_items WHERE sale_id = $1`, [saleId]))).code).toBe('AC002');
      expect((await erroDoBanco(q(`DELETE FROM sales WHERE id = $1`, [saleId]))).code).toBe('AC002');
      expect(await erroDoBanco(q(`UPDATE sales SET total_cents = 1 WHERE id = $1`, [saleId]))).toMatchObject({
        code: 'AC011',
        constraint: 'ck_sales_transition',
      });
    });
  });

  describe('estorno manual recusado, cancelamento legítimo permitido', () => {
    it('o serviço de estoque recusa estornar a baixa de uma venda (409 BAIXA_DE_VENDA) e mostra o vínculo', async () => {
      const p = await produto(est, categoria, 'Pente', 5_000);
      const { saleId, movimentos: [baixa] } = await vender(est, [{ productId: p, quantityMilli: 1_000, unitPriceCents: 1_500 }]);
      expect(await codigoDe(movimentos.reverse(dono(), est.tenantId, baixa, { requestKey: novaChave(), reason: 'Lançado errado' } as never))).toBe(
        'BAIXA_DE_VENDA',
      );
      const lista = await movimentos.list(dono(), est.tenantId, { productId: p } as never);
      expect(lista.movements.find((m) => m.id === baixa)?.saleId).toBe(saleId);
      expect(await saldo(p)).toBe(4_000);
    });

    it('SQL direto (como a API anterior): estorno sem sale_id e estorno com sale_id de venda ativa são recusados pelo banco', async () => {
      const p = await produto(est, categoria, 'Escova', 5_000);
      const { saleId, movimentos: [baixa] } = await vender(est, [{ productId: p, quantityMilli: 1_000, unitPriceCents: 1_500 }]);
      const semVenda = await erroDoBanco(
        db.transaction((tx) => movimentar(tx, est.tenantId, dono(), p, 1_000, { kind: 'ESTORNO', saleId: null, reverses: baixa, reason: 'Manual' })),
      );
      expect(semVenda).toMatchObject({ code: 'AC010', constraint: 'ck_stock_movements_sale_reversal' });
      const vendaAtiva = await erroDoBanco(
        db.transaction((tx) => movimentar(tx, est.tenantId, dono(), p, 1_000, { kind: 'ESTORNO', saleId, reverses: baixa, reason: 'Manual' })),
      );
      expect(vendaAtiva).toMatchObject({ code: 'AC010', constraint: 'ck_stock_movements_sale_reversal' });
      expect(await saldo(p)).toBe(4_000);
    });

    it('cancelamento pelo fluxo devolve tudo, inclusive produto arquivado (que continua arquivado)', async () => {
      const a = await produto(est, categoria, 'Máquina', 5_000);
      const b = await produto(est, categoria, 'Pente de máquina', 5_000);
      const { saleId } = await vender(est, [
        { productId: a, quantityMilli: 1_000, unitPriceCents: 9_000 },
        { productId: b, quantityMilli: 3_000, unitPriceCents: 500 },
      ]);
      await q(`UPDATE stock_products SET archived_at = now() WHERE id = $1`, [b]);
      await cancelar(est, saleId);
      const [v] = await q<{ status: string; estornos: number }>(
        `SELECT s.status, (SELECT count(*)::int FROM stock_movements m WHERE m.sale_id = s.id AND m.kind = 'ESTORNO') AS estornos
           FROM sales s WHERE s.id = $1`,
        [saleId],
      );
      expect(v).toEqual({ status: 'CANCELADA', estornos: 2 });
      expect([await saldo(a), await saldo(b)]).toEqual([5_000, 5_000]);
      expect((await q<{ arquivado: boolean }>(`SELECT archived_at IS NOT NULL AS arquivado FROM stock_products WHERE id = $1`, [b]))[0].arquivado).toBe(true);
    });

    it('cancelamento parcial (só um dos estornos) é recusado no commit; nada muda', async () => {
      const a = await produto(est, categoria, 'Toalha', 5_000);
      const b = await produto(est, categoria, 'Capa', 5_000);
      const { saleId } = await vender(est, [
        { productId: a, quantityMilli: 1_000, unitPriceCents: 1_000 },
        { productId: b, quantityMilli: 1_000, unitPriceCents: 1_000 },
      ]);
      expect(await erroDoBanco(cancelar(est, saleId, { apenas: 1 }))).toMatchObject({ code: 'AC013', constraint: 'ck_sales_consistency' });
      expect((await q<{ status: string }>(`SELECT status FROM sales WHERE id = $1`, [saleId]))[0].status).toBe('ATIVA');
      expect([await saldo(a), await saldo(b)]).toEqual([4_000, 4_000]);
    });

    it('cancelamento repetido: o segundo não grava estorno nem muda o motivo', async () => {
      const p = await produto(est, categoria, 'Avental', 5_000);
      const { saleId } = await vender(est, [{ productId: p, quantityMilli: 1_000, unitPriceCents: 1_000 }]);
      await cancelar(est, saleId);
      expect(await erroDoBanco(cancelar(est, saleId, { motivo: 'Outro motivo qualquer' }))).toMatchObject({
        code: 'AC011',
        constraint: 'ck_sales_transition',
      });
      const [m] = await q<{ n: number }>(`SELECT count(*)::int AS n FROM stock_movements WHERE sale_id = $1 AND kind = 'ESTORNO'`, [saleId]);
      expect(m.n).toBe(1);
      expect(await saldo(p)).toBe(5_000);
    });

    it('venda cancelada não recebe baixa nova', async () => {
      const p = await produto(est, categoria, 'Borrifador', 5_000);
      const { saleId } = await vender(est, [{ productId: p, quantityMilli: 1_000, unitPriceCents: 1_000 }]);
      await cancelar(est, saleId);
      const r = await erroDoBanco(db.transaction((tx) => movimentar(tx, est.tenantId, dono(), p, -1_000, { kind: 'SAIDA_VENDA', saleId })));
      expect(r).toMatchObject({ code: 'AC010', constraint: 'ck_stock_movements_sale_active' });
    });
  });

  describe('recebimento de venda', () => {
    it('integral e um ativo por venda; cancelar exige estornar o recebimento antes', async () => {
      const p = await produto(est, categoria, 'Kit barba', 5_000);
      const { saleId } = await vender(est, [{ productId: p, quantityMilli: 2_000, unitPriceCents: 2_550 }]);
      expect(await erroDoBanco(receber(est, saleId, 5_000))).toMatchObject({ code: 'AC014', constraint: 'ck_sale_payments_sale' });
      const pago = await receber(est, saleId, 5_100);
      expect((await erroDoBanco(receber(est, saleId, 5_100))).code).toBe('23505');
      expect(await erroDoBanco(cancelar(est, saleId))).toMatchObject({ code: 'AC012', constraint: 'ck_sales_no_active_payment' });
      expect(await erroDoBanco(q(`UPDATE sale_payments SET amount_cents = 1 WHERE id = $1`, [pago]))).toMatchObject({ code: 'AC014' });
      await estornarRecebimento(pago, dono());
      expect(await erroDoBanco(estornarRecebimento(pago, dono()))).toMatchObject({ code: 'AC014' });
      await cancelar(est, saleId);
      expect(await erroDoBanco(receber(est, saleId, 5_100))).toMatchObject({ code: 'AC014', constraint: 'ck_sale_payments_sale' });
      expect(await saldo(p)).toBe(5_000);
    });

    it('recebimento e cancelamento simultâneos: só um vence (a venda é travada pelos dois)', async () => {
      const p = await produto(est, categoria, 'Kit cabelo', 5_000);
      const { saleId } = await vender(est, [{ productId: p, quantityMilli: 1_000, unitPriceCents: 3_000 }]);
      const resultados = await Promise.allSettled([cancelar(est, saleId), receber(est, saleId, 3_000)]);
      expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const [l] = await q<{ status: string; ativos: number }>(
        `SELECT s.status, (SELECT count(*)::int FROM sale_payments x WHERE x.sale_id = s.id AND x.refunded_at IS NULL) AS ativos
           FROM sales s WHERE s.id = $1`,
        [saleId],
      );
      expect(l.status === 'CANCELADA' ? l.ativos === 0 : l.ativos === 1).toBe(true);
    });
  });

  describe('concorrência pelo último saldo', () => {
    it('duas vendas do último item: uma passa, a outra é recusada e o saldo nunca fica negativo', async () => {
      const p = await produto(est, categoria, 'Último perfume', 1_000);
      const resultados = await Promise.allSettled([
        vender(est, [{ productId: p, quantityMilli: 1_000, unitPriceCents: 10_000 }]),
        vender(est, [{ productId: p, quantityMilli: 1_000, unitPriceCents: 10_000 }]),
      ]);
      expect(resultados.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
      expect(await saldo(p)).toBe(0);
      const [n] = await q<{ n: number }>(`SELECT count(*)::int AS n FROM sale_items WHERE product_id = $1`, [p]);
      expect(n.n).toBe(1);
    });
  });

  describe('isolamento entre estabelecimentos', () => {
    it('cliente, produto, venda e recebimento de outro estabelecimento nunca fecham as FKs', async () => {
      const meu = await produto(est, categoria, 'Produto meu', 5_000);
      const deFora = await produto(outro, categoriaDoOutro, 'Produto de fora', 5_000);
      const clienteDeFora = await clientes.create(outro.dono.userId, outro.tenantId, { name: 'Cliente Vizinho', whatsapp: '11987650001' } as never);
      expect((await erroDoBanco(vender(est, [{ productId: meu, quantityMilli: 1_000, unitPriceCents: 100 }], { consumerId: clienteDeFora.id }))).code).toBe(
        '23503',
      );
      // Produto de fora: a baixa nem fecha a FK do produto com o estabelecimento.
      expect((await erroDoBanco(vender(est, [{ productId: deFora, quantityMilli: 1_000, unitPriceCents: 100 }]))).message).toBeTruthy();
      const { saleId: vendaDoOutro } = await vender(outro, [{ productId: deFora, quantityMilli: 1_000, unitPriceCents: 100 }]);
      // O gatilho do recebimento procura a venda no estabelecimento do
      // recebimento antes da FK: não acha e recusa (AC014).
      expect((await erroDoBanco(receber(est, vendaDoOutro, 100))).code).toMatch(/^(23503|AC014)$/);
      expect(
        (await erroDoBanco(db.transaction((tx) => movimentar(tx, est.tenantId, dono(), meu, -1_000, { kind: 'SAIDA_VENDA', saleId: vendaDoOutro })))).code,
      ).toMatch(/23503|AC010/);
      expect([await saldo(meu), await saldo(deFora)]).toEqual([5_000, 4_000]);
    });

    it('a baixa de venda de outro estabelecimento não é encontrada pelo estorno (404)', async () => {
      const deFora = await produto(outro, categoriaDoOutro, 'Produto de fora 2', 5_000);
      const { movimentos: [baixa] } = await vender(outro, [{ productId: deFora, quantityMilli: 1_000, unitPriceCents: 100 }]);
      expect((await erroDe(movimentos.reverse(dono(), est.tenantId, baixa, { requestKey: novaChave(), reason: 'Tentativa' } as never))).getStatus?.()).toBe(404);
    });
  });

  describe('saída manual de venda com o adicional', () => {
    it('com VENDAS: 409 USE_VENDAS; perda continua; sem VENDAS, a saída por venda manual volta', async () => {
      const p = await produto(est, categoria, 'Sabonete', 5_000);
      const mover = (kind: string) =>
        movimentos.create(dono(), est.tenantId, {
          requestKey: novaChave(),
          productId: p,
          kind,
          quantityMilli: 1_000,
          expectedUnit: 'UN',
          reason: kind === 'SAIDA_PERDA' ? 'Embalagem danificada' : null,
        } as never);
      expect(await codigoDe(mover('SAIDA_VENDA'))).toBe('USE_VENDAS');
      await mover('SAIDA_PERDA');
      await desligarVendas(est.tenantId);
      try {
        const manual = await mover('SAIDA_VENDA');
        expect(manual.movement.saleId).toBeNull();
        // Lançamento manual antigo continua estornável.
        await movimentos.reverse(dono(), est.tenantId, manual.movement.id, { requestKey: novaChave(), reason: 'Lançado errado' } as never);
      } finally {
        await ligarVendas(est.tenantId);
      }
      expect(await saldo(p)).toBe(4_000);
    });
  });

  describe('gate: nova venda contra manutenção', () => {
    const novaVenda = (userId: string, tenantId: string) =>
      resolveAuthorizedTenant(db.manager, userId, tenantId, { permitido: canRegisterSales, mensagemProibido: 'x', recurso: SALES_NEW_SALE_FEATURES });
    const manutencao = (userId: string, tenantId: string) =>
      resolveAuthorizedTenant(db.manager, userId, tenantId, {
        permitido: canAccessSalesHistory,
        mensagemProibido: 'x',
        recurso: SALES_MAINTENANCE_FEATURES,
      });

    it('nova venda pede VENDAS e ESTOQUE; sem um deles, 403 RECURSO_NAO_CONTRATADO; a manutenção continua', async () => {
      const loja = await dados.estabelecimento('gate');
      await expect(novaVenda(loja.dono.userId, loja.tenantId)).rejects.toMatchObject({ response: { code: 'RECURSO_NAO_CONTRATADO' } });
      await ligarVendas(loja.tenantId);
      await expect(novaVenda(loja.dono.userId, loja.tenantId)).resolves.toMatchObject({ role: 'DONO' });
      await dados.desligarEstoque(loja.tenantId);
      await expect(novaVenda(loja.dono.userId, loja.tenantId)).rejects.toMatchObject({ response: { code: 'RECURSO_NAO_CONTRATADO' } });
      await dados.ligarEstoque(loja.tenantId);
      await desligarVendas(loja.tenantId);
      await expect(manutencao(loja.dono.userId, loja.tenantId)).resolves.toMatchObject({ role: 'DONO' });
    });

    it('recepcionista com VENDAS_REGISTRAR: vende com o adicional; sem ele, só a manutenção; áreas da sessão acompanham', async () => {
      const loja = await dados.estabelecimento('gate-recepcao');
      await ligarVendas(loja.tenantId);
      const rita = await dados.vinculo(loja, 'rita', 'RECEPCIONISTA', ['VENDAS_REGISTRAR']);
      const areas = () =>
        sessionAreas(db.manager, { id: rita.membershipId, tenantId: loja.tenantId, role: EstablishmentRole.RECEPCIONISTA });
      await expect(novaVenda(rita.userId, loja.tenantId)).resolves.toMatchObject({ role: 'RECEPCIONISTA' });
      expect(await areas()).toEqual(['VENDAS_NOVA', 'VENDAS_HISTORICO']);
      await desligarVendas(loja.tenantId);
      await expect(novaVenda(rita.userId, loja.tenantId)).rejects.toMatchObject({ response: { code: 'RECURSO_NAO_CONTRATADO' } });
      await expect(manutencao(rita.userId, loja.tenantId)).resolves.toMatchObject({ role: 'RECEPCIONISTA' });
      expect(await areas()).toEqual([]);
      // Com uma venda registrada, a manutenção aparece mesmo sem o adicional.
      await ligarVendas(loja.tenantId);
      const cat = (await new StockCategoriesService(db).create(loja.dono.userId, loja.tenantId, { name: 'Balcão' })).id;
      const p = await produto(loja, cat, 'Bala', 5_000);
      await vender(loja, [{ productId: p, quantityMilli: 1_000, unitPriceCents: 100 }], { userId: rita.userId });
      await desligarVendas(loja.tenantId);
      expect(await areas()).toEqual(['VENDAS_HISTORICO']);
    });
  });

  describe('recepcionista em Equipe e acessos', () => {
    it('o dono cria a recepcionista (sem profissional), a vaga conta e o limite cheio recusa', async () => {
      const loja = await dados.estabelecimento('equipe');
      await ligarVendas(loja.tenantId);
      const antes = await db.transaction((tx) => staffSeatUsage(tx, loja.tenantId, 20, new Date()));
      const criada = await contas.create(loja.dono.userId, loja.dono.sessionId, loja.tenantId, {
        requestKey: novaChave(),
        role: 'RECEPCIONISTA',
        professionalId: null,
        name: 'Rita Recepção',
        username: `rita.${novoId().slice(0, 8)}`,
        permissions: ['VENDAS_REGISTRAR', 'VENDAS_RECEBER'],
      });
      expect(criada).toMatchObject({ role: 'RECEPCIONISTA' });
      const depois = await db.transaction((tx) => staffSeatUsage(tx, loja.tenantId, 20, new Date()));
      expect(depois.used).toBe(antes.used + 1);
      await q(`UPDATE tenants SET team_user_limit = $2 WHERE id = $1`, [loja.tenantId, depois.used]);
      expect(
        await codigoDe(
          contas.create(loja.dono.userId, loja.dono.sessionId, loja.tenantId, {
            requestKey: novaChave(),
            role: 'RECEPCIONISTA',
            professionalId: null,
            name: 'Segunda Recepção',
            username: `sara.${novoId().slice(0, 8)}`,
            permissions: [],
          }),
        ),
      ).toBe('LIMITE_DO_PLANO');
    });

    it('concessões: as três da lista passam; consulta geral, cancelar, estornar e estoque são recusados; sem VENDAS, nada novo', async () => {
      const loja = await dados.estabelecimento('concessoes');
      await ligarVendas(loja.tenantId);
      const rita: Pessoa = await dados.vinculo(loja, 'rita', 'RECEPCIONISTA');
      const definir = (expectedGranted: string[], granted: string[]) =>
        equipe.setPermissions(loja.dono.userId, loja.dono.sessionId, loja.tenantId, rita.membershipId, { expectedGranted, granted } as never);
      await definir([], ['VENDAS_REGISTRAR']);
      await definir(['VENDAS_REGISTRAR'], ['VENDAS_REGISTRAR', 'VENDAS_RECEBER', 'VENDAS_ALTERAR_PRECO']);
      const todas = ['VENDAS_ALTERAR_PRECO', 'VENDAS_RECEBER', 'VENDAS_REGISTRAR'];
      for (const proibida of ['VENDAS_VISUALIZAR', 'VENDAS_CANCELAR', 'VENDAS_ESTORNAR_RECEBIMENTO', 'ESTOQUE_VISUALIZAR', 'AGENDA_VISUALIZAR']) {
        expect(await codigoDe(definir(todas, [...todas, proibida]))).toBe('PERMISSAO_NAO_SE_APLICA');
      }
      expect(await codigoDe(definir(todas, ['VENDAS_RECEBER']))).toBe('PERMISSOES_INCOMPLETAS');
      await desligarVendas(loja.tenantId);
      // Retirar é sempre possível; conceder de novo, não.
      await definir(todas, ['VENDAS_REGISTRAR']);
      expect(await codigoDe(definir(['VENDAS_REGISTRAR'], ['VENDAS_REGISTRAR', 'VENDAS_RECEBER']))).toBe('RECURSO_NAO_CONTRATADO');
      const gravadas = await q<{ permission: string }>(
        `SELECT permission::text AS permission FROM membership_permission_overrides WHERE membership_id = $1 AND mode = 'GRANTED' ORDER BY 1`,
        [rita.membershipId],
      );
      expect(gravadas.map((g) => g.permission)).toEqual(['VENDAS_REGISTRAR']);
    });

    it('troca de perfil para Recepcionista com profissional ligado é recusada', async () => {
      const loja = await dados.estabelecimento('perfil');
      const funcionario = await dados.vinculo(loja, 'joao', 'PROFISSIONAL');
      const [m] = await q<{ professional_id: string }>(`SELECT professional_id FROM memberships WHERE id = $1`, [funcionario.membershipId]);
      expect(
        await codigoDe(
          equipe.changeAccess(loja.dono.userId, loja.dono.sessionId, loja.tenantId, funcionario.membershipId, {
            expected: { role: 'PROFISSIONAL', professionalId: m.professional_id, granted: [] },
            role: 'RECEPCIONISTA',
            professionalId: m.professional_id,
            granted: [],
          }),
        ),
      ).toBe('PERFIL_SEM_PROFISSIONAL');
    });
  });

  describe('unificação de clientes com vendas', () => {
    let seq = 0;
    const par = async () => {
      seq += 1;
      const nome = `Bruna Compras ${seq}`;
      const principal = await clientes.create(dono(), est.tenantId, { name: nome, whatsapp: `1198${String(7_000_000 + seq * 2).padStart(7, '0')}` } as never);
      const secundario = await clientes.create(dono(), est.tenantId, { name: nome, whatsapp: `1198${String(7_000_001 + seq * 2).padStart(7, '0')}` } as never);
      return { principal: principal.id as string, secundario: secundario.id as string };
    };
    const clienteDaVenda = async (saleId: string) =>
      (await q<{ consumer_id: string }>(`SELECT consumer_id FROM sales WHERE id = $1`, [saleId]))[0].consumer_id;

    it('a prévia conta as compras do secundário e a unificação as leva para o principal', async () => {
      const { principal, secundario } = await par();
      const p = await produto(est, categoria, `Produto unificação ${seq}`, 5_000);
      const { saleId } = await vender(est, [{ productId: p, quantityMilli: 1_000, unitPriceCents: 1_000 }], { consumerId: secundario });
      const previa = await unificacao.preview(dono(), est.tenantId, secundario, principal);
      expect(previa.transferir.compras).toBe(1);
      const feito = await unificacao.merge(dono(), est.tenantId, secundario, { principalId: principal, versaoDaPrevia: previa.versaoDaPrevia });
      expect(feito.transferido.compras).toBe(1);
      expect(await clienteDaVenda(saleId)).toBe(principal);
      // Lápide não recebe venda nova.
      expect(await erroDoBanco(vender(est, [{ productId: p, quantityMilli: 1_000, unitPriceCents: 1_000 }], { consumerId: secundario }))).toMatchObject({
        code: 'AC001',
      });
    });

    it('venda gravada durante a unificação: a unificação espera e recusa a prévia antiga; refeita, leva a venda', async () => {
      const { principal, secundario } = await par();
      const p = await produto(est, categoria, `Produto corrida ${seq}`, 5_000);
      const previa = await unificacao.preview(dono(), est.tenantId, secundario, principal);
      expect(previa.transferir.compras).toBe(0);
      const venda = db.createQueryRunner();
      await venda.connect();
      await venda.startTransaction();
      try {
        // A venda pega o FOR SHARE do cadastro (gatilho) e fica aberta.
        const { saleId } = await gravarVenda(venda.manager, est, [{ productId: p, quantityMilli: 1_000, unitPriceCents: 1_000 }], {
          consumerId: secundario,
        });
        const unir = unificacao.merge(dono(), est.tenantId, secundario, { principalId: principal, versaoDaPrevia: previa.versaoDaPrevia });
        await new Promise((r) => setTimeout(r, 300));
        await venda.commitTransaction();
        expect(await codigoDe(unir)).toBe('PREVIA_DESATUALIZADA');
        expect(await clienteDaVenda(saleId)).toBe(secundario);
        const nova = await unificacao.preview(dono(), est.tenantId, secundario, principal);
        expect(nova.transferir.compras).toBe(1);
        await unificacao.merge(dono(), est.tenantId, secundario, { principalId: principal, versaoDaPrevia: nova.versaoDaPrevia });
        expect(await clienteDaVenda(saleId)).toBe(principal);
      } finally {
        if (venda.isTransactionActive) await venda.rollbackTransaction();
        await venda.release();
      }
    });

    it('venda que chega com a unificação em andamento espera e encontra a lápide (AC001), sem gravar nada', async () => {
      const { principal, secundario } = await par();
      const p = await produto(est, categoria, `Produto espera ${seq}`, 5_000);
      // A "unificação" (as mesmas travas e a lápide do serviço) fica aberta numa
      // conexão própria.
      const merge = new Client({ connectionString: url, ssl: { rejectUnauthorized: true } });
      await merge.connect();
      try {
        await merge.query('BEGIN');
        await merge.query(`SELECT id FROM consumers WHERE tenant_id = $1 AND id = ANY($2::varchar[]) ORDER BY id FOR UPDATE`, [
          est.tenantId,
          [principal, secundario],
        ]);
        await merge.query(
          `UPDATE consumers SET merged_into_consumer_id = $3, merged_at = now(), merged_by_user_id = $4, updated_at = now()
            WHERE tenant_id = $1 AND id = $2`,
          [est.tenantId, secundario, principal, dono()],
        );
        const chegando = vender(est, [{ productId: p, quantityMilli: 1_000, unitPriceCents: 1_000 }], { consumerId: secundario });
        await new Promise((r) => setTimeout(r, 300));
        await merge.query('COMMIT');
        expect(await erroDoBanco(chegando)).toMatchObject({ code: 'AC001' });
        expect(await saldo(p)).toBe(5_000);
      } finally {
        await merge.end();
      }
    });

    it('unificação pela API anterior (só a lápide, sem conhecer vendas): o gatilho leva as vendas', async () => {
      const { principal, secundario } = await par();
      const p = await produto(est, categoria, `Produto legado ${seq}`, 5_000);
      const { saleId } = await vender(est, [{ productId: p, quantityMilli: 1_000, unitPriceCents: 1_000 }], { consumerId: secundario });
      await q(
        `UPDATE consumers SET merged_into_consumer_id = $3, merged_at = now(), merged_by_user_id = $4, updated_at = now()
          WHERE tenant_id = $1 AND id = $2`,
        [est.tenantId, secundario, principal, dono()],
      );
      expect(await clienteDaVenda(saleId)).toBe(principal);
      // Trocar o cliente de uma venda fora da unificação é recusado.
      const { principal: terceiro } = await par();
      expect(await erroDoBanco(q(`UPDATE sales SET consumer_id = $2 WHERE id = $1`, [saleId, terceiro]))).toMatchObject({
        code: 'AC011',
        constraint: 'ck_sales_transition',
      });
    });
  });
});
