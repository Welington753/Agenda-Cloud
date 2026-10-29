// Recebimentos manuais dos atendimentos (dono). Fonte do dinheiro que
// aparece no Início: só o que foi registrado aqui é "recebido". Preço de
// reserva nunca vira recebimento sozinho, e concluir ou cancelar um
// atendimento não registra nem estorna nada.
//
// REGISTRAR (quitação integral): valor efetivamente pago, forma, data do
// recebimento e quem registrou, numa transação com o atendimento travado.
// Repetir o mesmo formulário devolve o mesmo registro (chave única por quem
// registrou); duas quitações simultâneas do mesmo atendimento esbarram no
// índice `uq_appointment_payments_active` e a segunda recebe 409.
//
// ESTORNAR (integral, com motivo, senha do dono confirmada há pouco): marca
// o registro como estornado na data local de hoje; o valor e a data do
// recebimento original não mudam. Depois do estorno, o atendimento pode ser
// quitado de novo (um novo registro).
//
// O valor é sempre o informado, em centavos inteiros: mudar o preço do
// serviço depois não altera nenhum recebimento.
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { loadActor } from '../accounts/actor.js';
import { recordAudit } from '../accounts/audit.js';
import { requireRecentReauth } from '../accounts/reauth.js';
import { isUniqueViolation } from '../auth/unique-violation.js';
import { dataLocalDe } from '../availability/time-zone.js';
import { resolveAuthorizedTenant } from '../common/tenant-authorization.js';
import { mesDaData } from '../dashboard/dashboard-period.js';
import { generateId } from '../entities/common/generate-id.js';
import { linhasDe } from '../common/linhas-de.js';
import {
  PAYMENTS_FORBIDDEN_MESSAGE,
  PAYMENT_RECORD_FORBIDDEN_MESSAGE,
  PAYMENT_REFUND_FORBIDDEN_MESSAGE,
  canRecordPayments,
  canRefundPayments,
  canViewPayments,
} from './payment-access.js';
import type { PaymentPeriodDto, RecordPaymentDto, RefundPaymentDto } from './payments.dto.js';
import { FeatureKey } from '../entities/enums/feature-key.enum.js';

const conflito = (code: string, message: string) => new ConflictException({ code, message });

/** Teto das listas da tela (o resumo é contado à parte, sobre o período todo). */
export const LIMITE_DA_LISTA = 200;

/** Situações em que dá para registrar a quitação. Aguardando confirmação e
 * cancelado não têm o que quitar; falta pode ter cobrança combinada. */
const SITUACOES_QUITAVEIS = ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'NO_SHOW'];

export interface PaymentView {
  id: string;
  appointmentId: string;
  amountCents: number;
  method: string;
  receivedOn: string;
  recordedAt: string;
  recordedBy: { id: string; name: string };
  notes: string | null;
  refund: { refundedOn: string; refundedAt: string; reason: string; refundedBy: { id: string; name: string } } | null;
  appointment: { localDate: string; localStart: string; status: string; consumerName: string; serviceName: string; professionalName: string };
}

interface PaymentRow {
  id: string;
  appointment_id: string;
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
  start_at: Date;
  status: string;
  consumer_name: string;
  service_name: string | null;
  professional_name: string | null;
}

