// Notificações automáticas contra PostgreSQL DESCARTÁVEL — nunca Neon, nunca
// banco existente, nunca `.env`. Só roda com `DB_E2E_DIRECT_URL`; o schema é o
// das migrations versionadas (inclusive 1792540800000-NotificationJobs).
//
// Relógio CONTROLADO: `relogio` é a única fonte de "agora" do motor de
// disponibilidade, do serviço de agendamentos e do executor. Nenhum caso
// depende da hora em que roda.
//
// Provedor SIMULADO: nenhuma mensagem sai deste processo; nenhum WhatsApp é
// aberto e nenhum cliente é contatado.
import { globSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppointmentsService } from '../src/appointments/appointments.service.js';
import { AvailabilityService } from '../src/availability/availability.service.js';
import { ConsumersService } from '../src/consumers/consumers.service.js';
import { buildRuntimeDataSourceOptions } from '../src/database/runtime-data-source.js';
import { Appointment } from '../src/entities/appointment.entity.js';
import { AppointmentStatusChange } from '../src/entities/appointment-status-change.entity.js';
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
import { ExecutorDeNotificacoes } from '../src/notifications/notification-dispatcher.js';
import {
  cancelarPendentes,
  linhasDe,
  registrarEntrega,
} from '../src/notifications/notification-jobs.repository.js';
import { AgendadorDeNotificacoes } from '../src/notifications/notification-scheduler.js';
import { ProvedorWhatsappSimulado } from '../src/notifications/whatsapp-provider.js';
import { ProfessionalsService } from '../src/professionals/professionals.service.js';
import { ProfessionalWorkingHoursService } from '../src/professionals/working-hours.service.js';
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

/** Atendimentos no domingo 2027-03-07 (weekday 0), bem no futuro. */
const WEEKDAY = 0;
const SP = 'America/Sao_Paulo';
/** 10:00, 11:00 e 12:00 em São Paulo (UTC-3). */
const DEZ = '2027-03-07T13:00:00.000Z';
const ONZE = '2027-03-07T14:00:00.000Z';
const MEIO_DIA = '2027-03-07T15:00:00.000Z';
/** Bem antes: semana anterior. */
const ANTECEDENCIA = new Date('2027-03-01T12:00:00.000Z');

interface Cenario {
  tenantId: string;
  ownerUserId: string;
  professionalId: string;
  serviceId: string;
  consumerId: string;
  unitName: string;
}

interface Linha {
  id: string;
  tenant_id: string;
  appointment_id: string;
  kind: string;
  status: string;
  appointment_start_at: Date;
  scheduled_for: Date;
  not_after: Date;
  attempts: number;
  outcome_reason: string | null;
  provider_message_id: string | null;
  dedupe_key: string;
}

