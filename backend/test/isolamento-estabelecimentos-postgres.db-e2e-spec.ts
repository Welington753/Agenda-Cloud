// Isolamento entre estabelecimentos PELA API HTTP real (AppModule inteiro,
// sessão por cookie), contra PostgreSQL DESCARTÁVEL, com dois
// estabelecimentos fictícios independentes, A e B, de plano com todos os
// recursos. Os testes de serviço já provam a regra módulo a módulo; este
// prova a ligação das rotas (o `tenantId` sai só do caminho, os ids dos
// corpos e das buscas são conferidos contra ele) e trava rota nova sem caso:
// - a lista cobre TODA rota registrada sob /tenants/:tenantId (conferida
//   contra o roteador);
// - o dono de A (e o profissional de A, nas rotas da própria agenda), com
//   sessão ativa e senha confirmada, recebe o mesmo 404 de inexistente em
//   cada rota de B, sem nenhum dado de B na resposta;
// - no caminho do próprio A, ids de B no caminho, no corpo ou na busca não
//   alcançam nada de B;
// - nada muda em nenhuma tabela com `tenant_id` de A ou de B, nem nas contas
//   deles (`users`, `credentials`, `sessions`), rota por rota: a troca de
//   senha do funcionário de B tentada por A não muda a senha, a troca
//   obrigatória, o papel, a situação nem as sessões dele;
// - controle positivo: depois das tentativas, a conta certa de B faz a MESMA
//   chamada, com o mesmo corpo, e consegue. A recusa não é rota inexistente,
//   recurso inexistente nem corpo inválido.
import { createECDH, randomBytes, randomUUID } from 'node:crypto';
import { globSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import cookieParser from 'cookie-parser';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { hashPassword } from '../src/auth/password-hasher.js';
import { TENANT_NOT_FOUND_MESSAGE } from '../src/common/tenant-authorization.js';
import { buildRuntimeDataSourceOptions } from '../src/database/runtime-data-source.js';
import { DisparadorDePush } from '../src/push/push-dispatcher.js';
import { comTodosOsRecursos } from './support/plano-de-teste.js';

const url = process.env.DB_E2E_DIRECT_URL;
if (url && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)) {
  throw new Error('Este teste exige PostgreSQL descartável local.');
}
const id = () => randomUUID().replaceAll('-', '').slice(0, 24);
const SENHA = 'senha-de-teste-forte-1';
const TZ = 'America/Sao_Paulo';
const FRONT = 'http://localhost:3000';
const SEGREDO_DO_PROXY = 'segredo-do-proxy-so-para-este-teste-0123456789';
const MINUTO = 60_000;
const dia = (deslocamento: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(Date.now() + deslocamento * 86_400_000));
/** Instante de um horário local de São Paulo (UTC-3, sem horário de verão). */
const local = (data: string, hora: string) => new Date(`${data}T${hora}:00.000-03:00`).toISOString();
const SEMANA = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, intervals: [{ start: '06:00', end: '22:00' }] }));
/** Par de chaves P-256 no formato do navegador (aparelho ou VAPID). */
const parP256 = () => {
  const e = createECDH('prime256v1');
  e.generateKeys();
  return { publica: e.getPublicKey().toString('base64url'), privada: e.getPrivateKey().toString('base64url') };
};
const PROPRIAS = ['ATENDIMENTO_PROPRIO_INICIAR', 'ATENDIMENTO_PROPRIO_CONCLUIR', 'ATENDIMENTO_PROPRIO_FALTA'];

type Agente = ReturnType<typeof request.agent>;
type Metodo = 'get' | 'post' | 'put' | 'patch' | 'delete';
/** Criação de cenário: qualquer 2xx; o corpo do erro aparece se falhar. */
const ok = (r: request.Response) => expect({ status: r.status < 300 ? 'ok' : r.status, corpo: r.status < 300 ? null : r.body }).toEqual({ status: 'ok', corpo: null });

