// Agendamento com vários serviços contra PostgreSQL DESCARTÁVEL (dados
// fictícios; ver docs/plans/agendamento-multiplos-servicos.md). Prova:
// - Corte R$ 42,50/30 min + Barba R$ 25,00/30 min = UMA reserva de
//   R$ 67,50/60 min, com dois itens congelados;
// - a disponibilidade e a constraint usam o intervalo completo;
// - profissional incompatível e serviço de outro estabelecimento recusados;
// - duas reservas simultâneas: uma só, sem itens parciais;
// - mudar ou desativar o serviço depois não reescreve a reserva;
// - remarcar preserva a largura; cancelar não apaga itens;
// - reserva antiga (item sem nome congelado) continua legível;
// - pedido público com vários serviços.
import { globSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppointmentsService } from '../src/appointments/appointments.service.js';
import { ITENS_DA_RESERVA_SQL } from '../src/appointments/appointment-items-sql.js';
import { AvailabilityService } from '../src/availability/availability.service.js';
import { ConsumersService } from '../src/consumers/consumers.service.js';
import { buildRuntimeDataSourceOptions } from '../src/database/runtime-data-source.js';
import { Appointment } from '../src/entities/appointment.entity.js';
import { AppointmentItem } from '../src/entities/appointment-item.entity.js';
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
  const classes: (new () => object)[] = [];
  for (const arquivo of globSync(path.join(testDir, '../src/entities/**/*.entity.ts').replaceAll('\\', '/'))) {
    const modulo = (await import(pathToFileURL(arquivo).href)) as Record<string, unknown>;
    for (const exportado of Object.values(modulo)) {
      if (typeof exportado === 'function') classes.push(exportado as new () => object);
    }
  }
  return classes;
}

/** Domingo bem no futuro; 09:00 em São Paulo. */
const DATA = '2026-09-20';
const WEEKDAY = 0;
const NOVE = '2026-09-20T12:00:00.000Z';
const NOVE_E_MEIA = '2026-09-20T12:30:00.000Z';
const DEZ = '2026-09-20T13:00:00.000Z';
const AGORA = new Date('2026-09-01T12:00:00Z');

interface Cenario {
  tenantId: string;
  ownerUserId: string;
  professionalId: string;
  /** Faz só o corte: incompatível com a combinação. */
  soCorteId: string;
  corteId: string;
  barbaId: string;
  consumerId: string;
}

