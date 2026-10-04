// Integração real da criação de agendamentos (Lote 6D.5) contra PostgreSQL
// DESCARTÁVEL — nunca Neon, nunca banco existente, nunca `.env` local. Só
// roda com `DB_E2E_DIRECT_URL`; o schema é o real, aplicado pelas migrations
// versionadas, e este arquivo nunca cria nem altera tabela.
// `rejectUnauthorized: true` nunca é enfraquecido (o certificado do container
// é confiado via NODE_EXTRA_CA_CERTS).
//
// Prova o que fake em memória não prova:
//  - as linhas que de fato ficam em `appointments` e `appointment_items`;
//  - o ROLLBACK de verdade (nada parcial, nenhum cliente órfão);
//  - duas conexões disputando o mesmo horário, com coordenação
//    determinística (nunca `sleep` torcendo pelo escalonamento);
//  - a constraint `appointments_no_overlap_excl` recusando de verdade;
//  - o buffer dentro da janela persistida, e o encaixe adjacente;
//  - a concordância entre o GET de disponibilidade e o POST.
import { globSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppointmentsService } from '../src/appointments/appointments.service.js';
import { AvailabilityService } from '../src/availability/availability.service.js';
import { ConsumersService } from '../src/consumers/consumers.service.js';
import { buildRuntimeDataSourceOptions } from '../src/database/runtime-data-source.js';
import { Appointment } from '../src/entities/appointment.entity.js';
import { AppointmentItem } from '../src/entities/appointment-item.entity.js';
import { AppointmentStatusChange } from '../src/entities/appointment-status-change.entity.js';
import { Consumer } from '../src/entities/consumer.entity.js';
import { AppointmentStatus } from '../src/entities/enums/appointment-status.enum.js';
import { BusinessCategory } from '../src/entities/enums/business-category.enum.js';
import { EstablishmentRole } from '../src/entities/enums/establishment-role.enum.js';
import { Permission } from '../src/entities/enums/permission.enum.js';
import { PermissionMode } from '../src/entities/enums/permission-mode.enum.js';
import { ServiceModality } from '../src/entities/enums/service-modality.enum.js';
import { TenantStatus } from '../src/entities/enums/tenant-status.enum.js';
import { UserStatus } from '../src/entities/enums/user-status.enum.js';
import { Membership } from '../src/entities/membership.entity.js';
import { MembershipPermissionOverride } from '../src/entities/membership-permission-override.entity.js';
import { Plan } from '../src/entities/plan.entity.js';
import { Tenant } from '../src/entities/tenant.entity.js';
import { Unit } from '../src/entities/unit.entity.js';
import { User } from '../src/entities/user.entity.js';
import { ProfessionalsService } from '../src/professionals/professionals.service.js';
import { ProfessionalWorkingHoursService } from '../src/professionals/working-hours.service.js';
import { ServicesService } from '../src/services/services.service.js';

const DIRECT_URL = process.env.DB_E2E_DIRECT_URL;

const testDir = path.dirname(fileURLToPath(import.meta.url));

async function carregarEntidades(): Promise<(new () => object)[]> {
  const arquivos = globSync(
    path.join(testDir, '../src/entities/**/*.entity.ts').replaceAll('\\', '/'),
  );
  if (arquivos.length === 0) {
    throw new Error(
      'Nenhuma entidade encontrada — o padrão de arquivos saiu do lugar.',
    );
  }

  const classes: (new () => object)[] = [];
  for (const arquivo of arquivos) {
    const modulo = (await import(pathToFileURL(arquivo).href)) as Record<
      string,
      unknown
    >;
    for (const exportado of Object.values(modulo)) {
      if (typeof exportado === 'function')
        classes.push(exportado as new () => object);
    }
  }
  return classes;
}

/** Domingo (weekday 0), bem no futuro: nenhum teste depende do dia em que roda. */
const DATA = '2026-09-20';
const WEEKDAY_DA_DATA = 0;
/** 09:00 em America/Sao_Paulo. */
const NOVE_HORAS = '2026-09-20T12:00:00.000Z';
/** Relógio fixo, bem antes da data agendada. */
const AGORA = new Date('2026-09-01T12:00:00Z');

interface Cenario {
  tenantId: string;
  unitId: string;
  ownerUserId: string;
  professionalId: string;
  serviceId: string;
  consumerId: string;
}

