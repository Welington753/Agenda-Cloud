// Recebimentos de vendas (docs/plans/vendas-v1.md, seção 5.5): registro
// manual integral e estorno, separados da venda. Não exigem PAGAMENTOS e não
// entram no Início nem nas comissões, que leem só `appointment_payments`.
//
// REGISTRAR: no valor total da venda (calculado aqui, nunca vindo da tela),
// com uma das seis formas, a data local do recebimento e quem registrou. A
// venda é travada antes (`FOR UPDATE`, a mesma trava do cancelamento): receber
// e cancelar ao mesmo tempo nunca deixam venda cancelada com recebimento
// ativo. `uq_sale_payments_active` e o gatilho `sale_payments_guard` são a
// garantia final. Quem recebe: a própria venda com `VENDAS_RECEBER`; a de
// outra pessoa, também com `VENDAS_VISUALIZAR`.
//
// REENVIO: a mesma `requestKey` com a mesma venda, forma, data e observação
// devolve o recebimento original; com outros dados, 409 `CHAVE_REUTILIZADA`.
//
// ESTORNAR (integral, motivo, senha confirmada há pouco, `VENDAS_ESTORNAR_
// RECEBIMENTO`): venda e recebimento travados, estorno na mesma linha com a
// data local de hoje. Repetir com o mesmo motivo devolve o estorno gravado,
// sem novo lançamento; com outro motivo, 409 `JA_ESTORNADO`.
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { loadActor } from '../accounts/actor.js';
import { recordAudit } from '../accounts/audit.js';
import { requireRecentReauth } from '../accounts/reauth.js';
import { isUniqueViolation } from '../auth/unique-violation.js';
import { dataLocalDe } from '../availability/time-zone.js';
import { linhasDe } from '../common/linhas-de.js';
import { generateId } from '../entities/common/generate-id.js';
import { SALE_PAYMENT_CONSTRAINT } from '../migrations/1794614400000-SalesModule.js';
import { CHAVE_EM_USO, CHAVE_REUTILIZADA, conflito, numero } from '../stock/stock-common.js';
import {
  SALES_MAINTENANCE_FEATURES,
  canAccessSalesHistory,
  canReceiveSale,
  canReceiveSales,
  canRefundSalePayments,
  canViewAllSales,
} from './sales-access.js';
import { autorizarVendas, periodoDaConsulta, restricaoDoErro } from './sales.service.js';
import { mesmoMotivo, mesmoRecebimento } from './sale-request-fingerprint.js';
import type { RecordSalePaymentDto, RefundSalePaymentDto, SalePaymentListQueryDto } from './sales.dto.js';
import {
  SELECT_PAGAMENTO,
  VENDA_NAO_ENCONTRADA,
  fusoDoEstabelecimento,
  pagamentoPorId,
  toPaymentView,
  type SalePaymentView,
} from './sales-views.js';

/** Teto da lista de recebimentos (o resumo é do período inteiro). */
export const LIMITE_DA_LISTA_DE_RECEBIMENTOS = 200;

const jaRecebida = () => conflito('JA_RECEBIDA', 'Esta venda já tem um recebimento registrado.');

@Injectable()
export class SalePaymentsService {
  constructor(private readonly dataSource: DataSource) {}

