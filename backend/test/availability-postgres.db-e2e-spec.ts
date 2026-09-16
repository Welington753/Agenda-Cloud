// Integração real da consulta de disponibilidade (Lote 6D.4) contra
// PostgreSQL DESCARTÁVEL — nunca Neon, nunca banco existente, nunca `.env`
// local. Só roda com `DB_E2E_DIRECT_URL`; o schema é o real, aplicado pelas
// migrations versionadas, e este arquivo nunca cria nem altera tabela.
// `rejectUnauthorized: true` nunca é enfraquecido (o certificado do container
// é confiado via NODE_EXTRA_CA_CERTS).
//
// Prova o que fake em memória não prova: que o `WHERE` de sobreposição
// escrito em SQL de verdade traz os conflitos certos — inclusive um evento
// que COMEÇOU no dia anterior —, que tudo é escopado por tenant, e que a
// consulta não grava nada.
//
// FIXTURES: agendamentos e bloqueios são montados aqui, direto nas tabelas.
// Nenhuma rota de gravação é criada só para preparar teste — este lote não
// tem gravação nenhuma.
import { globSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
import { Service } from '../src/entities/service.entity.js';
import { Tenant } from '../src/entities/tenant.entity.js';
import { TimeBlock } from '../src/entities/time-block.entity.js';
import { Unit } from '../src/entities/unit.entity.js';
import { User } from '../src/entities/user.entity.js';
import { AvailabilityService } from '../src/availability/availability.service.js';
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
/** Relógio fixo, bem antes da data consultada. */
const AGORA = new Date('2026-09-01T12:00:00Z');

interface Cenario {
  tenantId: string;
  unitId: string;
  ownerUserId: string;
  professionalId: string;
  serviceId: string;
  consumerId: string;
}

describe.skipIf(!DIRECT_URL)('disponibilidade contra PostgreSQL descartável (Lote 6D.4)', () => {
  let dataSource: DataSource;
  let disponibilidade: AvailabilityService;
  let profissionais: ProfessionalsService;
  let servicos: ServicesService;
  let horarios: ProfessionalWorkingHoursService;
  let planId: string;
  const sufixo = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

  async function criarCenario(
    nome: string,
    opcoes: { timezone?: string; durationMinutes?: number; jornada?: string[] } = {},
  ): Promise<Cenario> {
    const manager = dataSource.manager;
    const timezone = opcoes.timezone ?? 'America/Sao_Paulo';

    const tenant = await manager.save(
      manager.create(Tenant, {
        slug: `e2e-disp-${nome}-${sufixo}`,
        category: BusinessCategory.OTHER,
        timezone,
        planId,
        status: TenantStatus.ACTIVE,
      }),
    );
    const unit = await manager.save(
      manager.create(Unit, {
        tenantId: tenant.id,
        name: `Unidade ${nome}`,
        address: '',
        timezone,
        isPrimary: true,
      }),
    );
    const user = await manager.save(
      manager.create(User, {
        name: `Dono ${nome}`,
        email: `dono-disp-${nome}-${sufixo}@example.test`,
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
      priceCents: null,
      priceVisible: true,
      durationMinutes: opcoes.durationMinutes ?? 60,
      bufferAfterMinutes: 0,
      modality: ServiceModality.IN_PERSON,
      activeInPublicBooking: true,
      requiresManualConfirmation: false,
    });

    const profissional = await profissionais.create(user.id, tenant.id, {
      name: `Profissional ${nome}`,
      serviceIds: [servico.id],
    });

    const [inicio, fim] = opcoes.jornada ?? ['09:00', '12:00'];
    await horarios.replace(user.id, tenant.id, profissional.id, {
      days: [{ weekday: WEEKDAY_DA_DATA, intervals: [{ start: inicio, end: fim }] }],
    });

    const consumidor = await manager.save(
      manager.create(Consumer, {
        tenantId: tenant.id,
        name: `Cliente ${nome}`,
        whatsapp: '(11) 90000-0000',
        whatsappNormalized: `5511${Math.floor(Math.random() * 1_000_000_000)}`,
      }),
    );

    return {
      tenantId: tenant.id,
      unitId: unit.id,
      ownerUserId: user.id,
      professionalId: profissional.id,
      serviceId: servico.id,
      consumerId: consumidor.id,
    };
  }

  /** Agendamento montado direto na tabela real, com as colunas reais. */
  async function agendar(
    cenario: Cenario,
    inicio: string,
    fim: string,
    opcoes: { status?: AppointmentStatus; professionalId?: string; duracaoSnapshot?: number } = {},
  ): Promise<Appointment> {
    const manager = dataSource.manager;
    const agendamento = await manager.save(
      manager.create(Appointment, {
        tenantId: cenario.tenantId,
        unitId: cenario.unitId,
        consumerId: cenario.consumerId,
        consumerNameSnapshot: 'Cliente de Teste',
        consumerWhatsappSnapshot: '5511900000000',
        professionalId: opcoes.professionalId ?? cenario.professionalId,
        startAt: new Date(inicio),
        endAt: new Date(fim),
        status: opcoes.status ?? AppointmentStatus.CONFIRMED,
      }),
    );

    await manager.save(
      manager.create(AppointmentItem, {
        tenantId: cenario.tenantId,
        appointmentId: agendamento.id,
        serviceId: cenario.serviceId,
        durationMinutesSnapshot:
          opcoes.duracaoSnapshot ??
          Math.round((new Date(fim).getTime() - new Date(inicio).getTime()) / 60_000),
        position: 0,
      }),
    );

    return agendamento;
  }

  async function consultar(cenario: Cenario, sobrescreve: Partial<Cenario> = {}) {
    return disponibilidade.consult(
      sobrescreve.ownerUserId ?? cenario.ownerUserId,
      sobrescreve.tenantId ?? cenario.tenantId,
      sobrescreve.professionalId ?? cenario.professionalId,
      { serviceId: sobrescreve.serviceId ?? cenario.serviceId, date: DATA },
    );
  }

  beforeAll(async () => {
    const entidades = await carregarEntidades();
    const opcoesBase = buildRuntimeDataSourceOptions(DIRECT_URL as string);

    dataSource = new DataSource({ ...opcoesBase, entities: entidades, logging: ['error'] });
    await dataSource.initialize();

    disponibilidade = new AvailabilityService(dataSource, () => AGORA);
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

  it('a jornada gravada vira horários reais, com os instantes do fuso do estabelecimento', async () => {
    const cenario = await criarCenario('base');

    const resposta = await consultar(cenario);

    expect(resposta.timezone).toBe('America/Sao_Paulo');
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

  it('agendamento gravado no banco some da lista — o SQL de sobreposição funciona', async () => {
    const cenario = await criarCenario('conflito');
    await agendar(cenario, '2026-09-20T13:00:00Z', '2026-09-20T14:00:00Z'); // 10:00-11:00

    const horas = (await consultar(cenario)).slots.map((s) => s.localStart);

    expect(horas).toContain('09:00'); // termina 10:00, encosta e vale
    expect(horas).not.toContain('09:15');
    expect(horas).not.toContain('10:00');
    expect(horas).not.toContain('10:45');
    expect(horas).toContain('11:00');
  });

  it('evento que COMEÇOU no dia anterior é carregado e ocupa a manhã', async () => {
    const cenario = await criarCenario('atravessa');
    // 19/09 23:00 -> 20/09 10:00, hora local de São Paulo.
    await agendar(cenario, '2026-09-20T02:00:00Z', '2026-09-20T13:00:00Z');

    const horas = (await consultar(cenario)).slots.map((s) => s.localStart);

    expect(horas).toEqual(['10:00', '10:15', '10:30', '10:45', '11:00']);
  });

  it('evento que começa no dia consultado e termina no seguinte também é carregado', async () => {
    const cenario = await criarCenario('noite', { jornada: ['18:00', '23:00'] });
    // 20/09 20:00 -> 21/09 02:00, hora local.
    await agendar(cenario, '2026-09-20T23:00:00Z', '2026-09-21T05:00:00Z');

    const horas = (await consultar(cenario)).slots.map((s) => s.localStart);

    expect(horas).toContain('18:00');
    expect(horas).not.toContain('19:15');
    expect(horas).not.toContain('20:00');
    expect(horas[horas.length - 1]).toBe('19:00');
  });

  it.each([AppointmentStatus.CANCELED, AppointmentStatus.NO_SHOW])(
    'agendamento %s gravado no banco não ocupa',
    async (status) => {
      const cenario = await criarCenario(`livre-${status.toLowerCase()}`);
      await agendar(cenario, '2026-09-20T13:00:00Z', '2026-09-20T14:00:00Z', { status });

      expect((await consultar(cenario)).slots.map((s) => s.localStart)).toContain('10:00');
    },
  );

  it('bloqueio gravado em time_blocks ocupa', async () => {
    const cenario = await criarCenario('bloqueio');
    await dataSource.manager.save(
      dataSource.manager.create(TimeBlock, {
        tenantId: cenario.tenantId,
        professionalId: cenario.professionalId,
        startAt: new Date('2026-09-20T12:00:00Z'),
        endAt: new Date('2026-09-20T13:00:00Z'),
        reason: 'Reunião interna',
      }),
    );

    const horas = (await consultar(cenario)).slots.map((s) => s.localStart);

    expect(horas).not.toContain('09:00');
    expect(horas).toContain('10:00');
  });

  it('mudar a duração do catálogo não mexe na ocupação já gravada', async () => {
    const cenario = await criarCenario('historico', { durationMinutes: 30 });
    // Reserva antiga de 90 minutos (09:00-10:30 local).
    await agendar(cenario, '2026-09-20T12:00:00Z', '2026-09-20T13:30:00Z', {
      duracaoSnapshot: 90,
    });

    // O catálogo muda DEPOIS: agora o serviço dura 15 minutos.
    await servicos.update(cenario.ownerUserId, cenario.tenantId, cenario.serviceId, {
      durationMinutes: 15,
    });

    const resposta = await consultar(cenario);

    expect(resposta.durationMinutes).toBe(15);
    // A janela ocupada continua sendo a PERSISTIDA (09:00-10:30), não
    // 09:00-09:15 recalculada pela duração nova.
    expect(resposta.slots.map((s) => s.localStart)).toEqual([
      '10:30',
      '10:45',
      '11:00',
      '11:15',
      '11:30',
      '11:45',
    ]);
  });

  it('conflito de OUTRO estabelecimento nunca é carregado', async () => {
    const cenarioA = await criarCenario('iso-a');
    const cenarioB = await criarCenario('iso-b');

    // B ocupa o mesmo instante, no próprio estabelecimento.
    await agendar(cenarioB, '2026-09-20T12:00:00Z', '2026-09-20T13:00:00Z');

    expect((await consultar(cenarioA)).slots.map((s) => s.localStart)).toContain('09:00');
    expect((await consultar(cenarioB)).slots.map((s) => s.localStart)).not.toContain('09:00');
  });

  it('consultar o profissional de outro estabelecimento é 404, mesmo com sessão válida', async () => {
    const cenarioA = await criarCenario('cruzado-a');
    const cenarioB = await criarCenario('cruzado-b');

    await expect(
      consultar(cenarioA, { professionalId: cenarioB.professionalId }),
    ).rejects.toBeInstanceOf(NotFoundException);

    await expect(
      consultar(cenarioA, { tenantId: cenarioB.tenantId }),
    ).rejects.toBeInstanceOf(NotFoundException);

    await expect(consultar(cenarioA, { serviceId: cenarioB.serviceId })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('num fuso com horário de verão, a virada aparece nos instantes reais', async () => {
    const cenario = await criarCenario('fuso', { timezone: 'America/New_York' });
    // 2026-11-01 é domingo e é o dia em que 02:00 volta para 01:00 nos EUA.
    await horarios.replace(cenario.ownerUserId, cenario.tenantId, cenario.professionalId, {
      days: [{ weekday: 0, intervals: [{ start: '00:00', end: '04:00' }] }],
    });

    const resposta = await disponibilidade.consult(
      cenario.ownerUserId,
      cenario.tenantId,
      cenario.professionalId,
      { serviceId: cenario.serviceId, date: '2026-11-01' },
    );

    const umaHora = resposta.slots.filter((s) => s.localStart === '01:00');
    expect(umaHora.length).toBeGreaterThanOrEqual(2);
    // Mesma hora local, instantes distintos: a resposta os distingue.
    expect(new Set(umaHora.map((s) => s.startAt)).size).toBe(umaHora.length);
    expect(new Set(umaHora.map((s) => s.offsetLabel))).toEqual(new Set(['-04:00', '-05:00']));
  });

  it('consultar é somente leitura: nada é gravado em appointments nem em time_blocks', async () => {
    const cenario = await criarCenario('escopo');
    await agendar(cenario, '2026-09-20T13:00:00Z', '2026-09-20T14:00:00Z');

    const contar = async () => ({
      agendamentos: await dataSource.manager.count(Appointment, {
        where: { tenantId: cenario.tenantId },
      }),
      bloqueios: await dataSource.manager.count(TimeBlock, {
        where: { tenantId: cenario.tenantId },
      }),
      servicos: await dataSource.manager.count(Service, { where: { tenantId: cenario.tenantId } }),
    });

    const antes = await contar();
    await consultar(cenario);
    await consultar(cenario);

    expect(await contar()).toEqual(antes);
  });
});
