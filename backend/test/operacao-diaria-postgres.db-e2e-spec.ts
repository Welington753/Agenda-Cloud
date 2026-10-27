// Operação diária contra PostgreSQL DESCARTÁVEL: listagem paginada de
// clientes, agenda por período (calendário do dono e do funcionário) e os
// indicadores do Início, sempre isolados por estabelecimento e no fuso dele.
import { randomUUID } from 'node:crypto';
import { globSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DataSource } from 'typeorm';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { buildRuntimeDataSourceOptions } from '../src/database/runtime-data-source.js';
import { AppointmentsService } from '../src/appointments/appointments.service.js';
import { AvailabilityService } from '../src/availability/availability.service.js';
import { ConsumersService } from '../src/consumers/consumers.service.js';
import { DashboardService } from '../src/dashboard/dashboard.service.js';
import { MyAgendaService } from '../src/team/my-agenda.service.js';

const url = process.env.DB_E2E_DIRECT_URL;
if (url && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)) {
  throw new Error('Este teste exige PostgreSQL descartável local.');
}
const id = () => randomUUID().replaceAll('-', '').slice(0, 24);

describe.skipIf(!url)('operação diária contra PostgreSQL descartável', () => {
  let db: DataSource;
  let consumers: ConsumersService;
  let appointments: AppointmentsService;
  let agenda: MyAgendaService;
  let dashboard: DashboardService;
  const marca = `operacao-${id()}`;
  let planoId: string;

  async function conta(nome: string) {
    const userId = id();
    await db.query(
      `INSERT INTO users (id, name, email, status, email_verified) VALUES ($1, $2, $3, 'ACTIVE', true)`,
      [userId, `Pessoa ${nome}`, `${marca}-${nome}@example.test`],
    );
    return userId;
  }

  async function estabelecimento(nome: string, timezone = 'America/Sao_Paulo') {
    const tenantId = id();
    const unitId = id();
    await db.query(
      `INSERT INTO tenants (id, slug, category, timezone, plan_id, status) VALUES ($1, $2, 'OTHER', $3, $4, 'ACTIVE')`,
      [tenantId, `${marca}-${nome}`, timezone, planoId],
    );
    await db.query(
      `INSERT INTO units (id, tenant_id, name, address, timezone, is_primary) VALUES ($1, $2, $3, '', $4, true)`,
      [unitId, tenantId, `${marca} ${nome}`, timezone],
    );
    const donoId = await conta(`${nome}-dono`);
    await db.query(`INSERT INTO memberships (id, user_id, tenant_id, role) VALUES ($1, $2, $3, 'DONO')`, [
      id(),
      donoId,
      tenantId,
    ]);
    const serviceId = id();
    await db.query(
      `INSERT INTO services (id, tenant_id, name, short_description, duration_minutes, price_cents) VALUES ($1, $2, 'Corte', '', 30, 5000)`,
      [serviceId, tenantId],
    );
    return { tenantId, unitId, donoId, serviceId };
  }
  type Est = Awaited<ReturnType<typeof estabelecimento>>;

  async function cliente(est: Est, nome: string, telefone: string) {
    const consumerId = id();
    await db.query(
      `INSERT INTO consumers (id, tenant_id, name, whatsapp, whatsapp_normalized) VALUES ($1, $2, $3, $4, $5)`,
      [consumerId, est.tenantId, nome, telefone, `55${telefone}`],
    );
    return consumerId;
  }

  async function profissional(est: Est, nome: string) {
    const professionalId = id();
    await db.query(
      `INSERT INTO professionals (id, tenant_id, name, avatar_initials, avatar_color) VALUES ($1, $2, $3, 'PX', '#000000')`,
      [professionalId, est.tenantId, nome],
    );
    return professionalId;
  }

  async function funcionario(est: Est, professionalId: string, nome: string) {
    const userId = await conta(nome);
    await db.query(
      `INSERT INTO memberships (id, user_id, tenant_id, role, professional_id) VALUES ($1, $2, $3, 'PROFISSIONAL', $4)`,
      [id(), userId, est.tenantId, professionalId],
    );
    return userId;
  }

  async function reserva(est: Est, professionalId: string, consumerId: string, inicio: string, status = 'CONFIRMED') {
    const appointmentId = id();
    const comeco = new Date(inicio);
    await db.query(
      `INSERT INTO appointments (id, tenant_id, unit_id, consumer_id, consumer_name_snapshot, consumer_whatsapp_snapshot,
          professional_id, start_at, end_at, status)
       VALUES ($1, $2, $3, $4, 'Cliente', '11999990000', $5, $6, $7, $8::appointment_status)`,
      [appointmentId, est.tenantId, est.unitId, consumerId, professionalId, comeco, new Date(comeco.getTime() + 1_800_000), status],
    );
    await db.query(
      `INSERT INTO appointment_items (id, tenant_id, appointment_id, service_id, duration_minutes_snapshot, price_cents_snapshot)
       VALUES ($1, $2, $3, $4, 30, 5000)`,
      [id(), est.tenantId, appointmentId, est.serviceId],
    );
    return appointmentId;
  }

  beforeAll(async () => {
    const directoryPath = path.dirname(fileURLToPath(import.meta.url));
    const entities: (new () => object)[] = [];
    for (const file of globSync(path.join(directoryPath, '../src/entities/**/*.entity.ts'))) {
      const exports = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
      for (const value of Object.values(exports)) if (typeof value === 'function') entities.push(value as new () => object);
    }
    db = new DataSource({ ...buildRuntimeDataSourceOptions(url!), entities, logging: ['error'] });
    await db.initialize();
    const relogio = () => new Date();
    consumers = new ConsumersService(db);
    appointments = new AppointmentsService(db, new AvailabilityService(db, relogio), consumers, relogio);
    agenda = new MyAgendaService(db, appointments);
    dashboard = new DashboardService(db);
    planoId = id();
    await db.query(
      `INSERT INTO plans (id, code, name, short_description, max_professionals, max_units) VALUES ($1, $2, 'Plano de teste', '', 3, 1)`,
      [planoId, marca],
    );
  });

  afterAll(async () => {
    if (db?.isInitialized) await db.destroy();
  });

  describe('clientes: listagem paginada', () => {
    it('primeira página sem busca, ordem estável por nome e id, cursor sem repetir nem pular', async () => {
      const est = await estabelecimento('clientes');
      const outro = await estabelecimento('clientes-outro');
      const nomes = ['bruna', 'Ana', 'carla', 'Ana', 'Davi', 'eva', 'Fábio'];
      for (const [i, nome] of nomes.entries()) await cliente(est, nome, `1190000000${i}`);
      await cliente(outro, 'Ana de outro lugar', '11911112222');

      const vistos: string[] = [];
      let cursor: string | undefined;
      let paginas = 0;
      do {
        const pagina = await consumers.listPage(est.donoId, est.tenantId, { limit: 3, cursor });
        expect(pagina.total).toBe(7);
        vistos.push(...pagina.consumers.map((c) => c.name));
        cursor = pagina.nextCursor ?? undefined;
        paginas += 1;
      } while (cursor && paginas < 10);
      expect(paginas).toBe(3);
      expect(vistos).toEqual(['Ana', 'Ana', 'bruna', 'carla', 'Davi', 'eva', 'Fábio']);
      expect(vistos).not.toContain('Ana de outro lugar');
    });

    it('a busca filtra a mesma listagem por nome ou telefone, com total do filtro', async () => {
      const est = await estabelecimento('busca');
      await cliente(est, 'Maria Souza', '11955554444');
      await cliente(est, 'Mariana Lima', '11933332222');
      await cliente(est, 'João 100%', '11977776666');
      const porNome = await consumers.listPage(est.donoId, est.tenantId, { q: 'mari', limit: 20 });
      expect(porNome.consumers.map((c) => c.name)).toEqual(['Maria Souza', 'Mariana Lima']);
      expect(porNome.total).toBe(2);
      const porTelefone = await consumers.listPage(est.donoId, est.tenantId, { q: '(11) 95555', limit: 20 });
      expect(porTelefone.consumers.map((c) => c.name)).toEqual(['Maria Souza']);
      // `%` digitado é texto, não curinga.
      const curinga = await consumers.listPage(est.donoId, est.tenantId, { q: '0%', limit: 20 });
      expect(curinga.consumers.map((c) => c.name)).toEqual(['João 100%']);
      const nada = await consumers.listPage(est.donoId, est.tenantId, { q: 'zzz', limit: 20 });
      expect(nada).toEqual({ consumers: [], nextCursor: null, total: 0 });
    });

    it('cursor adulterado é recusado; funcionário e outro estabelecimento não listam', async () => {
      const est = await estabelecimento('clientes-acesso');
      const outro = await estabelecimento('clientes-acesso-outro');
      await cliente(est, 'Pessoa', '11944443333');
      await expect(consumers.listPage(est.donoId, est.tenantId, { limit: 5, cursor: 'nao-e-cursor' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      const profissionalId = await profissional(est, 'Profissional');
      const staff = await funcionario(est, profissionalId, 'clientes-staff');
      await expect(consumers.listPage(staff, est.tenantId, { limit: 5 })).rejects.toBeInstanceOf(ForbiddenException);
      await expect(consumers.listPage(outro.donoId, est.tenantId, { limit: 5 })).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('agenda por período', () => {
    it('agrupa pela data local do estabelecimento e respeita o recorte e o profissional', async () => {
      const est = await estabelecimento('periodo');
      const outro = await estabelecimento('periodo-outro');
      const p1 = await profissional(est, 'Um');
      const p2 = await profissional(est, 'Dois');
      const c = await cliente(est, 'Cliente', '11922221111');
      // 23h30 de 28/02 em São Paulo = 02h30 UTC de 01/03: é do dia 28.
      const noFimDoDia = await reserva(est, p1, c, '2031-03-01T02:30:00.000Z');
      const primeiroDeMarco = await reserva(est, p2, c, '2031-03-01T13:00:00.000Z');
      await reserva(est, p1, c, '2031-04-01T13:00:00.000Z');
      const pOutro = await profissional(outro, 'Outro');
      await reserva(outro, pOutro, await cliente(outro, 'Outro', '11922223333'), '2031-03-01T15:00:00.000Z');

      const marco = await appointments.listRange(est.donoId, est.tenantId, { from: '2031-03-01', to: '2031-03-31' });
      expect(marco.timezone).toBe('America/Sao_Paulo');
      expect(marco.complete).toBe(true);
      expect(marco.appointments.map((a) => [a.id, a.localDate, a.localStart])).toEqual([[primeiroDeMarco, '2031-03-01', '10:00']]);

      const fevereiro = await appointments.listRange(est.donoId, est.tenantId, { from: '2031-02-28', to: '2031-02-28' });
      expect(fevereiro.appointments.map((a) => [a.id, a.localDate, a.localStart])).toEqual([[noFimDoDia, '2031-02-28', '23:30']]);

      const soDois = await appointments.listRange(est.donoId, est.tenantId, {
        from: '2031-02-28',
        to: '2031-03-31',
        professionalId: p2,
      });
      expect(soDois.appointments.map((a) => a.id)).toEqual([primeiroDeMarco]);

      await expect(
        appointments.listRange(outro.donoId, est.tenantId, { from: '2031-03-01', to: '2031-03-31' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('funcionário vê só o próprio período; a agenda geral continua recusada', async () => {
      const est = await estabelecimento('periodo-staff');
      const meu = await profissional(est, 'Meu');
      const colega = await profissional(est, 'Colega');
      const c = await cliente(est, 'Cliente', '11922224444');
      const minha = await reserva(est, meu, c, '2031-05-10T13:00:00.000Z');
      await reserva(est, colega, c, '2031-05-10T14:00:00.000Z');
      const staff = await funcionario(est, meu, 'periodo-staff-1');

      const periodo = await agenda.range(staff, est.tenantId, { from: '2031-05-01', to: '2031-05-31' });
      expect(periodo.professional.id).toBe(meu);
      expect(periodo.appointments.map((a) => [a.id, a.localDate])).toEqual([[minha, '2031-05-10']]);
      // Sem telefone, observação ou preço.
      expect(Object.keys(periodo.appointments[0]).sort()).toEqual(
        ['actions', 'consumer', 'durationMinutes', 'id', 'localDate', 'localServiceEnd', 'localStart', 'service', 'startAt', 'status'].sort(),
      );
      await expect(
        appointments.listRange(staff, est.tenantId, { from: '2031-05-01', to: '2031-05-31' }),
      ).rejects.toBeInstanceOf(ForbiddenException);

      await db.query(`UPDATE memberships SET status = 'SUSPENDED' WHERE user_id = $1`, [staff]);
      await expect(agenda.range(staff, est.tenantId, { from: '2031-05-01', to: '2031-05-31' })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('indicadores do Início', () => {
    it('clientes distintos × atendimentos, por situação, no período e no fuso do estabelecimento', async () => {
      const est = await estabelecimento('painel');
      const outro = await estabelecimento('painel-outro');
      const p = await profissional(est, 'Painel');
      const ana = await cliente(est, 'Ana', '11981110000');
      const bia = await cliente(est, 'Bia', '11981110001');
      const caio = await cliente(est, 'Caio', '11981110002');
      // Junho de 2031 no fuso de São Paulo.
      await reserva(est, p, ana, '2031-06-02T13:00:00.000Z', 'COMPLETED');
      await reserva(est, p, ana, '2031-06-09T13:00:00.000Z', 'COMPLETED');
      await reserva(est, p, ana, '2031-06-16T13:00:00.000Z', 'COMPLETED');
      await reserva(est, p, bia, '2031-06-03T13:00:00.000Z', 'COMPLETED');
      await reserva(est, p, bia, '2031-06-04T13:00:00.000Z', 'NO_SHOW');
      await reserva(est, p, caio, '2031-06-05T13:00:00.000Z', 'CANCELED');
      // 30/06 às 23h30 locais (01/07 UTC): ainda é junho.
      await reserva(est, p, caio, '2031-07-01T02:30:00.000Z', 'COMPLETED');
      // 01/07 às 10h locais: fora de junho.
      await reserva(est, p, caio, '2031-07-01T13:00:00.000Z', 'COMPLETED');
      const pOutro = await profissional(outro, 'Outro');
      await reserva(outro, pOutro, await cliente(outro, 'Zé', '11981110009'), '2031-06-02T15:00:00.000Z', 'COMPLETED');

      const visao = await dashboard.summary(est.donoId, est.tenantId, { from: '2031-06-01', to: '2031-06-30' });
      expect(visao.period).toEqual({ from: '2031-06-01', to: '2031-06-30' });
      // Ana (3), Bia (1) e Caio (1, no último dia) concluídos: 3 pessoas, 5 atendimentos.
      expect(visao.periodSummary.servedClients).toBe(3);
      expect(visao.periodSummary.appointmentsByStatus).toEqual({
        PENDING: 0,
        CONFIRMED: 0,
        IN_PROGRESS: 0,
        COMPLETED: 5,
        NO_SHOW: 1,
        CANCELED: 1,
      });
      expect(visao.periodSummary.appointmentsTotal).toBe(7);
      expect(visao.plan).toMatchObject({ maxProfessionals: 3, activeProfessionals: 1 });

      await expect(
        dashboard.summary(outro.donoId, est.tenantId, { from: '2031-06-01', to: '2031-06-30' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      const staff = await funcionario(est, p, 'painel-staff');
      await expect(dashboard.summary(staff, est.tenantId, {})).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('hoje, solicitações aguardando e próximos atendimentos a partir do agora', async () => {
      const est = await estabelecimento('painel-hoje');
      const p = await profissional(est, 'Hoje');
      const ana = await cliente(est, 'Ana', '11982220000');
      const bia = await cliente(est, 'Bia', '11982220001');
      // "Agora" fixo: 15/08/2031 às 12h em São Paulo (15h UTC).
      const agora = new Date('2031-08-15T15:00:00.000Z');
      await reserva(est, p, ana, '2031-08-15T12:00:00.000Z', 'COMPLETED');
      await reserva(est, p, ana, '2031-08-15T16:00:00.000Z', 'CONFIRMED');
      await reserva(est, p, bia, '2031-08-15T17:00:00.000Z', 'PENDING');
      await reserva(est, p, bia, '2031-08-15T18:00:00.000Z', 'CANCELED');
      const pedidoFuturo = await reserva(est, p, bia, '2031-08-20T13:00:00.000Z', 'PENDING');
      // Pendente que já passou não é "aguardando resposta".
      await reserva(est, p, bia, '2031-08-14T13:00:00.000Z', 'PENDING');

      const visao = await dashboard.summary(est.donoId, est.tenantId, {}, agora);
      expect(visao.today).toBe('2031-08-15');
      expect(visao.period).toEqual({ from: '2031-08-01', to: '2031-08-31' });
      // Só Ana: concluído e confirmado. Pendente e cancelado não contam.
      expect(visao.todaySummary.expectedClients).toBe(1);
      expect(visao.todaySummary.appointmentsByStatus).toMatchObject({ COMPLETED: 1, CONFIRMED: 1, PENDING: 1, CANCELED: 1 });
      expect(visao.pendingRequests).toBe(2);
      expect(visao.upcoming.map((a) => [a.localDate, a.localStart, a.status])).toEqual([
        ['2031-08-15', '13:00', 'CONFIRMED'],
        ['2031-08-15', '14:00', 'PENDING'],
        ['2031-08-20', '10:00', 'PENDING'],
      ]);
      expect(visao.upcoming.at(-1)?.id).toBe(pedidoFuturo);
    });
  });
});
