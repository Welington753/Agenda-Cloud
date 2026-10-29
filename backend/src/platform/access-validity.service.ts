// Validade do acesso pela administração da plataforma: pagamento confirmado
// manualmente, prorrogação do teste e cortesia (ver
// docs/plans/planos-e-validade-do-acesso.md, seção 2.5).
//
// Regras comuns (as mesmas da suspensão e da troca de plano):
// - só `MASTER_OWNER`, com senha confirmada há pouco NESTA sessão;
// - a linha do estabelecimento é travada e a versão lida pela tela é
//   conferida; o período e o histórico entram na mesma transação;
// - a chave do formulário (`requestKey`) é única por quem registrou: repetir
//   a mesma requisição devolve o período já gravado, sem duplicar pagamento
//   nem estender a validade de novo. A repetição é reconhecida ANTES da
//   conferência de versão (a primeira gravação já avançou a versão);
// - nada aqui tira suspensão ou arquivamento: num suspenso o período é
//   gravado e a reativação continua sendo outra ação; num arquivado, recusa.
import { ConflictException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';
import type { Actor } from '../accounts/actor.js';
import { recordAudit, type AdminAuditAction } from '../accounts/audit.js';
import { isUniqueViolation } from '../auth/unique-violation.js';
import { generateId } from '../entities/common/generate-id.js';
import {
  accessSituation,
  addDays,
  localDate,
  nextCourtesyPeriod,
  nextPaidPeriod,
  trialExtension,
  type AccessPeriodKind,
  type NewPeriodDates,
  type StoredPeriod,
} from '../commercial/access-periods.js';
import { loadAccessPeriods } from '../commercial/commercial-gate.js';
import { dataLocalDe } from '../availability/time-zone.js';
import { lifecycleActor, lockEstablishment, writeEstablishment, type TenantRow } from './establishment-admin.service.js';
import type { ExtendTrialDto, GrantCourtesyDto, RecordPaidPeriodDto } from './platform.dto.js';

const conflito = (code: string, message: string) => new ConflictException({ code, message });

const REQUEST_KEY_CONSTRAINT = 'uq_tenant_access_periods_request_key';

/** Uma linha de `tenant_access_periods` como a tela vê. */
export interface AccessPeriodView {
  id: string;
  kind: AccessPeriodKind;
  plan: { id: string; name: string };
  startsAt: string;
  endsAt: string;
  /** Primeiro e último dia cobertos, na data local do estabelecimento. */
  firstDay: string;
  lastDay: string;
  cycle: 'MONTHLY' | 'QUARTERLY' | null;
  amountCents: number | null;
  currency: string | null;
  paymentMethod: string | null;
  receivedOn: string | null;
  reference: string | null;
  confirmationSource: 'MANUAL' | null;
  reason: string | null;
  recordedAt: string;
  recordedBy: { id: string; name: string };
}

interface PeriodRow {
  id: string;
  tenant_id: string;
  kind: AccessPeriodKind;
  plan_id: string;
  plan_name: string;
  starts_at: Date;
  ends_at: Date;
  billing_cycle: 'MONTHLY' | 'QUARTERLY' | null;
  contracted_price_cents: number | null;
  currency: string | null;
  payment_method: string | null;
  payment_received_on: string | null;
  payment_reference: string | null;
  confirmation_source: 'MANUAL' | null;
  reason: string | null;
  recorded_at: Date;
  recorded_by_user_id: string;
  recorded_by_name: string;
  timezone: string;
}

const PERIOD_SELECT = `SELECT ap.id, ap.tenant_id, ap.kind::text AS kind, ap.plan_id, p.name AS plan_name,
    ap.starts_at, ap.ends_at, ap.billing_cycle::text AS billing_cycle, ap.contracted_price_cents,
    btrim(ap.currency) AS currency, ap.payment_method, to_char(ap.payment_received_on, 'YYYY-MM-DD') AS payment_received_on,
    ap.payment_reference, ap.confirmation_source, ap.reason, ap.recorded_at, ap.recorded_by_user_id,
    u.name AS recorded_by_name, t.timezone
  FROM tenant_access_periods ap
  JOIN plans p ON p.id = ap.plan_id
  JOIN users u ON u.id = ap.recorded_by_user_id
  JOIN tenants t ON t.id = ap.tenant_id`;

function toView(l: PeriodRow): AccessPeriodView {
  const fim = new Date(l.ends_at);
  const ultimo = localDate(new Date(fim.getTime() - 1), l.timezone);
  return {
    id: l.id,
    kind: l.kind,
    plan: { id: l.plan_id, name: l.plan_name },
    startsAt: new Date(l.starts_at).toISOString(),
    endsAt: fim.toISOString(),
    firstDay: dataLocalDe(new Date(l.starts_at), l.timezone),
    lastDay: `${ultimo.year}-${String(ultimo.month).padStart(2, '0')}-${String(ultimo.day).padStart(2, '0')}`,
    cycle: l.billing_cycle,
    amountCents: l.contracted_price_cents === null ? null : Number(l.contracted_price_cents),
    currency: l.currency,
    paymentMethod: l.payment_method,
    receivedOn: l.payment_received_on,
    reference: l.payment_reference,
    confirmationSource: l.confirmation_source,
    reason: l.reason,
    recordedAt: new Date(l.recorded_at).toISOString(),
    recordedBy: { id: l.recorded_by_user_id, name: l.recorded_by_name },
  };
}

/** Histórico de períodos do estabelecimento, do mais recente ao mais antigo. */
export async function listAccessPeriods(manager: EntityManager, tenantId: string): Promise<AccessPeriodView[]> {
  const linhas = await manager.query<PeriodRow[]>(
    `${PERIOD_SELECT} WHERE ap.tenant_id = $1 ORDER BY ap.starts_at DESC, ap.recorded_at DESC, ap.id DESC`,
    [tenantId],
  );
  return linhas.map(toView);
}

/** `"2027-02-28"` -> `"28/02/2027"`. */
const br = (iso: string) => iso.split('-').reverse().join('/');
const reais = (centavos: number) =>
  (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });
const CICLO = { MONTHLY: 'mensal', QUARTERLY: 'trimestral' } as const;

export interface AccessChangeResult {
  created: boolean;
  updatedAt: Date | null;
  period: AccessPeriodView;
}

interface NewPeriod {
  kind: AccessPeriodKind;
  dates: NewPeriodDates;
  requestKey: string;
  reason: string | null;
  paid?: {
    cycle: 'MONTHLY' | 'QUARTERLY';
    amountCents: number;
    method: string;
    receivedOn: string;
    reference: string | null;
  };
}

@Injectable()
export class AccessValidityService {
  constructor(private readonly dataSource: DataSource) {}

  async recordPaid(actorId: string, sessionId: string, tenantId: string, dto: RecordPaidPeriodDto, now = new Date()) {
    return this.change(actorId, sessionId, tenantId, dto.requestKey, dto.expectedUpdatedAt, 'PAID', now, async (manager, atual, periodos) => {
      const hoje = dataLocalDe(now, atual.timezone);
      if (dto.receivedOn > hoje) {
        throw conflito('DATA_FUTURA', 'A data do recebimento não pode ser depois de hoje.');
      }
      const limite = addDays(localDate(now, atual.timezone), -366);
      const minimo = `${limite.year}-${String(limite.month).padStart(2, '0')}-${String(limite.day).padStart(2, '0')}`;
      if (dto.receivedOn < minimo) {
        throw conflito('DATA_ANTIGA', 'A data do recebimento é de mais de um ano atrás. Confira antes de registrar.');
      }
      return {
        kind: 'PAID',
        dates: nextPaidPeriod(periodos, now, atual.timezone, dto.cycle),
        requestKey: dto.requestKey,
        reason: dto.notes ?? null,
        paid: {
          cycle: dto.cycle,
          amountCents: dto.amountCents,
          method: dto.paymentMethod,
          receivedOn: dto.receivedOn,
          reference: dto.reference ?? null,
        },
      };
    });
  }

