// Relatório das comissões APURADAS por profissional e período. Lê só as
// fotografias gravadas na conclusão (`commission_entries`): nunca recalcula
// com a regra atual e nunca inventa comissão para atendimento sem apuração.
// Comissão apurada não é pagamento ao profissional: repasses ficam fora
// deste lote, e o relatório não afirma nada sobre eles.
//
// PERÍODO: pela data LOCAL do atendimento (início marcado), datas
// inclusivas, no fuso do estabelecimento.
//
// TOTAL APURADO: soma das comissões dos itens cuja apuração está valendo
// (`CONFIRMED`) e cujo atendimento continua concluído. Fora do total, mas
// listado para conferência: apuração revertida ou atendimento que não está
// mais concluído.
//
// CONFERÊNCIA (o item ou atendimento continua no total, só é sinalizado):
// - serviço sem regra na conclusão ("não configurada");
// - percentual sobre item sem preço registrado (sem valor);
// - comissão maior que o preço do item;
// - recebimento do cliente estornado e não registrado de novo (só na visão
//   de quem vê recebimentos). O estorno não apaga nem muda a comissão.
import type { EntityManager } from 'typeorm';
import { dataLocalDe } from '../availability/time-zone.js';
import { linhasDe } from '../common/linhas-de.js';
import { ruleToView, situacaoDoItem, type ItemSituation, type RuleView, type StoredRule } from './commission-calculation.js';

/** Teto de atendimentos detalhados (os totais contam o período todo). */
export const LIMITE_DE_ATENDIMENTOS = 200;

export type ClientPayment = 'RECEBIDO' | 'SEM_RECEBIMENTO' | 'ESTORNADO';

export interface ReportOptions {
  tenantId: string;
  timezone: string;
  period: { from: string; to: string };
  professionalId?: string;
  /** Mostra a situação do recebimento do cliente (dono, nunca funcionário). */
  withClientPayment: boolean;
}

/** Apuração que vale: entra no total. */
const VALE = `(ce.status = 'CONFIRMED' AND a.status = 'COMPLETED')`;
const RECEBIMENTO_SQL = `CASE
    WHEN EXISTS (SELECT 1 FROM appointment_payments pg WHERE pg.tenant_id = a.tenant_id AND pg.appointment_id = a.id
      AND pg.refunded_at IS NULL) THEN 'RECEBIDO'
    WHEN EXISTS (SELECT 1 FROM appointment_payments pg WHERE pg.tenant_id = a.tenant_id AND pg.appointment_id = a.id)
      THEN 'ESTORNADO'
    ELSE 'SEM_RECEBIMENTO' END`;

function filtro(opcoes: ReportOptions): { sql: string; values: unknown[] } {
  const values: unknown[] = [opcoes.tenantId, opcoes.period.from, opcoes.period.to, opcoes.timezone];
  let sql = `ce.tenant_id = $1
    AND ce.service_date >= ($2::date)::timestamp AT TIME ZONE $4::text
    AND ce.service_date < ($3::date + 1)::timestamp AT TIME ZONE $4::text`;
  if (opcoes.professionalId) {
    values.push(opcoes.professionalId);
    sql += ` AND ce.professional_id = $${values.length}`;
  }
  return { sql, values };
}

interface TotalRow {
  professional_id: string;
  professional_name: string;
  professional_active: boolean;
  accrued_cents: string;
  appointments: number;
  items: number;
  not_configured: number;
  without_price: number;
  above_price: number;
  refunded: number;
  out_of_total: number;
}

interface ItemRow {
  appointment_id: string;
  service_date: Date;
  calculated_at: Date;
  appointment_status: string;
  consumer_name: string;
  professional_id: string;
  professional_name: string;
  client_payment: ClientPayment;
  entry_status: string;
  service_name: string | null;
  price_cents: number | null;
  applied_type: StoredRule['type'] | null;
  applied_value: number | null;
  professional_cents: number | null;
  establishment_cents: number | null;
}

export interface ReportItem {
  serviceName: string;
  priceCents: number | null;
  rule: RuleView | null;
  commissionCents: number | null;
  situation: ItemSituation;
}

export interface ReportAppointment {
  id: string;
  localDate: string;
  localStart: string;
  completedAt: string;
  consumerName: string;
  professional: { id: string; name: string };
  status: string;
  /** Entra no total apurado. */
  counted: boolean;
  commissionCents: number;
  items: ReportItem[];
  clientPayment?: ClientPayment;
  flags: string[];
}

const numero = (v: string | number | null) => (v === null ? null : Number(v));