describe.skipIf(!DIRECT_URL)(
  'agendamentos contra PostgreSQL descartável (Lote 6D.5)',
  () => {
    let dataSource: DataSource;
    let agendamentos: AppointmentsService;
    let disponibilidade: AvailabilityService;
    let clientes: ConsumersService;
    let profissionais: ProfessionalsService;
    let servicos: ServicesService;
    let horarios: ProfessionalWorkingHoursService;
    let planId: string;
    const sufixo = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

    async function criarCenario(
      nome: string,
      opcoes: {
        durationMinutes?: number;
        bufferAfterMinutes?: number;
        priceCents?: number | null;
        requiresManualConfirmation?: boolean;
        jornada?: [string, string];
      } = {},
    ): Promise<Cenario> {
      const manager = dataSource.manager;

      const tenant = await manager.save(
        manager.create(Tenant, {
          slug: `e2e-agd-${nome}-${sufixo}`,
          category: BusinessCategory.OTHER,
          timezone: 'America/Sao_Paulo',
          planId,
          status: TenantStatus.ACTIVE,
        }),
      );
      const unit = await manager.save(
        manager.create(Unit, {
          tenantId: tenant.id,
          name: `Unidade ${nome}`,
          address: '',
          timezone: 'America/Sao_Paulo',
          isPrimary: true,
        }),
      );
      const user = await manager.save(
        manager.create(User, {
          name: `Dono ${nome}`,
          email: `dono-agd-${nome}-${sufixo}@example.test`,
          phone: '+5511900000000',
          status: UserStatus.ACTIVE,
        }),
      );
      await manager.save(
        manager.create(Membership, {
          userId: user.id,
          tenantId: tenant.id,
          role: EstablishmentRole.DONO,
        }),
      );

      const servico = await servicos.create(user.id, tenant.id, {
        name: `Serviço ${nome}`,
        shortDescription: '',
        priceCents: opcoes.priceCents === undefined ? 5000 : opcoes.priceCents,
        priceVisible: true,
        durationMinutes: opcoes.durationMinutes ?? 60,
        bufferAfterMinutes: opcoes.bufferAfterMinutes ?? 0,
        modality: ServiceModality.IN_PERSON,
        activeInPublicBooking: true,
        requiresManualConfirmation: opcoes.requiresManualConfirmation ?? false,
      });

      const profissional = await profissionais.create(user.id, tenant.id, {
        name: `Profissional ${nome}`,
        serviceIds: [servico.id],
      });

      const [inicio, fim] = opcoes.jornada ?? ['09:00', '18:00'];
      await horarios.replace(user.id, tenant.id, profissional.id, {
        days: [
          {
            weekday: WEEKDAY_DA_DATA,
            intervals: [{ start: inicio, end: fim }],
          },
        ],
      });

      const consumidor = await clientes.create(user.id, tenant.id, {
        name: `Cliente ${nome}`,
        whatsapp: `(11) 9${Math.floor(Math.random() * 90_000_000 + 10_000_000)}`,
      });

      return {
        tenantId: tenant.id,
        unitId: unit.id,
        ownerUserId: user.id,
        professionalId: profissional.id,
        serviceId: servico.id,
        consumerId: consumidor.id,
      };
    }

    function agendar(
      cenario: Cenario,
      startAt = NOVE_HORAS,
      sobrescreve: Partial<Cenario> = {},
    ) {
      return agendamentos.create(
        sobrescreve.ownerUserId ?? cenario.ownerUserId,
        sobrescreve.tenantId ?? cenario.tenantId,
        {
          professionalId: sobrescreve.professionalId ?? cenario.professionalId,
          serviceId: sobrescreve.serviceId ?? cenario.serviceId,
          startAt,
          consumer: {
            mode: 'existing',
            consumerId: sobrescreve.consumerId ?? cenario.consumerId,
          },
        },
      );
    }

    beforeAll(async () => {
      const entidades = await carregarEntidades();
      const opcoesBase = buildRuntimeDataSourceOptions(DIRECT_URL as string);

      dataSource = new DataSource({
        ...opcoesBase,
        entities: entidades,
        logging: ['error'],
      });
      await dataSource.initialize();

      disponibilidade = new AvailabilityService(dataSource, () => AGORA);
      clientes = new ConsumersService(dataSource);
      // Mesmo relógio injetado do motor de disponibilidade: a elegibilidade de
      // cancelar/remarcar ("já começou?") precisa concordar com a grade que o
      // motor gera, senão os dois discordariam sobre o que é futuro.
      agendamentos = new AppointmentsService(
        dataSource,
        disponibilidade,
        clientes,
        () => AGORA,
      );
      profissionais = new ProfessionalsService(dataSource);
      servicos = new ServicesService(dataSource);
      horarios = new ProfessionalWorkingHoursService(dataSource);

      const plan = await dataSource.manager.findOne(Plan, {
        where: { code: 'equipe' },
      });
      if (!plan)
        throw new Error(
          'Catálogo de planos ausente — migrations não foram aplicadas.',
        );
      planId = plan.id;
    }, 30_000);

    afterAll(async () => {
      if (dataSource?.isInitialized) await dataSource.destroy();
    });

    it('grava o agendamento e o item, com as colunas reais', async () => {
      const cenario = await criarCenario('base');

      const view = await agendar(cenario);

      const gravado = await dataSource.manager.findOne(Appointment, {
        where: { id: view.id },
      });
      expect(gravado).not.toBeNull();
      expect(gravado!.tenantId).toBe(cenario.tenantId);
      expect(gravado!.unitId).toBe(cenario.unitId);
      expect(gravado!.professionalId).toBe(cenario.professionalId);
      expect(gravado!.consumerId).toBe(cenario.consumerId);
      expect(gravado!.startAt.toISOString()).toBe(NOVE_HORAS);
      expect(gravado!.endAt.toISOString()).toBe('2026-09-20T13:00:00.000Z');
      expect(gravado!.status).toBe(AppointmentStatus.CONFIRMED);
      // Snapshot congelado, não uma junção com `consumers` na hora de ler.
      expect(gravado!.consumerNameSnapshot).toContain('Cliente base');

      const itens = await dataSource.manager.find(AppointmentItem, {
        where: { appointmentId: view.id },
      });
      expect(itens).toHaveLength(1);
      expect(itens[0].serviceId).toBe(cenario.serviceId);
      expect(itens[0].durationMinutesSnapshot).toBe(60);
      expect(itens[0].priceCentsSnapshot).toBe(5000);
      expect(itens[0].position).toBe(0);
    });

    it('serviço sem preço grava snapshot NULO no banco — nunca zero', async () => {
      const cenario = await criarCenario('sem-preco', { priceCents: null });

      const view = await agendar(cenario);

      const [item] = await dataSource.manager.find(AppointmentItem, {
        where: { appointmentId: view.id },
      });
      expect(item.priceCentsSnapshot).toBeNull();
      expect(item.priceCentsSnapshot).not.toBe(0);
    });

    it('serviço com confirmação manual nasce PENDING no banco', async () => {
      const cenario = await criarCenario('manual', {
        requiresManualConfirmation: true,
      });

      const view = await agendar(cenario);

      const gravado = await dataSource.manager.findOne(Appointment, {
        where: { id: view.id },
      });
      expect(gravado!.status).toBe(AppointmentStatus.PENDING);
    });

    it('o buffer entra na janela PERSISTIDA e bloqueia o horário seguinte', async () => {
      // 30 min de atendimento + 15 de buffer: a ocupação vai até 09:45.
      const cenario = await criarCenario('buffer', {
        durationMinutes: 30,
        bufferAfterMinutes: 15,
      });

      const view = await agendar(cenario);

      const gravado = await dataSource.manager.findOne(Appointment, {
        where: { id: view.id },
      });
      expect(gravado!.endAt.toISOString()).toBe('2026-09-20T12:45:00.000Z');

      // O GET de disponibilidade lê essa janela: 09:30 (dentro do buffer) some,
      // 09:45 continua livre.
      const livres = await disponibilidade.consult(
        cenario.ownerUserId,
        cenario.tenantId,
        cenario.professionalId,
        { serviceId: cenario.serviceId, date: DATA },
      );
      const horas = livres.slots.map((s) => s.localStart);
      expect(horas).not.toContain('09:00');
      expect(horas).not.toContain('09:30');
      expect(horas).toContain('09:45');

      // E o POST concorda com o GET: 09:30 é recusado, 09:45 é aceito.
      await expect(
        agendar(cenario, '2026-09-20T12:30:00.000Z'),
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(
        agendar(cenario, '2026-09-20T12:45:00.000Z'),
      ).resolves.toBeDefined();
    });

    it('atendimentos adjacentes encaixam: fim excluído, sem buffer', async () => {
      const cenario = await criarCenario('adjacente', { durationMinutes: 60 });

      await agendar(cenario, NOVE_HORAS);
      // 10:00 começa exatamente quando o anterior termina — `[)` permite.
      const segundo = await agendar(cenario, '2026-09-20T13:00:00.000Z');

      expect(segundo.startAt).toBe('2026-09-20T13:00:00.000Z');
      const total = await dataSource.manager.count(Appointment, {
        where: { tenantId: cenario.tenantId },
      });
      expect(total).toBe(2);
    });

    it('o mesmo horário duas vezes é recusado com 409 pela constraint', async () => {
      const cenario = await criarCenario('dobrado');

      await agendar(cenario);
      await expect(agendar(cenario)).rejects.toBeInstanceOf(ConflictException);

      expect(
        await dataSource.manager.count(Appointment, {
          where: { tenantId: cenario.tenantId },
        }),
      ).toBe(1);
    });

    it('duas conexões disputando o MESMO horário: só uma reserva sobrevive', async () => {
      const cenario = await criarCenario('corrida');

      // Coordenação determinística, sem sleep: as duas tentativas ficam
      // paradas no mesmo portão e são liberadas juntas. Uma commita, a outra
      // esbarra no horário já ocupado — qual das duas vence é irrelevante, o
      // que importa é que exatamente uma sobrevive e a outra falha de forma
      // controlada.
      const largada = Promise.withResolvers<void>();

      const tentativa = async () => {
        await largada.promise;
        return agendar(cenario);
      };

      const primeira = tentativa();
      const segunda = tentativa();
      largada.resolve();
      const [a, b] = await Promise.allSettled([primeira, segunda]);

      const sucessos = [a, b].filter((r) => r.status === 'fulfilled');
      const falhas = [a, b].filter((r) => r.status === 'rejected');

      expect(sucessos).toHaveLength(1);
      expect(falhas).toHaveLength(1);
      // A falha é conflito CONTROLADO, nunca erro cru de banco vazando.
      expect((falhas[0] as PromiseRejectedResult).reason).toBeInstanceOf(
        ConflictException,
      );

      // A linha final no banco é o que vale, não a resposta HTTP.
      expect(
        await dataSource.manager.count(Appointment, {
          where: { tenantId: cenario.tenantId },
        }),
      ).toBe(1);
    });

    it('cliente novo e reserva são gravados na MESMA transação', async () => {
      const cenario = await criarCenario('cliente-novo');
      const antes = await dataSource.manager.count(Consumer, {
        where: { tenantId: cenario.tenantId },
      });

      const view = await agendamentos.create(
        cenario.ownerUserId,
        cenario.tenantId,
        {
          professionalId: cenario.professionalId,
          serviceId: cenario.serviceId,
          startAt: NOVE_HORAS,
          consumer: {
            mode: 'new',
            data: { name: 'Cliente Novíssimo', whatsapp: '(11) 97777-6666' },
          },
        },
      );

      expect(
        await dataSource.manager.count(Consumer, {
          where: { tenantId: cenario.tenantId },
        }),
      ).toBe(antes + 1);
      const gravado = await dataSource.manager.findOne(Appointment, {
        where: { id: view.id },
      });
      expect(gravado!.consumerNameSnapshot).toBe('Cliente Novíssimo');
    });

    it('reserva recusada NÃO deixa cliente órfão nem agendamento parcial', async () => {
      const cenario = await criarCenario('rollback');
      // Ocupa o horário primeiro, para a segunda tentativa bater na constraint.
      await agendar(cenario);

      const clientesAntes = await dataSource.manager.count(Consumer, {
        where: { tenantId: cenario.tenantId },
      });
      const agendamentosAntes = await dataSource.manager.count(Appointment, {
        where: { tenantId: cenario.tenantId },
      });

      await expect(
        agendamentos.create(cenario.ownerUserId, cenario.tenantId, {
          professionalId: cenario.professionalId,
          serviceId: cenario.serviceId,
          startAt: NOVE_HORAS,
          consumer: {
            mode: 'new',
            data: {
              name: 'Nunca Deveria Existir',
              whatsapp: '(11) 96666-5555',
            },
          },
        }),
      ).rejects.toBeInstanceOf(ConflictException);

      // O cliente criado dentro da transação que falhou não pode ter ficado.
      expect(
        await dataSource.manager.count(Consumer, {
          where: { tenantId: cenario.tenantId },
        }),
      ).toBe(clientesAntes);
      expect(
        await dataSource.manager.count(Appointment, {
          where: { tenantId: cenario.tenantId },
        }),
      ).toBe(agendamentosAntes);
      expect(
        await dataSource.manager.findOne(Consumer, {
          where: { tenantId: cenario.tenantId, name: 'Nunca Deveria Existir' },
        }),
      ).toBeNull();
    });

    it('nunca grava agendamento sem item', async () => {
      const cenario = await criarCenario('integridade');
      const view = await agendar(cenario);

      const itens = await dataSource.manager.count(AppointmentItem, {
        where: { appointmentId: view.id },
      });
      expect(itens).toBe(1);
    });

    it('ids de outro estabelecimento são recusados, mesmo com sessão válida', async () => {
      const cenarioA = await criarCenario('iso-a');
      const cenarioB = await criarCenario('iso-b');

      await expect(
        agendar(cenarioA, NOVE_HORAS, {
          professionalId: cenarioB.professionalId,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        agendar(cenarioA, NOVE_HORAS, { serviceId: cenarioB.serviceId }),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        agendar(cenarioA, NOVE_HORAS, { consumerId: cenarioB.consumerId }),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        agendar(cenarioA, NOVE_HORAS, { tenantId: cenarioB.tenantId }),
      ).rejects.toBeInstanceOf(NotFoundException);

      // Nenhuma das tentativas gravou nada em nenhum dos dois estabelecimentos.
      expect(
        await dataSource.manager.count(Appointment, {
          where: { tenantId: cenarioA.tenantId },
        }),
      ).toBe(0);
      expect(
        await dataSource.manager.count(Appointment, {
          where: { tenantId: cenarioB.tenantId },
        }),
      ).toBe(0);
    });

    it('serviço desativado no meio do caminho impede a reserva', async () => {
      const cenario = await criarCenario('desativado');
      await servicos.deactivate(
        cenario.ownerUserId,
        cenario.tenantId,
        cenario.serviceId,
      );

      await expect(agendar(cenario)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(
        await dataSource.manager.count(Appointment, {
          where: { tenantId: cenario.tenantId },
        }),
      ).toBe(0);
    });

    it('vínculo removido impede a reserva', async () => {
      const cenario = await criarCenario('sem-vinculo');
      await profissionais.setServices(
        cenario.ownerUserId,
        cenario.tenantId,
        cenario.professionalId,
        {
          serviceIds: [],
        },
      );

      await expect(agendar(cenario)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('jornada alterada para não cobrir o horário impede a reserva', async () => {
      const cenario = await criarCenario('jornada');
      // A semana passa a começar só às 14:00 — 09:00 deixa de existir.
      await horarios.replace(
        cenario.ownerUserId,
        cenario.tenantId,
        cenario.professionalId,
        {
          days: [
            {
              weekday: WEEKDAY_DA_DATA,
              intervals: [{ start: '14:00', end: '18:00' }],
            },
          ],
        },
      );

      await expect(agendar(cenario)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('o horário criado some da disponibilidade, e a listagem do dia o mostra', async () => {
      const cenario = await criarCenario('consistencia');

      const antes = await disponibilidade.consult(
        cenario.ownerUserId,
        cenario.tenantId,
        cenario.professionalId,
        { serviceId: cenario.serviceId, date: DATA },
      );
      expect(antes.slots.map((s) => s.localStart)).toContain('09:00');

      const view = await agendar(cenario);

      const depois = await disponibilidade.consult(
        cenario.ownerUserId,
        cenario.tenantId,
        cenario.professionalId,
        { serviceId: cenario.serviceId, date: DATA },
      );
      expect(depois.slots.map((s) => s.localStart)).not.toContain('09:00');

      const lista = await agendamentos.list(
        cenario.ownerUserId,
        cenario.tenantId,
        { date: DATA },
      );
      expect(lista.appointments.map((a) => a.id)).toContain(view.id);
      expect(lista.appointments[0].localStart).toBe('09:00');
      expect(lista.timezone).toBe('America/Sao_Paulo');
    });

    it('NO_SHOW mantém o horário ocupado: GET não oferece, POST recusa com 409 (Lote 6D.5.1)', async () => {
      // Decisão de negócio: falta já ocorrida não libera o horário. Antes desta
      // correção, o motor de disponibilidade divergia da constraint (liberava
      // `NO_SHOW` no GET e o INSERT recusava com 409); agora as duas camadas
      // concordam — o horário nem chega a ser oferecido.
      const cenario = await criarCenario('no-show');
      const view = await agendar(cenario);

      // Não existe rota de mudança de status neste lote: o estado é alterado
      // direto na tabela, exatamente para não inventar endpoint para o teste.
      await dataSource.manager.update(
        Appointment,
        { id: view.id },
        {
          status: AppointmentStatus.NO_SHOW,
        },
      );

      const disponibilidadeApos = await disponibilidade.consult(
        cenario.ownerUserId,
        cenario.tenantId,
        cenario.professionalId,
        { serviceId: cenario.serviceId, date: DATA },
      );
      expect(disponibilidadeApos.slots.map((s) => s.localStart)).not.toContain(
        '09:00',
      );

      // A constraint recusa a mesma reserva de forma controlada (409), nunca
      // com erro cru de banco vazando.
      await expect(agendar(cenario)).rejects.toBeInstanceOf(ConflictException);

      expect(
        await dataSource.manager.count(Appointment, {
          where: { tenantId: cenario.tenantId },
        }),
      ).toBe(1);
    });

    it('CANCELED libera o horário: GET oferece de novo e o POST aceita a nova reserva', async () => {
      const cenario = await criarCenario('canceled');
      const view = await agendar(cenario);

      await dataSource.manager.update(
        Appointment,
        { id: view.id },
        {
          status: AppointmentStatus.CANCELED,
        },
      );

      const disponibilidadeApos = await disponibilidade.consult(
        cenario.ownerUserId,
        cenario.tenantId,
        cenario.professionalId,
        { serviceId: cenario.serviceId, date: DATA },
      );
      expect(disponibilidadeApos.slots.map((s) => s.localStart)).toContain(
        '09:00',
      );

      const nova = await agendar(cenario);
      expect(nova.id).not.toBe(view.id);

      expect(
        await dataSource.manager.count(Appointment, {
          where: { tenantId: cenario.tenantId },
        }),
      ).toBe(2);
    });

    it('a listagem de um dia nunca mostra agendamento de outro estabelecimento', async () => {
      const cenarioA = await criarCenario('lista-a');
      const cenarioB = await criarCenario('lista-b');
      await agendar(cenarioA);
      await agendar(cenarioB);

      const lista = await agendamentos.list(
        cenarioA.ownerUserId,
        cenarioA.tenantId,
        { date: DATA },
      );

      expect(lista.appointments).toHaveLength(1);
      expect(lista.appointments[0].professional.id).toBe(
        cenarioA.professionalId,
      );
    });

    it('o detalhe de um agendamento de outro estabelecimento é 404', async () => {
      const cenarioA = await criarCenario('detalhe-a');
      const cenarioB = await criarCenario('detalhe-b');
      const deB = await agendar(cenarioB);

      await expect(
        agendamentos.get(cenarioA.ownerUserId, cenarioA.tenantId, deB.id),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    // -------------------------------------------------------------------------
    // Lote 6D.6 — cancelamento e remarcação contra PostgreSQL real.
    //
    // É aqui que as garantias que só o banco dá são provadas: a constraint de
    // sobreposição liberando o horário SÓ depois do commit, os locks `FOR UPDATE`
    // serializando duas ações sobre a mesma reserva, e o estado das linhas depois
    // de cada operação.

    /** 10:00 e 11:00 locais de São Paulo, no mesmo dia da jornada de teste. */
    const DEZ_HORAS = '2026-09-20T13:00:00.000Z';
    const ONZE_HORAS = '2026-09-20T14:00:00.000Z';

    it('cancelar libera o período e preserva os registros da reserva', async () => {
      const cenario = await criarCenario('cancela');
      const view = await agendar(cenario);

      // Antes: 09:00 ocupado.
      const antes = await disponibilidade.consult(
        cenario.ownerUserId,
        cenario.tenantId,
        cenario.professionalId,
        { serviceId: cenario.serviceId, date: DATA },
      );
      expect(antes.slots.map((s) => s.localStart)).not.toContain('09:00');

      const cancelada = await agendamentos.cancel(
        cenario.ownerUserId,
        cenario.tenantId,
        view.id,
        {
          expectedStartAt: view.startAt,
        },
      );
      expect(cancelada.status).toBe(AppointmentStatus.CANCELED);

      // Depois do COMMIT: 09:00 volta a ser oferecido e uma nova reserva entra.
      const depois = await disponibilidade.consult(
        cenario.ownerUserId,
        cenario.tenantId,
        cenario.professionalId,
        { serviceId: cenario.serviceId, date: DATA },
      );
      expect(depois.slots.map((s) => s.localStart)).toContain('09:00');
      await expect(agendar(cenario)).resolves.toMatchObject({
        localStart: '09:00',
      });

      // A linha continua lá, com o item intacto — nada de exclusão física.
      const linha = await dataSource.manager.findOne(Appointment, {
        where: { id: view.id },
      });
      expect(linha?.status).toBe(AppointmentStatus.CANCELED);
      const itens = await dataSource.manager.find(AppointmentItem, {
        where: { appointmentId: view.id },
      });
      expect(itens).toHaveLength(1);
      expect(itens[0].durationMinutesSnapshot).toBe(60);

      // E a transição foi gravada uma vez, com o estado anterior real.
      const transicoes = await dataSource.manager.find(
        AppointmentStatusChange,
        {
          where: { appointmentId: view.id },
        },
      );
      expect(transicoes).toHaveLength(1);
      expect(transicoes[0].fromStatus).toBe(AppointmentStatus.CONFIRMED);
      expect(transicoes[0].toStatus).toBe(AppointmentStatus.CANCELED);
      expect(transicoes[0].changedBy).toBe(cenario.ownerUserId);
    });

    it('repetir o cancelamento não duplica o histórico', async () => {
      const cenario = await criarCenario('cancela-2x');
      const view = await agendar(cenario);

      await agendamentos.cancel(
        cenario.ownerUserId,
        cenario.tenantId,
        view.id,
        {
          expectedStartAt: view.startAt,
        },
      );
      const segunda = await agendamentos.cancel(
        cenario.ownerUserId,
        cenario.tenantId,
        view.id,
        {
          expectedStartAt: view.startAt,
        },
      );

      expect(segunda.status).toBe(AppointmentStatus.CANCELED);
      expect(
        await dataSource.manager.count(AppointmentStatusChange, {
          where: { appointmentId: view.id },
        }),
      ).toBe(1);
      // A linha final continua cancelada, no horário original.
      const linha = await dataSource.manager.findOne(Appointment, {
        where: { id: view.id },
      });
      expect(linha?.status).toBe(AppointmentStatus.CANCELED);
      expect(linha?.startAt.toISOString()).toBe(view.startAt);
    });

    // ------------------------------------------------------------------------
    // Confirmação de cancelamento aberta numa tela desatualizada.
    //
    // A ordem entre as sessões é imposta pelo próprio Postgres, não por sleep:
    // uma conexão externa trava a linha da reserva com `FOR UPDATE`, cada ação
    // é disparada só depois de a anterior estar comprovadamente ENFILEIRADA
    // atrás desse lock (`pg_blocking_pids`), e a fila de lock de linha atende
    // na ordem de chegada quando a conexão externa confirma.

    /** Quantas sessões deste banco estão bloqueadas esperando lock agora. */
    async function sessoesBloqueadas(): Promise<number> {
      const linhas: { total: number }[] = await dataSource.query(
        `SELECT count(*)::int AS total
         FROM pg_stat_activity
        WHERE datname = current_database()
          AND cardinality(pg_blocking_pids(pid)) > 0`,
      );
      return linhas[0].total;
    }

    /** Espera até `quantidade` sessões estarem bloqueadas. Consulta uma condição
     * observável no banco (com prazo máximo), nunca uma pausa fixa torcendo
     * pelo escalonamento. */
    async function aguardarBloqueadas(quantidade: number): Promise<void> {
      const prazo = Date.now() + 10_000;
      while ((await sessoesBloqueadas()) < quantidade) {
        if (Date.now() > prazo) {
          throw new Error(
            `Esperava ${quantidade} sessão(ões) bloqueada(s) no lock da reserva.`,
          );
        }
        await new Promise((resolve) => setImmediate(resolve));
      }
    }

    /** Abre uma transação externa que segura `FOR UPDATE` na linha da reserva. */
    async function segurarReserva(appointmentId: string) {
      const runner = dataSource.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      await runner.query(
        'SELECT id FROM appointments WHERE id = $1 FOR UPDATE',
        [appointmentId],
      );
      return {
        liberar: async () => {
          await runner.commitTransaction();
          await runner.release();
        },
      };
    }

    it('remarcação confirma primeiro: o cancelamento da tela antiga é recusado com 409', async () => {
      const cenario = await criarCenario('cancela-tela-antiga');
      // A tela abre a confirmação de cancelamento mostrando 09:00.
      const view = await agendar(cenario);
      const instanteMostrado = view.startAt;

      const trava = await segurarReserva(view.id);
      // Outra sessão remarca para 11:00 — entra primeiro na fila do lock.
      const remarcacao = agendamentos
        .reschedule(cenario.ownerUserId, cenario.tenantId, view.id, {
          startAt: ONZE_HORAS,
          expectedStartAt: view.startAt,
        })
        .then(
          () => 'ok' as const,
          (error: unknown) => error,
        );
      await aguardarBloqueadas(1);
      // A confirmação antiga chega depois, ainda com 09:00.
      const cancelamento = agendamentos
        .cancel(cenario.ownerUserId, cenario.tenantId, view.id, {
          expectedStartAt: instanteMostrado,
        })
        .then(
          () => 'ok' as const,
          (error: unknown) => error,
        );
      await aguardarBloqueadas(2);
      await trava.liberar();

      expect(await remarcacao).toBe('ok');
      const falhaCancelamento = await cancelamento;
      expect(falhaCancelamento).toBeInstanceOf(ConflictException);
      expect((falhaCancelamento as ConflictException).message).toMatch(/mudou/);

      // Nada cancelado e nenhum histórico: a reserva segue confirmada às 11:00.
      const linha = await dataSource.manager.findOne(Appointment, {
        where: { id: view.id },
      });
      expect(linha?.status).toBe(AppointmentStatus.CONFIRMED);
      expect(linha?.startAt.toISOString()).toBe(ONZE_HORAS);
      expect(
        await dataSource.manager.count(AppointmentStatusChange, {
          where: { appointmentId: view.id },
        }),
      ).toBe(0);

      // Nova confirmação CONSCIENTE, com o horário atualizado, cancela.
      const cancelada = await agendamentos.cancel(
        cenario.ownerUserId,
        cenario.tenantId,
        view.id,
        {
          expectedStartAt: ONZE_HORAS,
        },
      );
      expect(cancelada.status).toBe(AppointmentStatus.CANCELED);
      expect(
        await dataSource.manager.count(AppointmentStatusChange, {
          where: { appointmentId: view.id },
        }),
      ).toBe(1);
    });

    it('cancelamento confirma primeiro: a remarcação não ressuscita a reserva cancelada', async () => {
      const cenario = await criarCenario('remarca-depois-cancela');
      const view = await agendar(cenario);

      const trava = await segurarReserva(view.id);
      const cancelamento = agendamentos
        .cancel(cenario.ownerUserId, cenario.tenantId, view.id, {
          expectedStartAt: view.startAt,
        })
        .then(
          () => 'ok' as const,
          (error: unknown) => error,
        );
      await aguardarBloqueadas(1);
      const remarcacao = agendamentos
        .reschedule(cenario.ownerUserId, cenario.tenantId, view.id, {
          startAt: ONZE_HORAS,
          expectedStartAt: view.startAt,
        })
        .then(
          () => 'ok' as const,
          (error: unknown) => error,
        );
      await aguardarBloqueadas(2);
      await trava.liberar();

      expect(await cancelamento).toBe('ok');
      expect(await remarcacao).toBeInstanceOf(BadRequestException);

      // Cancelada, no horário ORIGINAL, com uma transição só.
      const linha = await dataSource.manager.findOne(Appointment, {
        where: { id: view.id },
      });
      expect(linha?.status).toBe(AppointmentStatus.CANCELED);
      expect(linha?.startAt.toISOString()).toBe(view.startAt);
      const transicoes = await dataSource.manager.find(
        AppointmentStatusChange,
        {
          where: { appointmentId: view.id },
        },
      );
      expect(transicoes).toHaveLength(1);
      expect(transicoes[0].fromStatus).toBe(AppointmentStatus.CONFIRMED);
      expect(transicoes[0].toStatus).toBe(AppointmentStatus.CANCELED);
    });

    it('remarcação válida persiste depois de reler do banco', async () => {
      const cenario = await criarCenario('remarca');
      const view = await agendar(cenario);

      const remarcada = await agendamentos.reschedule(
        cenario.ownerUserId,
        cenario.tenantId,
        view.id,
        { startAt: DEZ_HORAS, expectedStartAt: view.startAt },
      );

      expect(remarcada.id).toBe(view.id);
      expect(remarcada.localStart).toBe('10:00');

      // Releitura pela rota de detalhe (outra consulta, outro caminho).
      const relida = await agendamentos.get(
        cenario.ownerUserId,
        cenario.tenantId,
        view.id,
      );
      expect(relida.startAt).toBe(DEZ_HORAS);
      expect(relida.localStart).toBe('10:00');
      expect(relida.status).toBe(AppointmentStatus.CONFIRMED);

      // Uma linha só (ATUALIZADA, não recriada) e nenhuma transição de status.
      expect(
        await dataSource.manager.count(Appointment, {
          where: { tenantId: cenario.tenantId },
        }),
      ).toBe(1);
      expect(
        await dataSource.manager.count(AppointmentStatusChange, {
          where: { appointmentId: view.id },
        }),
      ).toBe(0);

      // O horário antigo volta a ser oferecido; o novo sai da lista.
      const livres = await disponibilidade.consult(
        cenario.ownerUserId,
        cenario.tenantId,
        cenario.professionalId,
        { serviceId: cenario.serviceId, date: DATA },
      );
      expect(livres.slots.map((s) => s.localStart)).toContain('09:00');
      expect(livres.slots.map((s) => s.localStart)).not.toContain('10:00');
    });

    it('remarcar para o MESMO instante é operação sem alteração', async () => {
      const cenario = await criarCenario('remarca-igual');
      const view = await agendar(cenario);
      const antes = await dataSource.manager.findOne(Appointment, {
        where: { id: view.id },
      });

      const resultado = await agendamentos.reschedule(
        cenario.ownerUserId,
        cenario.tenantId,
        view.id,
        { startAt: view.startAt, expectedStartAt: view.startAt },
      );

      expect(resultado.startAt).toBe(view.startAt);
      const depois = await dataSource.manager.findOne(Appointment, {
        where: { id: view.id },
      });
      expect(depois?.startAt.toISOString()).toBe(antes?.startAt.toISOString());
      expect(depois?.endAt.toISOString()).toBe(antes?.endAt.toISOString());
      expect(
        await dataSource.manager.count(AppointmentStatusChange, {
          where: { appointmentId: view.id },
        }),
      ).toBe(0);
    });

    it('conflito na remarcação preserva integralmente o horário original', async () => {
      const cenario = await criarCenario('remarca-conflito');
      const primeira = await agendar(cenario);
      const segunda = await agendar(cenario, DEZ_HORAS);

      // Mover a primeira para cima da segunda: a constraint recusa.
      await expect(
        agendamentos.reschedule(
          cenario.ownerUserId,
          cenario.tenantId,
          primeira.id,
          {
            startAt: DEZ_HORAS,
            expectedStartAt: primeira.startAt,
          },
        ),
      ).rejects.toBeInstanceOf(ConflictException);

      // As DUAS reservas continuam exatamente onde estavam.
      const relidaA = await agendamentos.get(
        cenario.ownerUserId,
        cenario.tenantId,
        primeira.id,
      );
      const relidaB = await agendamentos.get(
        cenario.ownerUserId,
        cenario.tenantId,
        segunda.id,
      );
      expect(relidaA.startAt).toBe(primeira.startAt);
      expect(relidaB.startAt).toBe(segunda.startAt);
    });

    it('mudar o catálogo depois da reserva não altera os snapshots ao remarcar', async () => {
      const cenario = await criarCenario('remarca-snapshot', {
        durationMinutes: 60,
        bufferAfterMinutes: 0,
        priceCents: 5000,
      });
      const view = await agendar(cenario);
      expect(view.durationMinutes).toBe(60);
      expect(view.priceCents).toBe(5000);

      // Catálogo muda DEPOIS da reserva: duração menor, buffer novo, outro preço.
      await servicos.update(
        cenario.ownerUserId,
        cenario.tenantId,
        cenario.serviceId,
        {
          durationMinutes: 30,
          bufferAfterMinutes: 15,
          priceCents: 9900,
        },
      );

      const remarcada = await agendamentos.reschedule(
        cenario.ownerUserId,
        cenario.tenantId,
        view.id,
        { startAt: DEZ_HORAS, expectedStartAt: view.startAt },
      );

      // Duração e preço seguem os CONGELADOS.
      expect(remarcada.durationMinutes).toBe(60);
      expect(remarcada.priceCents).toBe(5000);

      // E a ocupação gravada continua com 60 min (não 30, nem 45 com buffer novo).
      const linha = await dataSource.manager.findOne(Appointment, {
        where: { id: view.id },
      });
      const minutos =
        (linha!.endAt.getTime() - linha!.startAt.getTime()) / 60_000;
      expect(minutos).toBe(60);

      // O item também fica intacto.
      const item = await dataSource.manager.findOne(AppointmentItem, {
        where: { appointmentId: view.id },
      });
      expect(item?.durationMinutesSnapshot).toBe(60);
      expect(item?.priceCentsSnapshot).toBe(5000);
    });

    it('duas reservas disputando o MESMO horário novo: só uma remarcação sobrevive', async () => {
      const cenario = await criarCenario('remarca-corrida');
      const a = await agendar(cenario);
      const b = await agendar(cenario, DEZ_HORAS);

      // As duas tentam ir para 11:00 ao mesmo tempo. Coordenação determinística
      // (portão único liberado de uma vez), sem sleep: qual vence é irrelevante,
      // o que importa é que exatamente uma vence e a outra recebe conflito
      // CONTROLADO — a constraint é a árbitra final.
      const largada = Promise.withResolvers<void>();
      const mover = async (reserva: { id: string; startAt: string }) => {
        await largada.promise;
        return agendamentos.reschedule(
          cenario.ownerUserId,
          cenario.tenantId,
          reserva.id,
          {
            startAt: ONZE_HORAS,
            expectedStartAt: reserva.startAt,
          },
        );
      };

      const primeira = mover(a);
      const segunda = mover(b);
      largada.resolve();
      const [r1, r2] = await Promise.allSettled([primeira, segunda]);

      const sucessos = [r1, r2].filter((r) => r.status === 'fulfilled');
      const falhas = [r1, r2].filter((r) => r.status === 'rejected');
      expect(sucessos).toHaveLength(1);
      expect(falhas).toHaveLength(1);
      expect((falhas[0] as PromiseRejectedResult).reason).toBeInstanceOf(
        ConflictException,
      );

      // Exatamente uma reserva está às 11:00, e nenhuma linha se perdeu.
      const doDia = await dataSource.manager.find(Appointment, {
        where: { tenantId: cenario.tenantId },
      });
      expect(doDia).toHaveLength(2);
      expect(
        doDia.filter((r) => r.startAt.toISOString() === ONZE_HORAS),
      ).toHaveLength(1);
    });

    it('cancelamento concorrente com remarcação: uma ganha, a outra é recusada sem corromper', async () => {
      const cenario = await criarCenario('cancela-vs-remarca');
      const view = await agendar(cenario);

      // Mesmo portão determinístico. As duas ações travam a MESMA linha com
      // `FOR UPDATE`, então serializam: a segunda só prossegue depois do commit
      // da primeira e já lê o estado novo.
      const largada = Promise.withResolvers<void>();
      const cancelar = async () => {
        await largada.promise;
        return agendamentos.cancel(
          cenario.ownerUserId,
          cenario.tenantId,
          view.id,
          {
            expectedStartAt: view.startAt,
          },
        );
      };
      const remarcar = async () => {
        await largada.promise;
        return agendamentos.reschedule(
          cenario.ownerUserId,
          cenario.tenantId,
          view.id,
          {
            startAt: DEZ_HORAS,
            expectedStartAt: view.startAt,
          },
        );
      };

      const c = cancelar();
      const r = remarcar();
      largada.resolve();
      const [resCancel, resRemarca] = await Promise.allSettled([c, r]);

      const linha = await dataSource.manager.findOne(Appointment, {
        where: { id: view.id },
      });

      // Exatamente uma das duas vence — as duas partiram do MESMO instante
      // mostrado na tela, então a que chega depois encontra a reserva mudada.
      expect([resCancel.status, resRemarca.status].sort()).toEqual([
        'fulfilled',
        'rejected',
      ]);

      if (resRemarca.status === 'fulfilled') {
        // Remarcou primeiro: o cancelamento partiu do horário antigo e é
        // recusado com 409 — nunca cancela a reserva no horário novo sem que a
        // pessoa tenha visto esse horário.
        expect((resCancel as PromiseRejectedResult).reason).toBeInstanceOf(
          ConflictException,
        );
        expect(linha?.status).toBe(AppointmentStatus.CONFIRMED);
        expect(linha?.startAt.toISOString()).toBe(DEZ_HORAS);
      } else {
        // Cancelou primeiro: remarcar é recusado (400, "cancelada não pode ser
        // remarcada") e a linha fica cancelada no horário ORIGINAL — nunca num
        // estado meio-gravado.
        expect((resRemarca as PromiseRejectedResult).reason).toBeInstanceOf(
          BadRequestException,
        );
        expect(linha?.status).toBe(AppointmentStatus.CANCELED);
        expect(linha?.startAt.toISOString()).toBe(view.startAt);
      }

      // Em qualquer das ordens: uma linha só, e a transição só existe se o
      // cancelamento venceu.
      expect(
        await dataSource.manager.count(Appointment, {
          where: { tenantId: cenario.tenantId },
        }),
      ).toBe(1);
      expect(
        await dataSource.manager.count(AppointmentStatusChange, {
          where: { appointmentId: view.id },
        }),
      ).toBe(resCancel.status === 'fulfilled' ? 1 : 0);
    });

    it('cancelar funciona com o serviço e o profissional desativados depois da reserva', async () => {
      const cenario = await criarCenario('cancela-inativo');
      const view = await agendar(cenario);

      // `deactivate` é a rota real de desativação: não existe campo `active` no
      // DTO de update — desativar é uma ação, não uma edição de campo.
      await servicos.deactivate(
        cenario.ownerUserId,
        cenario.tenantId,
        cenario.serviceId,
      );
      await profissionais.deactivate(
        cenario.ownerUserId,
        cenario.tenantId,
        cenario.professionalId,
      );

      const cancelada = await agendamentos.cancel(
        cenario.ownerUserId,
        cenario.tenantId,
        view.id,
        {
          expectedStartAt: view.startAt,
        },
      );
      expect(cancelada.status).toBe(AppointmentStatus.CANCELED);

      // Remarcar, ao contrário, é recusado: horário NOVO exige elegibilidade atual.
      const outro = await criarCenario('remarca-inativo');
      const reserva = await agendar(outro);
      await servicos.deactivate(
        outro.ownerUserId,
        outro.tenantId,
        outro.serviceId,
      );
      await expect(
        agendamentos.reschedule(outro.ownerUserId, outro.tenantId, reserva.id, {
          startAt: DEZ_HORAS,
          expectedStartAt: reserva.startAt,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('isolamento entre estabelecimentos: B não cancela nem remarca a reserva de A', async () => {
      const cenarioA = await criarCenario('iso-cancel-a');
      const cenarioB = await criarCenario('iso-cancel-b');
      const reservaDeA = await agendar(cenarioA);

      // B usa o PRÓPRIO tenant e o id da reserva de A: indistinguível de
      // inexistente, nunca confirma que a reserva existe em outro lugar.
      await expect(
        agendamentos.cancel(
          cenarioB.ownerUserId,
          cenarioB.tenantId,
          reservaDeA.id,
          {
            expectedStartAt: reservaDeA.startAt,
          },
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        agendamentos.reschedule(
          cenarioB.ownerUserId,
          cenarioB.tenantId,
          reservaDeA.id,
          {
            startAt: DEZ_HORAS,
            expectedStartAt: reservaDeA.startAt,
          },
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        agendamentos.rescheduleOptions(
          cenarioB.ownerUserId,
          cenarioB.tenantId,
          reservaDeA.id,
          {
            date: DATA,
          },
        ),
      ).rejects.toBeInstanceOf(NotFoundException);

      // B com o tenant de A (sem vínculo) também é 404.
      await expect(
        agendamentos.cancel(
          cenarioB.ownerUserId,
          cenarioA.tenantId,
          reservaDeA.id,
          {
            expectedStartAt: reservaDeA.startAt,
          },
        ),
      ).rejects.toBeInstanceOf(NotFoundException);

      // A reserva de A segue intacta.
      const relida = await agendamentos.get(
        cenarioA.ownerUserId,
        cenarioA.tenantId,
        reservaDeA.id,
      );
      expect(relida.status).toBe(AppointmentStatus.CONFIRMED);
      expect(relida.startAt).toBe(reservaDeA.startAt);
    });

    it('override DENIED impede cancelar e remarcar, mesmo sendo DONO', async () => {
      const cenario = await criarCenario('denied');
      const view = await agendar(cenario);

      const membership = await dataSource.manager.findOne(Membership, {
        where: { tenantId: cenario.tenantId, userId: cenario.ownerUserId },
      });
      await dataSource.manager.save(
        dataSource.manager.create(MembershipPermissionOverride, {
          tenantId: cenario.tenantId,
          membershipId: membership!.id,
          permission: Permission.AGENDAMENTO_CANCELAR,
          mode: PermissionMode.DENIED,
        }),
      );

      await expect(
        agendamentos.cancel(cenario.ownerUserId, cenario.tenantId, view.id, {
          expectedStartAt: view.startAt,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      // Remarcar continua permitido: as permissões são independentes.
      await expect(
        agendamentos.reschedule(
          cenario.ownerUserId,
          cenario.tenantId,
          view.id,
          {
            startAt: DEZ_HORAS,
            expectedStartAt: view.startAt,
          },
        ),
      ).resolves.toMatchObject({ localStart: '10:00' });

      // Agora nega EDITAR também: remarcar passa a ser 403.
      await dataSource.manager.save(
        dataSource.manager.create(MembershipPermissionOverride, {
          tenantId: cenario.tenantId,
          membershipId: membership!.id,
          permission: Permission.AGENDAMENTO_EDITAR,
          mode: PermissionMode.DENIED,
        }),
      );
      await expect(
        agendamentos.reschedule(
          cenario.ownerUserId,
          cenario.tenantId,
          view.id,
          {
            startAt: ONZE_HORAS,
            expectedStartAt: DEZ_HORAS,
          },
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      // E a reserva ficou onde a remarcação permitida a deixou.
      const linha = await dataSource.manager.findOne(Appointment, {
        where: { id: view.id },
      });
      expect(linha?.startAt.toISOString()).toBe(DEZ_HORAS);
      expect(linha?.status).toBe(AppointmentStatus.CONFIRMED);
    });

    it('a lista de horários para remarcar ignora só a própria reserva', async () => {
      const cenario = await criarCenario('opcoes');
      const a = await agendar(cenario);
      await agendar(cenario, DEZ_HORAS);

      const opcoes = await agendamentos.rescheduleOptions(
        cenario.ownerUserId,
        cenario.tenantId,
        a.id,
        { date: DATA },
      );

      const horas = opcoes.slots.map((s) => s.localStart);
      // O horário DELA aparece (ela não bloqueia a si mesma)...
      expect(horas).toContain('09:00');
      // ...e o da OUTRA reserva continua ocupado.
      expect(horas).not.toContain('10:00');
    });
  },
);
