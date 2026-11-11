// Relatórios por período do portal PELA API HTTP real (AppModule inteiro,
// sessão por cookie), contra PostgreSQL DESCARTÁVEL. Dados e preços
// fictícios. Prova:
// - pagamentos recebidos pela data de recebimento, as duas pontas inclusas,
//   só os não anulados na soma, anulados à parte, valor gravado;
// - virada do mês: recebido em 31/10 e em 01/11; cadastro às 23:59:59.999 de
//   31/10 em São Paulo conta em outubro, e às 00:00 de 01/11, em novembro
//   (com o horário de verão de 2001: nenhum offset fixo);
// - período vazio: zero, sem grupos;
// - alcance pela marca is_test ATUAL: reclassificar muda o período passado;
// - relatório = soma do detalhamento por plano/ciclo = extrato filtrado
//   (recebidos e anulados, com paginação) = Visão geral no mês atual;
// - lista filtrada por data de cadastro, com o filtro ecoado;
// - recusa a quem não é MASTER_OWNER e ao dono de estabelecimento.
//
// O banco é compartilhado com os outros arquivos (em série). Os dados de
// período ficam em 2001, fora do alcance dos outros arquivos, e os
// estabelecimentos de 2001 são apagados no fim (eles iriam para o começo de
// qualquer lista ordenada por cadastro).
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
import { buildRuntimeDataSourceOptions } from '../src/database/runtime-data-source.js';
import { comTodosOsRecursos } from './support/plano-de-teste.js';

const url = process.env.DB_E2E_DIRECT_URL;
if (url && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)) {
  throw new Error('Este teste exige PostgreSQL descartável local.');
}
const id = () => randomUUID().replaceAll('-', '').slice(0, 24);
const SENHA = 'senha-de-teste-forte-1';
const TZ = 'America/Sao_Paulo';
const SEGREDO_DO_PROXY = 'segredo-do-proxy-so-para-este-teste-0123456789';
const hoje = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());

type Agente = ReturnType<typeof request.agent>;

interface Relatorio {
  scope: string;
  timeZone: string;
  period: { from: string; to: string; month: string | null; days: number };
  currency: string;
  payments: { count: number; totalCents: number; canceledCount: number };
  byPlanCycle: { planId: string; planName: string; cycle: string; count: number; totalCents: number }[];
  registrations: { count: number };
}

interface Extrato {
  items: { id: string; tenant: { id: string }; amountCents: number; receivedOn: string; canceled: unknown }[];
  total: number;
  page: number;
  pageSize: number;
  from: string | null;
  to: string | null;
  scope: string;
  status: string | null;
}

