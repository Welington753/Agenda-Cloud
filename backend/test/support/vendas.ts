// Apoio dos testes de banco da API de vendas (PR 3 de docs/plans/vendas-v1.md):
// serviços reais sobre o banco descartável, estabelecimentos fictícios com
// ESTOQUE e VENDAS ligados como a assinatura liga (overrides), produtos,
// clientes e corpo de venda. Nunca banco real.
import type { DataSource } from 'typeorm';
import { ConsumersService } from '../../src/consumers/consumers.service.js';
import { ConsumerMergeService } from '../../src/consumers/consumer-merge.service.js';
import { SalePaymentsService } from '../../src/sales/sale-payments.service.js';
import { SalesService } from '../../src/sales/sales.service.js';
import { StockCategoriesService } from '../../src/stock/stock-categories.service.js';
import { StockMovementsService } from '../../src/stock/stock-movements.service.js';
import { StockProductsService } from '../../src/stock/stock-products.service.js';
import type { CreateSaleDto } from '../../src/sales/sales.dto.js';
import { novaChave, novoId, semeador, type Estabelecimento, type Pessoa } from './estoque.js';

export function apoioDeVendas(db: DataSource, marca: string) {
  const dados = semeador(db, marca);
  const vendas = new SalesService(db);
  const recebimentos = new SalePaymentsService(db);
  const produtos = new StockProductsService(db);
  const categorias = new StockCategoriesService(db);
  const movimentos = new StockMovementsService(db);
  const clientes = new ConsumersService(db);
  const unificacao = new ConsumerMergeService(db);
  const q = dados.q;
  const categoriaDe = new Map<string, string>();
  let telefone = 0;

  async function recurso(tenantId: string, featureId: string, enabled: boolean) {
    await q(
      `INSERT INTO tenant_feature_overrides (id, tenant_id, feature_id, enabled) VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, feature_id) DO UPDATE SET enabled = EXCLUDED.enabled`,
      [novoId(), tenantId, featureId, enabled],
    );
  }
  const ligarVendas = (tenantId: string) => recurso(tenantId, 'feat_vendas', true);
  const desligarVendas = (tenantId: string) =>
    q(`DELETE FROM tenant_feature_overrides WHERE tenant_id = $1 AND feature_id = 'feat_vendas'`, [tenantId]);

  /** Estabelecimento com ESTOQUE e VENDAS ligados e uma categoria. */
  async function loja(nome: string): Promise<Estabelecimento> {
    const e = await dados.estabelecimento(nome);
    await ligarVendas(e.tenantId);
    categoriaDe.set(e.tenantId, (await categorias.create(e.dono.userId, e.tenantId, { name: 'Revenda' })).id);
    return e;
  }

  async function produto(
    e: Estabelecimento,
    nome: string,
    saldoMilli: number,
    opcoes: { preco?: number | null; unit?: string; purpose?: string } = {},
  ): Promise<string> {
    const r = await produtos.create(e.dono.userId, e.tenantId, {
      requestKey: novaChave(),
      name: nome,
      description: null,
      internalCode: null,
      categoryId: categoriaDe.get(e.tenantId)!,
      subcategoryId: null,
      purpose: opcoes.purpose ?? 'VENDA',
      unit: opcoes.unit ?? 'UN',
      minQuantityMilli: 0,
      initialQuantityMilli: saldoMilli > 0 ? saldoMilli : null,
      salePriceCents: opcoes.preco === undefined ? 1_000 : opcoes.preco,
    } as never);
    return r.product.id;
  }

  async function cliente(e: Estabelecimento, nome: string): Promise<string> {
    telefone += 1;
    const c = await clientes.create(e.dono.userId, e.tenantId, {
      name: nome,
      whatsapp: `1197${String(1_000_000 + telefone + Math.floor(Math.random() * 1_000) * 1_000).padStart(7, '0')}`,
    } as never);
    return c.id as string;
  }

  const saldo = async (productId: string) =>
    Number((await q<{ s: string }>(`SELECT balance_milli::text AS s FROM stock_products WHERE id = $1`, [productId]))[0].s);

  /** Item no preço sugerido gravado (lido do banco), ou no preço dado. */
  async function item(productId: string, quantityMilli: number, unitPriceCents?: number) {
    const [p] = await q<{ unit: string; preco: string | null }>(`SELECT unit, sale_price_cents::text AS preco FROM stock_products WHERE id = $1`, [
      productId,
    ]);
    const sugerido = p.preco === null ? null : Number(p.preco);
    return {
      productId,
      quantityMilli,
      expectedUnit: p.unit as CreateSaleDto['items'][number]['expectedUnit'],
      expectedSuggestedPriceCents: sugerido,
      unitPriceCents: unitPriceCents ?? sugerido ?? 1,
    };
  }

  async function vender(e: Estabelecimento, quem: Pessoa, itens: CreateSaleDto['items'], extra: Partial<CreateSaleDto> = {}) {
    return vendas.create(quem.userId, e.tenantId, { requestKey: novaChave(), consumerId: null, items: itens, ...extra });
  }

  const reconfirmarSenha = (p: Pessoa, quando: Date = new Date()) =>
    q(`UPDATE sessions SET reauthenticated_at = $2 WHERE id = $1`, [p.sessionId, quando]);

  const hoje = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

  return {
    dados,
    q,
    vendas,
    recebimentos,
    produtos,
    movimentos,
    clientes,
    unificacao,
    recurso,
    ligarVendas,
    desligarVendas,
    loja,
    produto,
    cliente,
    saldo,
    item,
    vender,
    reconfirmarSenha,
    hoje,
  };
}
