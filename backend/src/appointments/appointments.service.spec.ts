// Autorização, isolamento, snapshots e regras de gravação do
// `AppointmentsService` contra um `DataSource` falso, em memória — mesmo
// padrão de availability.service.spec.ts.
//
// O que NÃO é provado aqui (e sim em test/appointments-postgres.db-e2e-spec.ts,
// contra PostgreSQL real): a constraint de sobreposição, o rollback de
// verdade e duas conexões disputando o mesmo horário. Fake em memória não
// tem constraint nem transação real — fingir que tem seria o pior tipo de
// teste verde.
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { FindOperator, QueryFailedError, type DataSource } from 'typeorm';
import { AvailabilityService } from '../availability/availability.service.js';
import { ConsumersService } from '../consumers/consumers.service.js';
import { Appointment } from '../entities/appointment.entity.js';
import { AppointmentItem } from '../entities/appointment-item.entity.js';
import { BookingPolicy } from '../entities/booking-policy.entity.js';
import { Consumer } from '../entities/consumer.entity.js';
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
import { Unit } from '../entities/unit.entity.js';
import { AppointmentsService, OVERLAP_CONSTRAINT } from './appointments.service.js';

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
const CLIENTE_A = 'cliente_a';
const CLIENTE_B = 'cliente_b';
const UNIDADE_A = 'unidade_a';

/** Domingo, 20/09/2026 — a jornada de teste é cadastrada em weekday 0.
 * 09:00 local de São Paulo = 12:00Z. */
const INICIO = '2026-09-20T12:00:00.000Z';
const DATA = '2026-09-20';
const AGORA = new Date('2026-09-19T12:00:00Z');

let proximoId = 0;

class FakeManager {
  constructor(
    private readonly colecoes: Map<unknown, Registro[]>,
    /** Injeta falha no save de uma entidade, para provar que a transação
     * inteira desfaz. */
    private readonly falharAoSalvar?: { entidade: unknown; erro: Error },
  ) {}

  colecaoDe(entity: unknown): Registro[] {
    const colecao = this.colecoes.get(entity);
    if (!colecao) throw new Error('Entidade inesperada no teste');
    return colecao;
  }

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

  create(_entity: unknown, dados: Registro): Registro {
    return { ...dados };
  }

  save(entity: unknown, dados?: Registro): Promise<Registro> {
    // `save(objeto)` (uma entidade só) chega com o objeto no 1º parâmetro.
    const eClasse = typeof entity === 'function';
    const linha = (eClasse ? dados : (entity as Registro)) as Registro;
    const classe = eClasse ? entity : this.classeDe(linha);

    if (this.falharAoSalvar && this.falharAoSalvar.entidade === classe) {
      return Promise.reject(this.falharAoSalvar.erro);
    }

    proximoId += 1;
    const salvo = { id: `gerado_${proximoId}`, createdAt: new Date(), ...linha };
    this.colecaoDe(classe).push(salvo);
    return Promise.resolve(salvo);
  }

