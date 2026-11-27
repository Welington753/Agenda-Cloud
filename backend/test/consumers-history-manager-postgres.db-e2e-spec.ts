// Histórico do cliente consultado pelo GERENTE, PELA API HTTP real (AppModule
// inteiro, sessão por cookie), contra PostgreSQL DESCARTÁVEL. Fecha a lacuna
// apontada na revisão do PR de clientes (docs/plans/permissoes-individuais.md):
// a equivalência compara campo a campo cada item do histórico, e
// consumers-identity-postgres confere o histórico do dono, mas nenhum teste
// com banco consultava o histórico como gerente.
//
// Não repete a matriz da equivalência. Confere, no corpo devolvido pela rota,
// os três desfechos que ela encontrou:
// - preço e recebimento visíveis (gerente com a consulta de recebimentos);
// - preço visível e recebimento oculto (mesmas concessões, sem o recurso de
//   pagamentos no estabelecimento);
// - os dois ocultos (gerente sem a consulta de recebimentos).
// O formato dos campos ocultos é o atual: `priceCents: null` (presente) e
// `payment` AUSENTE (não `null`), com `hidden` dizendo o que saiu.
//
// O acesso do gerente é montado só pelo caminho que o sistema oferece: o dono
// cria o gerente em "Equipe e acessos" (`POST /tenants/:id/team/staff-accounts`)
// e muda as concessões pela mesma tela (`PUT .../members/:id/permissions`).
// Nenhuma permissão é gravada direto no banco. O recurso de pagamentos é
// desligado com a linha de `tenant_feature_overrides` que a plataforma grava
// (como em consumers-identity-postgres); as concessões continuam gravadas.
//
// Banco compartilhado entre os specs: no fim (mesmo com falha), o gerente é
// suspenso e perde as concessões, e depois todos os dados deste spec saem.
// Nenhum gerente ativo fica para o levantamento de pilot-team-manager-check.
import { randomUUID } from 'node:crypto';
import { globSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import cookieParser from 'cookie-parser';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { hashPassword } from '../src/auth/password-hasher.js';
import { CONSUMERS_FORBIDDEN_MESSAGE } from '../src/consumers/consumer-access.js';
import { buildRuntimeDataSourceOptions } from '../src/database/runtime-data-source.js';
import { comTodosOsRecursos } from './support/plano-de-teste.js';

const url = process.env.DB_E2E_DIRECT_URL;
if (url && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)) {
  throw new Error('Este teste exige PostgreSQL descartável local.');
}
const id = () => randomUUID().replaceAll('-', '').slice(0, 24);
const chave = () => `chave-${id()}`;
const SENHA = 'senha-de-teste-forte-1';
const SENHA_DO_GERENTE = 'senha-escolhida-gerente-1';
const TZ = 'America/Sao_Paulo';
const FRONT = 'http://localhost:3000';
const SEGREDO_DO_PROXY = 'segredo-do-proxy-so-para-este-teste-0123456789';
/** Data local de São Paulo, `deslocamento` dias a partir de hoje. */
const dia = (deslocamento: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(Date.now() + deslocamento * 86_400_000));
/** Instante de um horário local de São Paulo (UTC-3, sem horário de verão). */
const local = (data: string, hora: string) => new Date(`${data}T${hora}:00.000-03:00`);

const CLIENTES = ['CONSUMIDORES_VISUALIZAR'];
const SEM_RECEBIMENTOS = [...CLIENTES, 'AGENDA_VISUALIZAR', 'PROFISSIONAIS_VISUALIZAR'];
const COM_RECEBIMENTOS = [...SEM_RECEBIMENTOS, 'RECEBIMENTOS_VISUALIZAR'];

type Agente = ReturnType<typeof request.agent>;
interface Item {
  id: string;
  priceCents: number | null;
  payment?: { amountCents: number; method: string; receivedOn: string; refunded: boolean } | null;
  hidden: string[];
  [campo: string]: unknown;
}
interface Historico {
  appointments: Item[];
  nextCursor: string | null;
}