describe.skipIf(!DIRECT_URL)('notificações automáticas contra PostgreSQL descartável', () => {
  let dataSource: DataSource;
  let agendamentos: AppointmentsService;
  let clientes: ConsumersService;
  let profissionais: ProfessionalsService;
  let servicos: ServicesService;
  let horarios: ProfessionalWorkingHoursService;
  let planId: string;
  let relogio = ANTECEDENCIA;
  const agora = () => relogio;
  const sufixo = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  let contador = 0;

  async function criarCenario(
    opcoes: { timezone?: string; manual?: boolean; jornada?: [string, string]; autorizado?: boolean } = {},
  ): Promise<Cenario> {
    contador += 1;
    const nome = `n${contador}`;
    const timezone = opcoes.timezone ?? SP;
    const manager = dataSource.manager;
    const tenant = await manager.save(
      manager.create(Tenant, {
        slug: `e2e-notif-${nome}-${sufixo}`,
        category: BusinessCategory.OTHER,
        timezone,
        planId,
        status: TenantStatus.ACTIVE,
      }),
    );
    const unitName = `Estúdio ${nome} & Cia`;
    await manager.save(
      manager.create(Unit, { tenantId: tenant.id, name: unitName, address: '', timezone, isPrimary: true }),
    );
    const user = await manager.save(
      manager.create(User, {
        name: `Dono ${nome}`,
        email: `dono-notif-${nome}-${sufixo}@example.test`,
        phone: '+5511900000000',
        status: UserStatus.ACTIVE,
      }),
    );
    await manager.save(
      manager.create(Membership, { userId: user.id, tenantId: tenant.id, role: EstablishmentRole.DONO }),
    );
    const servico = await servicos.create(user.id, tenant.id, {
      name: 'Consulta de avaliação dermatológica',
      shortDescription: '',
      priceCents: 5000,
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
    const [inicio, fim] = opcoes.jornada ?? ['09:00', '18:00'];
    await horarios.replace(user.id, tenant.id, profissional.id, {
      days: [{ weekday: WEEKDAY, intervals: [{ start: inicio, end: fim }] }],
    });
    const consumidor = await clientes.create(user.id, tenant.id, {
      name: 'Maria  Aparecida Souza',
      whatsapp: `(11) 9${String(Math.floor(Math.random() * 90_000_000 + 10_000_000))}`,
    });
    if (opcoes.autorizado ?? true) {
      await dataSource.query(
        `UPDATE consumers SET whatsapp_opt_in_at = $3, whatsapp_opt_in_source = 'TESTE'
          WHERE tenant_id = $1 AND id = $2`,
        [tenant.id, consumidor.id, new Date('2027-01-01T00:00:00Z')],
      );
    }
    return {
      tenantId: tenant.id,
      ownerUserId: user.id,
      professionalId: profissional.id,
      serviceId: servico.id,
      consumerId: consumidor.id,
      unitName,
    };
  }

  function agendar(c: Cenario, startAt: string) {
    return agendamentos.create(c.ownerUserId, c.tenantId, {
      professionalId: c.professionalId,
      serviceId: c.serviceId,
      startAt,
      consumer: { mode: 'existing', consumerId: c.consumerId },
    });
  }

  async function tarefas(appointmentId: string): Promise<Linha[]> {
    return linhasDe<Linha>(
      await dataSource.query(
        `SELECT * FROM notification_jobs WHERE appointment_id = $1 ORDER BY scheduled_for, kind, created_at`,
        [appointmentId],
      ),
    );
  }

  const resumo = (linhas: Linha[]) =>
    linhas.map((l) => `${l.kind}@${new Date(l.scheduled_for).toISOString()}:${l.status}`);

  function executor(nome: string, provedor: ProvedorWhatsappSimulado, extra: Partial<{ limite: number }> = {}) {
    return new ExecutorDeNotificacoes(dataSource, {
      envioHabilitado: true,
      provedor,
      executor: nome,
      agora,
      ...extra,
    });
  }

  /** Só as tarefas deste cenário ficam vencidas: o resto do banco (outros
   * testes, ou execuções anteriores no mesmo banco descartável) é empurrado
   * para o futuro ou encerrado, para um teste não processar o de outro. */
  async function isolarFila(appointmentIds: string[]) {
    await dataSource.query(
      `UPDATE notification_jobs
          SET status = CASE WHEN status = 'SENDING' THEN 'UNCERTAIN' ELSE 'SCHEDULED' END,
              scheduled_for = '2100-01-01', not_after = '2100-01-02',
              locked_by = NULL, locked_until = NULL
        WHERE status IN ('SCHEDULED', 'PROCESSING', 'SENDING')
          AND NOT (appointment_id = ANY($1::varchar[]))`,
      [appointmentIds],
    );
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

  // ------------------------------------------------------------ programação

  it('criada já confirmada com antecedência: confirmação, véspera às 09:00 locais e 2 h antes', async () => {
    const c = await criarCenario();
    const view = await agendar(c, DEZ);
    expect(view.status).toBe(AppointmentStatus.CONFIRMED);
    expect(resumo(await tarefas(view.id))).toEqual([
      `CONFIRMATION@${ANTECEDENCIA.toISOString()}:SCHEDULED`,
      'REMINDER_DAY_BEFORE@2027-03-06T12:00:00.000Z:SCHEDULED',
      'REMINDER_2H@2027-03-07T11:00:00.000Z:SCHEDULED',
    ]);
  });

  it('pendente não programa nada; confirmar programa; confirmar de novo não duplica', async () => {
    const c = await criarCenario({ manual: true });
    const view = await agendar(c, DEZ);
    expect(view.status).toBe(AppointmentStatus.PENDING);
    expect(await tarefas(view.id)).toEqual([]);

    relogio = new Date('2027-03-02T12:00:00.000Z');
    await agendamentos.changeStatus(c.ownerUserId, c.tenantId, view.id, 'confirm', { expectedStartAt: DEZ });
    const depois = await tarefas(view.id);
    expect(depois.map((l) => l.kind)).toEqual(['CONFIRMATION', 'REMINDER_DAY_BEFORE', 'REMINDER_2H']);

    // Repetição pela rota: o serviço devolve sem gravar nada.
    await agendamentos.changeStatus(c.ownerUserId, c.tenantId, view.id, 'confirm', { expectedStartAt: DEZ });
    // Repetição por baixo (outra chamada ao agendador): a chave UNIQUE barra.
    await new AgendadorDeNotificacoes().aoConfirmar(
      dataSource.manager,
      { tenantId: c.tenantId, appointmentId: view.id, inicio: new Date(DEZ), timezone: SP },
      relogio,
    );
    expect(await tarefas(view.id)).toHaveLength(3);
  });

  it('feita na véspera: sem lembrete da véspera', async () => {
    const c = await criarCenario();
    relogio = new Date('2027-03-06T10:00:00.000Z'); // 07:00 local da véspera
    const view = await agendar(c, DEZ);
    expect((await tarefas(view.id)).map((l) => l.kind)).toEqual(['CONFIRMATION', 'REMINDER_2H']);
  });

  it('feita no próprio dia: com e sem tempo para o lembrete de 2 h', async () => {
    const c = await criarCenario();
    relogio = new Date('2027-03-07T10:30:00.000Z'); // 07:30 local; 2 h antes das 10:00 = 08:00
    const cedo = await agendar(c, DEZ);
    expect((await tarefas(cedo.id)).map((l) => l.kind)).toEqual(['CONFIRMATION', 'REMINDER_2H']);

    relogio = new Date('2027-03-07T12:30:00.000Z'); // 09:30 local; 2 h antes das 11:00 já passou
    const tarde = await agendar(c, ONZE);
    expect((await tarefas(tarde.id)).map((l) => l.kind)).toEqual(['CONFIRMATION']);
  });

  it('confirmação tardia de pendente: lembrete de 2 h vencido não é programado', async () => {
    const c = await criarCenario({ manual: true });
    const view = await agendar(c, MEIO_DIA);
    relogio = new Date('2027-03-07T13:30:00.000Z'); // 10:30 local, 1h30 antes
    await agendamentos.changeStatus(c.ownerUserId, c.tenantId, view.id, 'confirm', {
      expectedStartAt: MEIO_DIA,
    });
    expect((await tarefas(view.id)).map((l) => l.kind)).toEqual(['CONFIRMATION']);
  });

  it('virada de dia e fuso: atendimento 00:30 em Tóquio tem véspera no dia anterior LOCAL', async () => {
    const c = await criarCenario({ timezone: 'Asia/Tokyo', jornada: ['00:00', '03:00'] });
    // 2027-03-07 00:30 em Tóquio = 2027-03-06T15:30Z (a data UTC já é a véspera local).
    const view = await agendar(c, '2027-03-06T15:30:00.000Z');
    const linhas = await tarefas(view.id);
    // Véspera local = 06/03, 09:00 em Tóquio = 00:00Z.
    expect(resumo(linhas)).toContain('REMINDER_DAY_BEFORE@2027-03-06T00:00:00.000Z:SCHEDULED');
    expect(resumo(linhas)).toContain('REMINDER_2H@2027-03-06T13:30:00.000Z:SCHEDULED');
  });

  // ------------------------------------------------------------ invalidação

  it('remarcação invalida lembretes antigos e recalcula; na véspera, sem "lembrete de amanhã" nem confirmação nova', async () => {
    const c = await criarCenario();
    const view = await agendar(c, DEZ);

    relogio = new Date('2027-03-03T12:00:00.000Z');
    await agendamentos.reschedule(c.ownerUserId, c.tenantId, view.id, { startAt: ONZE, expectedStartAt: DEZ });
    let linhas = await tarefas(view.id);
    expect(linhas.filter((l) => l.status === 'CANCELED').map((l) => l.kind).sort()).toEqual([
      'REMINDER_2H',
      'REMINDER_DAY_BEFORE',
    ]);
    expect(linhas.filter((l) => l.status === 'CANCELED').every((l) => l.outcome_reason === 'REMARCADA')).toBe(true);
    expect(resumo(linhas.filter((l) => l.status === 'SCHEDULED'))).toEqual([
      `CONFIRMATION@${ANTECEDENCIA.toISOString()}:SCHEDULED`,
      'REMINDER_DAY_BEFORE@2027-03-06T12:00:00.000Z:SCHEDULED',
      'REMINDER_2H@2027-03-07T12:00:00.000Z:SCHEDULED',
    ]);
    // A confirmação ainda não enviada passa a falar do horário novo.
    expect(new Date(linhas.find((l) => l.kind === 'CONFIRMATION')!.appointment_start_at).toISOString()).toBe(ONZE);

    // Na véspera, de volta às 10:00.
    relogio = new Date('2027-03-06T13:00:00.000Z');
    await agendamentos.reschedule(c.ownerUserId, c.tenantId, view.id, { startAt: DEZ, expectedStartAt: ONZE });
    linhas = await tarefas(view.id);
    const vigentes = linhas.filter((l) => l.status === 'SCHEDULED');
    expect(vigentes.map((l) => l.kind)).toEqual(['CONFIRMATION', 'REMINDER_2H']);
    expect(vigentes.filter((l) => l.kind === 'CONFIRMATION')).toHaveLength(1);
    expect(new Date(vigentes[1].scheduled_for).toISOString()).toBe('2027-03-07T11:00:00.000Z');
    // Nada duplicado: uma linha por chave.
    expect(new Set(linhas.map((l) => l.dedupe_key)).size).toBe(linhas.length);
  });

  it('cancelamento invalida tudo o que está pendente, e o executor não envia nada', async () => {
    const c = await criarCenario();
    const view = await agendar(c, DEZ);
    await agendamentos.cancel(c.ownerUserId, c.tenantId, view.id, { expectedStartAt: DEZ });
    const linhas = await tarefas(view.id);
    expect(linhas.every((l) => l.status === 'CANCELED' && l.outcome_reason === 'RESERVA_CANCELADA')).toBe(true);

    await isolarFila([view.id]);
    relogio = new Date('2027-03-07T12:00:00.000Z');
    const provedor = new ProvedorWhatsappSimulado();
    const r = await executor('exec-cancel', provedor).processarLote();
    expect(r.reservadas).toBe(0);
    expect(provedor.enviadas).toEqual([]);
  });

  it('iniciar atendimento invalida o lembrete pendente', async () => {
    const c = await criarCenario();
    const view = await agendar(c, DEZ);
    // 09:40 local: já pode iniciar (30 min antes).
    relogio = new Date('2027-03-07T12:40:00.000Z');
    await agendamentos.changeStatus(c.ownerUserId, c.tenantId, view.id, 'start', { expectedStartAt: DEZ });
    const linhas = await tarefas(view.id);
    // O lembrete de 2 h (08:00 local) já tinha passado sem executor; mesmo assim
    // fica invalidado, e nada mais sai.
    expect(linhas.filter((l) => l.status === 'SCHEDULED')).toEqual([]);
    expect(linhas.every((l) => l.outcome_reason === 'RESERVA_IN_PROGRESS')).toBe(true);
  });

  it('rollback: tarefa programada numa transação que falha não sobra', async () => {
    const c = await criarCenario();
    const view = await agendar(c, DEZ);
    const antes = await tarefas(view.id);

    await expect(
      dataSource.transaction(async (tx) => {
        await tx.update(Appointment, { id: view.id, tenantId: c.tenantId }, { status: AppointmentStatus.CANCELED });
        await new AgendadorDeNotificacoes().aoEncerrar(
          tx,
          { tenantId: c.tenantId, appointmentId: view.id },
          'RESERVA_CANCELADA',
          relogio,
        );
        throw new Error('falha depois de gravar');
      }),
    ).rejects.toThrow('falha depois de gravar');
    expect(resumo(await tarefas(view.id))).toEqual(resumo(antes));

    // Criação que falha (horário ocupado): nenhuma tarefa órfã da tentativa.
    const total = async () =>
      Number(
        linhasDe<{ n: string }>(
          await dataSource.query(`SELECT count(*)::text AS n FROM notification_jobs WHERE tenant_id = $1`, [c.tenantId]),
        )[0].n,
      );
    const antesDoConflito = await total();
    await expect(agendar(c, DEZ)).rejects.toThrow();
    expect(await total()).toBe(antesDoConflito);
  });

  it('isolamento: invalidação e FK nunca atravessam estabelecimentos', async () => {
    const a = await criarCenario();
    const b = await criarCenario();
    const deA = await agendar(a, DEZ);
    // Cancelar "a reserva de A" pelo tenant B não toca em nada.
    expect(
      await cancelarPendentes(dataSource.manager, { tenantId: b.tenantId, appointmentId: deA.id }, 'X', relogio),
    ).toBe(0);
    expect((await tarefas(deA.id)).every((l) => l.status === 'SCHEDULED')).toBe(true);
    // Tarefa com tenant B apontando para reserva de A: a FK composta recusa.
    await expect(
      dataSource.query(
        `INSERT INTO notification_jobs (id, tenant_id, appointment_id, kind, appointment_start_at, scheduled_for, not_after, dedupe_key)
         VALUES ($1, $2, $3, 'REMINDER_2H', $4, $4, $4, $5)`,
        [`x${sufixo}`.slice(0, 30), b.tenantId, deA.id, new Date(DEZ), `cross-${sufixo}`],
      ),
    ).rejects.toThrow(/fk_notification_jobs_tenant_appointment/);
  });

  // ------------------------------------------------------------ execução

  it('envio desativado por padrão: o executor não toca em nada', async () => {
    const c = await criarCenario();
    const view = await agendar(c, DEZ);
    const r = await new ExecutorDeNotificacoes(dataSource, { executor: 'padrao', agora }).processarLote();
    expect(r.desativado).toBe(true);
    expect((await tarefas(view.id)).every((l) => l.status === 'SCHEDULED' && l.attempts === 0)).toBe(true);
  });

  it('envia só depois de conferir; mensagem sem dados do serviço; entrega registrada à parte', async () => {
    const c = await criarCenario();
    const view = await agendar(c, DEZ);
    await isolarFila([view.id]);
    const provedor = new ProvedorWhatsappSimulado();
    const r = await executor('exec-ok', provedor).processarLote();
    expect(r).toMatchObject({ reservadas: 1, aceitas: 1 });
    expect(provedor.enviadas).toHaveLength(1);
    const [msg] = provedor.enviadas;
    expect(msg.modelo).toBe('CONFIRMATION');
    expect(msg.texto).toBe(
      `Olá, Maria. Seu agendamento no ${c.unitName} está confirmado para 07/03/2027 às 10:00. Se precisar mudar, responda esta mensagem.`,
    );
    expect(msg.texto).not.toMatch(/Consulta|dermatol|R\$|Profissional/);
    expect(msg.para).toMatch(/^5511\d{9}$/);

    const confirmacao = (await tarefas(view.id)).find((l) => l.kind === 'CONFIRMATION')!;
    expect(confirmacao.status).toBe('SENT'); // aceita pelo provedor — ainda não é entrega
    expect(await registrarEntrega(dataSource.manager, confirmacao.provider_message_id!, relogio)).toBe(true);
    expect((await tarefas(view.id)).find((l) => l.kind === 'CONFIRMATION')!.status).toBe('DELIVERED');
  });

  it('cliente sem autorização de contato (como todo cliente existente): pulado, nada enviado', async () => {
    const c = await criarCenario({ autorizado: false });
    const view = await agendar(c, DEZ);
    await isolarFila([view.id]);
    const provedor = new ProvedorWhatsappSimulado();
    const r = await executor('exec-sem-consentimento', provedor).processarLote();
    expect(r.puladas).toBe(1);
    expect(provedor.enviadas).toEqual([]);
    const linha = (await tarefas(view.id)).find((l) => l.kind === 'CONFIRMATION')!;
    expect([linha.status, linha.outcome_reason]).toEqual(['SKIPPED', 'SEM_AUTORIZACAO']);
  });

  it('confere o horário vigente e o prazo antes de enviar', async () => {
    const c = await criarCenario();
    const view = await agendar(c, DEZ);
    // Horário mudado por fora do serviço (sem reprogramar): pula.
    await dataSource.query(`UPDATE appointments SET start_at = $2, end_at = $3 WHERE id = $1`, [
      view.id,
      new Date(MEIO_DIA),
      new Date('2027-03-07T16:00:00.000Z'),
    ]);
    await isolarFila([view.id]);
    const provedor = new ProvedorWhatsappSimulado();
    await executor('exec-horario', provedor).processarLote();
    expect(provedor.enviadas).toEqual([]);
    expect((await tarefas(view.id)).find((l) => l.kind === 'CONFIRMATION')!.outcome_reason).toBe('HORARIO_ALTERADO');

    // Executor atrasado (serviço hibernado): o lembrete da véspera venceu o prazo.
    const d = await criarCenario();
    const outra = await agendar(d, ONZE);
    await dataSource.query(`UPDATE notification_jobs SET status = 'SENT' WHERE appointment_id = $1 AND kind = 'CONFIRMATION'`, [outra.id]);
    await isolarFila([outra.id]);
    relogio = new Date('2027-03-06T22:00:00.000Z'); // 19:00 da véspera — 10 h depois das 09:00
    await executor('exec-atrasado', provedor).processarLote();
    expect(provedor.enviadas).toEqual([]);
    const vespera = (await tarefas(outra.id)).find((l) => l.kind === 'REMINDER_DAY_BEFORE')!;
    expect([vespera.status, vespera.outcome_reason]).toEqual(['SKIPPED', 'FORA_DO_PRAZO']);
  });

  it('dois executores disputando: cada tarefa sai uma vez só', async () => {
    const c = await criarCenario();
    const ids: string[] = [];
    for (const hora of [DEZ, ONZE, MEIO_DIA]) ids.push((await agendar(c, hora)).id);
    await isolarFila(ids);

    // Determinístico: uma transação externa trava UMA tarefa; o executor pula
    // essa linha (SKIP LOCKED) em vez de esperar ou pegá-la.
    const [travada] = linhasDe<{ id: string }>(
      await dataSource.query(`SELECT id FROM notification_jobs WHERE appointment_id = $1 AND kind = 'CONFIRMATION'`, [ids[0]]),
    );
    const runner = dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      await runner.query(`SELECT id FROM notification_jobs WHERE id = $1 FOR UPDATE`, [travada.id]);
      const sozinho = new ProvedorWhatsappSimulado();
      const r = await executor('exec-a', sozinho).processarLote();
      expect(r.reservadas).toBe(2);
      expect(sozinho.enviadas.map((m) => m.chaveDeIdempotencia)).not.toContain(`${ids[0]}:CONFIRMATION`);
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }

    // Concorrência de verdade: dois executores, ao mesmo tempo, sobre o que sobrou.
    await dataSource.query(
      `UPDATE notification_jobs SET status = 'SCHEDULED', scheduled_for = $2, not_after = $3, attempts = 0,
              locked_by = NULL, locked_until = NULL, provider_message_id = NULL
        WHERE appointment_id = ANY($1::varchar[]) AND kind = 'CONFIRMATION'`,
      [ids, relogio, new Date(DEZ)],
    );
    const p1 = new ProvedorWhatsappSimulado();
    const p2 = new ProvedorWhatsappSimulado();
    const [r1, r2] = await Promise.all([
      executor('exec-1', p1, { limite: 2 }).processarLote(),
      executor('exec-2', p2, { limite: 2 }).processarLote(),
    ]);
    const chaves = [...p1.enviadas, ...p2.enviadas].map((m) => m.chaveDeIdempotencia).sort();
    expect(chaves).toEqual(ids.map((id) => `${id}:CONFIRMATION`).sort());
    expect(r1.reservadas + r2.reservadas).toBe(3);
  });

  it('falhas do provedor nunca alteram a reserva', async () => {
    const c = await criarCenario();
    const view = await agendar(c, DEZ);
    await isolarFila([view.id]);
    const reservaAntes = await dataSource.manager.findOneByOrFail(Appointment, { id: view.id });
    const historicoAntes = await dataSource.manager.countBy(AppointmentStatusChange, { appointmentId: view.id });
    const confirmacao = async () => (await tarefas(view.id)).find((l) => l.kind === 'CONFIRMATION')!;

    // Recusa temporária: volta para a fila com espera.
    const provedor = new ProvedorWhatsappSimulado(false);
    provedor.responder({ tipo: 'recusada', definitiva: false, erro: 'limite de taxa' });
    expect((await executor('exec-f', provedor).processarLote()).reprogramadas).toBe(1);
    let linha = await confirmacao();
    expect(linha.status).toBe('SCHEDULED');
    expect(linha.attempts).toBe(1);
    expect(new Date(linha.scheduled_for).getTime()).toBe(relogio.getTime() + 60_000);

    // Exceção na chamada (sem resposta) com provedor NÃO idempotente: incerto, sem reenvio.
    relogio = new Date(relogio.getTime() + 2 * 60_000);
    provedor.responder(new Error('timeout'));
    expect((await executor('exec-f', provedor).processarLote()).incertas).toBe(1);
    linha = await confirmacao();
    expect([linha.status, linha.outcome_reason]).toEqual(['UNCERTAIN', 'RESULTADO_INCERTO']);
    relogio = new Date(relogio.getTime() + 60 * 60_000);
    await executor('exec-f', provedor).processarLote();
    expect(provedor.enviadas.filter((m) => m.modelo === 'CONFIRMATION')).toHaveLength(2);

    // Recusa definitiva: falha, sem nova tentativa.
    relogio = ANTECEDENCIA;
    const d = await criarCenario();
    const outra = await agendar(d, ONZE);
    await isolarFila([outra.id]);
    const p2 = new ProvedorWhatsappSimulado();
    p2.responder({ tipo: 'recusada', definitiva: true, erro: 'número sem WhatsApp' });
    expect((await executor('exec-g', p2).processarLote()).falhas).toBe(1);

    const reservaDepois = await dataSource.manager.findOneByOrFail(Appointment, { id: view.id });
    expect(reservaDepois.status).toBe(reservaAntes.status);
    expect(reservaDepois.startAt.toISOString()).toBe(reservaAntes.startAt.toISOString());
    expect(reservaDepois.endAt.toISOString()).toBe(reservaAntes.endAt.toISOString());
    expect(await dataSource.manager.countBy(AppointmentStatusChange, { appointmentId: view.id })).toBe(historicoAntes);
    expect((await dataSource.manager.findOneByOrFail(Appointment, { id: outra.id })).status).toBe(AppointmentStatus.CONFIRMED);
  });

  it('retomada: PROCESSING vencido é reenviado; SENDING abandonado vira incerto (ou volta, se idempotente)', async () => {
    const c = await criarCenario();
    const ids = [(await agendar(c, DEZ)).id, (await agendar(c, ONZE)).id];
    await isolarFila(ids);
    const passado = new Date(relogio.getTime() - 60_000);
    // Executor que morreu ANTES de chamar o provedor.
    await dataSource.query(
      `UPDATE notification_jobs SET status = 'PROCESSING', locked_by = 'morto', locked_until = $2, attempts = 1
        WHERE appointment_id = $1 AND kind = 'CONFIRMATION'`,
      [ids[0], passado],
    );
    // Executor que morreu DEPOIS de decidir enviar.
    await dataSource.query(
      `UPDATE notification_jobs SET status = 'SENDING', locked_by = 'morto', locked_until = $2, attempts = 1
        WHERE appointment_id = $1 AND kind = 'CONFIRMATION'`,
      [ids[1], passado],
    );
    const provedor = new ProvedorWhatsappSimulado(false);
    const r = await executor('exec-retomada', provedor).processarLote();
    expect(r.abandonadasResolvidas).toBe(1);
    expect(provedor.enviadas.map((m) => m.chaveDeIdempotencia)).toEqual([`${ids[0]}:CONFIRMATION`]);
    expect((await tarefas(ids[1])).find((l) => l.kind === 'CONFIRMATION')!.status).toBe('UNCERTAIN');

    // Com provedor idempotente, o SENDING abandonado volta para a fila.
    await dataSource.query(
      `UPDATE notification_jobs SET status = 'SENDING', locked_by = 'morto', locked_until = $2, attempts = 1, outcome_reason = NULL
        WHERE appointment_id = $1 AND kind = 'CONFIRMATION'`,
      [ids[1], passado],
    );
    const idempotente = new ProvedorWhatsappSimulado(true);
    await executor('exec-idem', idempotente).processarLote();
    expect(idempotente.enviadas.map((m) => m.chaveDeIdempotencia)).toEqual([`${ids[1]}:CONFIRMATION`]);
    expect((await tarefas(ids[1])).find((l) => l.kind === 'CONFIRMATION')!.status).toBe('SENT');
  });
});