const SELECT_PAGAMENTO = `
  SELECT pg.id, pg.appointment_id, pg.amount_cents::text AS amount_cents, pg.method,
         to_char(pg.received_on, 'YYYY-MM-DD') AS received_on, pg.recorded_at, pg.recorded_by_user_id,
         ru.name AS recorded_by_name, pg.notes, pg.refunded_at, to_char(pg.refunded_on, 'YYYY-MM-DD') AS refunded_on,
         pg.refund_reason, pg.refunded_by_user_id, fu.name AS refunded_by_name,
         a.start_at, a.status::text AS status, a.consumer_name_snapshot AS consumer_name,
         s.name AS service_name, p.name AS professional_name
    FROM appointment_payments pg
    JOIN appointments a ON a.tenant_id = pg.tenant_id AND a.id = pg.appointment_id
    JOIN users ru ON ru.id = pg.recorded_by_user_id
    LEFT JOIN users fu ON fu.id = pg.refunded_by_user_id
    LEFT JOIN professionals p ON p.tenant_id = a.tenant_id AND p.id = a.professional_id
    LEFT JOIN LATERAL (
      SELECT service_id FROM appointment_items WHERE tenant_id = a.tenant_id AND appointment_id = a.id ORDER BY position LIMIT 1
    ) i ON true
    LEFT JOIN services s ON s.tenant_id = a.tenant_id AND s.id = i.service_id`;

function toView(linha: PaymentRow, timezone: string): PaymentView {
  const inicio = new Date(linha.start_at);
  return {
    id: linha.id,
    appointmentId: linha.appointment_id,
    amountCents: Number(linha.amount_cents),
    method: linha.method,
    receivedOn: linha.received_on,
    recordedAt: new Date(linha.recorded_at).toISOString(),
    recordedBy: { id: linha.recorded_by_user_id, name: linha.recorded_by_name },
    notes: linha.notes,
    refund:
      linha.refunded_at && linha.refunded_on && linha.refund_reason && linha.refunded_by_user_id
        ? {
            refundedOn: linha.refunded_on,
            refundedAt: new Date(linha.refunded_at).toISOString(),
            reason: linha.refund_reason,
            refundedBy: { id: linha.refunded_by_user_id, name: linha.refunded_by_name ?? '' },
          }
        : null,
    appointment: {
      localDate: dataLocalDe(inicio, timezone),
      localStart: new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(inicio),
      status: linha.status,
      consumerName: linha.consumer_name,
      serviceName: linha.service_name ?? '',
      professionalName: linha.professional_name ?? '',
    },
  };
}

@Injectable()
export class PaymentsService {
  constructor(private readonly dataSource: DataSource) {}

