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
import { AppointmentStatusChange } from '../entities/appointment-status-change.entity.js';
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

  /** `tx.update(Entidade, where, patch)` — o cancelamento e a remarcação
   * escrevem assim, sempre pelas duas chaves (`id` + `tenantId`). O fake
   * aplica o patch nas linhas que casam e devolve quantas foram afetadas, o
   * que permite provar que uma linha de OUTRO tenant nunca é atingida. */
  update(entity: unknown, where: Registro, patch: Registro): Promise<{ affected: number }> {
    const atingidas = this.colecaoDe(entity).filter((linha) => this.casa(linha, where));
    for (const linha of atingidas) Object.assign(linha, patch);
    return Promise.resolve({ affected: atingidas.length });
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
    if ('toStatus' in linha) return AppointmentStatusChange;
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
  itens?: Registro[];
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
    [AppointmentItem, opcoes.itens ?? []],
    [AppointmentStatusChange, []],
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
    servico: new AppointmentsService(dataSource, availability, consumers, () => AGORA),
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

// ---------------------------------------------------------------------------
// Lote 6D.6 — cancelamento e remarcação.
//
// O que ESTES testes provam: autorização, isolamento por tenant, as regras de
// estado/janela, a idempotência do cancelamento, a preservação dos snapshots e
// que a remarcação não inventa transição de status. O que eles NÃO provam (e
// está em test/appointments-postgres.db-e2e-spec.ts, contra PostgreSQL real):
// a constraint de sobreposição, os locks `FOR UPDATE` e duas conexões
// disputando o mesmo horário — um fake em memória não tem nada disso.

const RESERVA = 'reserva_a';

/** Uma reserva CONFIRMED às 09:00 local (12:00Z) com item de 60 min, no dia da
 * jornada de teste. `AGORA` é 19/09, então ela está no futuro. */
function comReserva(extra: Opcoes = {}, sobrescreveReserva: Registro = {}) {
  return montar({
    agendamentos: [
      {
        id: RESERVA,
        tenantId: TENANT_A,
        unitId: UNIDADE_A,
        consumerId: CLIENTE_A,
        consumerNameSnapshot: 'Maria Souza',
        consumerWhatsappSnapshot: '(11) 90000-0000',
        professionalId: PROF_A,
        startAt: new Date(INICIO),
        endAt: new Date('2026-09-20T13:00:00.000Z'),
        status: AppointmentStatus.CONFIRMED,
        createdAt: new Date('2026-09-18T10:00:00Z'),
        ...sobrescreveReserva,
      },
    ],
    itens: [
      {
        id: 'item_a',
        tenantId: TENANT_A,
        appointmentId: RESERVA,
        serviceId: SERVICO_A,
        priceCentsSnapshot: 5000,
        durationMinutesSnapshot: 60,
        position: 0,
      },
    ],
    ...extra,
  });
}

const negar = (permission: Permission): Registro[] => [
  {
    tenantId: TENANT_A,
    membershipId: 'membership_a',
    permission,
    mode: PermissionMode.DENIED,
  },
];

/** Serviço de A com o catálogo alterado — para provar que snapshot não é
 * recalculado. */
function servicoAlterado(campos: Registro): Registro[] {
  return [
    {
      id: SERVICO_A,
      tenantId: TENANT_A,
      active: true,
      name: 'Corte',
      durationMinutes: 60,
      bufferAfterMinutes: 0,
      priceCents: 5000,
      requiresManualConfirmation: false,
      ...campos,
    },
  ];
}

describe('AppointmentsService.cancel', () => {
  it('grava CANCELED e a transição, na mesma operação', async () => {
    const { servico, colecoes } = comReserva();

    const view = await servico.cancel(USUARIO_DONO, TENANT_A, RESERVA);

    expect(view.status).toBe(AppointmentStatus.CANCELED);
    const transicoes = colecoes.get(AppointmentStatusChange) ?? [];
    expect(transicoes).toHaveLength(1);
    expect(transicoes[0]).toMatchObject({
      tenantId: TENANT_A,
      appointmentId: RESERVA,
      fromStatus: AppointmentStatus.CONFIRMED,
      toStatus: AppointmentStatus.CANCELED,
      // `changedBy` é o usuário autenticado, não um rótulo inventado.
      changedBy: USUARIO_DONO,
    });
  });

  it('repetir NÃO duplica o histórico e devolve o estado atual', async () => {
    const { servico, colecoes } = comReserva();

    await servico.cancel(USUARIO_DONO, TENANT_A, RESERVA);
    const segunda = await servico.cancel(USUARIO_DONO, TENANT_A, RESERVA);

    expect(segunda.status).toBe(AppointmentStatus.CANCELED);
    expect(colecoes.get(AppointmentStatusChange) ?? []).toHaveLength(1);
  });

  it('preserva o item da reserva — nada é apagado', async () => {
    const { servico, colecoes } = comReserva();

    await servico.cancel(USUARIO_DONO, TENANT_A, RESERVA);

    const itens = colecoes.get(AppointmentItem) ?? [];
    expect(itens).toHaveLength(1);
    expect(itens[0]).toMatchObject({ priceCentsSnapshot: 5000, durationMinutesSnapshot: 60 });
  });

  it('funciona com o serviço e o profissional DESATIVADOS depois da reserva', async () => {
    // É o caso que quebraria se o cancelamento passasse pelo motor de
    // disponibilidade: ele recusa serviço/profissional inativo com 400.
    const { servico } = comReserva({
      servicos: servicoAlterado({ active: false }),
      professionais: [
        { id: PROF_A, tenantId: TENANT_A, active: false, name: 'Ana', unitId: undefined },
      ],
    });

    const view = await servico.cancel(USUARIO_DONO, TENANT_A, RESERVA);
    expect(view.status).toBe(AppointmentStatus.CANCELED);
  });

  it.each([
    AppointmentStatus.IN_PROGRESS,
    AppointmentStatus.COMPLETED,
    AppointmentStatus.NO_SHOW,
  ])('%s não pode ser cancelado', async (status) => {
    const { servico } = comReserva({}, { status });
    await expect(servico.cancel(USUARIO_DONO, TENANT_A, RESERVA)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('reserva que já começou não pode ser cancelada', async () => {
    // `AGORA` é 19/09 12:00Z; esta começou 18/09.
    const { servico } = comReserva(
      {},
      {
        startAt: new Date('2026-09-18T12:00:00.000Z'),
        endAt: new Date('2026-09-18T13:00:00.000Z'),
      },
    );
    await expect(servico.cancel(USUARIO_DONO, TENANT_A, RESERVA)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('cancelar pelo tenant alheio é 404 — e nada é alterado', async () => {
    const { servico, colecoes } = comReserva();

    await expect(servico.cancel(USUARIO_DONO, TENANT_B, RESERVA)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect((colecoes.get(Appointment) ?? [])[0].status).toBe(AppointmentStatus.CONFIRMED);
  });

  it('DENIED em AGENDAMENTO_CANCELAR é 403', async () => {
    const { servico } = comReserva({ overrides: negar(Permission.AGENDAMENTO_CANCELAR) });
    await expect(servico.cancel(USUARIO_DONO, TENANT_A, RESERVA)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('DENIED em SERVICOS_VISUALIZAR NÃO impede cancelar', async () => {
    // Cancelar não escolhe serviço — exigir essa permissão travaria o
    // cancelamento sem motivo.
    const { servico } = comReserva({ overrides: negar(Permission.SERVICOS_VISUALIZAR) });
    const view = await servico.cancel(USUARIO_DONO, TENANT_A, RESERVA);
    expect(view.status).toBe(AppointmentStatus.CANCELED);
  });
});

describe('AppointmentsService.reschedule', () => {
  const DEZ_HORAS = '2026-09-20T13:00:00.000Z';

  it('move o horário preservando id, cliente, status e snapshots', async () => {
    const { servico, colecoes } = comReserva();

    const view = await servico.reschedule(USUARIO_DONO, TENANT_A, RESERVA, {
      startAt: DEZ_HORAS,
      expectedStartAt: INICIO,
    });

    expect(view.id).toBe(RESERVA);
    expect(view.startAt).toBe(DEZ_HORAS);
    expect(view.localStart).toBe('10:00');
    expect(view.status).toBe(AppointmentStatus.CONFIRMED);
    expect(view.consumer.id).toBe(CLIENTE_A);
    // Preço e duração continuam os CONGELADOS.
    expect(view.priceCents).toBe(5000);
    expect(view.durationMinutes).toBe(60);
    // Uma linha só: a reserva foi ATUALIZADA, não recriada.
    expect(colecoes.get(Appointment) ?? []).toHaveLength(1);
    expect(colecoes.get(AppointmentItem) ?? []).toHaveLength(1);
  });

  it('NÃO grava transição de status: o status não mudou', async () => {
    const { servico, colecoes } = comReserva();

    await servico.reschedule(USUARIO_DONO, TENANT_A, RESERVA, {
      startAt: DEZ_HORAS,
      expectedStartAt: INICIO,
    });

    expect(colecoes.get(AppointmentStatusChange) ?? []).toHaveLength(0);
  });

  it('remarcar para o MESMO instante não altera nada', async () => {
    const { servico, colecoes } = comReserva();
    const antes = { ...(colecoes.get(Appointment) ?? [])[0] };

    const view = await servico.reschedule(USUARIO_DONO, TENANT_A, RESERVA, {
      startAt: INICIO,
      expectedStartAt: INICIO,
    });

    expect(view.startAt).toBe(INICIO);
    expect((colecoes.get(Appointment) ?? [])[0]).toEqual(antes);
    expect(colecoes.get(AppointmentStatusChange) ?? []).toHaveLength(0);
  });

  it('a ocupação nova tem a largura CONGELADA, não a do catálogo atual', async () => {
    // Reserva de 60 min + 0 de buffer; o catálogo agora diz 30 min + 15 de
    // buffer e outro preço. A janela gravada tem de continuar com 60 min.
    const { servico, colecoes } = comReserva({
      servicos: servicoAlterado({
        durationMinutes: 30,
        bufferAfterMinutes: 15,
        priceCents: 9900,
      }),
    });

    const view = await servico.reschedule(USUARIO_DONO, TENANT_A, RESERVA, {
      startAt: DEZ_HORAS,
      expectedStartAt: INICIO,
    });

    const linha = (colecoes.get(Appointment) ?? [])[0];
    const minutos = ((linha.endAt as Date).getTime() - (linha.startAt as Date).getTime()) / 60_000;
    expect(minutos).toBe(60);
    // E o preço/duração exibidos continuam os do snapshot, não os novos.
    expect(view.priceCents).toBe(5000);
    expect(view.durationMinutes).toBe(60);
  });

  it('a própria reserva não bloqueia o horário dela (ignorarAgendamentoId)', async () => {
    // Sem ignorar, 09:00 apareceria ocupado pela própria reserva e mover para
    // 09:15 (que sobrepõe a janela antiga) seria recusado.
    const { servico } = comReserva();

    const view = await servico.reschedule(USUARIO_DONO, TENANT_A, RESERVA, {
      startAt: '2026-09-20T12:15:00.000Z',
      expectedStartAt: INICIO,
    });

    expect(view.localStart).toBe('09:15');
  });

  it('reserva CANCELED não pode ser remarcada', async () => {
    const { servico } = comReserva({}, { status: AppointmentStatus.CANCELED });
    await expect(
      servico.reschedule(USUARIO_DONO, TENANT_A, RESERVA, {
        startAt: DEZ_HORAS,
        expectedStartAt: INICIO,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([
    AppointmentStatus.IN_PROGRESS,
    AppointmentStatus.COMPLETED,
    AppointmentStatus.NO_SHOW,
  ])('%s não pode ser remarcado', async (status) => {
    const { servico } = comReserva({}, { status });
    await expect(
      servico.reschedule(USUARIO_DONO, TENANT_A, RESERVA, {
        startAt: DEZ_HORAS,
        expectedStartAt: INICIO,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('instante esperado diferente do gravado é 409 (tela desatualizada)', async () => {
    const { servico, colecoes } = comReserva();

    await expect(
      servico.reschedule(USUARIO_DONO, TENANT_A, RESERVA, {
        startAt: DEZ_HORAS,
        // A tela achava que a reserva era às 11:00 — não é.
        expectedStartAt: '2026-09-20T14:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    // E o horário ORIGINAL fica intacto.
    expect(((colecoes.get(Appointment) ?? [])[0].startAt as Date).toISOString()).toBe(INICIO);
  });

  it('horário fora da jornada é 400 e preserva o horário original', async () => {
    const { servico, colecoes } = comReserva();

    await expect(
      servico.reschedule(USUARIO_DONO, TENANT_A, RESERVA, {
        // 20:00 local — a jornada de teste termina 12:00.
        startAt: '2026-09-20T23:00:00.000Z',
        expectedStartAt: INICIO,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(((colecoes.get(Appointment) ?? [])[0].startAt as Date).toISOString()).toBe(INICIO);
  });

  it('serviço desativado depois da reserva impede REMARCAR (mas não cancelar)', async () => {
    // A elegibilidade é conferida com as linhas ATUAIS: remarcar é escolher um
    // horário novo, e um serviço desativado não pode receber horário novo.
    const { servico } = comReserva({ servicos: servicoAlterado({ active: false }) });

    await expect(
      servico.reschedule(USUARIO_DONO, TENANT_A, RESERVA, {
        startAt: DEZ_HORAS,
        expectedStartAt: INICIO,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('remarcar pelo tenant alheio é 404 — e nada é alterado', async () => {
    const { servico, colecoes } = comReserva();

    await expect(
      servico.reschedule(USUARIO_DONO, TENANT_B, RESERVA, {
        startAt: DEZ_HORAS,
        expectedStartAt: INICIO,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(((colecoes.get(Appointment) ?? [])[0].startAt as Date).toISOString()).toBe(INICIO);
  });

  it('DENIED em AGENDAMENTO_EDITAR é 403', async () => {
    const { servico } = comReserva({ overrides: negar(Permission.AGENDAMENTO_EDITAR) });
    await expect(
      servico.reschedule(USUARIO_DONO, TENANT_A, RESERVA, {
        startAt: DEZ_HORAS,
        expectedStartAt: INICIO,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('erro da constraint de sobreposição vira 409', async () => {
    const { servico, manager } = comReserva();
    // Simula a constraint disparando no UPDATE: é o que acontece quando outra
    // reserva ocupou o horário entre a validação e a gravação.
    const original = manager.update.bind(manager);
    manager.update = () =>
      Promise.reject(
        new QueryFailedError('update', [], {
          code: '23P01',
          constraint: OVERLAP_CONSTRAINT,
        } as unknown as Error),
      );

    await expect(
      servico.reschedule(USUARIO_DONO, TENANT_A, RESERVA, {
        startAt: DEZ_HORAS,
        expectedStartAt: INICIO,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    manager.update = original;
  });
});

describe('AppointmentsService.rescheduleOptions', () => {
  it('oferece o horário da própria reserva (ela não bloqueia a si mesma)', async () => {
    const { servico } = comReserva();

    const opcoes = await servico.rescheduleOptions(USUARIO_DONO, TENANT_A, RESERVA, {
      date: DATA,
    });

    expect(opcoes.appointmentId).toBe(RESERVA);
    expect(opcoes.slots.map((s) => s.localStart)).toContain('09:00');
    // Duração CONGELADA na reserva.
    expect(opcoes.durationMinutes).toBe(60);
  });

  it('usa a ocupação congelada para montar a grade, não a do catálogo', async () => {
    // Catálogo agora: 30 min. A reserva ocupa 60. Com 60 min de largura e
    // jornada 09:00–12:00, o último início possível é 11:00.
    const { servico } = comReserva({ servicos: servicoAlterado({ durationMinutes: 30 }) });

    const opcoes = await servico.rescheduleOptions(USUARIO_DONO, TENANT_A, RESERVA, {
      date: DATA,
    });

    expect(opcoes.durationMinutes).toBe(60);
    expect(opcoes.slots.at(-1)?.localStart).toBe('11:00');
    expect(opcoes.slots.map((s) => s.localStart)).not.toContain('11:30');
  });

  it('pelo tenant alheio é 404', async () => {
    const { servico } = comReserva();
    await expect(
      servico.rescheduleOptions(USUARIO_DONO, TENANT_B, RESERVA, { date: DATA }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('DENIED em AGENDAMENTO_EDITAR é 403', async () => {
    const { servico } = comReserva({ overrides: negar(Permission.AGENDAMENTO_EDITAR) });
    await expect(
      servico.rescheduleOptions(USUARIO_DONO, TENANT_A, RESERVA, { date: DATA }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
