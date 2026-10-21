// Agendamento público e solicitações pendentes contra PostgreSQL DESCARTÁVEL —
// nunca Neon, nunca banco existente, nunca `.env`. Só roda com
// `DB_E2E_DIRECT_URL`; o schema é o das migrations versionadas (inclusive
// 1792540800000-NotificationJobs e 1792627200000-PublicBooking).
//
// Relógio CONTROLADO: `relogio` é a única fonte de "agora" do motor, da
// agenda e do pedido público.
import { globSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppointmentsService } from '../src/appointments/appointments.service.js';
import { AvailabilityService } from '../src/availability/availability.service.js';
import { ConsumersService } from '../src/consumers/consumers.service.js';
import { buildRuntimeDataSourceOptions } from '../src/database/runtime-data-source.js';
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
import {
  PublicBookingService,
  type PublicReceiptView,
} from '../src/public-booking/public-booking.service.js';
import { ServicesService } from '../src/services/services.service.js';

const DIRECT_URL = process.env.DB_E2E_DIRECT_URL;
const testDir = path.dirname(fileURLToPath(import.meta.url));

async function carregarEntidades(): Promise<(new () => object)[]> {
  const arquivos = globSync(
    path.join(testDir, '../src/entities/**/*.entity.ts').replaceAll('\\', '/'),
  );
  const classes: (new () => object)[] = [];
  for (const arquivo of arquivos) {
    const modulo = (await import(pathToFileURL(arquivo).href)) as Record<string, unknown>;
    for (const exportado of Object.values(modulo)) {
      if (typeof exportado === 'function') classes.push(exportado as new () => object);
    }
  }
  return classes;
}

/** Domingo 2027-03-07 (weekday 0), bem no futuro. */
const WEEKDAY = 0;
const DATA = '2027-03-07';
const SP = 'America/Sao_Paulo';
/** 10:00 e 11:00 em São Paulo (UTC-3). */
const DEZ = '2027-03-07T13:00:00.000Z';
const ONZE = '2027-03-07T14:00:00.000Z';
const MEIO_DIA = '2027-03-07T15:00:00.000Z';
const ANTECEDENCIA = new Date('2027-03-01T12:00:00.000Z');

interface Cenario {
  tenantId: string;
  slug: string;
  ownerUserId: string;
  professionalId: string;
  serviceId: string;
  unitName: string;
}