  async record(userId: string, tenantId: string, dto: RecordPaymentDto, now = new Date()): Promise<{ created: boolean; payment: PaymentView }> {
    const autorizado = await resolveAuthorizedTenant(this.dataSource.manager, userId, tenantId, {
      permitido: canRecordPayments,
      mensagemProibido: PAYMENT_RECORD_FORBIDDEN_MESSAGE,
      recurso: FeatureKey.PAGAMENTOS,
    });
    const repetido = await this.porChave(this.dataSource.manager, autorizado.tenantId, userId, dto.requestKey);
    if (repetido) return { created: false, payment: repetido };
    try {
      const id = await this.dataSource.transaction(async (manager) => {
        const [atendimento] = linhasDe<{ status: string; start_at: Date; timezone: string }>(
          await manager.query(
            `SELECT a.status::text AS status, a.start_at, t.timezone FROM appointments a JOIN tenants t ON t.id = a.tenant_id
              WHERE a.tenant_id = $1 AND a.id = $2 FOR UPDATE OF a`,
            [autorizado.tenantId, dto.appointmentId],
          ),
        );
        if (!atendimento) throw new NotFoundException('Atendimento não encontrado.');
        if (!SITUACOES_QUITAVEIS.includes(atendimento.status)) {
          throw conflito(
            'ATENDIMENTO_NAO_QUITAVEL',
            atendimento.status === 'CANCELED'
              ? 'Atendimento cancelado não tem o que quitar.'
              : 'Confirme o atendimento antes de registrar o recebimento.',
          );
        }
        const hoje = dataLocalDe(now, atendimento.timezone);
        if (dto.receivedOn > hoje) throw conflito('DATA_NO_FUTURO', 'A data do recebimento não pode ser depois de hoje.');
        const [ativo] = await manager.query<unknown[]>(
          `SELECT 1 FROM appointment_payments WHERE tenant_id = $1 AND appointment_id = $2 AND refunded_at IS NULL`,
          [autorizado.tenantId, dto.appointmentId],
        );
        if (ativo) throw conflito('JA_QUITADO', 'Este atendimento já tem um recebimento registrado. Estorne-o antes de registrar outro.');
        const novo = generateId();
        await manager.query(
          `INSERT INTO appointment_payments (id, tenant_id, appointment_id, amount_cents, method, received_on, recorded_at,
              recorded_by_user_id, request_key, notes)
           VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8, $9, $10)`,
          [novo, autorizado.tenantId, dto.appointmentId, dto.amountCents, dto.method, dto.receivedOn, now, userId, dto.requestKey, dto.notes ?? null],
        );
        const actor = await loadActor(manager, userId);
        await recordAudit(
          manager,
          {
            action: 'PAYMENT_RECORDED',
            actor,
            tenantId: autorizado.tenantId,
            summary: `Recebimento de ${(dto.amountCents / 100).toFixed(2)} registrado para um atendimento.`,
            newData: { paymentId: novo, appointmentId: dto.appointmentId, amountCents: dto.amountCents, method: dto.method, receivedOn: dto.receivedOn },
          },
          now,
        );
        return novo;
      });
      return { created: true, payment: (await this.porId(this.dataSource.manager, autorizado.tenantId, id))! };
    } catch (error) {
      if (isUniqueViolation(error, 'uq_appointment_payments_active')) {
        throw conflito('JA_QUITADO', 'Este atendimento já tem um recebimento registrado. Estorne-o antes de registrar outro.');
      }
      if (isUniqueViolation(error, 'uq_appointment_payments_request_key')) {
        const outro = await this.porChave(this.dataSource.manager, autorizado.tenantId, userId, dto.requestKey);
        if (outro) return { created: false, payment: outro };
        // A chave é única por quem registrou, em qualquer estabelecimento: a
        // mesma chave usada noutro não devolve aquele registro daqui.
        throw conflito('CHAVE_EM_USO', 'Este formulário já foi usado. Atualize a página antes de registrar de novo.');
      }
      throw error;
    }
  }

  async refund(userId: string, sessionId: string, tenantId: string, paymentId: string, dto: RefundPaymentDto, now = new Date()): Promise<PaymentView> {
    const tenant = await this.dataSource.transaction(async (manager) => {
      await requireRecentReauth(manager, sessionId, now);
      const autorizado = await resolveAuthorizedTenant(manager, userId, tenantId, {
        permitido: canRefundPayments,
        mensagemProibido: PAYMENT_REFUND_FORBIDDEN_MESSAGE,
        recurso: FeatureKey.PAGAMENTOS,
      });
      const [linha] = linhasDe<{ refunded_at: Date | null; amount_cents: string; timezone: string; received_on: string }>(
        await manager.query(
          `SELECT pg.refunded_at, pg.amount_cents::text AS amount_cents, t.timezone, to_char(pg.received_on, 'YYYY-MM-DD') AS received_on
             FROM appointment_payments pg JOIN tenants t ON t.id = pg.tenant_id
            WHERE pg.tenant_id = $1 AND pg.id = $2 FOR UPDATE OF pg`,
          [autorizado.tenantId, paymentId],
        ),
      );
      if (!linha) throw new NotFoundException('Recebimento não encontrado.');
      if (linha.refunded_at) throw conflito('JA_ESTORNADO', 'Este recebimento já foi estornado.');
      const hoje = dataLocalDe(now, linha.timezone);
      await manager.query(
        `UPDATE appointment_payments
            SET refunded_at = $3, refunded_on = $4::date, refund_reason = $5, refunded_by_user_id = $6
          WHERE tenant_id = $1 AND id = $2`,
        [autorizado.tenantId, paymentId, now, hoje < linha.received_on ? linha.received_on : hoje, dto.reason, userId],
      );
      const actor = await loadActor(manager, userId);
      await recordAudit(
        manager,
        {
          action: 'PAYMENT_REFUNDED',
          actor,
          tenantId: autorizado.tenantId,
          summary: `Recebimento de ${(Number(linha.amount_cents) / 100).toFixed(2)} estornado.`,
          newData: { paymentId, reason: dto.reason },
        },
        now,
      );
      return autorizado.tenantId;
    });
    return (await this.porId(this.dataSource.manager, tenant, paymentId))!;
  }