  async extendTrial(actorId: string, sessionId: string, tenantId: string, dto: ExtendTrialDto, now = new Date()) {
    return this.change(actorId, sessionId, tenantId, dto.requestKey, dto.expectedUpdatedAt, 'TRIAL', now, async (_m, atual, periodos) => {
      if (periodos.some((p) => p.kind !== 'TRIAL')) {
        throw conflito(
          'TESTE_ENCERRADO',
          'Este estabelecimento já teve período pago ou cortesia: o teste não volta. Use a cortesia.',
        );
      }
      return {
        kind: 'TRIAL',
        dates: trialExtension(periodos, now, atual.timezone, dto.days, new Date(atual.created_at)),
        requestKey: dto.requestKey,
        reason: dto.reason,
      };
    });
  }

  async grantCourtesy(actorId: string, sessionId: string, tenantId: string, dto: GrantCourtesyDto, now = new Date()) {
    return this.change(actorId, sessionId, tenantId, dto.requestKey, dto.expectedUpdatedAt, 'COURTESY', now, async (_m, atual, periodos) => ({
      kind: 'COURTESY',
      dates: nextCourtesyPeriod(periodos, now, atual.timezone, dto.days),
      requestKey: dto.requestKey,
      reason: dto.reason,
    }));
  }

  // ---------------------------------------------------------------- internos

  private async change(
    actorId: string,
    sessionId: string,
    tenantId: string,
    requestKey: string,
    expectedUpdatedAt: string,
    kind: AccessPeriodKind,
    now: Date,
    montar: (manager: EntityManager, atual: TenantRow, periodos: StoredPeriod[]) => Promise<NewPeriod>,
  ): Promise<AccessChangeResult> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const actor = await lifecycleActor(manager, actorId, sessionId, now);
        const atual = await lockEstablishment(manager, tenantId, expectedUpdatedAt).catch(async (erro: unknown) => {
          // A repetição de uma requisição já gravada encontra a versão
          // avançada: devolve o que foi gravado em vez do 409 de versão.
          const repetida = await this.replay(manager, actorId, requestKey, tenantId, kind);
          if (repetida) return repetida;
          throw erro;
        });
        if ('period' in atual) return atual;
        const repetida = await this.replay(manager, actorId, requestKey, tenantId, kind);
        if (repetida) return repetida;

        if (atual.status === 'ARCHIVED') {
          throw conflito('ESTABELECIMENTO_ARQUIVADO', 'Estabelecimento arquivado: reative antes de registrar validade.');
        }
        if (!['TRIAL', 'ACTIVE', 'SUSPENDED'].includes(atual.status)) {
          throw conflito('SITUACAO_INVALIDA', 'Esta situação não aceita registro de validade por aqui.');
        }

        const periodos = await loadAccessPeriods(manager, atual.id);
        const novo = await montar(manager, atual, periodos);
        const id = generateId();
        await manager.query(
          `INSERT INTO tenant_access_periods
             (id, tenant_id, kind, plan_id, starts_at, ends_at, anchor_day, billing_cycle, contracted_price_cents,
              currency, payment_method, payment_received_on, payment_reference, confirmation_source, reason,
              recorded_at, recorded_by_user_id, request_key)
           VALUES ($1, $2, $3::access_period_kind, $4, $5, $6, $7, $8::billing_cycle, $9, $10, $11, $12::date, $13, $14, $15,
                   $16, $17, $18)`,
          [
            id,
            atual.id,
            novo.kind,
            atual.plan_id,
            novo.dates.startsAt,
            novo.dates.endsAt,
            novo.dates.anchorDay,
            novo.paid?.cycle ?? null,
            novo.paid?.amountCents ?? null,
            novo.paid ? 'BRL' : null,
            novo.paid?.method ?? null,
            novo.paid?.receivedOn ?? null,
            novo.paid?.reference ?? null,
            novo.paid ? 'MANUAL' : null,
            novo.reason,
            now,
            actor.id,
            novo.requestKey,
          ],
        );

        // Primeiro pago ou cortesia: a situação administrativa deixa de
        // ser "teste". Suspensão e arquivamento nunca saem daqui.
        let sets = 'status = status';
        let situacao = { status: atual.status, restoreStatus: atual.restore_status };
        if (novo.kind !== 'TRIAL') {
          if (atual.status === 'TRIAL') {
            sets = `status = 'ACTIVE'`;
            situacao = { ...situacao, status: 'ACTIVE' };
          } else if (atual.status === 'SUSPENDED' && atual.restore_status === 'TRIAL') {
            sets = `restore_status = 'ACTIVE'`;
            situacao = { ...situacao, restoreStatus: 'ACTIVE' };
          }
        }
        const versao = await writeEstablishment(manager, atual.id, now, sets, []);