describe.skipIf(!DIRECT_URL)('agendamento com vários serviços contra PostgreSQL descartável', () => {
  let dataSource: DataSource;
  let agendamentos: AppointmentsService;
  let disponibilidade: AvailabilityService;
  let clientes: ConsumersService;
  let profissionais: ProfessionalsService;
  let servicos: ServicesService;
  let horarios: ProfessionalWorkingHoursService;
  let planId: string;
  const sufixo = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

  async function criarCenario(nome: string, barba: { bufferAfterMinutes?: number; publico?: boolean } = {}): Promise<Cenario> {
    const manager = dataSource.manager;
    const tenant = await manager.save(
      manager.create(Tenant, {
        slug: `e2e-multi-${nome}-${sufixo}`,
        category: BusinessCategory.BARBERSHOP,
        timezone: 'America/Sao_Paulo',
        planId,
        status: TenantStatus.ACTIVE,
      }),
    );
    await manager.query('UPDATE tenants SET access_legacy_since = now() WHERE id = $1', [tenant.id]);
    await manager.save(
      manager.create(Unit, { tenantId: tenant.id, name: `Unidade ${nome}`, address: '', timezone: 'America/Sao_Paulo', isPrimary: true }),
    );
    const user = await manager.save(
      manager.create(User, { name: `Dono ${nome}`, email: `dono-multi-${nome}-${sufixo}@example.test`, status: UserStatus.ACTIVE }),
    );
    await manager.save(manager.create(Membership, { userId: user.id, tenantId: tenant.id, role: EstablishmentRole.DONO }));
    const base = {
      shortDescription: '',
      priceVisible: true,
      modality: ServiceModality.IN_PERSON,
      activeInPublicBooking: true,
      requiresManualConfirmation: false,
    };
    const corte = await servicos.create(user.id, tenant.id, {
      ...base,
      name: 'Corte',
      priceCents: 4250,
      durationMinutes: 30,
      bufferAfterMinutes: 0,
    });
    const barbaCriada = await servicos.create(user.id, tenant.id, {
      ...base,
      name: 'Barba',
      priceCents: 2500,
      durationMinutes: 30,
      bufferAfterMinutes: barba.bufferAfterMinutes ?? 0,
      activeInPublicBooking: barba.publico ?? true,
    });
    const profissional = await profissionais.create(user.id, tenant.id, { name: `Ana ${nome}`, serviceIds: [corte.id, barbaCriada.id] });
    const soCorte = await profissionais.create(user.id, tenant.id, { name: `Bia ${nome}`, serviceIds: [corte.id] });
    for (const p of [profissional, soCorte]) {
      await horarios.replace(user.id, tenant.id, p.id, { days: [{ weekday: WEEKDAY, intervals: [{ start: '09:00', end: '18:00' }] }] });
    }
    const consumidor = await clientes.create(user.id, tenant.id, {
      name: `Cliente ${nome}`,
      whatsapp: `(11) 9${Math.floor(Math.random() * 90_000_000 + 10_000_000)}`,
    });
    return {
      tenantId: tenant.id,
      ownerUserId: user.id,
      professionalId: profissional.id,
      soCorteId: soCorte.id,
      corteId: corte.id,
      barbaId: barbaCriada.id,
      consumerId: consumidor.id,
    };
  }

  const agendar = (c: Cenario, serviceIds: string[], startAt = NOVE, professionalId = c.professionalId, tenantId = c.tenantId) =>
    agendamentos.create(c.ownerUserId, tenantId, {
      professionalId,
      serviceIds,
      startAt,
      consumer: { mode: 'existing', consumerId: c.consumerId },
    });

  beforeAll(async () => {
    dataSource = new DataSource({
      ...buildRuntimeDataSourceOptions(DIRECT_URL as string),
      entities: await carregarEntidades(),
      logging: ['error'],
    });
    await dataSource.initialize();
    disponibilidade = new AvailabilityService(dataSource, () => AGORA);
    clientes = new ConsumersService(dataSource);
    agendamentos = new AppointmentsService(dataSource, disponibilidade, clientes, () => AGORA);
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

  it('Corte R$ 42,50/30 min + Barba R$ 25,00/30 min = uma reserva de R$ 67,50/60 min com dois itens', async () => {
    const c = await criarCenario('soma');
    // Resumo antes de confirmar, calculado no servidor.
    const consulta = await disponibilidade.consult(c.ownerUserId, c.tenantId, c.professionalId, {
      serviceIds: [c.corteId, c.barbaId],
      date: DATA,
    });
    expect(consulta).toMatchObject({
      serviceId: c.corteId,
      serviceIds: [c.corteId, c.barbaId],
      durationMinutes: 60,
      totalPriceCents: 6750,
      priceHidden: false,
      services: [
        { id: c.corteId, name: 'Corte', durationMinutes: 30, priceCents: 4250 },
        { id: c.barbaId, name: 'Barba', durationMinutes: 30, priceCents: 2500 },
      ],
    });
    const view = await agendar(c, [c.corteId, c.barbaId]);

    expect(view).toMatchObject({
      durationMinutes: 60,
      priceCents: 6750,
      service: { id: c.corteId, name: 'Corte + Barba' },
      services: [
        { id: c.corteId, name: 'Corte', priceCents: 4250, durationMinutes: 30 },
        { id: c.barbaId, name: 'Barba', priceCents: 2500, durationMinutes: 30 },
      ],
      status: AppointmentStatus.CONFIRMED,
    });
    const gravado = await dataSource.manager.findOneOrFail(Appointment, { where: { id: view.id } });
    expect(gravado.endAt.toISOString()).toBe(DEZ);
    const itens = await dataSource.manager.find(AppointmentItem, { where: { appointmentId: view.id }, order: { position: 'ASC' } });
    expect(itens.map((i) => [i.serviceId, i.serviceNameSnapshot, i.priceCentsSnapshot, i.durationMinutesSnapshot, i.position])).toEqual([
      [c.corteId, 'Corte', 4250, 30, 0],
      [c.barbaId, 'Barba', 2500, 30, 1],
    ]);
    // As leituras em SQL (recebimentos, visão geral, agenda própria) somam igual.
    const [agregado] = await dataSource.query(`SELECT i.* FROM appointments a ${ITENS_DA_RESERVA_SQL} WHERE a.id = $1`, [view.id]);
    expect(agregado).toMatchObject({ service_name: 'Corte + Barba', duration_minutes: 60 });
    expect(Number(agregado.price_cents)).toBe(6750);
    expect(await dataSource.manager.count(Appointment, { where: { tenantId: c.tenantId } })).toBe(1);
  });

  it('a disponibilidade considera a duração completa e o maior intervalo depois do atendimento', async () => {
    const c = await criarCenario('grade', { bufferAfterMinutes: 10 });
    const combo = await disponibilidade.calcular(dataSource.manager, c.tenantId, c.professionalId, [c.corteId, c.barbaId], DATA);
    expect(combo.duracaoMinutos).toBe(60);
    expect(combo.bufferMinutos).toBe(10);
    const ultimoCombo = combo.resultado.slots.at(-1)!;
    const soCorte = await disponibilidade.calcular(dataSource.manager, c.tenantId, c.professionalId, c.corteId, DATA);
    // Jornada até 18:00: 30 min cabem às 17:30; 60 + 10 não.
    expect(soCorte.resultado.slots.at(-1)!.localStart).toBe('17:30');
    expect(ultimoCombo.localStart <= '16:50').toBe(true);
    const view = await agendar(c, [c.barbaId, c.corteId]);
    const gravado = await dataSource.manager.findOneOrFail(Appointment, { where: { id: view.id } });
    // Ordem escolhida preservada; ocupação = 60 + 10.
    expect(view.service.name).toBe('Barba + Corte');
    expect(gravado.endAt.toISOString()).toBe('2026-09-20T13:10:00.000Z');
  });

  it('conflito em qualquer parte do intervalo completo é recusado', async () => {
    const c = await criarCenario('conflito');
    // Reserva de um serviço às 09:30 ocupa a segunda metade da combinação das 09:00.
    await agendar(c, [c.corteId], NOVE_E_MEIA);
    // Início livre, fim sobreposto: o horário nem é oferecido (mesma regra de um serviço).
    await expect(agendar(c, [c.corteId, c.barbaId], NOVE)).rejects.toThrow(BadRequestException);
    // Começando dentro da reserva existente: ocupado.
    await expect(agendar(c, [c.corteId, c.barbaId], NOVE_E_MEIA)).rejects.toThrow(ConflictException);
    // Só o corte às 09:00 ainda cabe.
    await expect(agendar(c, [c.corteId], NOVE)).resolves.toMatchObject({ durationMinutes: 30 });
    expect(await dataSource.manager.count(Appointment, { where: { tenantId: c.tenantId } })).toBe(2);
  });

  it('profissional que não faz todos os serviços e serviço de outro estabelecimento são recusados', async () => {
    const c = await criarCenario('compat');
    const outro = await criarCenario('compat-outro');
    await expect(agendar(c, [c.corteId, c.barbaId], NOVE, c.soCorteId)).rejects.toThrow(BadRequestException);
    await expect(agendar(c, [c.corteId, outro.barbaId])).rejects.toThrow(NotFoundException);
    await expect(agendar(c, [c.corteId, c.corteId])).rejects.toThrow(BadRequestException);
    expect(await dataSource.manager.count(Appointment, { where: { tenantId: c.tenantId } })).toBe(0);
    expect(await dataSource.manager.count(Appointment, { where: { tenantId: outro.tenantId } })).toBe(0);
  });

  it('duas reservas simultâneas da mesma combinação: uma só, sem itens parciais', async () => {
    const c = await criarCenario('corrida');
    const resultados = await Promise.allSettled([
      agendar(c, [c.corteId, c.barbaId]),
      agendar(c, [c.barbaId, c.corteId]),
    ]);
    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const recusa = resultados.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(recusa.reason).toBeInstanceOf(ConflictException);
    const reservas = await dataSource.manager.find(Appointment, { where: { tenantId: c.tenantId } });
    expect(reservas).toHaveLength(1);
    expect(await dataSource.manager.count(AppointmentItem, { where: { tenantId: c.tenantId } })).toBe(2);
  });

  it('mudar, desativar o serviço, remarcar e cancelar não reescrevem os itens contratados', async () => {
    const c = await criarCenario('historico');
    const view = await agendar(c, [c.corteId, c.barbaId]);
    await dataSource.query(`UPDATE services SET name = 'Corte novo', price_cents = 9999, duration_minutes = 45 WHERE id = $1`, [c.corteId]);
    await dataSource.query(`UPDATE services SET active = false WHERE id = $1`, [c.barbaId]);
    const relido = await agendamentos.get(c.ownerUserId, c.tenantId, view.id);
    expect(relido).toMatchObject({ durationMinutes: 60, priceCents: 6750, service: { name: 'Corte + Barba' } });

    // Remarcar exige os serviços ativos (direito de atender é atual) e preserva a largura.
    await dataSource.query(`UPDATE services SET active = true WHERE id = $1`, [c.barbaId]);
    const opcoes = await agendamentos.rescheduleOptions(c.ownerUserId, c.tenantId, view.id, { date: DATA });
    expect(opcoes.durationMinutes).toBe(60);
    const movida = await agendamentos.reschedule(c.ownerUserId, c.tenantId, view.id, { startAt: DEZ, expectedStartAt: NOVE });
    expect(movida).toMatchObject({ startAt: DEZ, durationMinutes: 60, priceCents: 6750 });
    const gravado = await dataSource.manager.findOneOrFail(Appointment, { where: { id: view.id } });
    expect(gravado.endAt.toISOString()).toBe('2026-09-20T14:00:00.000Z');

    await agendamentos.cancel(c.ownerUserId, c.tenantId, view.id, { expectedStartAt: DEZ });
    expect(await dataSource.manager.count(AppointmentItem, { where: { appointmentId: view.id } })).toBe(2);
    // Cancelada libera o intervalo inteiro.
    await expect(agendar(c, [c.barbaId], '2026-09-20T13:30:00.000Z')).resolves.toBeTruthy();
  });

  it('reserva antiga de um serviço (item sem nome congelado) continua legível, sem valores inventados', async () => {
    const c = await criarCenario('antiga');
    const view = await agendar(c, [c.corteId]);
    await dataSource.query(`UPDATE appointment_items SET service_name_snapshot = NULL WHERE appointment_id = $1`, [view.id]);
    const relido = await agendamentos.get(c.ownerUserId, c.tenantId, view.id);
    expect(relido).toMatchObject({ durationMinutes: 30, priceCents: 4250, service: { name: 'Corte' }, services: [{ name: 'Corte' }] });
  });

  it('pedido público com vários serviços: uma reserva pendente; serviço fora do online recusa a combinação', async () => {
    const c = await criarCenario('publico');
    const criado = await dataSource.transaction((tx) =>
      agendamentos.criarPedidoPublico(tx, {
        tenantId: c.tenantId,
        professionalId: c.professionalId,
        serviceIds: [c.corteId, c.barbaId],
        startAt: new Date(NOVE),
        consumerId: c.consumerId,
        nomeInformado: 'Cliente Fictício',
        whatsappInformado: '(11) 99999-0000',
      }),
    );
    expect(criado.appointment.status).toBe(AppointmentStatus.PENDING);
    expect(criado.serviceName).toBe('Corte + Barba');
    expect(await dataSource.manager.count(AppointmentItem, { where: { appointmentId: criado.appointment.id } })).toBe(2);

    const fora = await criarCenario('publico-fora', { publico: false });
    await expect(
      dataSource.transaction((tx) =>
        agendamentos.criarPedidoPublico(tx, {
          tenantId: fora.tenantId,
          professionalId: fora.professionalId,
          serviceIds: [fora.corteId, fora.barbaId],
          startAt: new Date(NOVE),
          consumerId: fora.consumerId,
          nomeInformado: 'Cliente Fictício',
          whatsappInformado: '(11) 99999-0000',
        }),
      ),
    ).rejects.toThrow(BadRequestException);
    expect(await dataSource.manager.count(Appointment, { where: { tenantId: fora.tenantId } })).toBe(0);
  });
});