describe.skipIf(!DIRECT_URL)('agendamento público contra PostgreSQL descartável', () => {
  let dataSource: DataSource;
  let agendamentos: AppointmentsService;
  let publico: PublicBookingService;
  let clientes: ConsumersService;
  let profissionais: ProfessionalsService;
  let servicos: ServicesService;
  let horarios: ProfessionalWorkingHoursService;
  let planId: string;
  let relogio = ANTECEDENCIA;
  const agora = () => relogio;
  const sufixo = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  let contador = 0;
  let telefones = 0;

  /** Telefone novo por chamada — os limites por telefone não se cruzam. */
  function telefone(): string {
    telefones += 1;
    const n = String(10_000_000 + ((Number(sufixo.slice(-6)) * 7 + telefones) % 89_999_999));
    return `(11) 9${n}`;
  }

  let chaves = 0;
  const chave = () => `chave-${sufixo}-${(chaves += 1)}`.padEnd(16, 'x');

  async function criarCenario(
    opcoes: { timezone?: string; manual?: boolean; ligado?: boolean } = {},
  ): Promise<Cenario> {
    contador += 1;
    const nome = `p${contador}`;
    const timezone = opcoes.timezone ?? SP;
    const manager = dataSource.manager;
    const slug = `e2e-publico-${nome}-${sufixo}`;
    const tenant = await manager.save(
      manager.create(Tenant, {
        slug,
        category: BusinessCategory.OTHER,
        timezone,
        planId,
        status: TenantStatus.ACTIVE,
      }),
    );
    const unitName = `Clínica ${nome} & Saúde`;
    await manager.save(
      manager.create(Unit, { tenantId: tenant.id, name: unitName, address: 'Rua X', timezone, isPrimary: true }),
    );
    const user = await manager.save(
      manager.create(User, {
        name: `Dono ${nome}`,
        email: `dono-publico-${nome}-${sufixo}@example.test`,
        phone: '+5511900000000',
        status: UserStatus.ACTIVE,
      }),
    );
    await manager.save(
      manager.create(Membership, { userId: user.id, tenantId: tenant.id, role: EstablishmentRole.DONO }),
    );
    const servico = await servicos.create(user.id, tenant.id, {
      name: 'Sessão de fisioterapia',
      shortDescription: 'Avaliação e exercícios',
      priceCents: 12000,
      priceVisible: true,
      durationMinutes: 60,
      bufferAfterMinutes: 0,
      modality: ServiceModality.IN_PERSON,
      activeInPublicBooking: true,
      requiresManualConfirmation: opcoes.manual ?? false,
    });
    const profissional = await profissionais.create(user.id, tenant.id, {
      name: `Profissional ${nome}`,
      serviceIds: [servico.id],
    });
    await horarios.replace(user.id, tenant.id, profissional.id, {
      days: [{ weekday: WEEKDAY, intervals: [{ start: '09:00', end: '18:00' }] }],
    });
    if (opcoes.ligado ?? true) await publico.updateSettings(user.id, tenant.id, true);
    return {
      tenantId: tenant.id,
      slug,
      ownerUserId: user.id,
      professionalId: profissional.id,
      serviceId: servico.id,
      unitName,
    };
  }

  function pedir(
    c: Cenario,
    startAt: string,
    extra: Partial<{ name: string; whatsapp: string; idempotencyKey: string; serviceId: string; professionalId: string }> = {},
  ): Promise<PublicReceiptView> {
    return publico.request(c.slug, {
      serviceId: c.serviceId,
      professionalId: c.professionalId,
      startAt,
      name: 'Joana Pública',
      whatsapp: telefone(),
      idempotencyKey: chave(),
      ...extra,
    });
  }

  async function erroDe(promessa: Promise<unknown>): Promise<HttpException> {
    try {
      await promessa;
    } catch (erro) {
      if (erro instanceof HttpException) return erro;
      throw erro;
    }
    throw new Error('esperava falha HTTP');
  }

  beforeAll(async () => {
    const entidades = await carregarEntidades();
    dataSource = new DataSource({
      ...buildRuntimeDataSourceOptions(DIRECT_URL as string),
      entities: entidades,
      logging: ['error'],
    });
    await dataSource.initialize();
    const disponibilidade = new AvailabilityService(dataSource, agora);
    clientes = new ConsumersService(dataSource);
    agendamentos = new AppointmentsService(dataSource, disponibilidade, clientes, agora);
    publico = new PublicBookingService(dataSource, disponibilidade, agendamentos, agora);
    profissionais = new ProfessionalsService(dataSource);
    servicos = new ServicesService(dataSource);
    horarios = new ProfessionalWorkingHoursService(dataSource);
    const plan = await dataSource.manager.findOne(Plan, { where: { code: 'equipe' } });
    if (!plan) throw new Error('Catálogo de planos ausente — migrations não foram aplicadas.');
    planId = plan.id;
  }, 30_000);

  beforeEach(() => {
    relogio = ANTECEDENCIA;
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  // ------------------------------------------------------------ exposição

  it('não habilitado, suspenso ou inexistente: o mesmo 404 em todas as rotas públicas', async () => {
    const desligado = await criarCenario({ ligado: false });
    for (const chamar of [
      () => publico.profile(desligado.slug),
      () => publico.availabilityFor(desligado.slug, {
        serviceId: desligado.serviceId,
        professionalId: desligado.professionalId,
        date: DATA,
      }),
      () => pedir(desligado, DEZ),
      () => publico.profile(`nao-existe-${sufixo}`),
    ]) {
      const erro = await erroDe(chamar());
      expect(erro).toBeInstanceOf(NotFoundException);
      expect(erro.message).toBe('Página de agendamento não encontrada.');
    }
    // Nada foi criado pelo pedido recusado.
    const [{ total }] = (await dataSource.query(
      `SELECT count(*)::int AS total FROM appointments WHERE tenant_id = $1`,
      [desligado.tenantId],
    )) as { total: number }[];
    expect(total).toBe(0);

    const suspenso = await criarCenario();
    await dataSource.query(`UPDATE tenants SET status = 'SUSPENDED' WHERE id = $1`, [suspenso.tenantId]);
    expect(await erroDe(publico.profile(suspenso.slug))).toBeInstanceOf(NotFoundException);

    // Desligar depois de ligado volta a esconder.
    const c = await criarCenario();
    await publico.profile(c.slug);
    await publico.updateSettings(c.ownerUserId, c.tenantId, false);
    expect(await erroDe(publico.profile(c.slug))).toBeInstanceOf(NotFoundException);
  });

  it('perfil público: só serviço/profissional do online, sem dado privado nenhum', async () => {
    const c = await criarCenario();
    // Serviço fora do online, profissional fora do online e serviço inativo.
    const oculto = await servicos.create(c.ownerUserId, c.tenantId, {
      name: 'Serviço interno',
      shortDescription: '',
      priceCents: 1,
      priceVisible: false,
      durationMinutes: 30,
      bufferAfterMinutes: 0,
      modality: ServiceModality.IN_PERSON,
      activeInPublicBooking: false,
      requiresManualConfirmation: false,
    });
    const offline = await profissionais.create(c.ownerUserId, c.tenantId, {
      name: 'Profissional offline',
      serviceIds: [c.serviceId, oculto.id],
    });
    await dataSource.query(`UPDATE professionals SET online_booking_active = false WHERE id = $1`, [offline.id]);
    // Uma reserva com cliente e observação: nada disso pode aparecer.
    await agendamentos.create(c.ownerUserId, c.tenantId, {
      professionalId: c.professionalId,
      serviceId: c.serviceId,
      startAt: ONZE,
      consumer: { mode: 'new', data: { name: 'Cliente Secreto', whatsapp: '(11) 91234-0000', email: 'secreto@example.test' } },
      notes: 'observação interna',
    });

    const perfil = await publico.profile(c.slug.toUpperCase());
    expect(perfil.establishment).toEqual({ name: c.unitName, slug: c.slug, timezone: SP });
    expect(perfil.services.map((s) => s.id)).toEqual([c.serviceId]);
    expect(perfil.professionals.map((p) => p.id)).toEqual([c.professionalId]);
    expect(perfil.professionals[0].serviceIds).toEqual([c.serviceId]);

    const disponibilidade = await publico.availabilityFor(c.slug, {
      serviceId: c.serviceId,
      professionalId: c.professionalId,
      date: DATA,
    });
    expect(disponibilidade.slots.map((s) => s.localStart)).not.toContain('11:00');
    expect(Object.keys(disponibilidade.slots[0]).sort()).toEqual(['localStart', 'offsetLabel', 'startAt']);

    const texto = JSON.stringify([perfil, disponibilidade]);
    for (const proibido of ['Cliente Secreto', '91234', 'secreto@', 'observação', 'whatsapp', 'consumer', 'email', 'unitId', 'Serviço interno', 'offline']) {
      expect(texto).not.toContain(proibido);
    }

    // Profissional offline ou serviço oculto pedidos diretamente: recusa genérica.
    const generica = 'Este serviço ou profissional não está disponível para agendamento online. Escolha outra opção.';
    for (const query of [
      { serviceId: oculto.id, professionalId: c.professionalId, date: DATA },
      { serviceId: c.serviceId, professionalId: offline.id, date: DATA },
      { serviceId: 'inexistente', professionalId: c.professionalId, date: DATA },
    ]) {
      const erro = await erroDe(publico.availabilityFor(c.slug, query));
      expect(erro).toBeInstanceOf(BadRequestException);
      expect(erro.message).toBe(generica);
    }
  });

  // ------------------------------------------------------------ fluxo

  it('pedido nasce PENDING mesmo sem confirmação manual, aparece para o dono e é confirmado', async () => {
    const c = await criarCenario({ manual: false });
    const whatsapp = telefone();
    const idempotencyKey = chave();
    const recibo = await pedir(c, DEZ, { whatsapp, idempotencyKey, name: 'Joana  Pública' });
    expect(recibo).toEqual({
      status: AppointmentStatus.PENDING,
      startAt: DEZ,
      localDate: DATA,
      localStart: '10:00',
      timezone: SP,
      serviceName: 'Sessão de fisioterapia',
      professionalName: expect.stringMatching(/^Profissional /),
      establishmentName: c.unitName,
      replayed: false,
    });

    // Pendente não programa notificação nenhuma.
    const [linha] = (await dataSource.query(
      `SELECT a.id, a.status FROM appointments a
         JOIN public_booking_requests r ON r.appointment_id = a.id
        WHERE a.tenant_id = $1`,
      [c.tenantId],
    )) as { id: string; status: string }[];
    expect(linha.status).toBe('PENDING');
    expect(await dataSource.query(`SELECT 1 FROM notification_jobs WHERE appointment_id = $1`, [linha.id])).toEqual([]);

    // O horário pedido some da disponibilidade pública.
    const depois = await publico.availabilityFor(c.slug, { serviceId: c.serviceId, professionalId: c.professionalId, date: DATA });
    expect(depois.slots.map((s) => s.localStart)).not.toContain('10:00');

    // Painel: aparece como pedido online, e ler a lista não muda nada.
    const lista = await publico.pendingRequests(c.ownerUserId, c.tenantId);
    expect(lista.requests).toHaveLength(1);
    expect(lista.requests[0]).toMatchObject({ id: linha.id, origin: 'PUBLIC', status: 'PENDING', startAt: DEZ });
    expect(lista.requests[0].consumer.name).toBe('Joana  Pública');
    expect((await publico.pendingRequests(c.ownerUserId, c.tenantId)).requests[0].status).toBe('PENDING');

    // Tela desatualizada: confirmar com outro instante é recusado.
    expect(
      await erroDe(agendamentos.changeStatus(c.ownerUserId, c.tenantId, linha.id, 'confirm', { expectedStartAt: ONZE })),
    ).toBeInstanceOf(ConflictException);

    const confirmada = await agendamentos.changeStatus(c.ownerUserId, c.tenantId, linha.id, 'confirm', {
      expectedStartAt: DEZ,
    });
    expect(confirmada.status).toBe('CONFIRMED');
    // Base do PR #53: a confirmação programa as tarefas, sem autorização inventada.
    const kinds = (await dataSource.query(
      `SELECT kind FROM notification_jobs WHERE appointment_id = $1 ORDER BY kind`,
      [linha.id],
    )) as { kind: string }[];
    expect(kinds.map((k) => k.kind)).toEqual(['CONFIRMATION', 'REMINDER_2H', 'REMINDER_DAY_BEFORE']);
    const [cliente] = (await dataSource.query(
      `SELECT whatsapp_opt_in_at FROM consumers WHERE tenant_id = $1 AND whatsapp_normalized = $2`,
      [c.tenantId, `+55${whatsapp.replace(/\D/g, '')}`],
    )) as { whatsapp_opt_in_at: Date | null }[];
    expect(cliente.whatsapp_opt_in_at).toBeNull();

    // "Recarregar": sai da lista de pendentes e o estado persiste.
    expect((await publico.pendingRequests(c.ownerUserId, c.tenantId)).requests).toEqual([]);
    expect((await agendamentos.get(c.ownerUserId, c.tenantId, linha.id)).status).toBe('CONFIRMED');

    // Reenvio do mesmo envio (resposta perdida): o MESMO pedido, com o estado atual.
    const repetido = await publico.request(c.slug, {
      serviceId: c.serviceId,
      professionalId: c.professionalId,
      startAt: DEZ,
      name: 'Joana  Pública',
      whatsapp,
      idempotencyKey,
    });
    expect(repetido).toMatchObject({ replayed: true, status: 'CONFIRMED', startAt: DEZ });
    const [{ total }] = (await dataSource.query(
      `SELECT count(*)::int AS total FROM public_booking_requests WHERE tenant_id = $1`,
      [c.tenantId],
    )) as { total: number }[];
    expect(total).toBe(1);
  });

  it('recusar = cancelar: persiste, sai da lista e libera o horário', async () => {
    const c = await criarCenario();
    await pedir(c, DEZ);
    const [pedido] = (await publico.pendingRequests(c.ownerUserId, c.tenantId)).requests;
    const recusado = await agendamentos.cancel(c.ownerUserId, c.tenantId, pedido.id, { expectedStartAt: DEZ });
    expect(recusado.status).toBe('CANCELED');
    expect((await publico.pendingRequests(c.ownerUserId, c.tenantId)).requests).toEqual([]);
    expect((await agendamentos.get(c.ownerUserId, c.tenantId, pedido.id)).status).toBe('CANCELED');
    const livre = await publico.availabilityFor(c.slug, { serviceId: c.serviceId, professionalId: c.professionalId, date: DATA });
    expect(livre.slots.map((s) => s.localStart)).toContain('10:00');
  });

  it('dois clientes disputando o mesmo horário: um pedido grava, o outro recebe 409', async () => {
    const c = await criarCenario();
    const resultados = await Promise.allSettled([pedir(c, MEIO_DIA), pedir(c, MEIO_DIA)]);
    const aceitos = resultados.filter((r) => r.status === 'fulfilled');
    const recusados = resultados.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(aceitos).toHaveLength(1);
    expect(recusados).toHaveLength(1);
    expect(recusados[0].reason).toBeInstanceOf(ConflictException);
    expect((recusados[0].reason as Error).message).toBe('Este horário acabou de ser ocupado. Escolha outro horário disponível.');
    const [{ total }] = (await dataSource.query(
      `SELECT count(*)::int AS total FROM appointments WHERE tenant_id = $1 AND status <> 'CANCELED'`,
      [c.tenantId],
    )) as { total: number }[];
    expect(total).toBe(1);
    // Nenhum cliente órfão do pedido recusado: só o do aceito.
    const [{ clientesCriados }] = (await dataSource.query(
      `SELECT count(*)::int AS "clientesCriados" FROM consumers WHERE tenant_id = $1`,
      [c.tenantId],
    )) as { clientesCriados: number }[];
    expect(clientesCriados).toBe(1);
  });

  it('serviço desativado, fora do online, vínculo removido ou profissional offline antes da gravação: recusa genérica', async () => {
    const generica = 'Este serviço ou profissional não está disponível para agendamento online. Escolha outra opção.';
    const alteracoes: ((c: Cenario) => Promise<unknown>)[] = [
      (c) => dataSource.query(`UPDATE services SET active = false WHERE id = $1`, [c.serviceId]),
      (c) => dataSource.query(`UPDATE services SET active_in_public_booking = false WHERE id = $1`, [c.serviceId]),
      (c) => dataSource.query(`DELETE FROM professional_services WHERE service_id = $1`, [c.serviceId]),
      (c) => dataSource.query(`UPDATE professionals SET online_booking_active = false WHERE id = $1`, [c.professionalId]),
      (c) => dataSource.query(`UPDATE professionals SET active = false WHERE id = $1`, [c.professionalId]),
    ];
    for (const alterar of alteracoes) {
      const c = await criarCenario();
      // A pessoa viu o horário livre...
      const antes = await publico.availabilityFor(c.slug, { serviceId: c.serviceId, professionalId: c.professionalId, date: DATA });
      expect(antes.slots.map((s) => s.startAt)).toContain(DEZ);
      // ...e o cadastro mudou antes do envio.
      await alterar(c);
      const erro = await erroDe(pedir(c, DEZ));
      expect(erro).toBeInstanceOf(BadRequestException);
      expect(erro.message).toBe(generica);
      const [{ total }] = (await dataSource.query(
        `SELECT count(*)::int AS total FROM consumers WHERE tenant_id = $1`,
        [c.tenantId],
      )) as { total: number }[];
      expect(total, 'nenhum cliente criado por pedido recusado').toBe(0);
    }
  });

  it('horário fora da grade ou no passado: 400; ocupado: 409', async () => {
    const c = await criarCenario();
    expect(await erroDe(pedir(c, '2027-03-07T13:07:00.000Z'))).toBeInstanceOf(BadRequestException);
    expect(await erroDe(pedir(c, '2027-03-07T02:00:00.000Z'))).toBeInstanceOf(BadRequestException);
    relogio = new Date('2027-03-07T14:30:00.000Z');
    expect(await erroDe(pedir(c, DEZ))).toBeInstanceOf(BadRequestException);
    relogio = ANTECEDENCIA;
    await pedir(c, ONZE);
    expect(await erroDe(pedir(c, ONZE))).toBeInstanceOf(ConflictException);
  });

  // ------------------------------------------------------------ cliente existente

  it('telefone já cadastrado: resposta igual, cadastro intacto, sem autorização de contato inventada', async () => {
    const c = await criarCenario();
    const whatsapp = telefone();
    const existente = await clientes.create(c.ownerUserId, c.tenantId, {
      name: 'Nome Verdadeiro',
      whatsapp,
      email: 'verdadeiro@example.test',
    });

    const reciboExistente = await pedir(c, DEZ, { whatsapp, name: 'Impostor Qualquer' });
    const reciboNovo = await pedir(c, ONZE, { name: 'Impostor Qualquer' });
    const semHorario = (r: PublicReceiptView) => ({ ...r, startAt: '', localStart: '' });
    expect(semHorario(reciboExistente)).toEqual(semHorario(reciboNovo));
    expect(Object.keys(reciboExistente).sort()).toEqual(
      ['establishmentName', 'localDate', 'localStart', 'professionalName', 'replayed', 'serviceName', 'startAt', 'status', 'timezone'],
    );

    const [linha] = (await dataSource.query(
      `SELECT name, email, whatsapp_opt_in_at, whatsapp_opt_in_source FROM consumers WHERE id = $1`,
      [existente.id],
    )) as { name: string; email: string; whatsapp_opt_in_at: Date | null; whatsapp_opt_in_source: string | null }[];
    expect(linha).toEqual({
      name: 'Nome Verdadeiro',
      email: 'verdadeiro@example.test',
      whatsapp_opt_in_at: null,
      whatsapp_opt_in_source: null,
    });
    // O dono vê o nome informado no pedido (snapshot), ligado ao cadastro existente.
    const pedidos = (await publico.pendingRequests(c.ownerUserId, c.tenantId)).requests;
    const doExistente = pedidos.find((p) => p.startAt === DEZ)!;
    expect(doExistente.consumer).toMatchObject({ id: existente.id, name: 'Impostor Qualquer' });
  });

  // ------------------------------------------------------------ limites

  it('limites: chave repetida devolve o mesmo pedido, chave com outros dados 409, 2 pendentes e 3 por dia por telefone', async () => {
    const c = await criarCenario();
    const whatsapp = telefone();
    const k1 = chave();

    // Clique duplo: dois envios simultâneos com a MESMA chave → um pedido só.
    const [a, b] = await Promise.all([
      pedir(c, DEZ, { whatsapp, idempotencyKey: k1 }),
      pedir(c, DEZ, { whatsapp, idempotencyKey: k1 }),
    ]);
    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
    expect(a.startAt).toBe(b.startAt);

    expect(await erroDe(pedir(c, ONZE, { whatsapp, idempotencyKey: k1 }))).toBeInstanceOf(ConflictException);

    // Segundo pendente ainda cabe; o terceiro não.
    await pedir(c, ONZE, { whatsapp });
    const pendentes = await erroDe(pedir(c, MEIO_DIA, { whatsapp }));
    expect(pendentes.getStatus()).toBe(429);
    expect(pendentes.message).toMatch(/aguardando confirmação/);

    // Recusar um libera vaga de pendente, mas o limite diário (3) segura.
    const [primeiro] = (await publico.pendingRequests(c.ownerUserId, c.tenantId)).requests;
    await agendamentos.cancel(c.ownerUserId, c.tenantId, primeiro.id, { expectedStartAt: primeiro.startAt });
    await pedir(c, MEIO_DIA, { whatsapp });
    await agendamentos.cancel(
      c.ownerUserId,
      c.tenantId,
      (await publico.pendingRequests(c.ownerUserId, c.tenantId)).requests[0].id,
      { expectedStartAt: ONZE },
    );
    const diario = await erroDe(pedir(c, '2027-03-07T16:00:00.000Z', { whatsapp }));
    expect(diario.getStatus()).toBe(429);
    expect(diario.message).toMatch(/muitos pedidos hoje/);

    // 24 h depois, volta a aceitar.
    relogio = new Date(ANTECEDENCIA.getTime() + 25 * 60 * 60_000);
    await pedir(c, '2027-03-07T16:00:00.000Z', { whatsapp });

    // Outro estabelecimento: limites independentes para o mesmo telefone.
    const outro = await criarCenario();
    await pedir(outro, DEZ, { whatsapp });
  });

  // ------------------------------------------------------------ isolamento

  it('isolamento: ids de outro estabelecimento não servem, listas e configuração não vazam', async () => {
    const a = await criarCenario();
    const b = await criarCenario();
    await pedir(b, DEZ);

    // Serviço/profissional de B pela página de A.
    const erro = await erroDe(pedir(a, DEZ, { serviceId: b.serviceId, professionalId: b.professionalId }));
    expect(erro).toBeInstanceOf(BadRequestException);
    expect(await erroDe(pedir(a, DEZ, { professionalId: b.professionalId }))).toBeInstanceOf(BadRequestException);

    expect((await publico.pendingRequests(a.ownerUserId, a.tenantId)).requests).toEqual([]);
    // Dono de A não lê nem configura B.
    expect(await erroDe(publico.pendingRequests(a.ownerUserId, b.tenantId))).toBeInstanceOf(NotFoundException);
    expect(await erroDe(publico.settings(a.ownerUserId, b.tenantId))).toBeInstanceOf(NotFoundException);
    expect(await erroDe(publico.updateSettings(a.ownerUserId, b.tenantId, false))).toBeInstanceOf(NotFoundException);
    // B continua ligado.
    expect((await publico.settings(b.ownerUserId, b.tenantId)).enabled).toBe(true);
  });

  it('configuração: só DONO sem DENIED; GERENTE e DONO com DENIED recebem 403', async () => {
    const c = await criarCenario({ ligado: false });
    expect(await publico.settings(c.ownerUserId, c.tenantId)).toEqual({ enabled: false, slug: c.slug, updatedAt: null });

    const gerente = await dataSource.manager.save(
      dataSource.manager.create(User, {
        name: 'Gerente',
        email: `gerente-publico-${contador}-${sufixo}@example.test`,
        phone: '+5511900000001',
        status: UserStatus.ACTIVE,
      }),
    );
    await dataSource.manager.save(
      dataSource.manager.create(Membership, { userId: gerente.id, tenantId: c.tenantId, role: EstablishmentRole.GERENTE }),
    );
    expect((await erroDe(publico.updateSettings(gerente.id, c.tenantId, true))).getStatus()).toBe(403);
    expect((await erroDe(publico.pendingRequests(gerente.id, c.tenantId))).getStatus()).toBe(403);

    const [membership] = (await dataSource.query(
      `SELECT id FROM memberships WHERE user_id = $1 AND tenant_id = $2`,
      [c.ownerUserId, c.tenantId],
    )) as { id: string }[];
    await dataSource.query(
      `INSERT INTO membership_permission_overrides (id, tenant_id, membership_id, permission, mode)
       VALUES ($1, $2, $3, 'CONFIGURACOES_GERENCIAR', 'DENIED')`,
      [`ovr${contador}${sufixo}`.slice(0, 30), c.tenantId, membership.id],
    );
    expect((await erroDe(publico.updateSettings(c.ownerUserId, c.tenantId, true))).getStatus()).toBe(403);
    expect(await erroDe(publico.profile(c.slug))).toBeInstanceOf(NotFoundException);
  });

  // ------------------------------------------------------------ fuso

  it('fuso do estabelecimento: Manaus (UTC-4) oferece e grava 09:00 locais = 13:00Z', async () => {
    const c = await criarCenario({ timezone: 'America/Manaus' });
    const disponibilidade = await publico.availabilityFor(c.slug, {
      serviceId: c.serviceId,
      professionalId: c.professionalId,
      date: DATA,
    });
    expect(disponibilidade.timezone).toBe('America/Manaus');
    expect(disponibilidade.slots[0]).toEqual({ startAt: '2027-03-07T13:00:00.000Z', localStart: '09:00', offsetLabel: '-04:00' });
    const recibo = await pedir(c, '2027-03-07T13:00:00.000Z');
    expect(recibo).toMatchObject({ localDate: DATA, localStart: '09:00', timezone: 'America/Manaus' });
    // O mesmo instante às 22:00 locais do sábado (fora da jornada) não é aceito.
    expect(await erroDe(pedir(c, '2027-03-07T02:00:00.000Z'))).toBeInstanceOf(BadRequestException);
  });

  // ------------------------------------------------------------ regressão interna

  it('agenda interna inalterada: sem confirmação manual nasce CONFIRMED; com manual, PENDING listado como INTERNAL', async () => {
    const automatico = await criarCenario({ manual: false });
    const confirmada = await agendamentos.create(automatico.ownerUserId, automatico.tenantId, {
      professionalId: automatico.professionalId,
      serviceId: automatico.serviceId,
      startAt: DEZ,
      consumer: { mode: 'new', data: { name: 'Balcão', whatsapp: telefone() } },
    });
    expect(confirmada.status).toBe('CONFIRMED');
    expect(
      ((await dataSource.query(`SELECT kind FROM notification_jobs WHERE appointment_id = $1`, [confirmada.id])) as unknown[]).length,
    ).toBe(3);
    expect((await publico.pendingRequests(automatico.ownerUserId, automatico.tenantId)).requests).toEqual([]);

    const manual = await criarCenario({ manual: true });
    const pendente = await agendamentos.create(manual.ownerUserId, manual.tenantId, {
      professionalId: manual.professionalId,
      serviceId: manual.serviceId,
      startAt: DEZ,
      consumer: { mode: 'new', data: { name: 'Balcão', whatsapp: telefone() } },
    });
    expect(pendente.status).toBe('PENDING');
    const lista = await publico.pendingRequests(manual.ownerUserId, manual.tenantId);
    expect(lista.requests.map((r) => [r.id, r.origin, r.requestedAt])).toEqual([[pendente.id, 'INTERNAL', null]]);
  });
});
