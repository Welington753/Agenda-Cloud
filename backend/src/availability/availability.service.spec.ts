// Autorização, isolamento e carregamento do `AvailabilityService` contra um
// `DataSource` falso, em memória — mesmo padrão de
// professionals.service.spec.ts e working-hours.service.spec.ts. O cálculo em
// si é provado em availability-rules.spec.ts, e a consulta real ao banco
// (sobreposição, tenant, evento que atravessa o dia) em
// test/availability-postgres.db-e2e-spec.ts.
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { FindOperator, type DataSource } from 'typeorm';
import { Appointment } from '../entities/appointment.entity.js';
import { BookingPolicy } from '../entities/booking-policy.entity.js';
import { AppointmentStatus } from '../entities/enums/appointment-status.enum.js';
import { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { Permission } from '../entities/enums/permission.enum.js';
import { PermissionMode } from '../entities/enums/permission-mode.enum.js';
import { TenantStatus } from '../entities/enums/tenant-status.enum.js';
import { Membership } from '../entities/membership.entity.js';
import { MembershipPermissionOverride } from '../entities/membership-permission-override.entity.js';
import { Professional } from '../entities/professional.entity.js';
import { ProfessionalSchedule } from '../entities/professional-schedule.entity.js';
import { ProfessionalService } from '../entities/professional-service.entity.js';
import { Service } from '../entities/service.entity.js';
import { Tenant } from '../entities/tenant.entity.js';
import { TimeBlock } from '../entities/time-block.entity.js';
import { AvailabilityService } from './availability.service.js';

interface Registro {
  [campo: string]: unknown;
}

const USUARIO_DONO = 'user_dono';
const TENANT_A = 'tenant_a';
const TENANT_B = 'tenant_b';
const PROF_A = 'prof_a';
const PROF_B = 'prof_b';
const SERVICO_A = 'servico_a';
const SERVICO_B = 'servico_b';
/** Domingo, 20/09/2026 — a jornada de teste é cadastrada em weekday 0. */
const DATA = '2026-09-20';
const AGORA = new Date('2026-09-19T12:00:00Z');

class FakeManager {
  constructor(private readonly colecoes: Map<unknown, Registro[]>) {}

  private colecaoDe(entity: unknown): Registro[] {
    const colecao = this.colecoes.get(entity);
    if (!colecao) throw new Error('Entidade inesperada no teste');
    return colecao;
  }

  /** Reproduz o pouco de `where` que o serviço usa: igualdade, `In`,
   * `LessThan` e `MoreThan`. */
  private casa(linha: Registro, where: Registro): boolean {
    return Object.entries(where).every(([campo, esperado]) => {
      const valor = linha[campo];
      if (!(esperado instanceof FindOperator)) return valor === esperado;

      const alvo = esperado.value as unknown;
      switch (esperado.type) {
        case 'in':
          return (alvo as unknown[]).includes(valor);
        case 'lessThan':
          return (valor as Date).getTime() < (alvo as Date).getTime();
        case 'moreThan':
          return (valor as Date).getTime() > (alvo as Date).getTime();
        default:
          throw new Error(`Operador não suportado no teste: ${esperado.type}`);
      }
    });
  }

  findOne(entity: unknown, options: { where: Registro }): Promise<Registro | null> {
    return Promise.resolve(this.colecaoDe(entity).find((l) => this.casa(l, options.where)) ?? null);
  }

  find(entity: unknown, options: { where: Registro }): Promise<Registro[]> {
    return Promise.resolve(this.colecaoDe(entity).filter((l) => this.casa(l, options.where)));
  }
}

interface Opcoes {
  role?: EstablishmentRole;
  semMembership?: boolean;
  statusTenant?: TenantStatus;
  overrides?: Registro[];
  professionais?: Registro[];
  servicos?: Registro[];
  vinculos?: Registro[];
  horarios?: Registro[];
  agendamentos?: Registro[];
  bloqueios?: Registro[];
  politicas?: Registro[];
  timezone?: string;
}

function montar(opcoes: Opcoes = {}) {
  const colecoes = new Map<unknown, Registro[]>([
    [
      Tenant,
      [
        {
          id: TENANT_A,
          status: opcoes.statusTenant ?? TenantStatus.ACTIVE,
          timezone: opcoes.timezone ?? 'America/Sao_Paulo',
        },
        { id: TENANT_B, status: TenantStatus.ACTIVE, timezone: 'America/Sao_Paulo' },
      ],
    ],
    [
      Membership,
      opcoes.semMembership
        ? []
        : [
            {
              id: 'membership_a',
              userId: USUARIO_DONO,
              tenantId: TENANT_A,
              role: opcoes.role ?? EstablishmentRole.DONO,
            },
          ],
    ],
    [MembershipPermissionOverride, opcoes.overrides ?? []],
    [
      Professional,
      opcoes.professionais ?? [
        { id: PROF_A, tenantId: TENANT_A, active: true },
        { id: PROF_B, tenantId: TENANT_B, active: true },
      ],
    ],
    [
      Service,
      opcoes.servicos ?? [
        {
          id: SERVICO_A,
          tenantId: TENANT_A,
          active: true,
          durationMinutes: 60,
          bufferAfterMinutes: 0,
        },
        {
          id: SERVICO_B,
          tenantId: TENANT_B,
          active: true,
          durationMinutes: 60,
          bufferAfterMinutes: 0,
        },
      ],
    ],
    [
      ProfessionalService,
      opcoes.vinculos ?? [
        { id: 'link_a', tenantId: TENANT_A, professionalId: PROF_A, serviceId: SERVICO_A },
      ],
    ],
    [
      ProfessionalSchedule,
      opcoes.horarios ?? [
        {
          id: 'schedule_a',
          tenantId: TENANT_A,
          professionalId: PROF_A,
          weekday: 0,
          active: true,
          startTime: '09:00',
          endTime: '12:00',
          lunchStart: undefined,
          lunchEnd: undefined,
        },
      ],
    ],
    [Appointment, opcoes.agendamentos ?? []],
    [TimeBlock, opcoes.bloqueios ?? []],
    [BookingPolicy, opcoes.politicas ?? []],
  ]);

  const manager = new FakeManager(colecoes);
  const dataSource = { manager } as unknown as DataSource;
  return new AvailabilityService(dataSource, () => AGORA);
}

function consultar(
  servico: AvailabilityService,
  sobrescreve: { tenantId?: string; professionalId?: string; serviceId?: string; date?: string } = {},
) {
  return servico.consult(
    USUARIO_DONO,
    sobrescreve.tenantId ?? TENANT_A,
    sobrescreve.professionalId ?? PROF_A,
    { serviceId: sobrescreve.serviceId ?? SERVICO_A, date: sobrescreve.date ?? DATA },
  );
}

describe('AvailabilityService.consult — autorização', () => {
  it('sem vínculo com o estabelecimento é 404, nunca 403', async () => {
    await expect(consultar(montar({ semMembership: true }))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('tenant inativo é 404 — a existência dele não é confirmada', async () => {
    await expect(
      consultar(montar({ statusTenant: TenantStatus.SUSPENDED })),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('papel sem acesso é 403', async () => {
    await expect(consultar(montar({ role: EstablishmentRole.RECEPCIONISTA }))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it.each([
    Permission.AGENDA_VISUALIZAR,
    Permission.PROFISSIONAIS_VISUALIZAR,
    Permission.SERVICOS_VISUALIZAR,
  ])('DENIED em %s barra o DONO', async (permission) => {
    const servico = montar({
      overrides: [
        { tenantId: TENANT_A, membershipId: 'membership_a', permission, mode: PermissionMode.DENIED },
      ],
    });

    await expect(consultar(servico)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('AvailabilityService.consult — isolamento', () => {
  it('profissional de outro estabelecimento não é encontrado', async () => {
    await expect(consultar(montar(), { professionalId: PROF_B })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('serviço de outro estabelecimento não é encontrado', async () => {
    await expect(consultar(montar(), { serviceId: SERVICO_B })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('consultar pelo tenant alheio é 404 mesmo com sessão válida', async () => {
    await expect(consultar(montar(), { tenantId: TENANT_B })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('AvailabilityService.consult — elegibilidade', () => {
  it('sem vínculo profissional/serviço, recusa em vez de devolver lista vazia', async () => {
    await expect(consultar(montar({ vinculos: [] }))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('profissional desativado recusa', async () => {
    const servico = montar({ professionais: [{ id: PROF_A, tenantId: TENANT_A, active: false }] });
    await expect(consultar(servico)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('serviço desativado recusa', async () => {
    const servico = montar({
      servicos: [
        {
          id: SERVICO_A,
          tenantId: TENANT_A,
          active: false,
          durationMinutes: 60,
          bufferAfterMinutes: 0,
        },
      ],
    });
    await expect(consultar(servico)).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([0, -30])('duração %i é recusada, nunca vira lista vazia', async (durationMinutes) => {
    const servico = montar({
      servicos: [
        { id: SERVICO_A, tenantId: TENANT_A, active: true, durationMinutes, bufferAfterMinutes: 0 },
      ],
    });
    await expect(consultar(servico)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('fuso inválido no estabelecimento é erro explícito', async () => {
    await expect(consultar(montar({ timezone: 'Marte/Olympus' }))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('AvailabilityService.consult — resposta', () => {
  it('devolve os horários, o fuso e as regras aplicadas', async () => {
    const resposta = await consultar(montar());

    expect(resposta.timezone).toBe('America/Sao_Paulo');
    expect(resposta.date).toBe(DATA);
    expect(resposta.durationMinutes).toBe(60);
    expect(resposta.slotStepMinutes).toBe(15);
    expect(resposta.slots.map((s) => s.localStart)).toEqual([
      '09:00',
      '09:15',
      '09:30',
      '09:45',
      '10:00',
      '10:15',
      '10:30',
      '10:45',
      '11:00',
    ]);
    expect(resposta.slots[0].startAt).toBe('2026-09-20T12:00:00.000Z');
    expect(resposta.emptyReason).toBeNull();
  });

  it('nenhum campo de cliente aparece na resposta', async () => {
    const servico = montar({
      agendamentos: [
        {
          id: 'ag_1',
          tenantId: TENANT_A,
          professionalId: PROF_A,
          status: AppointmentStatus.CONFIRMED,
          startAt: new Date('2026-09-20T12:00:00Z'),
          endAt: new Date('2026-09-20T13:00:00Z'),
          consumerNameSnapshot: 'Fulano de Tal',
          consumerWhatsappSnapshot: '11999998888',
          notes: 'observação privada',
        },
      ],
    });

    const resposta = await consultar(servico);
    const serializada = JSON.stringify(resposta);

    expect(serializada).not.toContain('Fulano');
    expect(serializada).not.toContain('11999998888');
    expect(serializada).not.toContain('observação privada');
    expect(resposta.slots.map((s) => s.localStart)).not.toContain('09:00');
  });

  it('sem jornada no dia, a lista vazia tem motivo próprio', async () => {
    const resposta = await consultar(montar({ horarios: [] }));

    expect(resposta.slots).toEqual([]);
    expect(resposta.emptyReason).toBe('sem_jornada');
  });

  it('linha de jornada inativa conta como dia sem atendimento', async () => {
    const servico = montar({
      horarios: [
        {
          id: 'schedule_a',
          tenantId: TENANT_A,
          professionalId: PROF_A,
          weekday: 0,
          active: false,
          startTime: '09:00',
          endTime: '18:00',
        },
      ],
    });

    expect((await consultar(servico)).emptyReason).toBe('sem_jornada');
  });

  it('a pausa gravada vira dois turnos, com a mesma leitura do Lote 6D.3', async () => {
    const servico = montar({
      horarios: [
        {
          id: 'schedule_a',
          tenantId: TENANT_A,
          professionalId: PROF_A,
          weekday: 0,
          active: true,
          startTime: '09:00',
          endTime: '15:00',
          lunchStart: '12:00',
          lunchEnd: '14:00',
        },
      ],
    });

    const horas = (await consultar(servico)).slots.map((s) => s.localStart);
    expect(horas).toContain('11:00');
    expect(horas).not.toContain('11:15');
    expect(horas).toContain('14:00');
  });

  it.each([AppointmentStatus.CANCELED, AppointmentStatus.NO_SHOW])(
    '%s libera o horário',
    async (status) => {
      const servico = montar({
        agendamentos: [
          {
            id: 'ag_1',
            tenantId: TENANT_A,
            professionalId: PROF_A,
            status,
            startAt: new Date('2026-09-20T12:00:00Z'),
            endAt: new Date('2026-09-20T13:00:00Z'),
          },
        ],
      });

      expect((await consultar(servico)).slots.map((s) => s.localStart)).toContain('09:00');
    },
  );

  it.each([
    AppointmentStatus.PENDING,
    AppointmentStatus.CONFIRMED,
    AppointmentStatus.IN_PROGRESS,
    AppointmentStatus.COMPLETED,
  ])('%s ocupa o horário', async (status) => {
    const servico = montar({
      agendamentos: [
        {
          id: 'ag_1',
          tenantId: TENANT_A,
          professionalId: PROF_A,
          status,
          startAt: new Date('2026-09-20T12:00:00Z'),
          endAt: new Date('2026-09-20T13:00:00Z'),
        },
      ],
    });

    expect((await consultar(servico)).slots.map((s) => s.localStart)).not.toContain('09:00');
  });

  it('agendamento de OUTRO profissional não ocupa', async () => {
    const servico = montar({
      professionais: [
        { id: PROF_A, tenantId: TENANT_A, active: true },
        { id: 'prof_a2', tenantId: TENANT_A, active: true },
      ],
      agendamentos: [
        {
          id: 'ag_1',
          tenantId: TENANT_A,
          professionalId: 'prof_a2',
          status: AppointmentStatus.CONFIRMED,
          startAt: new Date('2026-09-20T12:00:00Z'),
          endAt: new Date('2026-09-20T13:00:00Z'),
        },
      ],
    });

    expect((await consultar(servico)).slots.map((s) => s.localStart)).toContain('09:00');
  });

  it('bloqueio ocupa', async () => {
    const servico = montar({
      bloqueios: [
        {
          id: 'bl_1',
          tenantId: TENANT_A,
          professionalId: PROF_A,
          startAt: new Date('2026-09-20T12:00:00Z'),
          endAt: new Date('2026-09-20T13:00:00Z'),
        },
      ],
    });

    expect((await consultar(servico)).slots.map((s) => s.localStart)).not.toContain('09:00');
  });

  it('sem booking_policies, nenhuma antecedência ou limite futuro é inventado', async () => {
    const resposta = await consultar(montar());

    expect(resposta.minLeadMinutes).toBeNull();
    expect(resposta.maxFutureDays).toBeNull();
  });

  it('com booking_policies, antecedência e limite futuro são aplicados e informados', async () => {
    const servico = montar({
      politicas: [
        {
          id: 'policy_a',
          tenantId: TENANT_A,
          minLeadMinutes: 60,
          maxFutureDays: 0,
          defaultBufferMinutes: 30,
        },
      ],
    });

    const resposta = await consultar(servico);

    expect(resposta.minLeadMinutes).toBe(60);
    expect(resposta.maxFutureDays).toBe(0);
    // 20/09 está além de "hoje" (19/09) com limite 0.
    expect(resposta.emptyReason).toBe('fora_da_janela_futura');
    // `defaultBufferMinutes` da política NÃO é aplicado (ver
    // availability-rules.ts): o buffer é o do serviço.
    expect(resposta.bufferAfterMinutes).toBe(0);
  });
});