  /** Recebimentos do período (pela data do recebimento) e os atendimentos que
   * aguardam quitação; o resumo é o mesmo cálculo do Início. */
  async list(userId: string, tenantId: string, query: PaymentPeriodDto, now = new Date()) {
    const manager = this.dataSource.manager;
    const autorizado = await resolveAuthorizedTenant(manager, userId, tenantId, {
      permitido: canViewPayments,
      mensagemProibido: PAYMENTS_FORBIDDEN_MESSAGE,
      recurso: FeatureKey.PAGAMENTOS,
    });
    const timezone = await this.fuso(manager, autorizado.tenantId);
    const periodo = query.from && query.to ? { from: query.from, to: query.to } : mesDaData(dataLocalDe(now, timezone));
    const recebimentos = linhasDe<PaymentRow>(
      await manager.query(
        `${SELECT_PAGAMENTO}
          WHERE pg.tenant_id = $1 AND (pg.received_on BETWEEN $2::date AND $3::date OR pg.refunded_on BETWEEN $2::date AND $3::date)
          ORDER BY pg.received_on DESC, pg.recorded_at DESC, pg.id
          LIMIT ${LIMITE_DA_LISTA + 1}`,
        [autorizado.tenantId, periodo.from, periodo.to],
      ),
    );
    const aQuitar = linhasDe<{ id: string; start_at: Date; status: string; consumer_name: string; service_name: string | null; professional_name: string | null; price_cents: string | null }>(
      await manager.query(
        `SELECT a.id, a.start_at, a.status::text AS status, a.consumer_name_snapshot AS consumer_name, s.name AS service_name,
                p.name AS professional_name, i.price_cents_snapshot::text AS price_cents
           FROM appointments a
           LEFT JOIN professionals p ON p.tenant_id = a.tenant_id AND p.id = a.professional_id
           LEFT JOIN LATERAL (
             SELECT service_id, price_cents_snapshot FROM appointment_items WHERE tenant_id = a.tenant_id AND appointment_id = a.id ORDER BY position LIMIT 1
           ) i ON true
           LEFT JOIN services s ON s.tenant_id = a.tenant_id AND s.id = i.service_id
          WHERE a.tenant_id = $1 AND a.status = 'COMPLETED'
            AND a.start_at >= ($2::date)::timestamp AT TIME ZONE $4::text
            AND a.start_at < ($3::date + 1)::timestamp AT TIME ZONE $4::text
            AND NOT EXISTS (SELECT 1 FROM appointment_payments pg WHERE pg.tenant_id = a.tenant_id AND pg.appointment_id = a.id AND pg.refunded_at IS NULL)
          ORDER BY a.start_at DESC, a.id
          LIMIT ${LIMITE_DA_LISTA + 1}`,
        [autorizado.tenantId, periodo.from, periodo.to, timezone],
      ),
    );
    return {
      timezone,
      period: periodo,
      summary: await resumoFinanceiro(manager, autorizado.tenantId, periodo),
      payments: recebimentos.slice(0, LIMITE_DA_LISTA).map((l) => toView(l, timezone)),
      paymentsComplete: recebimentos.length <= LIMITE_DA_LISTA,
      awaitingPayment: aQuitar.slice(0, LIMITE_DA_LISTA).map((l) => {
        const inicio = new Date(l.start_at);
        return {
          id: l.id,
          startAt: inicio.toISOString(),
          localDate: dataLocalDe(inicio, timezone),
          status: l.status,
          consumerName: l.consumer_name,
          serviceName: l.service_name ?? '',
          professionalName: l.professional_name ?? '',
          /** Preço da RESERVA (só sugestão para o campo de valor; não é
           * dinheiro recebido). `null`: sob consulta. */
          bookedPriceCents: l.price_cents === null ? null : Number(l.price_cents),
        };
      }),
      awaitingComplete: aQuitar.length <= LIMITE_DA_LISTA,
    };
  }