describe.skipIf(!url)('relatórios por período do portal pela API contra PostgreSQL descartável', () => {
  let app: INestApplication;
  let db: DataSource;
  const marca = `prp${id().slice(0, 8)}`;
  let hash: string;
  let master: Agente;
  let masterId: string;
  let plano: string;
  const de2001: string[] = [];

  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query(sql, params)) as T[];

  async function conta(nome: string, platformRole: string | null = null) {
    const userId = id();
    const email = `${marca}-${nome}@example.test`;
    await q(
      `INSERT INTO users (id, name, email, status, email_verified, platform_role) VALUES ($1, $2, $3, 'ACTIVE', true, $4::platform_role)`,
      [userId, `Pessoa ${nome}`, email, platformRole],
    );
    await q(`INSERT INTO credentials (id, user_id, password_hash, algorithm) VALUES ($1, $2, $3, 'argon2id')`, [id(), userId, hash]);
    return { userId, email };
  }

  let ip = 0;
  async function entrar(email: string): Promise<Agente> {
    const agente = request.agent(app.getHttpServer());
    ip += 1;
    await agente
      .post('/auth/login')
      .set('x-agenda-proxy-secret', SEGREDO_DO_PROXY)
      .set('x-agenda-client-ip', `10.71.${Math.floor(ip / 250)}.${ip % 250}`)
      .send({ login: email, password: SENHA })
      .expect(200);
    return agente;
  }

  /** `criadoEm`: hora LOCAL de São Paulo (`YYYY-MM-DD HH:MM:SS.mmm`),
   * convertida pelo banco com a regra de fuso da época (em outubro de 2001
   * havia horário de verão, UTC-2), ou um instante ISO terminado em `Z`. */
  async function estabelecimento(nome: string, criadoEm: string, isTest = false) {
    const tenantId = id();
    await q(
      `INSERT INTO tenants (id, slug, category, timezone, plan_id, status, created_at, is_test)
       VALUES ($1, $2, 'OTHER', $3, $4, 'ACTIVE',
         CASE WHEN $5 LIKE '%Z' THEN $5::timestamptz ELSE ($5::timestamp AT TIME ZONE '${TZ}') END, $6)`,
      [tenantId, `${marca}-${nome}`, TZ, plano, criadoEm, isTest],
    );
    await q(`INSERT INTO units (id, tenant_id, name, address, timezone, is_primary) VALUES ($1, $2, $3, '', $4, true)`, [
      id(),
      tenantId,
      `Estabelecimento ${marca} ${nome}`,
      TZ,
    ]);
    if (criadoEm.startsWith('2001')) de2001.push(tenantId);
    return tenantId;
  }

  /** Período pago de `inicio` a `fim` (datas locais), recebido em `recebidoEm`. */
  async function pago(
    tenantId: string,
    inicio: string,
    fim: string,
    recebidoEm: string,
    cents: number,
    ciclo: 'MONTHLY' | 'QUARTERLY' = 'MONTHLY',
    anulado = false,
  ) {
    await q(
      `INSERT INTO tenant_access_periods (id, tenant_id, kind, plan_id, starts_at, ends_at, anchor_day, billing_cycle,
         contracted_price_cents, currency, payment_method, payment_received_on, confirmation_source, recorded_by_user_id,
         request_key, canceled_at, canceled_by_user_id, cancel_reason, cancel_request_key)
       VALUES ($1, $2, 'PAID', $3, ($4::date)::timestamp AT TIME ZONE '${TZ}', ($5::date)::timestamp AT TIME ZONE '${TZ}', 1,
         $6::billing_cycle, $7, 'BRL', 'PIX', $8::date, 'MANUAL', $9, $10, $11, $12, $13, $14)`,
      [
        id(),
        tenantId,
        plano,
        inicio,
        fim,
        ciclo,
        cents,
        recebidoEm,
        masterId,
        `chave-${id()}`,
        anulado ? new Date() : null,
        anulado ? masterId : null,
        anulado ? 'registro fictício anulado' : null,
        anulado ? `anula-${id()}` : null,
      ],
    );
  }

  const relatorio = async (consulta = '', agente = master) =>
    (await agente.get(`/platform/reports${consulta ? `?${consulta}` : ''}`).expect(200)).body as Relatorio;

  /** Todas as páginas do extrato com a consulta dada (página de 1 item). */
  async function extrato(consulta: string) {
    const items: Extrato['items'] = [];
    let primeira: Extrato | null = null;
    for (let page = 1; ; page += 1) {
      const r = (await master.get(`/platform/subscription-payments?${consulta}&pageSize=1&page=${page}`).expect(200)).body as Extrato;
      primeira ??= r;
      items.push(...r.items);
      if (page >= r.total) break;
    }
    return { ...primeira!, items };
  }

  let a: string, b: string, interno: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.IGNORE_DOTENV_FILE = 'true';
    process.env.DATABASE_URL = url!;
    process.env.DIRECT_URL = url!;
    process.env.FRONTEND_URL ??= 'http://localhost:3000';
    process.env.API_PROXY_SECRET = SEGREDO_DO_PROXY;
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

    const responsavel = await conta('master', 'MASTER_OWNER');
    masterId = responsavel.userId;
    master = await entrar(responsavel.email);

    plano = `${marca}pl`;
    await q(
      comTodosOsRecursos(
        `INSERT INTO plans (id, code, name, short_description, max_professionals, max_units) VALUES ($1, $1, 'Plano fictício', '', 10, 1)`,
      ),
      [plano],
    );

    // A: cliente cadastrado no último milissegundo de 31/10/2001 em São Paulo.
    a = await estabelecimento('a', '2001-10-31 23:59:59.999');
    await pago(a, '2001-10-01', '2001-11-01', '2001-10-31', 5000);
    await pago(a, '2001-11-01', '2002-02-01', '2001-11-01', 15000, 'QUARTERLY');
    // B: cliente cadastrado à meia-noite de 01/11/2001 em São Paulo.
    b = await estabelecimento('b', '2001-11-01 00:00:00');
    await pago(b, '2001-09-01', '2001-10-01', '2001-10-01', 7000);
    await pago(b, '2001-10-01', '2001-11-01', '2001-10-15', 9000, 'MONTHLY', true);
    // Interno/teste cadastrado em outubro.
    interno = await estabelecimento('interno', '2001-10-10 12:00:00', true);
    await pago(interno, '2001-10-01', '2001-11-01', '2001-10-20', 11000);
    // Cliente de setembro, sem pagamento.
    await estabelecimento('setembro', '2001-09-30 12:00:00');
  });

  afterAll(async () => {
    try {
      if (db?.isInitialized && de2001.length) {
        await q('DELETE FROM tenant_access_periods WHERE tenant_id = ANY($1)', [de2001]);
        await q('DELETE FROM units WHERE tenant_id = ANY($1)', [de2001]);
        await q('DELETE FROM tenants WHERE id = ANY($1)', [de2001]);
      }
    } finally {
      await app?.close();
      if (db?.isInitialized) await db.destroy();
    }
  });

  it('mês com virada: recebidos nas duas pontas, anulados à parte, cadastros pelo fuso, grupos somando o total', async () => {
    const outubro = await relatorio('from=2001-10-01&to=2001-10-31');
    expect(outubro).toMatchObject({
      scope: 'CLIENTS',
      timeZone: TZ,
      currency: 'BRL',
      period: { from: '2001-10-01', to: '2001-10-31', month: '2001-10', days: 31 },
      payments: { count: 2, totalCents: 12000, canceledCount: 1 },
      registrations: { count: 1 },
    });
    expect(outubro.byPlanCycle).toEqual([{ planId: plano, planName: 'Plano fictício', cycle: 'MONTHLY', count: 2, totalCents: 12000 }]);

    const novembro = await relatorio('from=2001-11-01&to=2001-11-30');
    expect(novembro).toMatchObject({
      period: { month: '2001-11', days: 30 },
      payments: { count: 1, totalCents: 15000, canceledCount: 0 },
      registrations: { count: 1 },
    });
    expect(novembro.byPlanCycle).toEqual([{ planId: plano, planName: 'Plano fictício', cycle: 'QUARTERLY', count: 1, totalCents: 15000 }]);

    // Período personalizado de dois dias, cruzando o mês.
    const virada = await relatorio('from=2001-10-31&to=2001-11-01');
    expect(virada).toMatchObject({
      period: { month: null, days: 2 },
      payments: { count: 2, totalCents: 20000, canceledCount: 0 },
      registrations: { count: 2 },
    });
    expect(virada.byPlanCycle.reduce((s, g) => s + g.totalCents, 0)).toBe(virada.payments.totalCents);
    expect(virada.byPlanCycle.reduce((s, g) => s + g.count, 0)).toBe(virada.payments.count);
  });

  it('período vazio: zero e sem grupos', async () => {
    expect(await relatorio('from=2001-08-01&to=2001-08-31&scope=ALL')).toMatchObject({
      payments: { count: 0, totalCents: 0, canceledCount: 0 },
      byPlanCycle: [],
      registrations: { count: 0 },
    });
  });

  it('alcance: clientes, internos/teste e todos somam; reclassificar muda o período passado', async () => {
    const clientes = await relatorio('from=2001-10-01&to=2001-10-31&scope=CLIENTS');
    const internos = await relatorio('from=2001-10-01&to=2001-10-31&scope=INTERNAL');
    const todos = await relatorio('from=2001-10-01&to=2001-10-31&scope=ALL');
    expect(internos).toMatchObject({ scope: 'INTERNAL', payments: { count: 1, totalCents: 11000, canceledCount: 0 }, registrations: { count: 1 } });
    expect(todos).toMatchObject({ scope: 'ALL', payments: { count: 3, totalCents: 23000, canceledCount: 1 }, registrations: { count: 2 } });
    expect(todos.payments.totalCents).toBe(clientes.payments.totalCents + internos.payments.totalCents);
    expect(todos.registrations.count).toBe(clientes.registrations.count + internos.registrations.count);

    // Classificação atual, sem histórico: marcar B como interno tira de
    // "clientes" também o outubro já passado.
    await q('UPDATE tenants SET is_test = true WHERE id = $1', [b]);
    try {
      expect((await relatorio('from=2001-10-01&to=2001-10-31')).payments).toEqual({ count: 1, totalCents: 5000, canceledCount: 0 });
      expect((await relatorio('from=2001-10-01&to=2001-10-31&scope=INTERNAL')).payments).toEqual({
        count: 2,
        totalCents: 18000,
        canceledCount: 1,
      });
    } finally {
      await q('UPDATE tenants SET is_test = false WHERE id = $1', [b]);
    }
  });

  it('extrato filtrado concorda com o relatório: recebidos, anulados e as duas situações, com paginação', async () => {
    const outubro = await relatorio('from=2001-10-01&to=2001-10-31');
    const recebidos = await extrato('from=2001-10-01&to=2001-10-31&scope=CLIENTS&status=RECEIVED');
    expect(recebidos).toMatchObject({ from: '2001-10-01', to: '2001-10-31', scope: 'CLIENTS', status: 'RECEIVED', total: 2 });
    expect(recebidos.items).toHaveLength(outubro.payments.count);
    expect(recebidos.items.reduce((s, i) => s + i.amountCents, 0)).toBe(outubro.payments.totalCents);
    expect(recebidos.items.every((i) => i.canceled === null)).toBe(true);
    expect(new Set(recebidos.items.map((i) => i.receivedOn))).toEqual(new Set(['2001-10-01', '2001-10-31']));

    const anulados = await extrato('from=2001-10-01&to=2001-10-31&scope=CLIENTS&status=CANCELED');
    expect(anulados).toMatchObject({ status: 'CANCELED', total: outubro.payments.canceledCount });
    expect(anulados.items.map((i) => [i.tenant.id, i.receivedOn])).toEqual([[b, '2001-10-15']]);
    expect(anulados.items.every((i) => i.canceled !== null)).toBe(true);

    const ambos = await extrato('from=2001-10-01&to=2001-10-31&scope=CLIENTS');
    expect(ambos).toMatchObject({ status: null, total: 3 });

    const internos = await extrato('from=2001-10-01&to=2001-10-31&scope=INTERNAL&status=RECEIVED');
    expect(internos.items.map((i) => i.tenant.id)).toEqual([interno]);

    // Sem filtros: comportamento anterior (todos, as duas situações), com eco.
    const semFiltro = (await master.get(`/platform/subscription-payments?tenantId=${b}`).expect(200)).body as Extrato;
    expect(semFiltro).toMatchObject({ from: null, to: null, scope: 'ALL', status: null, total: 2 });
    // tenantId sem scope não esconde um interno.
    const doInterno = (await master.get(`/platform/subscription-payments?tenantId=${interno}`).expect(200)).body as Extrato;
    expect(doInterno.total).toBe(1);
  });

  it('sem datas: mês atual em São Paulo pelo servidor, igual à Visão geral e ao extrato do mês', async () => {
    const atual = await estabelecimento('atual', new Date().toISOString());
    const mes = hoje().slice(0, 7);
    const [y, m, d] = hoje().split('-').map(Number);
    const fim = new Date(Date.UTC(y, m - 1, d + 30)).toISOString().slice(0, 10);
    await pago(atual, hoje(), fim, hoje(), 4321);
    for (const scope of ['CLIENTS', 'INTERNAL', 'ALL']) {
      const r = await relatorio(`scope=${scope}`);
      const visao = (await master.get(`/platform/overview?scope=${scope}`).expect(200)).body as {
        payments: { month: string; from: string; to: string; count: number; totalCents: number; canceledCount: number };
      };
      expect(r.period).toMatchObject({ month: mes, from: visao.payments.from, to: visao.payments.to });
      expect(r.payments).toEqual({
        count: visao.payments.count,
        totalCents: visao.payments.totalCents,
        canceledCount: visao.payments.canceledCount,
      });
      const lista = (
        await master
          .get(`/platform/subscription-payments?from=${r.period.from}&to=${r.period.to}&scope=${scope}&status=RECEIVED&pageSize=1`)
          .expect(200)
      ).body as Extrato;
      expect(lista.total).toBe(r.payments.count);
    }
    expect((await relatorio()).payments.totalCents).toBeGreaterThanOrEqual(4321);
  });

  it('lista por data de cadastro: limites do dia em São Paulo, alcance e eco do filtro', async () => {
    const ids = async (consulta: string) => {
      const r = (await master.get(`/platform/establishments?q=${marca}&pageSize=100&${consulta}`).expect(200)).body as {
        items: { id: string }[];
        total: number;
        created: { from: string; to: string; timeZone: string } | null;
      };
      return { ids: r.items.map((i) => i.id).sort(), total: r.total, created: r.created };
    };
    expect(await ids('createdFrom=2001-10-31&createdTo=2001-10-31')).toEqual({
      ids: [a],
      total: 1,
      created: { from: '2001-10-31', to: '2001-10-31', timeZone: TZ },
    });
    expect((await ids('createdFrom=2001-11-01&createdTo=2001-11-01')).ids).toEqual([b]);
    expect((await ids('createdFrom=2001-10-01&createdTo=2001-10-31&scope=INTERNAL')).ids).toEqual([interno]);
    expect((await ids('createdFrom=2001-10-01&createdTo=2001-10-31&scope=ALL')).ids).toEqual([a, interno].sort());
    // A contagem do relatório é a mesma da lista com o mesmo filtro.
    const relatorioOut = await relatorio('from=2001-10-01&to=2001-10-31&scope=ALL');
    const listaOut = await master.get('/platform/establishments?createdFrom=2001-10-01&createdTo=2001-10-31&scope=ALL&pageSize=1').expect(200);
    expect((listaOut.body as { total: number }).total).toBe(relatorioOut.registrations.count);
    // Sem datas: sem restrição por cadastro.
    const semDatas = await ids('scope=ALL');
    expect(semDatas.created).toBeNull();
    expect(semDatas.total).toBeGreaterThanOrEqual(4);
  });

  it('recusa período inválido e quem não é MASTER_OWNER', async () => {
    await master.get('/platform/reports?from=2001-10-01').expect(400);
    await master.get('/platform/reports?from=2001-01-01&to=2002-01-02').expect(400);
    await master.get('/platform/reports?from=2001-01-01&to=2002-01-01').expect(200);
    await master.get('/platform/subscription-payments?status=RECEIVED&from=2001-10-31&to=2001-10-01').expect(400);

    const dono = await conta('dono');
    const proprio = await estabelecimento('do-dono', new Date().toISOString());
    await q(`INSERT INTO memberships (id, user_id, tenant_id, role) VALUES ($1, $2, $3, 'DONO')`, [id(), dono.userId, proprio]);
    const agenteDono = await entrar(dono.email);
    for (const caminho of ['/platform/reports', '/platform/reports?scope=ALL', '/platform/subscription-payments?scope=CLIENTS&status=RECEIVED']) {
      const r = await agenteDono.get(caminho).expect(403);
      expect(r.body).not.toHaveProperty('payments');
      expect(r.body).not.toHaveProperty('items');
    }
    for (const papel of ['MASTER_ADMIN', 'MASTER_SUPPORT']) {
      const delegado = await conta(`delegado-${papel}`, papel);
      await (await entrar(delegado.email)).get('/platform/reports').expect(403);
    }
  });
});