  async record(
    userId: string,
    tenantId: string,
    saleId: string,
    dto: RecordSalePaymentDto,
    now = new Date(),
  ): Promise<{ created: boolean; payment: SalePaymentView }> {
    const manager = this.dataSource.manager;
    const a = await autorizarVendas(manager, userId, tenantId, canReceiveSales, SALES_MAINTENANCE_FEATURES);
    const pedido = { saleId, method: dto.method, receivedOn: dto.receivedOn, notes: dto.notes };
    const repetido = await this.repeticao(manager, a.tenantId, userId, dto.requestKey, pedido);
    if (repetido) return { created: false, payment: repetido };
    try {
      const id = await this.dataSource.transaction(async (tx) => {
        const aa = await autorizarVendas(tx, userId, tenantId, canReceiveSales, SALES_MAINTENANCE_FEATURES);
        const t = aa.tenantId;
        const [venda] = linhasDe<{ status: string; total_cents: string; recorded_by_user_id: string; recorded_at: Date; timezone: string }>(
          await tx.query(
            `SELECT s.status, s.total_cents::text AS total_cents, s.recorded_by_user_id, s.recorded_at, t.timezone
               FROM sales s JOIN tenants t ON t.id = s.tenant_id
              WHERE s.tenant_id = $1 AND s.id = $2 FOR UPDATE OF s`,
            [t, saleId],
          ),
        );
        if (!venda) throw VENDA_NAO_ENCONTRADA();
        if (!canReceiveSale(aa.role, aa.overrides ?? [], { ownSale: venda.recorded_by_user_id === userId })) {
          throw new ForbiddenException({
            code: 'VENDA_DE_OUTRA_PESSOA',
            message: 'Você só pode receber as vendas que registrou.',
          });
        }
        if (venda.status !== 'ATIVA') throw conflito('VENDA_CANCELADA', 'Venda cancelada não recebe pagamento.');
        const [ativo] = await tx.query<unknown[]>(
          `SELECT 1 FROM sale_payments WHERE tenant_id = $1 AND sale_id = $2 AND refunded_at IS NULL`,
          [t, saleId],
        );
        if (ativo) throw jaRecebida();
        const hoje = dataLocalDe(now, venda.timezone);
        if (dto.receivedOn > hoje) throw conflito('DATA_NO_FUTURO', 'A data do recebimento não pode ser depois de hoje.');
        if (dto.receivedOn < dataLocalDe(new Date(venda.recorded_at), venda.timezone)) {
          throw conflito('DATA_ANTES_DA_VENDA', 'A data do recebimento não pode ser anterior à venda.');
        }
        const novo = generateId();
        const valor = numero(venda.total_cents);
        await tx.query(
          `INSERT INTO sale_payments (id, tenant_id, sale_id, amount_cents, method, received_on, recorded_at, recorded_by_user_id,
              request_key, notes)
           VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8, $9, $10)`,
          [novo, t, saleId, valor, dto.method, dto.receivedOn, now, userId, dto.requestKey, dto.notes],
        );
        await recordAudit(
          tx,
          {
            action: 'SALE_PAYMENT_RECORDED',
            actor: await loadActor(tx, userId),
            tenantId: t,
            summary: `Recebimento de ${(valor / 100).toFixed(2)} registrado para uma venda.`,
            newData: { paymentId: novo, saleId, amountCents: valor, method: dto.method, receivedOn: dto.receivedOn },
          },
          now,
        );
        return novo;
      });
      return { created: true, payment: await pagamentoPorId(manager, a.tenantId, id) };
    } catch (error) {
      if (isUniqueViolation(error, 'uq_sale_payments_active')) throw jaRecebida();
      if (isUniqueViolation(error, 'uq_sale_payments_request_key')) {
        const outro = await this.repeticao(manager, a.tenantId, userId, dto.requestKey, pedido);
        if (outro) return { created: false, payment: outro };
        throw CHAVE_EM_USO();
      }
      if (restricaoDoErro(error) === SALE_PAYMENT_CONSTRAINT) throw conflito('VENDA_CANCELADA', 'Venda cancelada não recebe pagamento.');
      throw error;
    }
  }

  private async repeticao(
    manager: EntityManager,
    tenantId: string,
    userId: string,
    chave: string,
    pedido: { saleId: string; method: string; receivedOn: string; notes: string | null },
  ): Promise<SalePaymentView | null> {
    const [l] = linhasDe<{ id: string; tenant_id: string; sale_id: string; method: string; received_on: string; notes: string | null }>(
      await manager.query(
        `SELECT id, tenant_id, sale_id, method, to_char(received_on, 'YYYY-MM-DD') AS received_on, notes
           FROM sale_payments WHERE recorded_by_user_id = $1 AND request_key = $2`,
        [userId, chave],
      ),
    );
    if (!l) return null;
    if (l.tenant_id !== tenantId) throw CHAVE_EM_USO();
    if (!mesmoRecebimento({ saleId: l.sale_id, method: l.method, receivedOn: l.received_on, notes: l.notes }, pedido)) throw CHAVE_REUTILIZADA();
    return pagamentoPorId(manager, tenantId, l.id);
  }