  private async fuso(manager: EntityManager, tenantId: string): Promise<string> {
    const [t] = linhasDe<{ timezone: string }>(await manager.query('SELECT timezone FROM tenants WHERE id = $1', [tenantId]));
    return t.timezone;
  }

  private async porId(manager: EntityManager, tenantId: string, id: string): Promise<PaymentView | null> {
    const [linha] = linhasDe<PaymentRow>(await manager.query(`${SELECT_PAGAMENTO} WHERE pg.tenant_id = $1 AND pg.id = $2`, [tenantId, id]));
    return linha ? toView(linha, await this.fuso(manager, tenantId)) : null;
  }

  private async porChave(manager: EntityManager, tenantId: string, userId: string, chave: string): Promise<PaymentView | null> {
    const [linha] = linhasDe<PaymentRow>(
      await manager.query(`${SELECT_PAGAMENTO} WHERE pg.tenant_id = $1 AND pg.recorded_by_user_id = $2 AND pg.request_key = $3`, [
        tenantId,
        userId,
        chave,
      ]),
    );
    return linha ? toView(linha, await this.fuso(manager, tenantId)) : null;
  }
}

/**
 * Resumo financeiro de um período (datas locais, inclusivas), igual no Início
 * e na tela de Recebimentos:
 *
 * - recebido: soma dos recebimentos com data de recebimento no período,
 *   estornados ou não (o dinheiro entrou naquele dia);
 * - estornado: soma dos estornos com data de estorno no período (o dinheiro
 *   saiu naquele dia, mesmo que o recebimento seja de antes);
 * - líquido: recebido − estornado;
 * - ticket médio: soma dos recebimentos do período que NÃO foram estornados ÷
 *   quantidade desses mesmos atendimentos. Estornar um recebimento antigo só
 *   o tira do período dele; não mexe na média dos atendimentos de outro
 *   período. Sem nenhum, `null` (nunca zero inventado).
 */
export async function resumoFinanceiro(manager: EntityManager, tenantId: string, periodo: { from: string; to: string }) {
  const [linha] = linhasDe<{ recebido: string; estornado: string; pagos: number; total_pagos: string }>(
    await manager.query(
      `SELECT
         COALESCE(SUM(amount_cents) FILTER (WHERE received_on BETWEEN $2::date AND $3::date), 0)::text AS recebido,
         COALESCE(SUM(amount_cents) FILTER (WHERE refunded_on BETWEEN $2::date AND $3::date), 0)::text AS estornado,
         COUNT(DISTINCT appointment_id) FILTER (WHERE received_on BETWEEN $2::date AND $3::date AND refunded_at IS NULL)::int AS pagos,
         COALESCE(SUM(amount_cents) FILTER (WHERE received_on BETWEEN $2::date AND $3::date AND refunded_at IS NULL), 0)::text AS total_pagos
       FROM appointment_payments WHERE tenant_id = $1`,
      [tenantId, periodo.from, periodo.to],
    ),
  );
  const recebido = Number(linha.recebido);
  const estornado = Number(linha.estornado);
  const totalPagos = Number(linha.total_pagos);
  return {
    receivedCents: recebido,
    refundedCents: estornado,
    netCents: recebido - estornado,
    paidAppointments: linha.pagos,
    paidTotalCents: totalPagos,
    averageTicketCents: linha.pagos > 0 ? Math.round(totalPagos / linha.pagos) : null,
  };
}