        const [linha] = await manager.query<PeriodRow[]>(`${PERIOD_SELECT} WHERE ap.id = $1`, [id]);
        const periodo = toView(linha);
        const depois = accessSituation(await loadAccessPeriods(manager, atual.id), now);
        await this.audit(manager, actor, atual, situacao, periodo, depois.validUntil, now);
        return { created: true, updatedAt: versao, period: periodo };
      });
    } catch (erro) {
      if (isUniqueViolation(erro, REQUEST_KEY_CONSTRAINT)) {
        const repetida = await this.replay(this.dataSource.manager, actorId, requestKey, tenantId, kind);
        if (repetida) return repetida;
      }
      throw erro;
    }
  }

  /** O período já gravado com esta chave por esta pessoa. A mesma chave
   * noutro estabelecimento ou noutro tipo de ação é recusada. */
  private async replay(
    manager: EntityManager,
    actorId: string,
    requestKey: string,
    tenantId: string,
    kind: AccessPeriodKind,
  ): Promise<AccessChangeResult | null> {
    const [linha] = await manager.query<PeriodRow[]>(
      `${PERIOD_SELECT} WHERE ap.recorded_by_user_id = $1 AND ap.request_key = $2`,
      [actorId, requestKey],
    );
    if (!linha) return null;
    if (linha.tenant_id !== tenantId || linha.kind !== kind) {
      throw conflito('CHAVE_REUTILIZADA', 'Este formulário já foi usado para outro registro. Recarregue a tela.');
    }
    return { created: false, updatedAt: null, period: toView(linha) };
  }

  private async audit(
    manager: EntityManager,
    actor: Actor,
    atual: TenantRow,
    situacao: { status: string; restoreStatus: string | null },
    periodo: AccessPeriodView,
    validUntil: Date | null,
    now: Date,
  ): Promise<void> {
    const vigencia = `de ${br(periodo.firstDay)} a ${br(periodo.lastDay)}`;
    const base = {
      periodId: periodo.id,
      kind: periodo.kind,
      planId: periodo.plan.id,
      startsAt: periodo.startsAt,
      endsAt: periodo.endsAt,
      validUntil: validUntil?.toISOString() ?? null,
      reason: periodo.reason,
      status: situacao.status,
      restoreStatus: situacao.restoreStatus,
    };
    let action: AdminAuditAction;
    let summary: string;
    if (periodo.kind === 'PAID') {
      action = 'ACCESS_PAID_PERIOD_RECORDED';
      summary =
        `Pagamento confirmado manualmente pela administração para ${atual.name} (sem confirmação automática): ` +
        `plano ${periodo.plan.name}, ${CICLO[periodo.cycle!]}, ${reais(periodo.amountCents!)}, ` +
        `recebido em ${br(periodo.receivedOn!)}. Período ${vigencia}.`;
    } else if (periodo.kind === 'TRIAL') {
      action = 'ACCESS_TRIAL_EXTENDED';
      summary = `Teste de ${atual.name} prorrogado: ${vigencia}. Motivo: ${periodo.reason}`;
    } else {
      action = 'ACCESS_COURTESY_GRANTED';
      summary = `Cortesia concedida a ${atual.name}: ${vigencia}. Motivo: ${periodo.reason}`;
    }
    await recordAudit(
      manager,
      {
        action,
        actor,
        tenantId: atual.id,
        summary,
        previousData: { status: atual.status, restoreStatus: atual.restore_status },
        newData:
          periodo.kind === 'PAID'
            ? {
                ...base,
                cycle: periodo.cycle,
                amountCents: periodo.amountCents,
                currency: periodo.currency,
                paymentMethod: periodo.paymentMethod,
                receivedOn: periodo.receivedOn,
                reference: periodo.reference,
                confirmationSource: 'MANUAL',
              }
            : base,
      },
      now,
    );
  }
}
