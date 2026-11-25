// Leitura das vendas e dos recebimentos de vendas: SQL e forma da resposta,
// iguais para "Minhas operações", consulta geral, detalhe e compras na ficha.
// Quem chama já autorizou e filtra por `tenant_id` (e pelo escopo).
import { NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { dataLocalDe } from '../availability/time-zone.js';
import { linhasDe } from '../common/linhas-de.js';
import { iso, numero } from '../stock/stock-common.js';
import type { StockUnit } from '../stock/stock-quantity.js';

export type SaleStatus = 'ATIVA' | 'CANCELADA';

export interface Pessoa {
  id: string;
  name: string;
}

export interface SaleItemView {
  position: number;
  productId: string;
  /** Nome, unidade e preços congelados na venda: mudar o cadastro depois não
   * muda a venda. */
  productName: string;
  unit: StockUnit;
  quantityMilli: number;
  unitPriceCents: number;
  /** Preço sugerido no momento da venda (`null` = não havia). */
  suggestedPriceCents: number | null;
  lineTotalCents: number;
}

export interface SalePaymentView {
  id: string;
  saleId: string;
  amountCents: number;
  method: string;
  receivedOn: string;
  recordedAt: string;
  recordedBy: Pessoa;
  notes: string | null;
  refund: { refundedOn: string; refundedAt: string; reason: string; refundedBy: Pessoa } | null;
}

export interface SaleView {
  id: string;
  status: SaleStatus;
  totalCents: number;
  recordedAt: string;
  localDate: string;
  recordedBy: Pessoa;
  consumer: Pessoa | null;
  items: SaleItemView[];
  payments: SalePaymentView[];
  /** Recebimento não estornado (no máximo um por venda). */
  activePaymentId: string | null;
  cancellation: { cancelledAt: string; reason: string; cancelledBy: Pessoa } | null;
}

/** Linha das listas: itens resumidos e o recebimento ativo (ou o último
 * estornado, quando não há ativo). */
export interface SaleSummaryView {
  id: string;
  status: SaleStatus;
  totalCents: number;
  recordedAt: string;
  localDate: string;
  recordedBy: Pessoa;
  consumer: Pessoa | null;
  items: { productName: string; quantityMilli: number; unit: StockUnit }[];
  payment: { id: string; amountCents: number; method: string; receivedOn: string; refunded: boolean } | null;
}

interface VendaRow {
  id: string;
  status: SaleStatus;
  total_cents: string;
  recorded_at: Date;
  recorded_by_user_id: string;
  recorded_by_name: string;
  consumer_id: string | null;
  consumer_name: string | null;
  cancelled_at: Date | null;
  cancelled_by_user_id: string | null;
  cancelled_by_name: string | null;
  cancel_reason: string | null;
  timezone: string;
}

const SELECT_VENDA = `SELECT s.id, s.status, s.total_cents::text AS total_cents, s.recorded_at, s.recorded_by_user_id,
    ru.name AS recorded_by_name, s.consumer_id, c.name AS consumer_name, s.cancelled_at, s.cancelled_by_user_id,
    cu.name AS cancelled_by_name, s.cancel_reason, t.timezone
  FROM sales s
  JOIN tenants t ON t.id = s.tenant_id
  JOIN users ru ON ru.id = s.recorded_by_user_id
  LEFT JOIN consumers c ON c.tenant_id = s.tenant_id AND c.id = s.consumer_id
  LEFT JOIN users cu ON cu.id = s.cancelled_by_user_id`;

/** Lista de vendas: o mesmo SELECT com os itens resumidos e o recebimento. */
export const SELECT_RESUMO = `SELECT s.id, s.status, s.total_cents::text AS total_cents, s.recorded_at, s.recorded_by_user_id,
    ru.name AS recorded_by_name, s.consumer_id, c.name AS consumer_name, t.timezone,
    (SELECT json_agg(json_build_object('productName', i.product_name, 'quantityMilli', i.quantity_milli, 'unit', i.unit)
                     ORDER BY i.position)
       FROM sale_items i WHERE i.tenant_id = s.tenant_id AND i.sale_id = s.id) AS items,
    pg.id AS payment_id, pg.amount_cents::text AS payment_amount_cents, pg.method AS payment_method,
    to_char(pg.received_on, 'YYYY-MM-DD') AS payment_received_on, pg.refunded_at IS NOT NULL AS payment_refunded
  FROM sales s
  JOIN tenants t ON t.id = s.tenant_id
  JOIN users ru ON ru.id = s.recorded_by_user_id
  LEFT JOIN consumers c ON c.tenant_id = s.tenant_id AND c.id = s.consumer_id
  LEFT JOIN LATERAL (
    SELECT sp.id, sp.amount_cents, sp.method, sp.received_on, sp.refunded_at FROM sale_payments sp
     WHERE sp.tenant_id = s.tenant_id AND sp.sale_id = s.id
     ORDER BY (sp.refunded_at IS NULL) DESC, sp.recorded_at DESC, sp.id DESC LIMIT 1
  ) pg ON true`;

export interface ResumoRow {
  id: string;
  status: SaleStatus;
  total_cents: string;
  recorded_at: Date;
  recorded_by_user_id: string;
  recorded_by_name: string;
  consumer_id: string | null;
  consumer_name: string | null;
  timezone: string;
  items: { productName: string; quantityMilli: number | string; unit: StockUnit }[] | null;
  payment_id: string | null;
  payment_amount_cents: string | null;
  payment_method: string | null;
  payment_received_on: string | null;
  payment_refunded: boolean | null;
}

export function toSummaryView(l: ResumoRow): SaleSummaryView {
  return {
    id: l.id,
    status: l.status,
    totalCents: numero(l.total_cents),
    recordedAt: iso(l.recorded_at)!,
    localDate: dataLocalDe(new Date(l.recorded_at), l.timezone),
    recordedBy: { id: l.recorded_by_user_id, name: l.recorded_by_name },
    consumer: l.consumer_id ? { id: l.consumer_id, name: l.consumer_name ?? '' } : null,
    items: (l.items ?? []).map((i) => ({ productName: i.productName, quantityMilli: Number(i.quantityMilli), unit: i.unit })),
    payment: l.payment_id
      ? {
          id: l.payment_id,
          amountCents: numero(l.payment_amount_cents),
          method: l.payment_method ?? '',
          receivedOn: l.payment_received_on ?? '',
          refunded: l.payment_refunded === true,
        }
      : null,
  };
}

interface PagamentoRow {
  id: string;
  sale_id: string;
  amount_cents: string;
  method: string;
  received_on: string;
  recorded_at: Date;
  recorded_by_user_id: string;
  recorded_by_name: string;
  notes: string | null;
  refunded_at: Date | null;
  refunded_on: string | null;
  refund_reason: string | null;
  refunded_by_user_id: string | null;
  refunded_by_name: string | null;
}

export const SELECT_PAGAMENTO = `SELECT sp.id, sp.sale_id, sp.amount_cents::text AS amount_cents, sp.method,
    to_char(sp.received_on, 'YYYY-MM-DD') AS received_on, sp.recorded_at, sp.recorded_by_user_id, ru.name AS recorded_by_name,
    sp.notes, sp.refunded_at, to_char(sp.refunded_on, 'YYYY-MM-DD') AS refunded_on, sp.refund_reason,
    sp.refunded_by_user_id, fu.name AS refunded_by_name
  FROM sale_payments sp
  JOIN users ru ON ru.id = sp.recorded_by_user_id
  LEFT JOIN users fu ON fu.id = sp.refunded_by_user_id`;

export function toPaymentView(l: PagamentoRow): SalePaymentView {
  return {
    id: l.id,
    saleId: l.sale_id,
    amountCents: numero(l.amount_cents),
    method: l.method,
    receivedOn: l.received_on,
    recordedAt: iso(l.recorded_at)!,
    recordedBy: { id: l.recorded_by_user_id, name: l.recorded_by_name },
    notes: l.notes,
    refund:
      l.refunded_at && l.refunded_on && l.refund_reason && l.refunded_by_user_id
        ? {
            refundedOn: l.refunded_on,
            refundedAt: iso(l.refunded_at)!,
            reason: l.refund_reason,
            refundedBy: { id: l.refunded_by_user_id, name: l.refunded_by_name ?? '' },
          }
        : null,
  };
}

export const VENDA_NAO_ENCONTRADA = () => new NotFoundException('Venda não encontrada.');

/** Venda completa (itens e recebimentos) do estabelecimento, ou 404. */
export async function vendaPorId(manager: EntityManager, tenantId: string, saleId: string): Promise<SaleView> {
  const [v] = linhasDe<VendaRow>(await manager.query(`${SELECT_VENDA} WHERE s.tenant_id = $1 AND s.id = $2`, [tenantId, saleId]));
  if (!v) throw VENDA_NAO_ENCONTRADA();
  const itens = linhasDe<{
    position: number;
    product_id: string;
    product_name: string;
    unit: StockUnit;
    quantity_milli: string;
    unit_price_cents: string;
    suggested_price_cents: string | null;
    line_total_cents: string;
  }>(
    await manager.query(
      `SELECT position, product_id, product_name, unit, quantity_milli::text AS quantity_milli,
              unit_price_cents::text AS unit_price_cents, suggested_price_cents::text AS suggested_price_cents,
              line_total_cents::text AS line_total_cents
         FROM sale_items WHERE tenant_id = $1 AND sale_id = $2 ORDER BY position`,
      [tenantId, saleId],
    ),
  );
  const pagamentos = linhasDe<PagamentoRow>(
    await manager.query(`${SELECT_PAGAMENTO} WHERE sp.tenant_id = $1 AND sp.sale_id = $2 ORDER BY sp.recorded_at, sp.id`, [tenantId, saleId]),
  ).map(toPaymentView);
  return {
    id: v.id,
    status: v.status,
    totalCents: numero(v.total_cents),
    recordedAt: iso(v.recorded_at)!,
    localDate: dataLocalDe(new Date(v.recorded_at), v.timezone),
    recordedBy: { id: v.recorded_by_user_id, name: v.recorded_by_name },
    consumer: v.consumer_id ? { id: v.consumer_id, name: v.consumer_name ?? '' } : null,
    items: itens.map((i) => ({
      position: Number(i.position),
      productId: i.product_id,
      productName: i.product_name,
      unit: i.unit,
      quantityMilli: numero(i.quantity_milli),
      unitPriceCents: numero(i.unit_price_cents),
      suggestedPriceCents: i.suggested_price_cents === null ? null : numero(i.suggested_price_cents),
      lineTotalCents: numero(i.line_total_cents),
    })),
    payments: pagamentos,
    activePaymentId: pagamentos.find((p) => p.refund === null)?.id ?? null,
    cancellation:
      v.status === 'CANCELADA' && v.cancelled_at && v.cancel_reason && v.cancelled_by_user_id
        ? {
            cancelledAt: iso(v.cancelled_at)!,
            reason: v.cancel_reason,
            cancelledBy: { id: v.cancelled_by_user_id, name: v.cancelled_by_name ?? '' },
          }
        : null,
  };
}

export async function pagamentoPorId(manager: EntityManager, tenantId: string, paymentId: string): Promise<SalePaymentView> {
  const [l] = linhasDe<PagamentoRow>(await manager.query(`${SELECT_PAGAMENTO} WHERE sp.tenant_id = $1 AND sp.id = $2`, [tenantId, paymentId]));
  if (!l) throw new NotFoundException('Recebimento não encontrado.');
  return toPaymentView(l);
}

export async function fusoDoEstabelecimento(manager: EntityManager, tenantId: string): Promise<string> {
  const [t] = linhasDe<{ timezone: string }>(await manager.query('SELECT timezone FROM tenants WHERE id = $1', [tenantId]));
  return t.timezone;
}