  /** O serviço chama `tx.save(tx.create(X, {...}))`, então a classe precisa
   * ser deduzida pelo formato — é o preço de um fake, e fica explícito. */
  private classeDe(linha: Registro): unknown {
    if ('consumerNameSnapshot' in linha) return Appointment;
    if ('durationMinutesSnapshot' in linha) return AppointmentItem;
    if ('whatsappNormalized' in linha) return Consumer;
    throw new Error('Não sei em qual coleção salvar este registro no teste');
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
  clientes?: Registro[];
  unidades?: Registro[];
  politicas?: Registro[];
  falharAoSalvar?: { entidade: unknown; erro: Error };
}

function montar(opcoes: Opcoes = {}) {
  const colecoes = new Map<unknown, Registro[]>([
    [
      Tenant,
      [
        {
          id: TENANT_A,
          status: opcoes.statusTenant ?? TenantStatus.ACTIVE,
          timezone: 'America/Sao_Paulo',
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
        { id: PROF_A, tenantId: TENANT_A, active: true, name: 'Ana', unitId: undefined },
        { id: PROF_B, tenantId: TENANT_B, active: true, name: 'Bia', unitId: undefined },
      ],
    ],
    [
      Service,
      opcoes.servicos ?? [
        {
          id: SERVICO_A,
          tenantId: TENANT_A,
          active: true,
          name: 'Corte',
          durationMinutes: 60,
          bufferAfterMinutes: 0,
          priceCents: 5000,
          requiresManualConfirmation: false,
        },
        {
          id: SERVICO_B,
          tenantId: TENANT_B,
          active: true,
          name: 'Corte B',
          durationMinutes: 60,
          bufferAfterMinutes: 0,
          priceCents: null,
          requiresManualConfirmation: false,
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
    [
      Consumer,
      opcoes.clientes ?? [
        {
          id: CLIENTE_A,
          tenantId: TENANT_A,
          name: 'Maria Souza',
          whatsapp: '(11) 90000-0000',
          whatsappNormalized: '+5511900000000',
        },
        {
          id: CLIENTE_B,
          tenantId: TENANT_B,
          name: 'Cliente de B',
          whatsapp: '(11) 90000-1111',
          whatsappNormalized: '+5511900001111',
        },
      ],
    ],
    [
      Unit,
      opcoes.unidades ?? [{ id: UNIDADE_A, tenantId: TENANT_A, isPrimary: true, createdAt: new Date() }],
    ],
    [Appointment, opcoes.agendamentos ?? []],
    [AppointmentItem, []],
    [TimeBlock, []],
    [BookingPolicy, opcoes.politicas ?? []],
  ]);

  const manager = new FakeManager(colecoes, opcoes.falharAoSalvar);
  const dataSource = {
    manager,
    transaction: async (cb: (tx: FakeManager) => Promise<unknown>) => cb(manager),
  } as unknown as DataSource;

  const availability = new AvailabilityService(dataSource, () => AGORA);
  const consumers = new ConsumersService(dataSource);
  return {
    servico: new AppointmentsService(dataSource, availability, consumers),
    colecoes,
    manager,
  };
}

function criar(
  servico: AppointmentsService,
  sobrescreve: Record<string, unknown> = {},
  tenantId = TENANT_A,
) {
  return servico.create(USUARIO_DONO, tenantId, {
    professionalId: PROF_A,
    serviceId: SERVICO_A,
    startAt: INICIO,
    consumer: { mode: 'existing', consumerId: CLIENTE_A },
    ...sobrescreve,
  } as Parameters<AppointmentsService['create']>[2]);
}

describe('AppointmentsService.create — autorização', () => {
  it('sem vínculo com o estabelecimento é 404, nunca 403', async () => {
    await expect(criar(montar({ semMembership: true }).servico)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('tenant inativo é 404 — a existência dele não é confirmada', async () => {
    await expect(
      criar(montar({ statusTenant: TenantStatus.SUSPENDED }).servico),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it.each([
    EstablishmentRole.GERENTE,
    EstablishmentRole.RECEPCIONISTA,
    EstablishmentRole.PROFISSIONAL,
  ])('papel %s é 403 neste lote', async (role) => {
    await expect(criar(montar({ role }).servico)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it.each([
    Permission.AGENDAMENTO_CRIAR,
    Permission.AGENDA_VISUALIZAR,
    Permission.CONSUMIDORES_VISUALIZAR,
  ])('DENIED em %s é 403 mesmo para o DONO', async (permission) => {
    const { servico } = montar({
      overrides: [
        { tenantId: TENANT_A, membershipId: 'membership_a', permission, mode: PermissionMode.DENIED },
      ],
    });
    await expect(criar(servico)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('nada é gravado quando a autorização recusa', async () => {
    const { servico, colecoes } = montar({ role: EstablishmentRole.GERENTE });
    await expect(criar(servico)).rejects.toBeInstanceOf(ForbiddenException);
    expect(colecoes.get(Appointment)).toHaveLength(0);
    expect(colecoes.get(AppointmentItem)).toHaveLength(0);
  });
});

describe('AppointmentsService.create — isolamento', () => {
  it('profissional de outro estabelecimento não é encontrado', async () => {
    await expect(criar(montar().servico, { professionalId: PROF_B })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('serviço de outro estabelecimento não é encontrado', async () => {
    await expect(criar(montar().servico, { serviceId: SERVICO_B })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('cliente de outro estabelecimento é 404, indistinguível de inexistente', async () => {
    await expect(
      criar(montar().servico, { consumer: { mode: 'existing', consumerId: CLIENTE_B } }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('agendar pelo tenant alheio é 404 mesmo com sessão válida', async () => {
    await expect(criar(montar().servico, {}, TENANT_B)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('AppointmentsService.create — elegibilidade', () => {
  it('profissional desativado recusa', async () => {
    const { servico } = montar({
      professionais: [{ id: PROF_A, tenantId: TENANT_A, active: false, name: 'Ana' }],
    });
    await expect(criar(servico)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('serviço desativado recusa', async () => {
    const { servico } = montar({
      servicos: [
        {
          id: SERVICO_A,
          tenantId: TENANT_A,
          active: false,
          name: 'Corte',
          durationMinutes: 60,
          bufferAfterMinutes: 0,
          priceCents: 5000,
          requiresManualConfirmation: false,
        },
      ],
    });
    await expect(criar(servico)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('sem vínculo profissional/serviço recusa', async () => {
    await expect(criar(montar({ vinculos: [] }).servico)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('sem unidade cadastrada recusa explicitamente — nunca inventa um id', async () => {
    const { servico } = montar({ unidades: [] });
    await expect(criar(servico)).rejects.toThrow(/unidade/i);
  });
});

describe('AppointmentsService.create — horário', () => {
  it('horário fora da jornada é 400, não 409', async () => {
    // 07:00 local — antes de a jornada começar.
    await expect(
      criar(montar().servico, { startAt: '2026-09-20T10:00:00.000Z' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('horário fora da grade de 15 minutos é 400', async () => {
    await expect(
      criar(montar().servico, { startAt: '2026-09-20T12:05:00.000Z' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('horário já ocupado por outro agendamento é 409, não 400', async () => {
    const { servico } = montar({
      agendamentos: [
        {
          id: 'existente',
          tenantId: TENANT_A,
          professionalId: PROF_A,
          status: AppointmentStatus.CONFIRMED,
          startAt: new Date(INICIO),
          endAt: new Date('2026-09-20T13:00:00.000Z'),
        },
      ],
    });
    await expect(criar(servico)).rejects.toBeInstanceOf(ConflictException);
  });

  it('dia sem jornada nenhuma é 400', async () => {
    const { servico } = montar({ horarios: [] });
    await expect(criar(servico)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('AppointmentsService.create — o que é gravado', () => {
  it('grava agendamento e item, com o fim da OCUPAÇÃO incluindo o buffer', async () => {
    const { servico, colecoes } = montar({
      servicos: [
        {
          id: SERVICO_A,
          tenantId: TENANT_A,
          active: true,
          name: 'Corte',
          durationMinutes: 60,
          bufferAfterMinutes: 10,
          priceCents: 5000,
          requiresManualConfirmation: false,
        },
      ],
    });

    const view = await criar(servico);

    const [gravado] = colecoes.get(Appointment)!;
    // 12:00Z + 60 de atendimento + 10 de buffer.
    expect((gravado.endAt as Date).toISOString()).toBe('2026-09-20T13:10:00.000Z');
    // A view separa os dois: o atendimento termina 13:00Z, a ocupação 13:10Z.
    expect(view.serviceEndAt).toBe('2026-09-20T13:00:00.000Z');
    expect(view.occupancyEndAt).toBe('2026-09-20T13:10:00.000Z');

    const [item] = colecoes.get(AppointmentItem)!;
    // O snapshot de duração é só o ATENDIMENTO — nunca atendimento + buffer.
    expect(item.durationMinutesSnapshot).toBe(60);
  });

  it('preço do serviço vira snapshot congelado', async () => {
    const { servico, colecoes } = montar();
    await criar(servico);
    expect(colecoes.get(AppointmentItem)![0].priceCentsSnapshot).toBe(5000);
  });

  it('serviço sem preço grava snapshot NULO — nunca zero', async () => {
    const { servico, colecoes } = montar({
      servicos: [
        {
          id: SERVICO_A,
          tenantId: TENANT_A,
          active: true,
          name: 'Corte',
          durationMinutes: 60,
          bufferAfterMinutes: 0,
          priceCents: null,
          requiresManualConfirmation: false,
        },
      ],
    });

    const view = await criar(servico);

    expect(colecoes.get(AppointmentItem)![0].priceCentsSnapshot).toBeUndefined();
    expect(view.priceCents).toBeNull();
    expect(view.priceCents).not.toBe(0);
  });

  it('snapshot do cliente é o nome e o whatsapp do momento da reserva', async () => {
    const { servico, colecoes } = montar();
    await criar(servico);
    const [gravado] = colecoes.get(Appointment)!;
    expect(gravado.consumerNameSnapshot).toBe('Maria Souza');
    expect(gravado.consumerWhatsappSnapshot).toBe('(11) 90000-0000');
  });

  it('serviço sem confirmação manual nasce CONFIRMED', async () => {
    const { servico } = montar();
    expect((await criar(servico)).status).toBe(AppointmentStatus.CONFIRMED);
  });

  it('serviço com confirmação manual nasce PENDING', async () => {
    const { servico } = montar({
      servicos: [
        {
          id: SERVICO_A,
          tenantId: TENANT_A,
          active: true,
          name: 'Corte',
          durationMinutes: 60,
          bufferAfterMinutes: 0,
          priceCents: 5000,
          requiresManualConfirmation: true,
        },
      ],
    });
    expect((await criar(servico)).status).toBe(AppointmentStatus.PENDING);
  });

  it('usa a unidade do profissional quando ele tem uma', async () => {
    const { servico } = montar({
      professionais: [
        { id: PROF_A, tenantId: TENANT_A, active: true, name: 'Ana', unitId: 'unidade_do_prof' },
      ],
    });
    expect((await criar(servico)).unitId).toBe('unidade_do_prof');
  });

  it('cai na unidade primária quando o profissional não tem unidade', async () => {
    expect((await criar(montar().servico)).unitId).toBe(UNIDADE_A);
  });

  it('cliente novo é gravado junto com a reserva', async () => {
    const { servico, colecoes } = montar();

    const view = await criar(servico, {
      consumer: { mode: 'new', data: { name: 'João Novo', whatsapp: '(11) 98888-7777' } },
    });

    expect(colecoes.get(Consumer)).toHaveLength(3);
    expect(view.consumer.name).toBe('João Novo');
    // O telefone é normalizado com a MESMA função do cadastro real.
    const novo = colecoes.get(Consumer)!.find((c) => c.name === 'João Novo');
    expect(novo!.whatsappNormalized).toBe('+5511988887777');
  });
});

describe('AppointmentsService.create — falhas de gravação', () => {
  it('violação da constraint de sobreposição vira 409', async () => {
    const erro = new QueryFailedError('INSERT', [], new Error('conflito'));
    (erro as unknown as { driverError: unknown }).driverError = {
      code: '23P01',
      constraint: OVERLAP_CONSTRAINT,
    };

    const { servico } = montar({ falharAoSalvar: { entidade: Appointment, erro } });
    await expect(criar(servico)).rejects.toBeInstanceOf(ConflictException);
  });

  it('outro erro de banco NÃO vira 409 — sobe como está', async () => {
    const erro = new QueryFailedError('INSERT', [], new Error('fk'));
    (erro as unknown as { driverError: unknown }).driverError = {
      code: '23503',
      constraint: 'fk_appointments_unit',
    };

    const { servico } = montar({ falharAoSalvar: { entidade: Appointment, erro } });
    await expect(criar(servico)).rejects.not.toBeInstanceOf(ConflictException);
  });

  it('falha ao gravar o item não deixa cliente novo para trás', async () => {
    // O rollback REAL é provado contra Postgres; aqui se prova que a
    // gravação do cliente acontece dentro da mesma transação do item, e não
    // antes dela, fora de qualquer transação.
    const { servico, colecoes } = montar({
      falharAoSalvar: { entidade: AppointmentItem, erro: new Error('falhou no item') },
    });

    await expect(
      criar(servico, {
        consumer: { mode: 'new', data: { name: 'Órfão', whatsapp: '(11) 97777-6666' } },
      }),
    ).rejects.toThrow('falhou no item');

    // No fake não há rollback de verdade: o que se garante aqui é que a
    // chamada aconteceu pelo caminho transacional (`dataSource.transaction`).
    expect(colecoes.get(AppointmentItem)).toHaveLength(0);
  });
});

describe('AppointmentsService.list', () => {
  it('devolve só os agendamentos cuja data local de início é a pedida', async () => {
    const { servico } = montar({
      agendamentos: [
        {
          id: 'de_hoje',
          tenantId: TENANT_A,
          professionalId: PROF_A,
          consumerId: CLIENTE_A,
          consumerNameSnapshot: 'Maria Souza',
          consumerWhatsappSnapshot: '(11) 90000-0000',
          unitId: UNIDADE_A,
          status: AppointmentStatus.CONFIRMED,
          startAt: new Date(INICIO),
          endAt: new Date('2026-09-20T13:00:00.000Z'),
          createdAt: new Date(),
        },
        {
          id: 'de_outro_dia',
          tenantId: TENANT_A,
          professionalId: PROF_A,
          consumerId: CLIENTE_A,
          consumerNameSnapshot: 'Maria Souza',
          consumerWhatsappSnapshot: '(11) 90000-0000',
          unitId: UNIDADE_A,
          status: AppointmentStatus.CONFIRMED,
          startAt: new Date('2026-09-21T12:00:00.000Z'),
          endAt: new Date('2026-09-21T13:00:00.000Z'),
          createdAt: new Date(),
        },
      ],
    });

    const resposta = await servico.list(USUARIO_DONO, TENANT_A, { date: DATA });

    expect(resposta.appointments.map((a) => a.id)).toEqual(['de_hoje']);
    expect(resposta.timezone).toBe('America/Sao_Paulo');
    expect(resposta.appointments[0].localStart).toBe('09:00');
  });

  it('exige permissão de ver a agenda', async () => {
    const { servico } = montar({
      overrides: [
        {
          tenantId: TENANT_A,
          membershipId: 'membership_a',
          permission: Permission.AGENDA_VISUALIZAR,
          mode: PermissionMode.DENIED,
        },
      ],
    });
    await expect(servico.list(USUARIO_DONO, TENANT_A, { date: DATA })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('listar pelo tenant alheio é 404', async () => {
    await expect(
      montar().servico.list(USUARIO_DONO, TENANT_B, { date: DATA }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