describe.skipIf(!url)('histórico do cliente consultado pelo gerente, pela API contra PostgreSQL descartável', () => {
  let app: INestApplication;
  let db: DataSource;
  let hash: string;
  const marca = `hger${id().slice(0, 8)}`;
  const planoId = `${marca}pl`;
  const tenants: string[] = [];
  const usuarios: string[] = [];

  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query(sql, params)) as T[];
  const contar = async (sql: string, params: unknown[]) => Number((await q<{ n: number }>(sql, params))[0].n);

  let ip = 0;
  const comProxy = <T extends request.Test>(chamada: T) => {
    ip += 1;
    return chamada
      .set('Origin', FRONT)
      .set('x-agenda-proxy-secret', SEGREDO_DO_PROXY)
      .set('x-agenda-client-ip', `10.72.${Math.floor(ip / 250)}.${ip % 250}`);
  };

  async function entrar(login: string, senha = SENHA): Promise<Agente> {
    const agente = request.agent(app.getHttpServer());
    await comProxy(agente.post('/auth/login')).send({ login, password: senha }).expect(200);
    return agente;
  }
  const reautenticar = (agente: Agente, senha: string) =>
    comProxy(agente.post('/platform/reauth')).send({ password: senha }).expect(204);

  async function estabelecimento(nome: string) {
    const tenantId = id();
    tenants.push(tenantId);
    const unitId = id();
    await q(
      `INSERT INTO tenants (id, slug, category, timezone, plan_id, status, access_legacy_since) VALUES ($1, $2, 'OTHER', $3, $4, 'ACTIVE', now())`,
      [tenantId, `${marca}-${nome}`, TZ, planoId],
    );
    await q(`INSERT INTO units (id, tenant_id, name, address, timezone, is_primary) VALUES ($1, $2, $3, '', $4, true)`, [
      unitId,
      tenantId,
      `${marca} ${nome}`,
      TZ,
    ]);
    const donoId = id();
    usuarios.push(donoId);
    const email = `${marca}-${nome}-dono@example.test`;
    await q(`INSERT INTO users (id, name, email, status, email_verified) VALUES ($1, $2, $3, 'ACTIVE', true)`, [donoId, `Dono ${nome}`, email]);
    await q(`INSERT INTO credentials (id, user_id, password_hash, algorithm) VALUES ($1, $2, $3, 'argon2id')`, [id(), donoId, hash]);
    await q(`INSERT INTO memberships (id, user_id, tenant_id, role) VALUES ($1, $2, $3, 'DONO')`, [id(), donoId, tenantId]);
    const serviceId = id();
    await q(
      `INSERT INTO services (id, tenant_id, name, short_description, duration_minutes, price_cents) VALUES ($1, $2, 'Corte', '', 30, 5000)`,
      [serviceId, tenantId],
    );
    const professionalId = id();
    await q(`INSERT INTO professionals (id, tenant_id, name, avatar_initials, avatar_color) VALUES ($1, $2, 'Ana', 'AN', '#000000')`, [
      professionalId,
      tenantId,
    ]);
    const consumerId = id();
    await q(`INSERT INTO consumers (id, tenant_id, name, whatsapp, whatsapp_normalized) VALUES ($1, $2, 'Cliente Fictício', '11999990000', $3)`, [
      consumerId,
      tenantId,
      `55${Math.floor(Math.random() * 1e11)}`,
    ]);
    const dono = await entrar(email);
    return { tenantId, unitId, donoId, dono, serviceId, professionalId, consumerId };
  }
  type Est = Awaited<ReturnType<typeof estabelecimento>>;

  /** Atendimento concluído há dois dias, às `hora` locais, com um item por
   * `[nome, preço]` (preço `null` = sob consulta). */
  async function concluido(est: Est, hora: string, itens: [string, number | null][]) {
    const appointmentId = id();
    const inicio = local(dia(-2), hora);
    await q(
      `INSERT INTO appointments (id, tenant_id, unit_id, consumer_id, consumer_name_snapshot, consumer_whatsapp_snapshot,
          professional_id, start_at, end_at, status)
       VALUES ($1, $2, $3, $4, 'Cliente Fictício', '11999990000', $5, $6, $7, 'COMPLETED')`,
      [appointmentId, est.tenantId, est.unitId, est.consumerId, est.professionalId, inicio, new Date(inicio.getTime() + 1_800_000)],
    );
    for (const [posicao, [nome, preco]] of itens.entries()) {
      await q(
        `INSERT INTO appointment_items (id, tenant_id, appointment_id, service_id, duration_minutes_snapshot, price_cents_snapshot,
            service_name_snapshot, position)
         VALUES ($1, $2, $3, $4, 30, $5, $6, $7)`,
        [id(), est.tenantId, appointmentId, est.serviceId, preco, nome, posicao],
      );
    }
    return { id: appointmentId, startAt: inicio.toISOString(), localStart: hora };
  }

  const registrar = (agente: Agente, tenantId: string, appointmentId: string, amountCents: number) =>
    comProxy(agente.post(`/tenants/${tenantId}/payments`)).send({ requestKey: chave(), appointmentId, amountCents, method: 'PIX', receivedOn: dia(-2) });
  const historico = (agente: Agente, tenantId: string, consumerId: string) =>
    comProxy(agente.get(`/tenants/${tenantId}/consumers/${consumerId}/appointments`));

  async function gerente(est: Est, nome: string, permissions: string[]) {
    const username = `${nome}@${marca}`;
    const criado = await comProxy(est.dono.post(`/tenants/${est.tenantId}/team/staff-accounts`))
      .send({ requestKey: chave(), role: 'GERENTE', professionalId: null, name: `Gerente ${nome}`, username, permissions, password: SENHA_DO_GERENTE })
      .expect(200);
    const corpo = criado.body as { userId: string; membershipId: string; temporaryPassword: string | null; role: string };
    usuarios.push(corpo.userId);
    expect(corpo).toMatchObject({ created: true, role: 'GERENTE', temporaryPassword: null });
    const agente = await entrar(username, SENHA_DO_GERENTE);
    return { ...corpo, agente };
  }

  /** O dono troca as concessões pela tela, a partir do que ela mostra. */
  async function conceder(est: Est, membershipId: string, granted: string[]) {
    const visao = await comProxy(est.dono.get(`/tenants/${est.tenantId}/team`)).expect(200);
    const atual = (visao.body.accesses as { membershipId: string; grantedPermissions: string[] }[]).find((a) => a.membershipId === membershipId)!;
    await comProxy(est.dono.put(`/tenants/${est.tenantId}/team/members/${membershipId}/permissions`))
      .send({ expectedGranted: atual.grantedPermissions, granted })
      .expect(200);
    expect(await concedidasNoBanco(membershipId)).toEqual([...granted].sort());
  }

  const concedidasNoBanco = async (membershipId: string) =>
    (
      await q<{ p: string }>(
        `SELECT permission::text AS p FROM membership_permission_overrides WHERE membership_id = $1 AND mode = 'GRANTED' ORDER BY 1`,
        [membershipId],
      )
    ).map((r) => r.p);

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
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(DataSource).useValue(db).compile();
    app = modulo.createNestApplication();
    app.use(cookieParser());
    await app.init();
    hash = await hashPassword(SENHA);
    await q(
      comTodosOsRecursos(`INSERT INTO plans (id, code, name, short_description, max_professionals, max_units) VALUES ($1, $1, 'Plano fictício', '', 5, 1)`),
      [planoId],
    );
  });

  afterAll(async () => {
    try {
      if (db?.isInitialized && tenants.length) {
        // Primeiro, e sozinho: nenhum gerente deste spec fica ativo nem com
        // concessão, mesmo que a remoção abaixo falhe.
        await q(`UPDATE memberships SET status = 'SUSPENDED' WHERE tenant_id = ANY($1::varchar[]) AND role = 'GERENTE'`, [tenants]);
        await q(`DELETE FROM membership_permission_overrides WHERE tenant_id = ANY($1::varchar[])`, [tenants]);
        // Depois, todos os dados deste spec, numa transação.
        await db.transaction(async (m) => {
          const por = (sql: string, params: unknown[]) => m.query(sql, params);
          await por(`DELETE FROM appointment_payments WHERE tenant_id = ANY($1::varchar[])`, [tenants]);
          await por(
            `DELETE FROM audit_logs WHERE tenant_id = ANY($1::varchar[]) OR actor_user_id = ANY($2::varchar[]) OR target_user_id = ANY($2::varchar[])`,
            [tenants, usuarios],
          );
          await por(`DELETE FROM appointment_items WHERE tenant_id = ANY($1::varchar[])`, [tenants]);
          await por(`DELETE FROM appointments WHERE tenant_id = ANY($1::varchar[])`, [tenants]);
          for (const tabela of ['tenant_feature_overrides', 'memberships', 'consumers', 'services', 'professionals', 'units']) {
            await por(`DELETE FROM ${tabela} WHERE tenant_id = ANY($1::varchar[])`, [tenants]);
          }
          await por(`DELETE FROM tenants WHERE id = ANY($1::varchar[])`, [tenants]);
          await por(`DELETE FROM users WHERE id = ANY($1::varchar[])`, [usuarios]);
          await por(`DELETE FROM plans WHERE id = $1`, [planoId]);
        });
        const sobras = await contar(
          `SELECT (SELECT count(*) FROM tenants WHERE id = ANY($1::varchar[])) + (SELECT count(*) FROM users WHERE id = ANY($2::varchar[])) AS n`,
          [tenants, usuarios],
        );
        expect(sobras).toBe(0);
      }
    } finally {
      await app?.close();
      if (db?.isInitialized) await db.destroy();
    }
  });

  it('o corpo do histórico para o gerente nos três desfechos: preço e recebimento, só o preço, nenhum dos dois', async () => {
    const est = await estabelecimento('hist');
    await reautenticar(est.dono, SENHA);
    // Três atendimentos: dois serviços com preço e recebimento ativo; um sob
    // consulta (preço nulo mesmo para quem vê) com recebimento estornado; um
    // com preço e sem recebimento (`payment: null` para quem vê).
    const comDois = await concluido(est, '09:00', [
      ['Corte', 5000],
      ['Barba', 2500],
    ]);
    const sobConsulta = await concluido(est, '10:00', [['Avaliação', null]]);
    const semPagamento = await concluido(est, '11:00', [['Corte', 5000]]);
    await registrar(est.dono, est.tenantId, comDois.id, 7500).expect(200);
    const estornado = (await registrar(est.dono, est.tenantId, sobConsulta.id, 3000).expect(200)).body.payment as { id: string };
    await comProxy(est.dono.post(`/tenants/${est.tenantId}/payments/${estornado.id}/refund`)).send({ reason: 'Lançado errado' }).expect(200);

    // O resto de cada item (igual em todos os desfechos), do mais recente ao
    // mais antigo.
    const base = [
      { ...semPagamento, services: ['Corte'] },
      { ...sobConsulta, services: ['Avaliação'] },
      { ...comDois, services: ['Corte', 'Barba'] },
    ].map((a) => ({ id: a.id, startAt: a.startAt, localDate: dia(-2), localStart: a.localStart, status: 'COMPLETED', professionalName: 'Ana', services: a.services }));
    const recebimento = (amountCents: number, refunded: boolean) => ({ amountCents, method: 'PIX', receivedOn: dia(-2), refunded });
    const precos = [5000, null, 7500];

    const tudoVisivel: Historico = {
      appointments: [
        { ...base[0], priceCents: 5000, payment: null, hidden: [] },
        { ...base[1], priceCents: null, payment: recebimento(3000, true), hidden: [] },
        { ...base[2], priceCents: 7500, payment: recebimento(7500, false), hidden: [] },
      ],
      nextCursor: null,
    };
    const soOPreco: Historico = {
      appointments: base.map((b, i) => ({ ...b, priceCents: precos[i], hidden: ['payment'] })),
      nextCursor: null,
    };
    const nada: Historico = {
      appointments: base.map((b) => ({ ...b, priceCents: null, hidden: ['price', 'payment'] })),
      nextCursor: null,
    };
    /** Corpo devolvido igual ao esperado, inclusive `payment` ausente (não
     * `null`) quando oculto e `priceCents` sempre presente. */
    const confere = (corpo: Historico, esperado: Historico) => {
      expect(corpo).toStrictEqual(esperado);
      for (const [i, item] of corpo.appointments.entries()) {
        expect(Object.hasOwn(item, 'priceCents')).toBe(true);
        expect(Object.hasOwn(item, 'payment')).toBe(Object.hasOwn(esperado.appointments[i], 'payment'));
      }
    };

    // Referência do dono, com o recurso ligado: tudo visível.
    confere((await historico(est.dono, est.tenantId, est.consumerId).expect(200)).body as Historico, tudoVisivel);

    // 1. Gerente com a consulta de recebimentos (e as dependências): o mesmo
    // corpo do dono.
    const g = await gerente(est, 'hist', COM_RECEBIMENTOS);
    expect(await concedidasNoBanco(g.membershipId)).toEqual([...COM_RECEBIMENTOS].sort());
    confere((await historico(g.agente, est.tenantId, est.consumerId).expect(200)).body as Historico, tudoVisivel);

    // 3. Sem a consulta de recebimentos: nem preço nem recebimento. Vale na
    // requisição seguinte, com a sessão aberta.
    await conceder(est, g.membershipId, SEM_RECEBIMENTOS);
    confere((await historico(g.agente, est.tenantId, est.consumerId).expect(200)).body as Historico, nada);
    // Só a consulta de clientes dá o mesmo corpo.
    await conceder(est, g.membershipId, CLIENTES);
    confere((await historico(g.agente, est.tenantId, est.consumerId).expect(200)).body as Historico, nada);

    // 2. A consulta de recebimentos de volta, mas o estabelecimento sem o
    // recurso de pagamentos: preço visível, recebimento oculto. As concessões
    // continuam gravadas; o dono vê o mesmo corpo.
    await conceder(est, g.membershipId, COM_RECEBIMENTOS);
    await q(
      `INSERT INTO tenant_feature_overrides (id, tenant_id, feature_id, enabled) SELECT $1, $2, id, false FROM features WHERE key = 'PAGAMENTOS'`,
      [id(), est.tenantId],
    );
    expect(await concedidasNoBanco(g.membershipId)).toEqual([...COM_RECEBIMENTOS].sort());
    confere((await historico(g.agente, est.tenantId, est.consumerId).expect(200)).body as Historico, soOPreco);
    confere((await historico(est.dono, est.tenantId, est.consumerId).expect(200)).body as Historico, soOPreco);

    // Sem a consulta de clientes, o histórico recusa (403 com a mensagem de
    // sempre), sem corpo de histórico.
    await conceder(est, g.membershipId, [...COM_RECEBIMENTOS].filter((p) => p !== 'CONSUMIDORES_VISUALIZAR'));
    const recusa = await historico(g.agente, est.tenantId, est.consumerId);
    expect({ status: recusa.status, message: recusa.body.message, appointments: recusa.body.appointments }).toEqual({
      status: 403,
      message: CONSUMERS_FORBIDDEN_MESSAGE,
      appointments: undefined,
    });
  });

  it('isolamento: o gerente com tudo de um estabelecimento não alcança o histórico de cliente de outro, nem por id', async () => {
    const a = await estabelecimento('iso-a');
    const b = await estabelecimento('iso-b');
    await reautenticar(a.dono, SENHA);
    const g = await gerente(a, 'iso', COM_RECEBIMENTOS);
    const atendimentoB = await concluido(b, '10:00', [['Corte', 5000]]);
    await registrar(b.dono, b.tenantId, atendimentoB.id, 5000).expect(200);
    await concluido(a, '10:00', [['Corte', 5000]]);

    // Pelo caminho de B: sem vínculo, 404 (nunca 403). Pelo caminho de A, com
    // o cliente de B: não acha.
    for (const resposta of [await historico(g.agente, b.tenantId, b.consumerId), await historico(g.agente, a.tenantId, b.consumerId)]) {
      expect(resposta.status).toBe(404);
      expect(JSON.stringify(resposta.body)).not.toContain(atendimentoB.id);
    }
    const deA = (await historico(g.agente, a.tenantId, a.consumerId).expect(200)).body as Historico;
    expect(deA.appointments).toHaveLength(1);
    expect(JSON.stringify(deA)).not.toContain(atendimentoB.id);
  });
});
