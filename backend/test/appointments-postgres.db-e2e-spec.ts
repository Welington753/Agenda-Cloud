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
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppointmentsService } from '../src/appointments/appointments.service.js';
import { AvailabilityService } from '../src/availability/availability.service.js';
import { ConsumersService } from '../src/consumers/consumers.service.js';
import { buildRuntimeDataSourceOptions } from '../src/database/runtime-data-source.js';
import { Appointment } from '../src/entities/appointment.entity.js';
import { AppointmentItem } from '../src/entities/appointment-item.entity.js';
import { Consumer } from '../src/entities/consumer.entity.js';
import { AppointmentStatus } from '../src/entities/enums/appointment-status.enum.js';
import { BusinessCategory } from '../src/entities/enums/business-category.enum.js';
import { EstablishmentRole } from '../src/entities/enums/establishment-role.enum.js';
import { ServiceModality } from '../src/entities/enums/service-modality.enum.js';
import { TenantStatus } from '../src/entities/enums/tenant-status.enum.js';
import { UserStatus } from '../src/entities/enums/user-status.enum.js';
import { Membership } from '../src/entities/membership.entity.js';
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
    throw new Error('Nenhuma entidade encontrada — o padrão de arquivos saiu do lugar.');
  }

  const classes: (new () => object)[] = [];
  for (const arquivo of arquivos) {
    const modulo = (await import(pathToFileURL(arquivo).href)) as Record<string, unknown>;
    for (const exportado of Object.values(modulo)) {
      if (typeof exportado === 'function') classes.push(exportado as new () => object);
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

describe.skipIf(!DIRECT_URL)('agendamentos contra PostgreSQL descartável (Lote 6D.5)', () => {
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
      days: [{ weekday: WEEKDAY_DA_DATA, intervals: [{ start: inicio, end: fim }] }],
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

  function agendar(cenario: Cenario, startAt = NOVE_HORAS, sobrescreve: Partial<Cenario> = {}) {
    return agendamentos.create(
      sobrescreve.ownerUserId ?? cenario.ownerUserId,
      sobrescreve.tenantId ?? cenario.tenantId,
      {
        professionalId: sobrescreve.professionalId ?? cenario.professionalId,
        serviceId: sobrescreve.serviceId ?? cenario.serviceId,
        startAt,
        consumer: { mode: 'existing', consumerId: sobrescreve.consumerId ?? cenario.consumerId },
      },
    );
  }

  beforeAll(async () => {
    const entidades = await carregarEntidades();
    const opcoesBase = buildRuntimeDataSourceOptions(DIRECT_URL as string);

    dataSource = new DataSource({ ...opcoesBase, entities: entidades, logging: ['error'] });
    await dataSource.initialize();

    disponibilidade = new AvailabilityService(dataSource, () => AGORA);
    clientes = new ConsumersService(dataSource);
    agendamentos = new AppointmentsService(dataSource, disponibilidade, clientes);
    profissionais = new ProfessionalsService(dataSource);
    servicos = new ServicesService(dataSource);
    horarios = new ProfessionalWorkingHoursService(dataSource);

    const plan = await dataSource.manager.findOne(Plan, { where: { code: 'equipe' } });
    if (!plan) throw new Error('Catálogo de planos ausente — migrations não foram aplicadas.');
    planId = plan.id;
  }, 30_000);

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it('grava o agendamento e o item, com as colunas reais', async () => {
    const cenario = await criarCenario('base');

    const view = await agendar(cenario);

    const gravado = await dataSource.manager.findOne(Appointment, { where: { id: view.id } });
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
    const cenario = await criarCenario('manual', { requiresManualConfirmation: true });

    const view = await agendar(cenario);

    const gravado = await dataSource.manager.findOne(Appointment, { where: { id: view.id } });
    expect(gravado!.status).toBe(AppointmentStatus.PENDING);
  });

  it('o buffer entra na janela PERSISTIDA e bloqueia o horário seguinte', async () => {
    // 30 min de atendimento + 15 de buffer: a ocupação vai até 09:45.
    const cenario = await criarCenario('buffer', {
      durationMinutes: 30,
      bufferAfterMinutes: 15,
    });

    const view = await agendar(cenario);

    const gravado = await dataSource.manager.findOne(Appointment, { where: { id: view.id } });
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
    await expect(agendar(cenario, '2026-09-20T12:30:00.000Z')).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(agendar(cenario, '2026-09-20T12:45:00.000Z')).resolves.toBeDefined();
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
      await dataSource.manager.count(Appointment, { where: { tenantId: cenario.tenantId } }),
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
    expect((falhas[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException);

    // A linha final no banco é o que vale, não a resposta HTTP.
    expect(
      await dataSource.manager.count(Appointment, { where: { tenantId: cenario.tenantId } }),
    ).toBe(1);
  });

  it('cliente novo e reserva são gravados na MESMA transação', async () => {
    const cenario = await criarCenario('cliente-novo');
    const antes = await dataSource.manager.count(Consumer, { where: { tenantId: cenario.tenantId } });

    const view = await agendamentos.create(cenario.ownerUserId, cenario.tenantId, {
      professionalId: cenario.professionalId,
      serviceId: cenario.serviceId,
      startAt: NOVE_HORAS,
      consumer: { mode: 'new', data: { name: 'Cliente Novíssimo', whatsapp: '(11) 97777-6666' } },
    });

    expect(
      await dataSource.manager.count(Consumer, { where: { tenantId: cenario.tenantId } }),
    ).toBe(antes + 1);
    const gravado = await dataSource.manager.findOne(Appointment, { where: { id: view.id } });
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
        consumer: { mode: 'new', data: { name: 'Nunca Deveria Existir', whatsapp: '(11) 96666-5555' } },
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    // O cliente criado dentro da transação que falhou não pode ter ficado.
    expect(
      await dataSource.manager.count(Consumer, { where: { tenantId: cenario.tenantId } }),
    ).toBe(clientesAntes);
    expect(
      await dataSource.manager.count(Appointment, { where: { tenantId: cenario.tenantId } }),
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
      agendar(cenarioA, NOVE_HORAS, { professionalId: cenarioB.professionalId }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      agendar(cenarioA, NOVE_HORAS, { serviceId: cenarioB.serviceId }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      agendar(cenarioA, NOVE_HORAS, { consumerId: cenarioB.consumerId }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(agendar(cenarioA, NOVE_HORAS, { tenantId: cenarioB.tenantId })).rejects.toBeInstanceOf(
      NotFoundException,
    );

    // Nenhuma das tentativas gravou nada em nenhum dos dois estabelecimentos.
    expect(
      await dataSource.manager.count(Appointment, { where: { tenantId: cenarioA.tenantId } }),
    ).toBe(0);
    expect(
      await dataSource.manager.count(Appointment, { where: { tenantId: cenarioB.tenantId } }),
    ).toBe(0);
  });

  it('serviço desativado no meio do caminho impede a reserva', async () => {
    const cenario = await criarCenario('desativado');
    await servicos.deactivate(cenario.ownerUserId, cenario.tenantId, cenario.serviceId);

    await expect(agendar(cenario)).rejects.toBeInstanceOf(BadRequestException);
    expect(
      await dataSource.manager.count(Appointment, { where: { tenantId: cenario.tenantId } }),
    ).toBe(0);
  });

  it('vínculo removido impede a reserva', async () => {
    const cenario = await criarCenario('sem-vinculo');
    await profissionais.setServices(cenario.ownerUserId, cenario.tenantId, cenario.professionalId, {
      serviceIds: [],
    });

    await expect(agendar(cenario)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('jornada alterada para não cobrir o horário impede a reserva', async () => {
    const cenario = await criarCenario('jornada');
    // A semana passa a começar só às 14:00 — 09:00 deixa de existir.
    await horarios.replace(cenario.ownerUserId, cenario.tenantId, cenario.professionalId, {
      days: [{ weekday: WEEKDAY_DA_DATA, intervals: [{ start: '14:00', end: '18:00' }] }],
    });

    await expect(agendar(cenario)).rejects.toBeInstanceOf(BadRequestException);
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

    const lista = await agendamentos.list(cenario.ownerUserId, cenario.tenantId, { date: DATA });
    expect(lista.appointments.map((a) => a.id)).toContain(view.id);
    expect(lista.appointments[0].localStart).toBe('09:00');
    expect(lista.timezone).toBe('America/Sao_Paulo');
  });

  it('divergência conhecida do NO_SHOW: o GET oferece, o INSERT recusa com 409', async () => {
    // Não é o comportamento desejado — é o que o banco e o motor de
    // disponibilidade fazem HOJE, e está fixado aqui para a divergência
    // ficar visível em vez de virar surpresa em produção. A constraint só
    // ignora `CANCELED`; o motor também libera `NO_SHOW`. Mudar isso exige
    // decisão de negócio e migration (ver appointments.service.ts).
    const cenario = await criarCenario('no-show');
    const view = await agendar(cenario);

    // Não existe rota de mudança de status neste lote: o estado é alterado
    // direto na tabela, exatamente para não inventar endpoint para o teste.
    await dataSource.manager.update(Appointment, { id: view.id }, {
      status: AppointmentStatus.NO_SHOW,
    });

    const livres = await disponibilidade.consult(
      cenario.ownerUserId,
      cenario.tenantId,
      cenario.professionalId,
      { serviceId: cenario.serviceId, date: DATA },
    );
    // O motor considera o horário livre de novo...
    expect(livres.slots.map((s) => s.localStart)).toContain('09:00');

    // ...mas a constraint continua ocupando, então a gravação é recusada de
    // forma controlada (409), nunca com erro cru de banco vazando.
    await expect(agendar(cenario)).rejects.toBeInstanceOf(ConflictException);

    expect(
      await dataSource.manager.count(Appointment, { where: { tenantId: cenario.tenantId } }),
    ).toBe(1);
  });

  it('a listagem de um dia nunca mostra agendamento de outro estabelecimento', async () => {
    const cenarioA = await criarCenario('lista-a');
    const cenarioB = await criarCenario('lista-b');
    await agendar(cenarioA);
    await agendar(cenarioB);

    const lista = await agendamentos.list(cenarioA.ownerUserId, cenarioA.tenantId, { date: DATA });

    expect(lista.appointments).toHaveLength(1);
    expect(lista.appointments[0].professional.id).toBe(cenarioA.professionalId);
  });

  it('o detalhe de um agendamento de outro estabelecimento é 404', async () => {
    const cenarioA = await criarCenario('detalhe-a');
    const cenarioB = await criarCenario('detalhe-b');
    const deB = await agendar(cenarioB);

    await expect(
      agendamentos.get(cenarioA.ownerUserId, cenarioA.tenantId, deB.id),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
