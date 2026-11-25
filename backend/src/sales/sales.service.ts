// Vendas (adicional VENDAS, docs/plans/vendas-v1.md): catálogo e busca de
// cliente para a nova venda, registro, consultas e cancelamento.
// Recebimentos: sale-payments.service.ts.
//
// ACESSO (sales-access.ts): nova venda (catálogo, busca, registrar) exige
// VENDAS e ESTOQUE; a manutenção das vendas registradas (consultar,
// cancelar) não exige recurso, só a validade do acesso. Autorização sempre
// antes de ler ou gravar, inclusive no reenvio, e de novo dentro da
// transação.
//
// REGISTRO (uma transação): trava o cliente (`FOR SHARE`, contra a
// unificação) e os produtos por ordem de id (`FOR UPDATE`, contra outra venda,
// movimentação ou conferência), confere finalidade, arquivamento, unidade,
// preço e saldo de TODOS, e grava a venda, uma `SAIDA_VENDA` com `sale_id`
// por item, os itens (nome, unidade e preço congelados) e a auditoria. Um
// item recusado recusa tudo. Total e linhas calculados aqui (sale-math.ts);
// o banco confere a linha (`ck_sale_items_line`) e a soma no commit
// (`ck_sales_consistency`).
//
// REENVIO: a mesma `requestKey` com a mesma venda devolve a original; com
// outra venda, 409 `CHAVE_REUTILIZADA` sem gravar.
//
// CANCELAMENTO (integral, motivo e senha confirmada há pouco): trava a
// venda, recusa com recebimento ativo (409 `RECEBIMENTO_ATIVO`), marca a
// venda como cancelada e, em seguida, lança um `ESTORNO` por item com o mesmo
// `sale_id`, inclusive de produto arquivado (que continua arquivado). O
// gatilho `stock_movements_sale_link` só aceita esse estorno com a venda já
// cancelada na transação. Repetir com o mesmo motivo devolve a venda
// cancelada, sem novo lançamento; com outro motivo, 409 `JA_CANCELADA`.
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { loadActor } from '../accounts/actor.js';
import { recordAudit } from '../accounts/audit.js';
import { requireRecentReauth } from '../accounts/reauth.js';
import { isUniqueViolation } from '../auth/unique-violation.js';
import { dataLocalDe } from '../availability/time-zone.js';
import { linhasDe } from '../common/linhas-de.js';
import { resolveAuthorizedTenant, type AuthorizedTenant, type PermissionOverrideLike } from '../common/tenant-authorization.js';
import { canViewConsumers } from '../consumers/consumer-access.js';
import { clienteUnificado, principalDoErroDeUnificado } from '../consumers/consumer-rules.js';
import { mesDaData } from '../dashboard/dashboard-period.js';
import { generateId } from '../entities/common/generate-id.js';
import type { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { SALE_ACTIVE_PAYMENT_CONSTRAINT } from '../migrations/1794614400000-SalesModule.js';
import { canViewStock } from '../stock/stock-access.js';
import {
  CHAVE_EM_USO,
  CHAVE_REUTILIZADA,
  LIMITE_DA_PAGINA,
  codificarCursor,
  conflito,
  decodificarCursor,
  iso,
  numero,
  termoDeBusca,
} from '../stock/stock-common.js';
import { registrarMovimentacao, travarProduto, type ProdutoTravado } from '../stock/stock-ledger.js';
import type { StockUnit } from '../stock/stock-quantity.js';
import {
  SALES_FORBIDDEN_MESSAGE,
  SALES_MAINTENANCE_FEATURES,
  SALES_NEW_SALE_FEATURES,
  canAccessSalesHistory,
  canCancelSales,
  canOverrideSalePrice,
  canRegisterSales,
  canViewAllSales,
} from './sales-access.js';
import { totalDaLinha } from './sale-math.js';
import { impressaoDaVenda, mesmoMotivo } from './sale-request-fingerprint.js';
import type { CancelSaleDto, CreateSaleDto, PurchaseListQueryDto, SaleCatalogQueryDto, SaleListQueryDto } from './sales.dto.js';
import {
  SELECT_RESUMO,
  VENDA_NAO_ENCONTRADA,
  fusoDoEstabelecimento,
  toSummaryView,
  vendaPorId,
  type ResumoRow,
  type SaleSummaryView,
  type SaleView,
} from './sales-views.js';

type Politica = (role: EstablishmentRole, overrides: readonly PermissionOverrideLike[]) => boolean;

/** Teto da busca de clientes da venda (a rota nunca vira lista de clientes). */
export const LIMITE_DA_BUSCA_DE_CLIENTES = 20;

export interface CatalogItemView {
  id: string;
  name: string;
  unit: StockUnit;
  /** `null` = sem preço sugerido (vender exige `VENDAS_ALTERAR_PRECO`). */
  salePriceCents: number | null;
  available: boolean;
  /** Só para quem tem `ESTOQUE_VISUALIZAR`. */
  balanceMilli?: number;
}

export interface SaleConsumerOption {
  id: string;
  name: string;
  /** Os quatro últimos dígitos do telefone; nunca o telefone inteiro. */
  phoneLast4: string | null;
}

export function autorizarVendas(
  manager: EntityManager,
  userId: string,
  tenantId: string,
  permitido: Politica,
  recurso: typeof SALES_NEW_SALE_FEATURES | typeof SALES_MAINTENANCE_FEATURES,
): Promise<AuthorizedTenant> {
  return resolveAuthorizedTenant(manager, userId, tenantId, { permitido, mensagemProibido: SALES_FORBIDDEN_MESSAGE, recurso });
}

const ov = (a: AuthorizedTenant) => a.overrides ?? [];

/** Período local (inclusivo) da consulta; sem as duas datas, o mês corrente. */
export function periodoDaConsulta(query: { from?: string; to?: string }, timezone: string, now: Date) {
  return query.from && query.to ? { from: query.from, to: query.to } : mesDaData(dataLocalDe(now, timezone));
}

@Injectable()
export class SalesService {
  constructor(private readonly dataSource: DataSource) {}

  /** Produtos de venda ativos, com preço sugerido e disponibilidade; saldo
   * numérico só para quem consulta o estoque. Nunca mínimo, histórico,
   * produto de consumo interno nem categoria arquivada. */
  async catalog(userId: string, tenantId: string, query: SaleCatalogQueryDto): Promise<{ products: CatalogItemView[]; showsBalance: boolean; nextCursor: string | null }> {
    const manager = this.dataSource.manager;
    const a = await autorizarVendas(manager, userId, tenantId, canRegisterSales, SALES_NEW_SALE_FEATURES);
    const veSaldo = canViewStock(a.role, ov(a));
    const params: unknown[] = [a.tenantId];
    const parametro = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };
    const filtros = [
      'p.tenant_id = $1',
      'p.archived_at IS NULL',
      `p.purpose IN ('VENDA', 'AMBOS')`,
      'c.archived_at IS NULL',
      '(p.subcategory_id IS NULL OR sc.archived_at IS NULL)',
    ];
    if (query.q) filtros.push(`p.name ILIKE ${parametro(termoDeBusca(query.q))}`);
    const cursor = decodificarCursor(query.cursor, 2);
    if (cursor) filtros.push(`(lower(p.name), p.id) > (${parametro(cursor[0])}, ${parametro(cursor[1])})`);
    const linhas = linhasDe<{ id: string; name: string; sort_name: string; unit: StockUnit; sale_price_cents: string | null; balance_milli: string }>(
      await manager.query(
        `SELECT p.id, p.name, lower(p.name) AS sort_name, p.unit, p.sale_price_cents::text AS sale_price_cents,
                p.balance_milli::text AS balance_milli
           FROM stock_products p
           JOIN stock_categories c ON c.tenant_id = p.tenant_id AND c.id = p.category_id
           LEFT JOIN stock_subcategories sc ON sc.tenant_id = p.tenant_id AND sc.id = p.subcategory_id
          WHERE ${filtros.join(' AND ')}
          ORDER BY lower(p.name), p.id
          LIMIT ${LIMITE_DA_PAGINA + 1}`,
        params,
      ),
    );
    const pagina = linhas.slice(0, LIMITE_DA_PAGINA);
    const ultimo = pagina.at(-1);
    return {
      products: pagina.map((l) => {
        const saldo = numero(l.balance_milli);
        return {
          id: l.id,
          name: l.name,
          unit: l.unit,
          salePriceCents: l.sale_price_cents === null ? null : numero(l.sale_price_cents),
          available: saldo > 0,
          ...(veSaldo ? { balanceMilli: saldo } : {}),
        };
      }),
      showsBalance: veSaldo,
      nextCursor: linhas.length > LIMITE_DA_PAGINA && ultimo ? codificarCursor([ultimo.sort_name, ultimo.id]) : null,
    };
  }

  /** Busca limitada de clientes para a venda: por nome ou pelos quatro
   * últimos dígitos do telefone; devolve id, nome e esses quatro dígitos,
   * só de cadastros ativos. Nunca e-mail, telefone inteiro nem histórico. A
   * tela escolhe por toque e envia o id; nada é escolhido sozinho. */
  async searchConsumers(userId: string, tenantId: string, q: string): Promise<{ consumers: SaleConsumerOption[] }> {
    const manager = this.dataSource.manager;
    const a = await autorizarVendas(manager, userId, tenantId, canRegisterSales, SALES_NEW_SALE_FEATURES);
    const params: unknown[] = [a.tenantId, termoDeBusca(q)];
    const condicoes = [`name ILIKE $2`];
    if (/^\d{4}$/.test(q)) {
      params.push(q);
      condicoes.push(`right(whatsapp_normalized, 4) = $3`);
    }
    const linhas = linhasDe<{ id: string; name: string; last4: string | null }>(
      await manager.query(
        `SELECT id, name, right(whatsapp_normalized, 4) AS last4 FROM consumers
          WHERE tenant_id = $1 AND merged_into_consumer_id IS NULL AND (${condicoes.join(' OR ')})
          ORDER BY lower(name), id
          LIMIT ${LIMITE_DA_BUSCA_DE_CLIENTES}`,
        params,
      ),
    );
    return {
      consumers: linhas.map((l) => ({ id: l.id, name: l.name, phoneLast4: l.last4 && /^\d{4}$/.test(l.last4) ? l.last4 : null })),
    };
  }

  async create(userId: string, tenantId: string, dto: CreateSaleDto, now = new Date()): Promise<{ created: boolean; sale: SaleView }> {
    const manager = this.dataSource.manager;
    const a = await autorizarVendas(manager, userId, tenantId, canRegisterSales, SALES_NEW_SALE_FEATURES);
    const impressao = impressaoDaVenda(dto);
    const repetida = await this.repeticao(manager, a.tenantId, userId, dto.requestKey, impressao);
    if (repetida) return { created: false, sale: repetida };
    try {
      const id = await this.dataSource.transaction(async (tx) => {
        const aa = await autorizarVendas(tx, userId, tenantId, canRegisterSales, SALES_NEW_SALE_FEATURES);
        return this.gravarVenda(tx, aa, userId, dto, impressao, now);
      });
      return { created: true, sale: await vendaPorId(manager, a.tenantId, id) };
    } catch (error) {
      if (isUniqueViolation(error, 'uq_sales_request_key')) {
        const outra = await this.repeticao(manager, a.tenantId, userId, dto.requestKey, impressao);
        if (outra) return { created: false, sale: outra };
        throw CHAVE_EM_USO();
      }
      const principal = principalDoErroDeUnificado(error);
      if (principal !== undefined) throw clienteUnificado(principal);
      throw error;
    }
  }

  private async gravarVenda(
    tx: EntityManager,
    a: AuthorizedTenant,
    userId: string,
    dto: CreateSaleDto,
    impressao: string,
    now: Date,
  ): Promise<string> {
    const t = a.tenantId;
    const veSaldo = canViewStock(a.role, ov(a));
    if (dto.consumerId) await travarCliente(tx, t, dto.consumerId);

    // Produtos travados por ordem de id: duas vendas com os mesmos produtos
    // fazem fila sem impasse, e a segunda vê o saldo que a primeira deixou.
    const produtos = new Map<string, ProdutoTravado>();
    for (const productId of dto.items.map((i) => i.productId).sort()) {
      const [existe] = await tx.query<unknown[]>(`SELECT 1 FROM stock_products WHERE tenant_id = $1 AND id = $2`, [t, productId]);
      if (!existe) throw new NotFoundException({ code: 'PRODUTO_NAO_ENCONTRADO', message: 'Produto não encontrado.', productId });
      produtos.set(productId, await travarProduto(tx, t, productId));
    }
    const de = (productId: string) => produtos.get(productId)!;
    const recusar = (filtro: (i: CreateSaleDto['items'][number], p: ProdutoTravado) => boolean) =>
      dto.items.filter((i) => filtro(i, de(i.productId)));

    const arquivados = recusar((_, p) => p.archived);
    if (arquivados.length) {
      throw conflito('PRODUTO_ARQUIVADO', 'Um produto da venda foi arquivado. Tire-o da venda.', { products: arquivados.map((i) => ({ productId: i.productId })) });
    }
    const foraDeVenda = recusar((_, p) => p.purpose !== 'VENDA' && p.purpose !== 'AMBOS');
    if (foraDeVenda.length) {
      throw conflito('FINALIDADE_INCOMPATIVEL', 'Um produto da venda não é mais de venda. Tire-o da venda.', {
        products: foraDeVenda.map((i) => ({ productId: i.productId })),
      });
    }
    const unidade = recusar((i, p) => p.unit !== i.expectedUnit);
    if (unidade.length) {
      throw conflito('UNIDADE_ALTERADA', 'A unidade de um produto mudou em outra tela. Recarregue antes de confirmar.', {
        products: unidade.map((i) => ({ productId: i.productId, unit: de(i.productId).unit })),
      });
    }
    const precoMudou = recusar((i, p) => p.salePriceCents !== i.expectedSuggestedPriceCents);
    if (precoMudou.length) {
      throw conflito('PRECO_ALTERADO', 'O preço sugerido de um produto mudou. Confira os preços antes de confirmar.', {
        products: precoMudou.map((i) => ({ productId: i.productId, salePriceCents: de(i.productId).salePriceCents })),
      });
    }
    const precoDiferente = recusar((i, p) => p.salePriceCents === null || i.unitPriceCents !== p.salePriceCents);
    if (precoDiferente.length && !canOverrideSalePrice(a.role, ov(a))) {
      throw new ForbiddenException({
        code: 'PRECO_NAO_AUTORIZADO',
        message: 'Você não tem permissão para vender com preço diferente do sugerido ou sem preço sugerido.',
        products: precoDiferente.map((i) => ({ productId: i.productId })),
      });
    }
    const semSaldo = recusar((i, p) => p.balanceMilli < i.quantityMilli);
    if (semSaldo.length) {
      throw conflito(
        'SALDO_INSUFICIENTE',
        semSaldo.length === 1
          ? `Saldo insuficiente de "${de(semSaldo[0].productId).name}".`
          : `Saldo insuficiente de ${semSaldo.length} produtos da venda.`,
        {
          products: semSaldo.map((i) => {
            const p = de(i.productId);
            return { productId: p.id, name: p.name, ...(veSaldo ? { balanceMilli: p.balanceMilli } : {}) };
          }),
        },
      );
    }

    const linhas = dto.items.map((i) => ({ ...i, lineTotalCents: totalDaLinha(i.unitPriceCents, i.quantityMilli) }));
    const total = linhas.reduce((s, l) => s + l.lineTotalCents, 0);
    const saleId = generateId();
    await tx.query(
      `INSERT INTO sales (id, tenant_id, consumer_id, total_cents, recorded_by_user_id, recorded_at, request_key, request_fingerprint)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [saleId, t, dto.consumerId, total, userId, now, dto.requestKey, impressao],
    );
    const baixas: string[] = [];
    for (const l of linhas) {
      baixas.push(
        await registrarMovimentacao(tx, {
          tenantId: t,
          produto: de(l.productId),
          kind: 'SAIDA_VENDA',
          deltaMilli: -l.quantityMilli,
          reason: null,
          userId,
          now,
          saleId,
        }),
      );
    }
    for (const [indice, l] of linhas.entries()) {
      const p = de(l.productId);
      await tx.query(
        `INSERT INTO sale_items (id, tenant_id, sale_id, position, product_id, stock_movement_id, product_name, unit,
            quantity_milli, unit_price_cents, suggested_price_cents, line_total_cents)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [generateId(), t, saleId, indice + 1, p.id, baixas[indice], p.name, p.unit, l.quantityMilli, l.unitPriceCents, p.salePriceCents, l.lineTotalCents],
      );
    }
    await recordAudit(
      tx,
      {
        action: 'SALE_RECORDED',
        actor: await loadActor(tx, userId),
        tenantId: t,
        summary: `Venda de ${(total / 100).toFixed(2)} registrada (${linhas.length} ${linhas.length === 1 ? 'item' : 'itens'}).`,
        newData: {
          saleId,
          consumerId: dto.consumerId,
          totalCents: total,
          items: linhas.map((l) => ({
            productId: l.productId,
            quantityMilli: l.quantityMilli,
            unitPriceCents: l.unitPriceCents,
            suggestedPriceCents: de(l.productId).salePriceCents,
            lineTotalCents: l.lineTotalCents,
          })),
        },
      },
      now,
    );
    return saleId;
  }

  /** Venda já gravada com esta chave por esta pessoa: a mesma venda devolve
   * a original; outra venda, 409. A chave é única por pessoa em qualquer
   * estabelecimento: a usada noutro não devolve aquela venda daqui. */
  private async repeticao(manager: EntityManager, tenantId: string, userId: string, chave: string, impressao: string): Promise<SaleView | null> {
    const [l] = linhasDe<{ id: string; tenant_id: string; request_fingerprint: string }>(
      await manager.query(`SELECT id, tenant_id, request_fingerprint FROM sales WHERE recorded_by_user_id = $1 AND request_key = $2`, [userId, chave]),
    );
    if (!l) return null;
    if (l.tenant_id !== tenantId) throw CHAVE_EM_USO();
    if (l.request_fingerprint !== impressao) throw CHAVE_REUTILIZADA();
    return vendaPorId(manager, tenantId, l.id);
  }

  /** Vendas do período: as próprias (`mine`) ou todas (`all`, consulta
   * geral). O resumo segue o mesmo escopo e o período inteiro. */
  async list(userId: string, tenantId: string, query: SaleListQueryDto, now = new Date()) {
    const manager = this.dataSource.manager;
    const a = await autorizarVendas(
      manager,
      userId,
      tenantId,
      query.scope === 'all' ? canViewAllSales : canAccessSalesHistory,
      SALES_MAINTENANCE_FEATURES,
    );
    const timezone = await fusoDoEstabelecimento(manager, a.tenantId);
    const periodo = periodoDaConsulta(query, timezone, now);
    const params: unknown[] = [a.tenantId, periodo.from, periodo.to, timezone];
    const parametro = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };
    const escopo = ['s.tenant_id = $1', `(s.recorded_at AT TIME ZONE $4::text)::date BETWEEN $2::date AND $3::date`];
    if (query.scope === 'mine') escopo.push(`s.recorded_by_user_id = ${parametro(userId)}`);
    const filtros = [...escopo];
    if (query.status) filtros.push(`s.status = ${parametro(query.status)}`);
    const cursor = decodificarCursor(query.cursor, 2);
    if (cursor) filtros.push(`(s.recorded_at, s.id) < (${parametro(cursor[0])}::timestamptz, ${parametro(cursor[1])})`);
    const linhas = linhasDe<ResumoRow>(
      await manager.query(
        `${SELECT_RESUMO} WHERE ${filtros.join(' AND ')} ORDER BY s.recorded_at DESC, s.id DESC LIMIT ${LIMITE_DA_PAGINA + 1}`,
        params,
      ),
    );
    const [resumo] = linhasDe<{ ativas: number; vendido: string; canceladas: number }>(
      await manager.query(
        `SELECT count(*) FILTER (WHERE s.status = 'ATIVA')::int AS ativas,
                COALESCE(sum(s.total_cents) FILTER (WHERE s.status = 'ATIVA'), 0)::text AS vendido,
                count(*) FILTER (WHERE s.status = 'CANCELADA')::int AS canceladas
           FROM sales s WHERE ${escopo.join(' AND ')}`,
        params.slice(0, query.scope === 'mine' ? 5 : 4),
      ),
    );
    const pagina = linhas.slice(0, LIMITE_DA_PAGINA);
    const ultimo = pagina.at(-1);
    return {
      scope: query.scope,
      timezone,
      period: periodo,
      /** Valor vendido não é dinheiro recebido: o recebido está em
       * `GET sales/payments`. */
      summary: { activeSales: resumo.ativas, soldCents: numero(resumo.vendido), cancelledSales: resumo.canceladas },
      sales: pagina.map(toSummaryView),
      nextCursor: linhas.length > LIMITE_DA_PAGINA && ultimo ? codificarCursor([iso(ultimo.recorded_at)!, ultimo.id]) : null,
    };
  }

  /** Detalhe: a própria venda (com `VENDAS_REGISTRAR`) ou qualquer uma com a
   * consulta geral. Venda que a pessoa não pode ver responde 404. */
  async get(userId: string, tenantId: string, saleId: string): Promise<SaleView> {
    const manager = this.dataSource.manager;
    const a = await autorizarVendas(manager, userId, tenantId, canAccessSalesHistory, SALES_MAINTENANCE_FEATURES);
    const venda = await vendaPorId(manager, a.tenantId, saleId);
    const propria = venda.recordedBy.id === userId && canRegisterSales(a.role, ov(a));
    if (!propria && !canViewAllSales(a.role, ov(a))) throw VENDA_NAO_ENCONTRADA();
    return venda;
  }

  async cancel(
    userId: string,
    sessionId: string,
    tenantId: string,
    saleId: string,
    dto: CancelSaleDto,
    now = new Date(),
  ): Promise<{ created: boolean; sale: SaleView }> {
    try {
      const r = await this.dataSource.transaction(async (tx) => {
        await requireRecentReauth(tx, sessionId, now);
        const a = await autorizarVendas(tx, userId, tenantId, canCancelSales, SALES_MAINTENANCE_FEATURES);
        const t = a.tenantId;
        const [venda] = linhasDe<{ status: string; cancel_reason: string | null; total_cents: string }>(
          await tx.query(`SELECT status, cancel_reason, total_cents::text AS total_cents FROM sales WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [
            t,
            saleId,
          ]),
        );
        if (!venda) throw VENDA_NAO_ENCONTRADA();
        if (venda.status === 'CANCELADA') {
          if (mesmoMotivo(venda.cancel_reason, dto.reason)) return { t, created: false };
          throw conflito('JA_CANCELADA', 'Esta venda já foi cancelada.');
        }
        const [ativo] = await tx.query<unknown[]>(
          `SELECT 1 FROM sale_payments WHERE tenant_id = $1 AND sale_id = $2 AND refunded_at IS NULL`,
          [t, saleId],
        );
        if (ativo) throw recebimentoAtivo();
        await tx.query(
          `UPDATE sales SET status = 'CANCELADA', cancelled_at = $3, cancelled_by_user_id = $4, cancel_reason = $5
            WHERE tenant_id = $1 AND id = $2`,
          [t, saleId, now, userId, dto.reason],
        );
        const baixas = linhasDe<{ id: string; product_id: string; quantity_milli: string }>(
          await tx.query(
            `SELECT id, product_id, quantity_milli::text AS quantity_milli FROM stock_movements
              WHERE tenant_id = $1 AND sale_id = $2 AND kind = 'SAIDA_VENDA' ORDER BY product_id, id`,
            [t, saleId],
          ),
        );
        for (const b of baixas) {
          await registrarMovimentacao(tx, {
            tenantId: t,
            produto: await travarProduto(tx, t, b.product_id),
            kind: 'ESTORNO',
            deltaMilli: numero(b.quantity_milli),
            reason: dto.reason,
            userId,
            now,
            reversesMovementId: b.id,
            saleId,
            devolucaoDeVenda: true,
          });
        }
        await recordAudit(
          tx,
          {
            action: 'SALE_CANCELLED',
            actor: await loadActor(tx, userId),
            tenantId: t,
            summary: `Venda de ${(numero(venda.total_cents) / 100).toFixed(2)} cancelada; ${baixas.length} ${baixas.length === 1 ? 'item devolvido' : 'itens devolvidos'} ao estoque.`,
            previousData: { saleId, status: 'ATIVA' },
            newData: { saleId, status: 'CANCELADA', reason: dto.reason, returnedMovements: baixas.map((b) => b.id) },
          },
          now,
        );
        return { t, created: true };
      });
      return { created: r.created, sale: await vendaPorId(this.dataSource.manager, r.t, saleId) };
    } catch (error) {
      if (restricaoDoErro(error) === SALE_ACTIVE_PAYMENT_CONSTRAINT) throw recebimentoAtivo();
      throw error;
    }
  }

  /** Compras na ficha do cliente: vendas deste cadastro, com consulta geral de
   * vendas E de clientes. Sem recurso: as compras continuam visíveis depois
   * que VENDAS sai. Uma `SAIDA_VENDA` manual antiga não é compra. */
  async purchases(userId: string, tenantId: string, consumerId: string, query: PurchaseListQueryDto) {
    const manager = this.dataSource.manager;
    const a = await autorizarVendas(
      manager,
      userId,
      tenantId,
      (role, overrides) => canViewAllSales(role, overrides) && canViewConsumers(role, overrides),
      SALES_MAINTENANCE_FEATURES,
    );
    const [cliente] = linhasDe<{ merged_into_consumer_id: string | null }>(
      await manager.query(`SELECT merged_into_consumer_id FROM consumers WHERE tenant_id = $1 AND id = $2`, [a.tenantId, consumerId]),
    );
    if (!cliente) throw new NotFoundException('Cliente não encontrado.');
    if (cliente.merged_into_consumer_id) throw clienteUnificado(cliente.merged_into_consumer_id);
    const params: unknown[] = [a.tenantId, consumerId];
    const filtros = ['s.tenant_id = $1', 's.consumer_id = $2'];
    const cursor = decodificarCursor(query.cursor, 2);
    if (cursor) {
      params.push(cursor[0], cursor[1]);
      filtros.push(`(s.recorded_at, s.id) < ($3::timestamptz, $4)`);
    }
    const linhas = linhasDe<ResumoRow>(
      await manager.query(`${SELECT_RESUMO} WHERE ${filtros.join(' AND ')} ORDER BY s.recorded_at DESC, s.id DESC LIMIT ${LIMITE_DA_PAGINA + 1}`, params),
    );
    const pagina = linhas.slice(0, LIMITE_DA_PAGINA);
    const ultimo = pagina.at(-1);
    return {
      purchases: pagina.map(toSummaryView) satisfies SaleSummaryView[],
      nextCursor: linhas.length > LIMITE_DA_PAGINA && ultimo ? codificarCursor([iso(ultimo.recorded_at)!, ultimo.id]) : null,
    };
  }
}

/** Cliente da venda: do estabelecimento e ativo, travado contra a unificação
 * (`FOR SHARE`). O gatilho `trg_sales_consumer_active` é a garantia final. */
async function travarCliente(tx: EntityManager, tenantId: string, consumerId: string): Promise<void> {
  const [c] = linhasDe<{ merged_into_consumer_id: string | null }>(
    await tx.query(`SELECT merged_into_consumer_id FROM consumers WHERE tenant_id = $1 AND id = $2 FOR SHARE`, [tenantId, consumerId]),
  );
  if (!c) throw new NotFoundException({ code: 'CLIENTE_NAO_ENCONTRADO', message: 'Cliente não encontrado.' });
  if (c.merged_into_consumer_id) throw clienteUnificado(c.merged_into_consumer_id);
}

export const recebimentoAtivo = () =>
  conflito('RECEBIMENTO_ATIVO', 'Esta venda tem um recebimento registrado. Estorne o recebimento antes de cancelar a venda.');

/** Nome da restrição de um erro do PostgreSQL (os gatilhos informam a deles). */
export function restricaoDoErro(error: unknown): string | undefined {
  const e = error as { constraint?: string; driverError?: { constraint?: string } };
  return e.driverError?.constraint ?? e.constraint;
}
