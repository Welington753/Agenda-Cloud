// Agenda do FUNCIONÁRIO (e do GERENTE com profissional ligado, depois da
// confirmação do dono): só os atendimentos do profissional ligado ao vínculo
// de quem está na sessão. O profissional NUNCA vem do navegador: a URL traz
// só o estabelecimento (que precisa de vínculo ativo da própria conta) e,
// nas ações, o id da reserva, que só é encontrado se for desse profissional.
// Reserva de colega ou de outro estabelecimento é indistinguível de
// inexistente (404).
//
// Exposto: data, horário, cliente (nome), serviço e situação. Nada de
// telefone, observações, preço, lista de clientes ou agenda de colegas.
//
// Tudo relido a cada requisição: vínculo suspenso ou removido, profissional
// desativado, estabelecimento fora de operação ou permissão retirada valem já
// na próxima, mesmo com a sessão aberta.
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';
import {
  AppointmentsService,
  LIMITE_DO_PERIODO,
  dataLocalDaString,
} from '../appointments/appointments.service.js';
import type { OwnAgendaPeriodDto } from '../appointments/appointment.dto.js';
import { transicaoPermitida } from '../appointments/appointment-status-transitions.js';
import { dataLocalDe, horaLocalDe, janelaDeCarregamento } from '../availability/time-zone.js';
import {
  MEMBERSHIP_SUSPENDED_MESSAGE,
  TENANT_NOT_FOUND_MESSAGE,
  effectiveOverrides,
} from '../common/tenant-authorization.js';
import type { AppointmentStatus } from '../entities/enums/appointment-status.enum.js';
import { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { isOperational } from './seats.js';
import {
  OWN_AGENDA_FORBIDDEN_MESSAGE,
  STAFF_ACTIONS,
  STAFF_ACTION_FORBIDDEN_MESSAGE,
  STAFF_PERMISSION_OF_ACTION,
  canViewOwnAgenda,
  staffPermissionGranted,
  type OverrideRow,
  type StaffAction,
} from './staff-access.js';
import type { MyAgendaQuery, OwnStatusActionDto } from './team.dto.js';

/** Mesmo teto da agenda do dono (LIMITE_DO_DIA): a rota nunca vira um dump. */
const LIMITE_DO_DIA = 200;
const PROFESSIONAL_INACTIVE_MESSAGE =
  'Seu cadastro de profissional está desativado neste estabelecimento. Fale com o responsável.';

export interface StaffAccess {
  tenantId: string;
  membershipId: string;
  professional: { id: string; name: string };
  timezone: string;
  allowed: Record<StaffAction, boolean>;
}

export interface OwnAppointmentView {
  id: string;
  startAt: string;
  localDate: string;
  localStart: string;
  localServiceEnd: string;
  durationMinutes: number;
  status: AppointmentStatus;
  service: { name: string };
  consumer: { name: string };
  /** Ações que ESTA conta pode fazer agora nesta reserva (permissão + regra
   * de horário e estado). O servidor confere de novo ao executar. */
  actions: StaffAction[];
}

interface OwnAppointmentRow {
  id: string;
  start_at: Date;
  status: AppointmentStatus;
  consumer_name: string;
  service_name: string | null;
  duration_minutes: number | null;
}

@Injectable()
export class MyAgendaService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly appointments: AppointmentsService,
  ) {}

  /** Prova o acesso de funcionário, no banco, nesta requisição. */
  async resolveStaffAccess(manager: EntityManager, userId: string, tenantId: string): Promise<StaffAccess> {
    const [linha] = await manager.query<
      {
        membership_id: string;
        role: EstablishmentRole;
        status: string;
        tenant_status: string;
        timezone: string;
        professional_id: string | null;
        professional_name: string | null;
        professional_active: boolean | null;
        permissions_confirmed: boolean;
        overrides: OverrideRow[];
      }[]
    >(
      `SELECT m.id AS membership_id, m.role, m.status, t.status::text AS tenant_status, t.timezone,
              m.permissions_confirmed_at IS NOT NULL AS permissions_confirmed,
              p.id AS professional_id, p.name AS professional_name, p.active AS professional_active,
              COALESCE((SELECT json_agg(json_build_object('permission', o.permission, 'mode', o.mode))
                FROM membership_permission_overrides o WHERE o.tenant_id = m.tenant_id AND o.membership_id = m.id),
                '[]'::json) AS overrides
         FROM memberships m
         JOIN tenants t ON t.id = m.tenant_id
         LEFT JOIN professionals p ON p.tenant_id = m.tenant_id AND p.id = m.professional_id
        WHERE m.user_id = $1 AND m.tenant_id = $2`,
      [userId, tenantId],
    );
    if (!linha || !isOperational(linha.tenant_status)) throw new NotFoundException(TENANT_NOT_FOUND_MESSAGE);
    if (linha.status !== 'ACTIVE') throw new ForbiddenException(MEMBERSHIP_SUSPENDED_MESSAGE);
    if (!canViewOwnAgenda(linha.role, linha.permissions_confirmed)) {
      throw new ForbiddenException(OWN_AGENDA_FORBIDDEN_MESSAGE);
    }
    if (!linha.professional_id || !linha.professional_active) {
      throw new ForbiddenException(PROFESSIONAL_INACTIVE_MESSAGE);
    }
    const valem = effectiveOverrides(linha.role, linha.permissions_confirmed, linha.overrides);
    const allowed = Object.fromEntries(
      STAFF_ACTIONS.map((acao) => [
        acao,
        staffPermissionGranted(linha.role, valem, STAFF_PERMISSION_OF_ACTION[acao]),
      ]),
    ) as Record<StaffAction, boolean>;
    return {
      tenantId,
      membershipId: linha.membership_id,
      professional: { id: linha.professional_id, name: linha.professional_name ?? '' },
      timezone: linha.timezone,
      allowed,
    };
  }

  async day(userId: string, tenantId: string, query: MyAgendaQuery, now = new Date()) {
    return this.dataSource.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');
      const acesso = await this.resolveStaffAccess(manager, userId, tenantId);
      const [year, month, day] = query.date.split('-').map(Number);
      const janela = janelaDeCarregamento({ year, month, day });
      const linhas = await manager.query<OwnAppointmentRow[]>(
        `SELECT a.id, a.start_at, a.status, a.consumer_name_snapshot AS consumer_name,
                s.name AS service_name, i.duration_minutes_snapshot AS duration_minutes
           FROM appointments a
           LEFT JOIN LATERAL (
             SELECT service_id, duration_minutes_snapshot FROM appointment_items
              WHERE tenant_id = a.tenant_id AND appointment_id = a.id ORDER BY position LIMIT 1
           ) i ON true
           LEFT JOIN services s ON s.tenant_id = a.tenant_id AND s.id = i.service_id
          WHERE a.tenant_id = $1 AND a.professional_id = $2 AND a.start_at < $3 AND a.end_at > $4
          ORDER BY a.start_at, a.id LIMIT ${LIMITE_DO_DIA}`,
        [acesso.tenantId, acesso.professional.id, janela.fim, janela.inicio],
      );
      const doDia = linhas.filter((l) => dataLocalDe(new Date(l.start_at), acesso.timezone) === query.date);
      return {
        professional: acesso.professional,
        timezone: acesso.timezone,
        date: query.date,
        permissions: acesso.allowed,
        appointments: doDia.map((l) => this.toView(l, acesso, now)),
        complete: linhas.length < LIMITE_DO_DIA,
      };
    });
  }

  /** Calendário do funcionário: o mesmo recorte e a mesma forma do dia, por
   * um período (no máximo 42 dias, ver `ownAgendaPeriodSchema`). Só do
   * profissional do vínculo, nunca de colegas. */
  async range(userId: string, tenantId: string, query: OwnAgendaPeriodDto, now = new Date()) {
    return this.dataSource.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');
      const acesso = await this.resolveStaffAccess(manager, userId, tenantId);
      const inicio = janelaDeCarregamento(dataLocalDaString(query.from)).inicio;
      const fim = janelaDeCarregamento(dataLocalDaString(query.to)).fim;
      const linhas = await manager.query<OwnAppointmentRow[]>(
        `SELECT a.id, a.start_at, a.status, a.consumer_name_snapshot AS consumer_name,
                s.name AS service_name, i.duration_minutes_snapshot AS duration_minutes
           FROM appointments a
           LEFT JOIN LATERAL (
             SELECT service_id, duration_minutes_snapshot FROM appointment_items
              WHERE tenant_id = a.tenant_id AND appointment_id = a.id ORDER BY position LIMIT 1
           ) i ON true
           LEFT JOIN services s ON s.tenant_id = a.tenant_id AND s.id = i.service_id
          WHERE a.tenant_id = $1 AND a.professional_id = $2 AND a.start_at < $3 AND a.end_at > $4
          ORDER BY a.start_at, a.id LIMIT ${LIMITE_DO_PERIODO}`,
        [acesso.tenantId, acesso.professional.id, fim, inicio],
      );
      const doPeriodo = linhas.filter((l) => {
        const data = dataLocalDe(new Date(l.start_at), acesso.timezone);
        return data >= query.from && data <= query.to;
      });
      return {
        professional: acesso.professional,
        timezone: acesso.timezone,
        from: query.from,
        to: query.to,
        permissions: acesso.allowed,
        appointments: doPeriodo.map((l) => this.toView(l, acesso, now)),
        complete: linhas.length < LIMITE_DO_PERIODO,
      };
    });
  }

  async changeOwnStatus(
    userId: string,
    tenantId: string,
    appointmentId: string,
    acao: StaffAction,
    dto: OwnStatusActionDto,
  ): Promise<OwnAppointmentView> {
    const acesso = await this.resolveStaffAccess(this.dataSource.manager, userId, tenantId);
    if (!acesso.allowed[acao]) throw new ForbiddenException(STAFF_ACTION_FORBIDDEN_MESSAGE);
    // Mesmas regras de estado, horário e `expectedStartAt` da agenda do dono;
    // a reserva só é encontrada se for deste profissional.
    await this.appointments.applyStatusChange(acesso.tenantId, appointmentId, acao, dto, userId, acesso.professional.id);
    const [linha] = await this.dataSource.manager.query<OwnAppointmentRow[]>(
      `SELECT a.id, a.start_at, a.status, a.consumer_name_snapshot AS consumer_name,
              s.name AS service_name, i.duration_minutes_snapshot AS duration_minutes
         FROM appointments a
         LEFT JOIN LATERAL (
           SELECT service_id, duration_minutes_snapshot FROM appointment_items
            WHERE tenant_id = a.tenant_id AND appointment_id = a.id ORDER BY position LIMIT 1
         ) i ON true
         LEFT JOIN services s ON s.tenant_id = a.tenant_id AND s.id = i.service_id
        WHERE a.tenant_id = $1 AND a.professional_id = $2 AND a.id = $3`,
      [acesso.tenantId, acesso.professional.id, appointmentId],
    );
    return this.toView(linha, acesso, new Date());
  }

  private toView(linha: OwnAppointmentRow, acesso: StaffAccess, now: Date): OwnAppointmentView {
    const inicio = new Date(linha.start_at);
    const duracao = linha.duration_minutes ?? 0;
    const fim = new Date(inicio.getTime() + duracao * 60_000);
    return {
      id: linha.id,
      startAt: inicio.toISOString(),
      localDate: dataLocalDe(inicio, acesso.timezone),
      localStart: horaLocalDe(inicio, acesso.timezone),
      localServiceEnd: horaLocalDe(fim, acesso.timezone),
      durationMinutes: duracao,
      status: linha.status,
      service: { name: linha.service_name ?? '' },
      consumer: { name: linha.consumer_name },
      actions: STAFF_ACTIONS.filter(
        (acao) => acesso.allowed[acao] && transicaoPermitida(acao, linha.status, inicio, now),
      ),
    };
  }
}
