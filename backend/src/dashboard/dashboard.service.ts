// Indicadores do Início (dono): tudo contado no SERVIDOR, sobre o período
// inteiro, nunca sobre uma página de lista. Toda consulta leva `tenant_id`
// no WHERE, e o estabelecimento vem da autorização (`resolveAuthorizedTenant`),
// nunca da URL sozinha.
//
// FUSO: as datas do período são do estabelecimento. Os limites viram
// instantes no próprio PostgreSQL (`data::timestamp AT TIME ZONE fuso`), que
// conhece horário de verão; um atendimento pertence ao dia local em que
// COMEÇA, a mesma regra da agenda.
//
// O QUE CADA NÚMERO CONTA (ver docs/plans/operacao-diaria-configuracoes.md):
// - clientes previstos hoje: clientes DISTINTOS com atendimento hoje em
//   CONFIRMED, IN_PROGRESS ou COMPLETED;
// - clientes atendidos no período: clientes DISTINTOS com atendimento
//   COMPLETED no período;
// - atendimentos por situação: quantidade de ATENDIMENTOS (não de pessoas);
// - solicitações aguardando: PENDING que ainda não começou (mesma regra da
//   aba Solicitações), contadas sem o teto da lista;
// - plano e uso: profissionais ativos e vagas de funcionário (team/seats.ts).
//
// FINANCEIRO: só os recebimentos registrados à mão (payments/), com o mesmo
// cálculo da tela de Recebimentos (`resumoFinanceiro`). Preço de reserva
// nunca é dinheiro recebido.
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { canViewAppointments, APPOINTMENTS_FORBIDDEN_MESSAGE } from '../appointments/appointment-access.js';
import { dataLocalDe, horaLocalDe } from '../availability/time-zone.js';
import { resolveAuthorizedTenant } from '../common/tenant-authorization.js';
import { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { linhasDe } from '../notifications/notification-jobs.repository.js';
import { activeProfessionals, staffSeatUsage } from '../team/seats.js';
import { contagemPorSituacao, mesDaData, type PeriodoLocal, type Situacao } from './dashboard-period.js';
import type { DashboardQueryDto } from './dashboard.dto.js';
import { resumoFinanceiro } from '../payments/payments.service.js';

/** Quantos próximos atendimentos o Início mostra; o resto fica na agenda. */
export const LIMITE_DE_PROXIMOS = 8;

const SITUACOES_PREVISTAS = ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'];

export interface ProximoAtendimento {
  id: string;
  startAt: string;
  localDate: string;
  localStart: string;
  status: Situacao;
  consumer: { name: string };
  service: { name: string };
  professional: { name: string };
}

export interface DashboardView {
  timezone: string;
  today: string;
  generatedAt: string;
  period: PeriodoLocal;
  todaySummary: {
    expectedClients: number;
    appointmentsByStatus: Record<Situacao, number>;
  };
  periodSummary: {
    servedClients: number;
    appointmentsByStatus: Record<Situacao, number>;
    appointmentsTotal: number;
  };
  pendingRequests: number;
  upcoming: ProximoAtendimento[];
  /** Recebimentos registrados no período (ver `resumoFinanceiro`). */
  finance: Awaited<ReturnType<typeof resumoFinanceiro>>;
  plan: {
    name: string;
    maxProfessionals: number;
    activeProfessionals: number;
    staffSeats: { used: number; pending: number; available: number; limit: number };
  };
}

/** `WHERE` do período: início do primeiro dia local até o início do dia
 * seguinte ao último. Parâmetros: $2 = from, $3 = to, $4 = fuso. */
const NO_PERIODO = `a.start_at >= ($2::date)::timestamp AT TIME ZONE $4::text
  AND a.start_at < ($3::date + 1)::timestamp AT TIME ZONE $4::text`;

@Injectable()
export class DashboardService {
  constructor(private readonly dataSource: DataSource) {}

  async summary(userId: string, tenantId: string, query: DashboardQueryDto, now = new Date()): Promise<DashboardView> {
    return this.dataSource.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');
      const authorized = await resolveAuthorizedTenant(manager, userId, tenantId, {
        // Só o dono: o Início reúne plano, vagas e dinheiro, que o gerente não
        // recebe por ter a agenda (ver common/manager-permissions.ts).
        permitido: (role, overrides) => role === EstablishmentRole.DONO && canViewAppointments(role, overrides),
        mensagemProibido: APPOINTMENTS_FORBIDDEN_MESSAGE,
      });
      const tenant = authorized.tenantId;

      const [dadosDoTenant] = linhasDe<{ timezone: string; plan_name: string; max_professionals: number }>(
        await manager.query(
          `SELECT t.timezone, p.name AS plan_name, p.max_professionals
             FROM tenants t JOIN plans p ON p.id = t.plan_id WHERE t.id = $1`,
          [tenant],
        ),
      );
      const timezone = dadosDoTenant.timezone;
      const hoje = dataLocalDe(now, timezone);
      const periodo: PeriodoLocal = query.from && query.to ? { from: query.from, to: query.to } : mesDaData(hoje);

      const porSituacaoHoje = await this.porSituacao(manager, tenant, { from: hoje, to: hoje }, timezone);
      const porSituacaoNoPeriodo = await this.porSituacao(manager, tenant, periodo, timezone);

      const [previstos] = linhasDe<{ total: number }>(
        await manager.query(
          `SELECT count(DISTINCT a.consumer_id)::int AS total FROM appointments a
            WHERE a.tenant_id = $1 AND ${NO_PERIODO} AND a.status::text = ANY($5::text[])`,
          [tenant, hoje, hoje, timezone, SITUACOES_PREVISTAS],
        ),
      );
      const [atendidos] = linhasDe<{ total: number }>(
        await manager.query(
          `SELECT count(DISTINCT a.consumer_id)::int AS total FROM appointments a
            WHERE a.tenant_id = $1 AND ${NO_PERIODO} AND a.status = 'COMPLETED'`,
          [tenant, periodo.from, periodo.to, timezone],
        ),
      );
      const [pendentes] = linhasDe<{ total: number }>(
        await manager.query(
          `SELECT count(*)::int AS total FROM appointments
            WHERE tenant_id = $1 AND status = 'PENDING' AND start_at > $2`,
          [tenant, now],
        ),
      );

      const proximos = linhasDe<{
        id: string;
        start_at: Date;
        status: Situacao;
        consumer_name: string;
        service_name: string | null;
        professional_name: string | null;
      }>(
        await manager.query(
          `SELECT a.id, a.start_at, a.status::text AS status, a.consumer_name_snapshot AS consumer_name,
                  s.name AS service_name, p.name AS professional_name
             FROM appointments a
             LEFT JOIN professionals p ON p.tenant_id = a.tenant_id AND p.id = a.professional_id
             LEFT JOIN LATERAL (
               SELECT service_id FROM appointment_items
                WHERE tenant_id = a.tenant_id AND appointment_id = a.id ORDER BY position LIMIT 1
             ) i ON true
             LEFT JOIN services s ON s.tenant_id = a.tenant_id AND s.id = i.service_id
            WHERE a.tenant_id = $1 AND a.status IN ('PENDING', 'CONFIRMED') AND a.start_at > $2
            ORDER BY a.start_at, a.id
            LIMIT ${LIMITE_DE_PROXIMOS}`,
          [tenant, now],
        ),
      );

      const financeiro = await resumoFinanceiro(manager, tenant, periodo);
      const vagas = await staffSeatUsage(manager, tenant, dadosDoTenant.max_professionals, now);
      const profissionaisAtivos = await activeProfessionals(manager, tenant);

      return {
        timezone,
        today: hoje,
        generatedAt: now.toISOString(),
        period: periodo,
        todaySummary: {
          expectedClients: previstos.total,
          appointmentsByStatus: porSituacaoHoje,
        },
        periodSummary: {
          servedClients: atendidos.total,
          appointmentsByStatus: porSituacaoNoPeriodo,
          appointmentsTotal: Object.values(porSituacaoNoPeriodo).reduce((soma, n) => soma + n, 0),
        },
        pendingRequests: pendentes.total,
        finance: financeiro,
        upcoming: proximos.map((linha) => {
          const inicio = new Date(linha.start_at);
          return {
            id: linha.id,
            startAt: inicio.toISOString(),
            localDate: dataLocalDe(inicio, timezone),
            localStart: horaLocalDe(inicio, timezone),
            status: linha.status,
            consumer: { name: linha.consumer_name },
            service: { name: linha.service_name ?? '' },
            professional: { name: linha.professional_name ?? '' },
          };
        }),
        plan: {
          name: dadosDoTenant.plan_name,
          maxProfessionals: dadosDoTenant.max_professionals,
          activeProfessionals: profissionaisAtivos,
          staffSeats: {
            used: vagas.used,
            pending: vagas.pendingInvites,
            available: vagas.available,
            limit: vagas.limit,
          },
        },
      };
    });
  }

  private async porSituacao(
    manager: EntityManager,
    tenantId: string,
    periodo: PeriodoLocal,
    timezone: string,
  ): Promise<Record<Situacao, number>> {
    const linhas = linhasDe<{ status: string; total: number }>(
      await manager.query(
        `SELECT a.status::text AS status, count(*)::int AS total FROM appointments a
          WHERE a.tenant_id = $1 AND ${NO_PERIODO}
          GROUP BY a.status`,
        [tenantId, periodo.from, periodo.to, timezone],
      ),
    );
    return contagemPorSituacao(linhas);
  }
}