describe.skipIf(!url)('isolamento entre estabelecimentos pela API contra PostgreSQL descartável', () => {
  let app: INestApplication;
  let db: DataSource;
  const marca = `iso${id().slice(0, 8)}`;
  let hash: string;
  let planoId: string;

  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query(sql, params)) as T[];

  async function conta(nome: string) {
    const userId = id();
    const email = `${marca}-${nome}@example.test`;
    await q(`INSERT INTO users (id, name, email, status, email_verified) VALUES ($1, $2, $3, 'ACTIVE', true)`, [
      userId,
      `Pessoa ${nome}`,
      email,
    ]);
    await q(`INSERT INTO credentials (id, user_id, password_hash, algorithm) VALUES ($1, $2, $3, 'argon2id')`, [id(), userId, hash]);
    return { userId, email };
  }

  let ip = 0;
  const comProxy = <T extends request.Test>(chamada: T) => {
    ip += 1;
    return chamada
      .set('x-agenda-proxy-secret', SEGREDO_DO_PROXY)
      .set('x-agenda-client-ip', `10.60.${Math.floor(ip / 250)}.${ip % 250}`);
  };

  async function entrar(login: string): Promise<Agente> {
    const agente = request.agent(app.getHttpServer());
    await comProxy(agente.post('/auth/login')).send({ login, password: SENHA }).expect(200);
    return agente;
  }

  const reautenticar = (agente: Agente) => comProxy(agente.post('/platform/reauth')).send({ password: SENHA }).expect(204);

  const chamar = (agente: Agente, metodo: Metodo, caminho: string, corpo?: object) => {
    const chamada = agente[metodo](caminho).set('Origin', FRONT);
    return corpo ? chamada.send(corpo) : chamada;
  };

  async function profissional(tenantId: string, nome: string) {
    const professionalId = id();
    await q(
      `INSERT INTO professionals (id, tenant_id, name, avatar_initials, avatar_color, active) VALUES ($1, $2, $3, 'PX', '#000000', true)`,
      [professionalId, tenantId, nome],
    );
    return professionalId;
  }

  async function reserva(
    est: { tenantId: string; unitId: string; consumerId: string; serviceId: string; nomeDoCliente: string },
    professionalId: string,
    inicio: number,
    status: string,
  ) {
    const appointmentId = id();
    await q(
      `INSERT INTO appointments (id, tenant_id, unit_id, consumer_id, consumer_name_snapshot, consumer_whatsapp_snapshot,
          professional_id, start_at, end_at, status)
       VALUES ($1, $2, $3, $4, $5, '11999990000', $6, $7, $8, $9::appointment_status)`,
      [appointmentId, est.tenantId, est.unitId, est.consumerId, est.nomeDoCliente, professionalId, new Date(inicio), new Date(inicio + 30 * MINUTO), status],
    );
    await q(
      `INSERT INTO appointment_items (id, tenant_id, appointment_id, service_id, duration_minutes_snapshot, price_cents_snapshot)
       VALUES ($1, $2, $3, $4, 30, 5000)`,
      [id(), est.tenantId, appointmentId, est.serviceId],
    );
    return appointmentId;
  }

  /** Estabelecimento com dono, serviço, profissionais, cliente, reservas em
   * cada situação, funcionário com a própria agenda, convite pendente,
   * recebimento e aparelho inscrito. O que tem rota é criado pela rota. */
  async function estabelecimento(letra: 'A' | 'B') {
    const tenantId = id();
    const unitId = id();
    await q(
      `INSERT INTO tenants (id, slug, category, timezone, plan_id, status, access_legacy_since)
       VALUES ($1, $2, 'OTHER', $3, $4, 'ACTIVE', now())`,
      [tenantId, `${marca}-${letra.toLowerCase()}`, TZ, planoId],
    );
    await q(`INSERT INTO units (id, tenant_id, name, address, timezone, is_primary) VALUES ($1, $2, $3, '', $4, true)`, [
      unitId,
      tenantId,
      `Estabelecimento ${letra} ${marca}`,
      TZ,
    ]);
    const donoConta = await conta(`dono-${letra}`);
    await q(`INSERT INTO memberships (id, user_id, tenant_id, role) VALUES ($1, $2, $3, 'DONO')`, [id(), donoConta.userId, tenantId]);
    const dono = await entrar(donoConta.email);
    await reautenticar(dono);
    const t = `/tenants/${tenantId}`;

    const serviceId = (await chamar(dono, 'post', `${t}/services`, { name: `Corte ${letra}`, durationMinutes: 30 }).expect(ok)).body.service
      .id as string;
    const professionalId = (await chamar(dono, 'post', `${t}/professionals`, { name: `Ana ${letra}`, serviceIds: [serviceId] }).expect(ok))
      .body.professional.id as string;
    await chamar(dono, 'put', `${t}/professionals/${professionalId}/schedule`, { days: SEMANA }).expect(ok);
    const nomeDoCliente = `Cliente Sigiloso ${letra} ${marca}`;
    const whatsapp = letra === 'A' ? '11911112222' : '11933334444';
    const consumerId = (
      await chamar(dono, 'post', `${t}/consumers`, { name: nomeDoCliente, whatsapp, email: `${marca}-cliente-${letra}@example.test` }).expect(ok)
    ).body.consumer.id as string;

    const base = { tenantId, unitId, consumerId, serviceId, nomeDoCliente };
    const agora = Date.now();
    const reservas = {
      confirmar: await reserva(base, professionalId, new Date(local(dia(3), '10:00')).getTime(), 'PENDING'),
      cancelar: await reserva(base, professionalId, new Date(local(dia(4), '10:00')).getTime(), 'CONFIRMED'),
      remarcar: await reserva(base, professionalId, new Date(local(dia(5), '10:00')).getTime(), 'CONFIRMED'),
      iniciar: await reserva(base, professionalId, agora - 5 * MINUTO, 'CONFIRMED'),
      concluir: await reserva(base, professionalId, agora - 120 * MINUTO, 'IN_PROGRESS'),
      faltar: await reserva(base, professionalId, agora - 240 * MINUTO, 'CONFIRMED'),
      receber: await reserva(base, professionalId, agora - 26 * 60 * MINUTO, 'COMPLETED'),
      recebida: await reserva(base, professionalId, agora - 28 * 60 * MINUTO, 'COMPLETED'),
    };
    const paymentId = (
      await chamar(dono, 'post', `${t}/payments`, {
        requestKey: `chave-${id()}`,
        appointmentId: reservas.recebida,
        amountCents: 5000,
        method: 'PIX',
        receivedOn: dia(-1),
      }).expect(ok)
    ).body.payment.id as string;

    // Funcionário com login próprio e a própria agenda.
    const daEquipe = await profissional(tenantId, `Bia ${letra}`);
    const username = `${marca}.${letra.toLowerCase()}`;
    const staff = (
      await chamar(dono, 'post', `${t}/team/staff-accounts`, {
        requestKey: `chave-${id()}`,
        professionalId: daEquipe,
        name: `Bia ${letra}`,
        username,
        permissions: PROPRIAS,
        password: SENHA,
      }).expect(ok)
    ).body as { membershipId: string };
    const [{ userId: staffUserId }] = await q<{ userId: string }>(`SELECT user_id AS "userId" FROM memberships WHERE id = $1`, [
      staff.membershipId,
    ]);
    // As próprias comissões (concessão do dono, fora de PROPRIAS para não mudar
    // os casos de troca de permissões abaixo).
    await q(
      `INSERT INTO membership_permission_overrides (id, tenant_id, membership_id, permission, mode)
       VALUES ($1, $2, $3, 'COMISSOES_PROPRIAS_VISUALIZAR', 'GRANTED')`,
      [id(), tenantId, staff.membershipId],
    );
    const equipe = await entrar(username);
    const proprias = {
      iniciar: await reserva(base, daEquipe, agora - 5 * MINUTO, 'CONFIRMED'),
      concluir: await reserva(base, daEquipe, agora - 120 * MINUTO, 'IN_PROGRESS'),
      faltar: await reserva(base, daEquipe, agora - 240 * MINUTO, 'CONFIRMED'),
    };

    // Convite pendente para outro profissional; um terceiro fica livre.
    const convidado = await profissional(tenantId, `Caio ${letra}`);
    await chamar(dono, 'post', `${t}/team/invites`, {
      requestKey: `chave-${id()}`,
      professionalId: convidado,
      name: `Caio ${letra}`,
      email: `${marca}-convite-${letra}@example.test`,
    }).expect(ok);
    const [{ inviteId }] = await q<{ inviteId: string }>(`SELECT id AS "inviteId" FROM invites WHERE tenant_id = $1 AND status = 'PENDING'`, [
      tenantId,
    ]);
    const livre = await profissional(tenantId, `Davi ${letra}`);
    const solto = await profissional(tenantId, `Eva ${letra}`);

    // Nenhum aviso sai: o disparador do teste tem transporte falso.
    const endpoint = `https://fcm.googleapis.com/fcm/send/${marca}-${letra}`;
    const aparelho = { p256dh: parP256().publica, auth: randomBytes(16).toString('base64url') };
    await chamar(dono, 'put', `${t}/push-subscription`, { endpoint, keys: aparelho }).expect(ok);

    return {
      letra,
      tenantId,
      dono,
      donoEmail: donoConta.email,
      donoUserId: donoConta.userId,
      equipe,
      equipeUserId: staffUserId,
      serviceId,
      professionalId,
      daEquipe,
      livre,
      solto,
      consumerId,
      nomeDoCliente,
      whatsapp,
      reservas,
      proprias,
      paymentId,
      membershipId: staff.membershipId,
      inviteId,
      endpoint,
      aparelho,
    };
  }
  type Est = Awaited<ReturnType<typeof estabelecimento>>;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.IGNORE_DOTENV_FILE = 'true';
    process.env.DATABASE_URL = url!;
    process.env.DIRECT_URL = url!;
    process.env.FRONTEND_URL = FRONT;
    process.env.API_PROXY_SECRET = SEGREDO_DO_PROXY;
    // Nenhuma mensagem sai deste teste: sem provedor de e-mail.
    delete process.env.EMAIL_PROVIDER;
    delete process.env.EMAIL_API_KEY;
    const pasta = path.dirname(fileURLToPath(import.meta.url));
    const entities: (new () => object)[] = [];
    for (const file of globSync(path.join(pasta, '../src/entities/**/*.entity.ts'))) {
      const exports = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
      for (const value of Object.values(exports)) if (typeof value === 'function') entities.push(value as new () => object);
    }
    db = new DataSource({ ...buildRuntimeDataSourceOptions(url!), entities, logging: ['error'] });
    await db.initialize();
    const { AppModule } = await import('../src/app.module.js');
    const vapid = parP256();
    const disparador = new DisparadorDePush(db, undefined, {
      chaves: { publicKey: vapid.publica, privateKey: vapid.privada, subject: 'mailto:teste@example.test' },
      transporte: { enviar: async () => ({ tipo: 'http', status: 201 }) },
      executor: 'isolamento',
    });
    const modulo = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(db)
      .overrideProvider(DisparadorDePush)
      .useValue(disparador)
      .compile();
    app = modulo.createNestApplication();
    app.use(cookieParser());
    await app.init();
    hash = await hashPassword(SENHA);
    planoId = `${marca}pl`;
    await q(
      comTodosOsRecursos(
        `INSERT INTO plans (id, code, name, short_description, max_professionals, max_units) VALUES ($1, $1, 'Plano fictício', '', 10, 1)`,
      ),
      [planoId],
    );
  });

  afterAll(async () => {
    await app?.close();
    if (db?.isInitialized) await db.destroy();
  });

  it('dono e profissional de A não alcançam B por caminho, corpo ou busca; a conta de B faz a mesma chamada', async () => {
    const a = await estabelecimento('A');
    const b = await estabelecimento('B');

    // [rota registrada, quem chama, caminho, corpo, status do controle,
    // cruza]. `t` dá o tenant do caminho; `r`, os recursos. `cruza`: a rota
    // leva id de recurso no caminho, no corpo ou na busca, então vale tentar
    // os ids de B no caminho do próprio A. A ordem é a do controle, que muda
    // B de verdade: a própria agenda antes de mexer no funcionário, a remoção
    // por último.
    type Caso = [string, 'dono' | 'equipe', (t: Est, r: Est) => string, ((t: Est, r: Est) => object | Promise<object>) | null, number, boolean];
    const p = (t: Est) => `/tenants/${t.tenantId}`;
    const chave = () => `chave-${id()}`;
    const casos: Caso[] = [
      ['GET /tenants/:tenantId/dashboard', 'dono', (t) => `${p(t)}/dashboard`, null, 200, false],
      ['GET /tenants/:tenantId/consumers', 'dono', (t) => `${p(t)}/consumers?q=Cliente`, null, 200, false],
      ['GET /tenants/:tenantId/consumers/page', 'dono', (t) => `${p(t)}/consumers/page`, null, 200, false],
      ['POST /tenants/:tenantId/consumers', 'dono', (t) => `${p(t)}/consumers`, () => ({ name: 'Outra pessoa', whatsapp: '11955556666' }), 201, false],
      ['GET /tenants/:tenantId/services', 'dono', (t) => `${p(t)}/services`, null, 200, false],
      ['POST /tenants/:tenantId/services', 'dono', (t) => `${p(t)}/services`, () => ({ name: 'Barba', durationMinutes: 20 }), 201, false],
      ['PATCH /tenants/:tenantId/services/:serviceId', 'dono', (t, r) => `${p(t)}/services/${r.serviceId}`, () => ({ priceCents: 4500 }), 200, true],
      ['GET /tenants/:tenantId/professionals', 'dono', (t) => `${p(t)}/professionals`, null, 200, false],
      [
        'POST /tenants/:tenantId/professionals',
        'dono',
        (t) => `${p(t)}/professionals`,
        (_t, r) => ({ name: 'Edu', serviceIds: [r.serviceId] }),
        201,
        true,
      ],
      ['PATCH /tenants/:tenantId/professionals/:professionalId', 'dono', (t, r) => `${p(t)}/professionals/${r.livre}`, () => ({ name: 'Davi Souza' }), 200, true],
      [
        'PUT /tenants/:tenantId/professionals/:professionalId/services',
        'dono',
        (t, r) => `${p(t)}/professionals/${r.livre}/services`,
        (_t, r) => ({ serviceIds: [r.serviceId] }),
        200,
        true,
      ],
      ['GET /tenants/:tenantId/professionals/:professionalId/schedule', 'dono', (t, r) => `${p(t)}/professionals/${r.professionalId}/schedule`, null, 200, true],
      [
        'PUT /tenants/:tenantId/professionals/:professionalId/schedule',
        'dono',
        (t, r) => `${p(t)}/professionals/${r.livre}/schedule`,
        () => ({ days: SEMANA }),
        200,
        true,
      ],
      [
        'GET /tenants/:tenantId/professionals/:professionalId/availability',
        'dono',
        (t, r) => `${p(t)}/professionals/${r.professionalId}/availability?serviceId=${r.serviceId}&date=${dia(6)}`,
        null,
        200,
        true,
      ],
      ['GET /tenants/:tenantId/appointments', 'dono', (t, r) => `${p(t)}/appointments?date=${dia(3)}&professionalId=${r.professionalId}`, null, 200, true],
      [
        'GET /tenants/:tenantId/appointments/range',
        'dono',
        (t, r) => `${p(t)}/appointments/range?from=${dia(-2)}&to=${dia(6)}&professionalId=${r.professionalId}`,
        null,
        200,
        true,
      ],
      ['GET /tenants/:tenantId/appointments/:appointmentId', 'dono', (t, r) => `${p(t)}/appointments/${r.reservas.cancelar}`, null, 200, true],
      [
        'POST /tenants/:tenantId/appointments',
        'dono',
        (t) => `${p(t)}/appointments`,
        (_t, r) => ({
          professionalId: r.professionalId,
          serviceId: r.serviceId,
          startAt: local(dia(6), '11:00'),
          consumer: { mode: 'existing', consumerId: r.consumerId },
        }),
        201,
        true,
      ],
      [
        'GET /tenants/:tenantId/appointments/:appointmentId/reschedule-options',
        'dono',
        (t, r) => `${p(t)}/appointments/${r.reservas.remarcar}/reschedule-options?date=${dia(5)}`,
        null,
        200,
        true,
      ],
      [
        'POST /tenants/:tenantId/appointments/:appointmentId/confirm',
        'dono',
        (t, r) => `${p(t)}/appointments/${r.reservas.confirmar}/confirm`,
        () => ({ expectedStartAt: local(dia(3), '10:00') }),
        201,
        true,
      ],
      [
        'POST /tenants/:tenantId/appointments/:appointmentId/cancel',
        'dono',
        (t, r) => `${p(t)}/appointments/${r.reservas.cancelar}/cancel`,
        () => ({ expectedStartAt: local(dia(4), '10:00') }),
        201,
        true,
      ],
      [
        'POST /tenants/:tenantId/appointments/:appointmentId/reschedule',
        'dono',
        (t, r) => `${p(t)}/appointments/${r.reservas.remarcar}/reschedule`,
        () => ({ expectedStartAt: local(dia(5), '10:00'), startAt: local(dia(5), '15:00') }),
        201,
        true,
      ],
      ['POST /tenants/:tenantId/appointments/:appointmentId/start', 'dono', (t, r) => `${p(t)}/appointments/${r.reservas.iniciar}/start`, inicioDe('iniciar'), 201, true],
      [
        'POST /tenants/:tenantId/appointments/:appointmentId/complete',
        'dono',
        (t, r) => `${p(t)}/appointments/${r.reservas.concluir}/complete`,
        inicioDe('concluir'),
        201,
        true,
      ],
      ['POST /tenants/:tenantId/appointments/:appointmentId/no-show', 'dono', (t, r) => `${p(t)}/appointments/${r.reservas.faltar}/no-show`, inicioDe('faltar'), 201, true],
      ['GET /tenants/:tenantId/payments', 'dono', (t) => `${p(t)}/payments`, null, 200, false],
      [
        'POST /tenants/:tenantId/payments',
        'dono',
        (t) => `${p(t)}/payments`,
        (_t, r) => ({ requestKey: chave(), appointmentId: r.reservas.receber, amountCents: 5000, method: 'PIX', receivedOn: dia(-1) }),
        200,
        true,
      ],
      [
        'POST /tenants/:tenantId/payments/:paymentId/refund',
        'dono',
        (t, r) => `${p(t)}/payments/${r.paymentId}/refund`,
        () => ({ reason: 'Cobrança em duplicidade' }),
        200,
        true,
      ],
      ['GET /tenants/:tenantId/commissions', 'dono', (t) => `${p(t)}/commissions`, null, 200, false],
      [
        'GET /tenants/:tenantId/commissions/rules/:professionalId',
        'dono',
        (t, r) => `${p(t)}/commissions/rules/${r.professionalId}`,
        null,
        200,
        true,
      ],
      [
        'PUT /tenants/:tenantId/commissions/rules/:professionalId/:serviceId',
        'dono',
        (t, r) => `${p(t)}/commissions/rules/${r.professionalId}/${r.serviceId}`,
        () => ({ kind: 'PERCENTAGE', value: 4000 }),
        200,
        true,
      ],
      [
        'DELETE /tenants/:tenantId/commissions/rules/:professionalId/:serviceId',
        'dono',
        (t, r) => `${p(t)}/commissions/rules/${r.professionalId}/${r.serviceId}`,
        null,
        200,
        true,
      ],
      ['GET /tenants/:tenantId/public-booking', 'dono', (t) => `${p(t)}/public-booking`, null, 200, false],
      ['PUT /tenants/:tenantId/public-booking', 'dono', (t) => `${p(t)}/public-booking`, () => ({ enabled: true }), 200, false],
      ['GET /tenants/:tenantId/booking-requests', 'dono', (t) => `${p(t)}/booking-requests`, null, 200, false],
      // O endpoint não é id de recurso de B: é o segredo do próprio
      // aparelho, que só o navegador dele conhece. Um aparelho avisa uma
      // pessoa só (push-subscriptions.repository.ts), então o mesmo endpoint
      // inscrito por outra conta COM AS MESMAS CHAVES passa a ser dela; com
      // outras chaves é recusado (test/push-postgres.db-e2e-spec.ts).
      ['PUT /tenants/:tenantId/push-subscription', 'dono', (t) => `${p(t)}/push-subscription`, (_t, r) => ({ endpoint: r.endpoint, keys: r.aparelho }), 200, false],
      ['POST /tenants/:tenantId/push-subscription/status', 'dono', (t) => `${p(t)}/push-subscription/status`, (_t, r) => ({ endpoint: r.endpoint }), 200, false],
      ['DELETE /tenants/:tenantId/push-subscription', 'dono', (t) => `${p(t)}/push-subscription`, (_t, r) => ({ endpoint: r.endpoint }), 200, false],
      ['GET /tenants/:tenantId/my-agenda', 'equipe', (t) => `${p(t)}/my-agenda?date=${dia(0)}`, null, 200, false],
      ['GET /tenants/:tenantId/my-agenda/range', 'equipe', (t) => `${p(t)}/my-agenda/range?from=${dia(-1)}&to=${dia(1)}`, null, 200, false],
      ['GET /tenants/:tenantId/my-agenda/commissions', 'equipe', (t) => `${p(t)}/my-agenda/commissions`, null, 200, false],
      ['POST /tenants/:tenantId/my-agenda/:appointmentId/start', 'equipe', (t, r) => `${p(t)}/my-agenda/${r.proprias.iniciar}/start`, propriaDe('iniciar'), 200, true],
      [
        'POST /tenants/:tenantId/my-agenda/:appointmentId/complete',
        'equipe',
        (t, r) => `${p(t)}/my-agenda/${r.proprias.concluir}/complete`,
        propriaDe('concluir'),
        200,
        true,
      ],
      ['POST /tenants/:tenantId/my-agenda/:appointmentId/no-show', 'equipe', (t, r) => `${p(t)}/my-agenda/${r.proprias.faltar}/no-show`, propriaDe('faltar'), 200, true],
      ['GET /tenants/:tenantId/team', 'dono', (t) => `${p(t)}/team`, null, 200, false],
      [
        'POST /tenants/:tenantId/team/invites',
        'dono',
        (t) => `${p(t)}/team/invites`,
        (_t, r) => ({ requestKey: chave(), professionalId: r.livre, name: 'Davi', email: `${marca}-davi-${r.letra}@example.test` }),
        200,
        true,
      ],
      [
        'POST /tenants/:tenantId/team/staff-accounts',
        'dono',
        (t) => `${p(t)}/team/staff-accounts`,
        (_t, r) => ({ requestKey: chave(), professionalId: r.solto, name: 'Eva', username: `${marca}.eva.${r.letra.toLowerCase()}`, permissions: [] }),
        200,
        true,
      ],
      ['POST /tenants/:tenantId/team/invites/:inviteId/resend', 'dono', (t, r) => `${p(t)}/team/invites/${r.inviteId}/resend`, null, 200, true],
      ['POST /tenants/:tenantId/team/invites/:inviteId/revoke', 'dono', (t, r) => `${p(t)}/team/invites/${r.inviteId}/revoke`, null, 200, true],
      [
        'PUT /tenants/:tenantId/team/members/:membershipId/permissions',
        'dono',
        (t, r) => `${p(t)}/team/members/${r.membershipId}/permissions`,
        () => ({ expectedGranted: [...PROPRIAS, 'COMISSOES_PROPRIAS_VISUALIZAR'], granted: PROPRIAS.slice(0, 2) }),
        200,
        true,
      ],
      [
        'PUT /tenants/:tenantId/team/members/:membershipId/access',
        'dono',
        (t, r) => `${p(t)}/team/members/${r.membershipId}/access`,
        (_t, r) => ({
          expected: { role: 'PROFISSIONAL', professionalId: r.daEquipe, granted: PROPRIAS.slice(0, 2) },
          role: 'PROFISSIONAL',
          professionalId: r.daEquipe,
          granted: PROPRIAS,
        }),
        200,
        true,
      ],
      ['POST /tenants/:tenantId/team/members/:membershipId/suspend', 'dono', (t, r) => `${p(t)}/team/members/${r.membershipId}/suspend`, null, 200, true],
      ['POST /tenants/:tenantId/team/members/:membershipId/reactivate', 'dono', (t, r) => `${p(t)}/team/members/${r.membershipId}/reactivate`, null, 200, true],
      [
        'POST /tenants/:tenantId/team/members/:membershipId/temporary-password',
        'dono',
        (t, r) => `${p(t)}/team/members/${r.membershipId}/temporary-password`,
        null,
        200,
        true,
      ],
      [
        'PUT /tenants/:tenantId/team/members/:membershipId/password',
        'dono',
        (t, r) => `${p(t)}/team/members/${r.membershipId}/password`,
        () => ({ password: 'outra-senha-forte-2' }),
        200,
        true,
      ],
      ['POST /tenants/:tenantId/services/:serviceId/deactivate', 'dono', (t, r) => `${p(t)}/services/${r.serviceId}/deactivate`, null, 200, true],
      ['POST /tenants/:tenantId/services/:serviceId/reactivate', 'dono', (t, r) => `${p(t)}/services/${r.serviceId}/reactivate`, null, 200, true],
      ['POST /tenants/:tenantId/professionals/:professionalId/deactivate', 'dono', (t, r) => `${p(t)}/professionals/${r.livre}/deactivate`, null, 200, true],
      ['POST /tenants/:tenantId/professionals/:professionalId/reactivate', 'dono', (t, r) => `${p(t)}/professionals/${r.livre}/reactivate`, null, 200, true],
      ['DELETE /tenants/:tenantId/team/members/:membershipId', 'dono', (t, r) => `${p(t)}/team/members/${r.membershipId}`, null, 204, true],
    ];

    function inicioDe(qual: 'iniciar' | 'concluir' | 'faltar') {
      return async (_t: Est, r: Est) => ({ expectedStartAt: await inicio(r.reservas[qual]) });
    }
    function propriaDe(qual: 'iniciar' | 'concluir' | 'faltar') {
      return async (_t: Est, r: Est) => ({ expectedStartAt: await inicio(r.proprias[qual]) });
    }
    async function inicio(appointmentId: string) {
      const [{ start_at }] = await q<{ start_at: Date }>(`SELECT start_at FROM appointments WHERE id = $1`, [appointmentId]);
      return start_at.toISOString();
    }

    // A lista cobre TODA rota registrada sob /tenants/:tenantId: rota nova sem
    // caso aqui faz o teste falhar.
    type Camada = { route?: { path: string; methods: Record<string, boolean> } };
    const pilha = (app.getHttpAdapter().getInstance() as { router: { stack: Camada[] } }).router.stack;
    const registradas = pilha
      .flatMap((c) => (c.route ? Object.keys(c.route.methods).map((m) => `${m.toUpperCase()} ${c.route!.path}`) : []))
      .filter((rota) => rota.split(' ')[1].startsWith('/tenants/:tenantId'));
    expect(casos.map(([rota]) => rota).sort()).toEqual([...new Set(registradas)].sort());

    // Tudo que tem `tenant_id`, de A e de B, antes e depois das tentativas.
    const tabelas = (
      await q<{ table_name: string }>(
        `SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'tenant_id' ORDER BY 1`,
      )
    ).map((l) => l.table_name);
    const retrato = async () => {
      const r: Record<string, string[]> = {};
      for (const tabela of [...tabelas, 'tenants']) {
        const coluna = tabela === 'tenants' ? 'id' : 'tenant_id';
        r[tabela] = (
          await q<{ l: string }>(`SELECT row_to_json(x)::text AS l FROM ${tabela} x WHERE ${coluna} = ANY($1) ORDER BY 1`, [[a.tenantId, b.tenantId]])
        ).map((l) => l.l);
      }
      return r;
    };
    // O que é de B e nunca pode aparecer numa resposta dada a A.
    const deB = [
      b.tenantId,
      b.serviceId,
      b.professionalId,
      b.daEquipe,
      b.livre,
      b.solto,
      b.consumerId,
      b.nomeDoCliente,
      b.whatsapp,
      b.donoEmail,
      b.paymentId,
      b.membershipId,
      b.inviteId,
      b.endpoint,
      ...Object.values(b.reservas),
      ...Object.values(b.proprias),
    ];
    const vazou = (corpo: unknown) => deB.filter((segredo) => JSON.stringify(corpo ?? null).includes(segredo));
    /** Corpo para o relatório de falha, sem senha, token, segredo nem hash. */
    const semSegredos = (corpo: unknown): unknown =>
      JSON.parse(JSON.stringify(corpo ?? null, (k, v: unknown) => (/password|token|secret|hash/i.test(k) && typeof v === 'string' ? '<omitido>' : v)));

    // As contas de A e de B ficam fora do retrato acima (`users`,
    // `credentials` e `sessions` não têm `tenant_id`): senha, troca
    // obrigatória, papel, situação e sessões. Comparado em memória; a falha
    // aponta só a conta e o campo, nunca o valor (hash de senha, de token).
    type Linha = Record<string, unknown>;
    type Conta = { conta: Linha; credencial: Linha | null; sessoes: Record<string, Linha> };
    const nomes = new Map(
      (
        await q<{ id: string; name: string }>(
          `SELECT DISTINCT u.id, u.name FROM users u JOIN memberships m ON m.user_id = u.id WHERE m.tenant_id = ANY($1)`,
          [[a.tenantId, b.tenantId]],
        )
      ).map((l) => [l.id, l.name]),
    );
    const contas = async () =>
      new Map(
        (
          await q<Conta & { id: string }>(
            `SELECT u.id, row_to_json(u) AS conta,
                    (SELECT row_to_json(c) FROM credentials c WHERE c.user_id = u.id) AS credencial,
                    COALESCE((SELECT json_object_agg(s.id, row_to_json(s)) FROM sessions s WHERE s.user_id = u.id), '{}') AS sessoes
               FROM users u WHERE u.id = ANY($1)`,
            [[...nomes.keys()]],
          )
        ).map((l) => [l.id, l]),
      );
    // Quem chama: só a confirmação de senha da própria sessão é atualização
    // normal. Na conta alvo e nas demais, qualquer campo conta.
    const quemChama = new Set([a.donoUserId, a.equipeUserId]);
    const campos = (tabela: string, x: Linha | null | undefined, y: Linha | null | undefined) =>
      [...new Set([...Object.keys(x ?? {}), ...Object.keys(y ?? {})])]
        .filter((c) => !isDeepStrictEqual(x?.[c], y?.[c]))
        .map((c) => `${tabela}.${c}`);
    /** `nome: tabela.coluna` do que mudou, fora o normal de quem chama. */
    const mudancas = (antes: Map<string, Conta>, depois: Map<string, Conta>) => {
      const sensiveis: string[] = [];
      for (const [userId, nome] of nomes) {
        const x = antes.get(userId);
        const y = depois.get(userId);
        const diferencas = [...campos('users', x?.conta, y?.conta), ...campos('credentials', x?.credencial, y?.credencial)];
        for (const s of new Set([...Object.keys(x?.sessoes ?? {}), ...Object.keys(y?.sessoes ?? {})])) {
          const [sx, sy] = [x?.sessoes[s], y?.sessoes[s]];
          if (!sx || !sy) diferencas.push(sx ? 'sessions: sessão removida' : 'sessions: sessão nova');
          else
            diferencas.push(...campos('sessions', sx, sy).filter((c) => !(quemChama.has(userId) && c === 'sessions.reauthenticated_at')));
        }
        sensiveis.push(...diferencas.map((d) => `${nome}: ${d}`));
      }
      return sensiveis;
    };
    const contasAntes = await contas();
    // O alvo da troca de senha (o funcionário de B) tem credencial e sessão
    // aberta: uma troca ou uma revogação apareceria na comparação.
    const alvo = contasAntes.get(b.equipeUserId);
    expect({
      credencial: alvo?.credencial != null,
      trocaObrigatoria: alvo?.conta.must_change_password,
      sessaoAberta: Object.values(alvo?.sessoes ?? {}).some((s) => s.revoked_at === null),
    }).toEqual({ credencial: true, trocaObrigatoria: false, sessaoAberta: true });

    const INEXISTENTE = { statusCode: 404, error: 'Not Found', message: TENANT_NOT_FOUND_MESSAGE };
    const antes = await retrato();
    const fora: { rota: string; ataque: string; status: number; corpo: unknown; vazou: string[] }[] = [];
    const trocados: Record<string, number> = {};
    const contasMudadas: { rota: string; campos: string[] }[] = [];
    for (const [rota, quem, caminho, corpo, , cruza] of casos) {
      const metodo = rota.split(' ')[0].toLowerCase() as Metodo;
      const contasDaRota = await contas();
      const atacante = quem === 'dono' ? a.dono : a.equipe;
      // Caminho de B com os recursos de B: o mesmo 404 de inexistente.
      const deOutro = await chamar(atacante, metodo, caminho(b, b), corpo ? await corpo(b, b) : undefined);
      if (!isDeepStrictEqual({ status: deOutro.status, corpo: deOutro.body }, { status: 404, corpo: INEXISTENTE }))
        fora.push({ rota, ataque: 'tenant de B', status: deOutro.status, corpo: semSegredos(deOutro.body), vazou: vazou(deOutro.body) });
      // Caminho do próprio A com ids de B: escrita recusada; busca filtrada
      // por id de B pode responder, mas nunca com nada de B.
      if (cruza) {
        const trocado = await chamar(atacante, metodo, caminho(a, b), corpo ? await corpo(a, b) : undefined);
        trocados[rota] = trocado.status;
        if ((metodo !== 'get' && trocado.status < 400) || vazou(trocado.body).length > 0)
          fora.push({ rota, ataque: 'ids de B no caminho de A', status: trocado.status, corpo: semSegredos(trocado.body), vazou: vazou(trocado.body) });
      }
      // Antes do controle positivo, que muda essas contas de propósito.
      const mudou = mudancas(contasDaRota, await contas());
      if (mudou.length > 0) contasMudadas.push({ rota, campos: mudou });
    }
    expect({ fora, contasMudadas }).toEqual({ fora: [], contasMudadas: [] });
    // Fora o 404, só: as agendas de A filtradas pelo profissional de B
    // respondem vazias, e a criação com serviço de B é recusada inteira.
    expect(Object.fromEntries(Object.entries(trocados).filter(([, status]) => status !== 404))).toEqual({
      'GET /tenants/:tenantId/appointments': 200,
      'GET /tenants/:tenantId/appointments/range': 200,
      'POST /tenants/:tenantId/professionals': 400,
    });
    expect(await retrato()).toEqual(antes);

    // Controle positivo: a conta certa de B, mesma chamada e mesmo corpo.
    const controles: { rota: string; status: number; erro?: unknown }[] = [];
    for (const [rota, quem, caminho, corpo, status] of casos) {
      const metodo = rota.split(' ')[0].toLowerCase() as Metodo;
      const r = await chamar(quem === 'dono' ? b.dono : b.equipe, metodo, caminho(b, b), corpo ? await corpo(b, b) : undefined);
      if (r.status !== status) controles.push({ rota, status: r.status, erro: semSegredos(r.body) });
    }
    expect(controles).toEqual([]);
    // A comparação enxerga a troca: feita pela conta certa de B, a senha do
    // alvo muda e a sessão dele é encerrada.
    expect(mudancas(contasAntes, await contas())).toEqual(
      expect.arrayContaining([`${nomes.get(b.equipeUserId)}: credentials.password_hash`, `${nomes.get(b.equipeUserId)}: sessions.revoked_at`]),
    );
  });
});