  async refund(
    userId: string,
    sessionId: string,
    tenantId: string,
    paymentId: string,
    dto: RefundSalePaymentDto,
    now = new Date(),
  ): Promise<{ created: boolean; payment: SalePaymentView }> {
    const r = await this.dataSource.transaction(async (tx) => {
      await requireRecentReauth(tx, sessionId, now);
      const a = await autorizarVendas(tx, userId, tenantId, canRefundSalePayments, SALES_MAINTENANCE_FEATURES);
      const t = a.tenantId;
      // A venda antes do recebimento, a mesma ordem do registro e do
      // cancelamento.
      await tx.query(
        `SELECT s.id FROM sales s JOIN sale_payments sp ON sp.tenant_id = s.tenant_id AND sp.sale_id = s.id
          WHERE sp.tenant_id = $1 AND sp.id = $2 FOR UPDATE OF s`,
        [t, paymentId],
      );
      const [linha] = linhasDe<{ refunded_at: Date | null; refund_reason: string | null; amount_cents: string; received_on: string; sale_id: string; timezone: string }>(
        await tx.query(
          `SELECT sp.refunded_at, sp.refund_reason, sp.amount_cents::text AS amount_cents,
                  to_char(sp.received_on, 'YYYY-MM-DD') AS received_on, sp.sale_id, t.timezone
             FROM sale_payments sp JOIN tenants t ON t.id = sp.tenant_id
            WHERE sp.tenant_id = $1 AND sp.id = $2 FOR UPDATE OF sp`,
          [t, paymentId],
        ),
      );
      if (!linha) throw new NotFoundException('Recebimento não encontrado.');
      if (linha.refunded_at) {
        if (mesmoMotivo(linha.refund_reason, dto.reason)) return { t, created: false };
        throw conflito('JA_ESTORNADO', 'Este recebimento já foi estornado.');
      }
      const hoje = dataLocalDe(now, linha.timezone);
      await tx.query(
        `UPDATE sale_payments SET refunded_at = $3, refunded_on = $4::date, refund_reason = $5, refunded_by_user_id = $6
          WHERE tenant_id = $1 AND id = $2`,
        [t, paymentId, now, hoje < linha.received_on ? linha.received_on : hoje, dto.reason, userId],
      );
      await recordAudit(
        tx,
        {
          action: 'SALE_PAYMENT_REFUNDED',
          actor: await loadActor(tx, userId),
          tenantId: t,
          summary: `Recebimento de venda de ${(numero(linha.amount_cents) / 100).toFixed(2)} estornado.`,
          newData: { paymentId, saleId: linha.sale_id, reason: dto.reason },
        },
        now,
      );
      return { t, created: true };
    });
    return { created: r.created, payment: await pagamentoPorId(this.dataSource.manager, r.t, paymentId) };
  }

  /** Recebimentos de vendas do período (pela data do recebimento ou do
   * estorno): os que a pessoa registrou (`mine`) ou todos (`all`). Resumo no
   * mesmo escopo: recebido (data do recebimento), estornado (data do
   * estorno) e líquido. Só de vendas: os de atendimentos ficam em
   * Recebimentos, sob PAGAMENTOS. */
  async list(userId: string, tenantId: string, query: SalePaymentListQueryDto, now = new Date()) {
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
    const params: unknown[] = [a.tenantId, periodo.from, periodo.to];
    const escopo = ['sp.tenant_id = $1'];
    if (query.scope === 'mine') {
      params.push(userId);
      escopo.push('sp.recorded_by_user_id = $4');
    }
    const linhas = linhasDe<Parameters<typeof toPaymentView>[0]>(
      await manager.query(
        `${SELECT_PAGAMENTO}
          WHERE ${escopo.join(' AND ')} AND (sp.received_on BETWEEN $2::date AND $3::date OR sp.refunded_on BETWEEN $2::date AND $3::date)
          ORDER BY sp.received_on DESC, sp.recorded_at DESC, sp.id
          LIMIT ${LIMITE_DA_LISTA_DE_RECEBIMENTOS + 1}`,
        params,
      ),
    );
    const [resumo] = linhasDe<{ recebido: string; estornado: string }>(
      await manager.query(
        `SELECT COALESCE(sum(sp.amount_cents) FILTER (WHERE sp.received_on BETWEEN $2::date AND $3::date), 0)::text AS recebido,
                COALESCE(sum(sp.amount_cents) FILTER (WHERE sp.refunded_on BETWEEN $2::date AND $3::date), 0)::text AS estornado
           FROM sale_payments sp WHERE ${escopo.join(' AND ')}`,
        params,
      ),
    );
    const recebido = numero(resumo.recebido);
    const estornado = numero(resumo.estornado);
    return {
      scope: query.scope,
      timezone,
      period: periodo,
      summary: { receivedCents: recebido, refundedCents: estornado, netCents: recebido - estornado },
      payments: linhas.slice(0, LIMITE_DA_LISTA_DE_RECEBIMENTOS).map(toPaymentView),
      complete: linhas.length <= LIMITE_DA_LISTA_DE_RECEBIMENTOS,
    };
  }
}