export async function commissionReport(manager: EntityManager, opcoes: ReportOptions) {
  const { sql, values } = filtro(opcoes);
  const estornado = opcoes.withClientPayment
    ? `count(DISTINCT ce.appointment_id) FILTER (WHERE ${VALE} AND (${RECEBIMENTO_SQL}) = 'ESTORNADO')::int`
    : '0';
  const totais = linhasDe<TotalRow>(
    await manager.query(
      `SELECT ce.professional_id, p.name AS professional_name, p.active AS professional_active,
              COALESCE(sum(ce.professional_cents) FILTER (WHERE ${VALE}), 0)::text AS accrued_cents,
              count(DISTINCT ce.appointment_id) FILTER (WHERE ${VALE})::int AS appointments,
              count(*) FILTER (WHERE ${VALE})::int AS items,
              count(*) FILTER (WHERE ${VALE} AND ce.applied_type IS NULL)::int AS not_configured,
              count(*) FILTER (WHERE ${VALE} AND ce.applied_type IS NOT NULL AND ce.professional_cents IS NULL)::int
                AS without_price,
              count(*) FILTER (WHERE ${VALE} AND ce.professional_cents > ce.price_cents_snapshot)::int AS above_price,
              ${estornado} AS refunded,
              count(DISTINCT ce.appointment_id) FILTER (WHERE NOT ${VALE})::int AS out_of_total
         FROM commission_entries ce
         JOIN appointments a ON a.tenant_id = ce.tenant_id AND a.id = ce.appointment_id
         JOIN professionals p ON p.tenant_id = ce.tenant_id AND p.id = ce.professional_id
        WHERE ${sql}
        GROUP BY ce.professional_id, p.name, p.active
        ORDER BY p.name, ce.professional_id`,
      values,
    ),
  );

  const itens = linhasDe<ItemRow>(
    await manager.query(
      `WITH alvo AS (
         SELECT ce.appointment_id, min(ce.service_date) AS service_date
           FROM commission_entries ce
          WHERE ${sql}
          GROUP BY ce.appointment_id
          ORDER BY min(ce.service_date) DESC, ce.appointment_id
          LIMIT ${LIMITE_DE_ATENDIMENTOS + 1}
       )
       SELECT ce.appointment_id, ce.service_date, ce.calculated_at, a.status::text AS appointment_status,
              a.consumer_name_snapshot AS consumer_name, ce.professional_id, p.name AS professional_name,
              ${opcoes.withClientPayment ? RECEBIMENTO_SQL : `'SEM_RECEBIMENTO'`} AS client_payment,
              ce.status::text AS entry_status, COALESCE(ai.service_name_snapshot, sv.name) AS service_name,
              ce.price_cents_snapshot AS price_cents, ce.applied_type::text AS applied_type, ce.applied_value,
              ce.professional_cents, ce.establishment_cents
         FROM alvo
         JOIN commission_entries ce ON ce.tenant_id = $1 AND ce.appointment_id = alvo.appointment_id
         JOIN appointments a ON a.tenant_id = ce.tenant_id AND a.id = ce.appointment_id
         JOIN professionals p ON p.tenant_id = ce.tenant_id AND p.id = ce.professional_id
         LEFT JOIN appointment_items ai ON ai.tenant_id = ce.tenant_id AND ai.id = ce.appointment_item_id
         LEFT JOIN services sv ON sv.tenant_id = ce.tenant_id AND sv.id = ce.service_id
        ORDER BY alvo.service_date DESC, ce.appointment_id, ai.position, ce.id`,
      values,
    ),
  );

  const atendimentos: ReportAppointment[] = [];
  for (const linha of itens) {
    let atual = atendimentos.at(-1);
    if (!atual || atual.id !== linha.appointment_id) {
      const inicio = new Date(linha.service_date);
      atual = {
        id: linha.appointment_id,
        localDate: dataLocalDe(inicio, opcoes.timezone),
        localStart: new Intl.DateTimeFormat('en-GB', {
          timeZone: opcoes.timezone,
          hour: '2-digit',
          minute: '2-digit',
          hourCycle: 'h23',
        }).format(inicio),
        completedAt: new Date(linha.calculated_at).toISOString(),
        consumerName: linha.consumer_name,
        professional: { id: linha.professional_id, name: linha.professional_name },
        status: linha.appointment_status,
        counted: linha.entry_status === 'CONFIRMED' && linha.appointment_status === 'COMPLETED',
        commissionCents: 0,
        items: [],
        ...(opcoes.withClientPayment ? { clientPayment: linha.client_payment } : {}),
        flags: [],
      };
      atendimentos.push(atual);
    }
    const preco = numero(linha.price_cents);
    const comissao = numero(linha.professional_cents);
    const tipo = linha.applied_type;
    const item: ReportItem = {
      serviceName: linha.service_name ?? '',
      priceCents: preco,
      rule: tipo === null ? null : ruleToView({ type: tipo, value: Number(linha.applied_value) }),
      commissionCents: comissao,
      situation: situacaoDoItem({ appliedType: tipo, priceCents: preco, professionalCents: comissao }),
    };
    atual.items.push(item);
    atual.commissionCents += comissao ?? 0;
  }
  for (const a of atendimentos) {
    const flags = new Set<string>();
    if (!a.counted) flags.add('FORA_DO_TOTAL');
    for (const item of a.items) if (item.situation !== 'OK') flags.add(item.situation);
    if (a.clientPayment === 'ESTORNADO' && a.counted) flags.add('RECEBIMENTO_ESTORNADO');
    a.flags = [...flags];
  }

  const professionals = totais.map((t) => ({
    professional: { id: t.professional_id, name: t.professional_name, active: t.professional_active },
    accruedCents: Number(t.accrued_cents),
    appointments: t.appointments,
    items: t.items,
    review: {
      notConfigured: t.not_configured,
      withoutPrice: t.without_price,
      abovePrice: t.above_price,
      ...(opcoes.withClientPayment ? { refundedPayment: t.refunded } : {}),
      outOfTotal: t.out_of_total,
    },
  }));
  return {
    timezone: opcoes.timezone,
    period: opcoes.period,
    /** Comissão apurada na conclusão do atendimento; não é pagamento. */
    basis: 'APURADA_NA_CONCLUSAO' as const,
    totalAccruedCents: professionals.reduce((soma, p) => soma + p.accruedCents, 0),
    professionals,
    appointments: atendimentos.slice(0, LIMITE_DE_ATENDIMENTOS),
    appointmentsComplete: atendimentos.length <= LIMITE_DE_ATENDIMENTOS,
  };
}
