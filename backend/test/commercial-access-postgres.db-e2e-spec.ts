// Planos Básico/Pro/Max e validade do acesso, PELA API HTTP real (AppModule
// inteiro, sessão por cookie), contra PostgreSQL DESCARTÁVEL com a migration
// CommercialAccess aplicada. Dados fictícios. Prova:
// - catálogo renomeado sem mexer em códigos, ids e vínculos;
// - pagamento confirmado manualmente: registro, repetição sem duplicar,
//   disputa de duas telas, renovação antecipada encadeada e histórico;
// - vencimento com a sessão aberta: dados preservados, motivo na sessão,
//   agendamento público fechado, regularização pela administração;
// - pagamento não tira suspensão nem arquivamento;
// - recurso fora do plano não é liberado por concessão do dono;
// - dono e gerente de um Max não alcançam a administração da plataforma;
// - legado só pela marca explícita: sem período e sem marca, bloqueia; a
//   criação grava estabelecimento e teste juntos, ou nada;
// - correção de um registro feito por engano: anula sem apagar, recusa a
//   cadeia, repete sem efeito novo e não mexe em papel global;
// - funcionário não recebe a situação comercial na sessão.
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

type Agente = ReturnType<typeof request.agent>;

describe.skipIf(!url)('planos e validade do acesso pela API contra PostgreSQL descartável', () => {
  let app: INestApplication;
  let db: DataSource;
  const marca = `com${id().slice(0, 8)}`;
  let hash: string;

  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query(sql, params)) as T[];
  const n = async (sql: string, params: unknown[] = []) => Number((await q<{ n: number }>(sql, params))[0].n);

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

  // Cada login (e cada confirmação de senha) vem de um IP próprio (pelo cabeçalho do proxy, com o
  // segredo), para o limite de tentativas por IP não misturar as pessoas.
  let ip = 0;
  async function entrar(email: string): Promise<Agente> {
    const agente = request.agent(app.getHttpServer());
    ip += 1;
    await agente
      .post('/auth/login')
      .set('x-agenda-proxy-secret', SEGREDO_DO_PROXY)
      .set('x-agenda-client-ip', `10.20.${Math.floor(ip / 250)}.${ip % 250}`)
      .send({ login: email, password: SENHA })
      .expect(200);
    return agente;
  }

  /** Senha confirmada há pouco nesta sessão (ações sensíveis). */
  const reautenticar = (agente: Agente) => {
    ip += 1;
    return agente
      .post('/platform/reauth')
      .set('x-agenda-proxy-secret', SEGREDO_DO_PROXY)
      .set('x-agenda-client-ip', `10.30.${Math.floor(ip / 250)}.${ip % 250}`)
      .send({ password: SENHA })
      .expect(204);
  };

  /** `legado`: marcado como anterior ao controle (como os do piloto na
   * migration). Sem a marca, é um estabelecimento novo sem período. */
  async function estabelecimento(nome: string, planId: string, legado = true) {
    const tenantId = id();
    const slug = `${marca}-${nome}`;
    await q(
      `INSERT INTO tenants (id, slug, category, timezone, plan_id, status, created_at, access_legacy_since)
       VALUES ($1, $2, 'OTHER', $3, $4, 'TRIAL', now() - interval '200 days', CASE WHEN $5::boolean THEN now() END)`,
      [tenantId, slug, TZ, planId, legado],
    );
    await q(`INSERT INTO units (id, tenant_id, name, address, timezone, is_primary) VALUES ($1, $2, $3, '', $4, true)`, [
      id(),
      tenantId,
      `Estabelecimento ${nome}`,
      TZ,
    ]);
    const dono = await conta(`${nome}-dono`);
    await q(`INSERT INTO memberships (id, user_id, tenant_id, role) VALUES ($1, $2, $3, 'DONO')`, [id(), dono.userId, tenantId]);
    return { tenantId, slug, dono };
  }

  async function gerente(tenantId: string, nome: string, concedidas: string[]) {
    const pessoa = await conta(nome);
    const membershipId = id();
    await q(
      `INSERT INTO memberships (id, user_id, tenant_id, role, permissions_confirmed_at) VALUES ($1, $2, $3, 'GERENTE', now())`,
      [membershipId, pessoa.userId, tenantId],
    );
    for (const permission of concedidas) {
      await q(
        `INSERT INTO membership_permission_overrides (id, tenant_id, membership_id, permission, mode)
         VALUES ($1, $2, $3, $4::permission, 'GRANTED')`,
        [id(), tenantId, membershipId, permission],
      );
    }
    return { ...pessoa, membershipId };
  }

  const ficha = async (master: Agente, tenantId: string) =>
    (await master.get(`/platform/establishments/${tenantId}`).expect(200)).body as {
      updatedAt: string;
      status: string;
      restoreStatus: string | null;
      access: { state: string; legacy: boolean; blocked: boolean; lastDay: string | null; validUntil: string | null };
      accessPeriods: {
        id: string;
        kind: string;
        firstDay: string;
        lastDay: string;
        amountCents: number | null;
        canceled: { reason: string } | null;
        correction: { allowed: boolean; after?: { state: string; validUntil: string | null }; blockedByPeriodId?: string } | null;
      }[];
      allowedActions: Record<string, boolean>;
    };

  const pago = (updatedAt: string, extra: Record<string, unknown> = {}) => ({
    expectedUpdatedAt: updatedAt,
    requestKey: `chave-${id()}`,
    cycle: 'MONTHLY',
    amountCents: 14990,
    paymentMethod: 'PIX',
    receivedOn: new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date()),
    reference: 'comprovante fictício',
    manualConfirmation: true,
    ...extra,
  });

  let master: Agente;
  let planoSemRecebimentos: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.IGNORE_DOTENV_FILE = 'true';
    process.env.DATABASE_URL = url!;
    process.env.DIRECT_URL = url!;
    process.env.FRONTEND_URL ??= 'http://localhost:3000';
    process.env.API_PROXY_SECRET = SEGREDO_DO_PROXY;
    // Nenhuma mensagem sai deste teste: sem provedor de e-mail.
    delete process.env.EMAIL_PROVIDER;
    delete process.env.EMAIL_API_KEY;
    // Entidades carregadas como nos outros testes de banco (o glob do
    // runtime aponta para .js compilado); o AppModule inteiro usa ESTE
    // DataSource, ligado ao banco descartável.
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
    master = await entrar(responsavel.email);
    await reautenticar(master);

    // Plano de teste com todos os recursos MENOS os recebimentos.
    planoSemRecebimentos = id();
    await q(
      comTodosOsRecursos(
        `INSERT INTO plans (id, code, name, short_description, max_professionals, max_units) VALUES ($1, $2, 'Sem recebimentos', '', 5, 1)`,
      ),
      [planoSemRecebimentos, `${marca}-semrec`],
    );
    await q(
      `DELETE FROM plan_features WHERE plan_id = $1 AND feature_id = (SELECT id FROM features WHERE key = 'PAGAMENTOS')`,
      [planoSemRecebimentos],
    );
  });

  afterAll(async () => {
    await app?.close();
    if (db?.isInitialized) await db.destroy();
  });

  it('catálogo: Básico, Pro e Max sobre os códigos e ids de sempre; preço não aprovado continua nulo', async () => {
    const planos = await q<{ id: string; code: string; name: string; price_cents: number | null; max_professionals: number }>(
      `SELECT id, code, name, price_cents, max_professionals FROM plans WHERE id IN ('plan_essencial', 'plan_equipe', 'plan_pro') ORDER BY max_professionals`,
    );
    expect(planos).toEqual([
      { id: 'plan_essencial', code: 'essencial', name: 'Básico', price_cents: null, max_professionals: 2 },
      { id: 'plan_equipe', code: 'equipe', name: 'Pro', price_cents: null, max_professionals: 5 },
      { id: 'plan_pro', code: 'pro', name: 'Max', price_cents: null, max_professionals: 20 },
    ]);
    // Os módulos que já existem estão nos três planos.
    for (const plano of ['plan_essencial', 'plan_equipe', 'plan_pro']) {
      const chaves = await q<{ key: string }>(
        `SELECT f.key::text AS key FROM plan_features pf JOIN features f ON f.id = pf.feature_id WHERE pf.plan_id = $1`,
        [plano],
      );
      expect(chaves.map((c) => c.key)).toEqual(
        expect.arrayContaining(['AGENDA', 'AGENDAMENTO_PUBLICO', 'PROFISSIONAIS', 'CONSUMIDORES', 'EQUIPE', 'PAGAMENTOS']),
      );
    }
  });

  it('pagamento manual: registra, repete sem duplicar, disputa entre telas e renova encadeado', async () => {
    const est = await estabelecimento('pago', 'plan_pro');
    let f = await ficha(master, est.tenantId);
    expect(f.access).toMatchObject({ state: 'UNTRACKED', blocked: false });
    expect(f.allowedActions).toMatchObject({ recordPayment: true, extendTrial: true, grantCourtesy: true });

    const corpo = pago(f.updatedAt);
    const primeiro = await master.post(`/platform/establishments/${est.tenantId}/access/paid`).send(corpo).expect(200);
    expect(primeiro.body).toMatchObject({
      created: true,
      period: { kind: 'PAID', cycle: 'MONTHLY', amountCents: 14990, currency: 'BRL', confirmationSource: 'MANUAL', plan: { name: 'Max' } },
    });

    // A mesma requisição de novo (resposta perdida, clique duplo): nada novo.
    const repetida = await master.post(`/platform/establishments/${est.tenantId}/access/paid`).send(corpo).expect(200);
    expect(repetida.body).toMatchObject({ created: false, period: { id: primeiro.body.period.id } });
    expect(await n(`SELECT count(*)::int AS n FROM tenant_access_periods WHERE tenant_id = $1`, [est.tenantId])).toBe(1);
    expect(
      await n(`SELECT count(*)::int AS n FROM audit_logs WHERE tenant_id = $1 AND action = 'ACCESS_PAID_PERIOD_RECORDED'`, [est.tenantId]),
    ).toBe(1);
    const [historico] = await q<{ summary: string; new_data: Record<string, unknown> }>(
      `SELECT summary, new_data FROM audit_logs WHERE tenant_id = $1 AND action = 'ACCESS_PAID_PERIOD_RECORDED'`,
      [est.tenantId],
    );
    expect(historico.summary).toContain('confirmado manualmente');
    expect(historico.summary).toContain('sem confirmação automática');
    expect(historico.new_data).toMatchObject({ confirmationSource: 'MANUAL', amountCents: 14990, status: 'ACTIVE' });

    // Primeiro período pago: a situação administrativa deixa de ser teste.
    f = await ficha(master, est.tenantId);
    expect(f.status).toBe('ACTIVE');
    expect(f.access.state).toBe('PAID');
    expect(f.allowedActions.extendTrial).toBe(false);

    // Duas telas com a mesma versão e chaves diferentes: só uma grava.
    const [a, b] = await Promise.all([
      master.post(`/platform/establishments/${est.tenantId}/access/paid`).send(pago(f.updatedAt, { cycle: 'QUARTERLY', amountCents: 40490 })),
      master.post(`/platform/establishments/${est.tenantId}/access/paid`).send(pago(f.updatedAt, { cycle: 'QUARTERLY', amountCents: 40490 })),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect([a, b].find((r) => r.status === 409)!.body.code).toBe('ALTERADO_POR_OUTRA_TELA');

    // A renovação antecipada encostou no fim do primeiro, sem sobrepor.
    const periodos = await q<{ starts_at: Date; ends_at: Date; anchor_day: number; billing_cycle: string }>(
      `SELECT starts_at, ends_at, anchor_day, billing_cycle::text AS billing_cycle FROM tenant_access_periods WHERE tenant_id = $1 ORDER BY starts_at`,
      [est.tenantId],
    );
    expect(periodos).toHaveLength(2);
    expect(periodos[1].starts_at.getTime()).toBe(periodos[0].ends_at.getTime());
    expect(periodos[1].anchor_day).toBe(periodos[0].anchor_day);
    expect(periodos[1].billing_cycle).toBe('QUARTERLY');
    f = await ficha(master, est.tenantId);
    expect(f.access.validUntil).toBe(periodos[1].ends_at.toISOString());
    expect(f.accessPeriods.map((p) => p.amountCents)).toEqual([40490, 14990]);

    // O banco recusa um pago sobreposto, mesmo fora da aplicação.
    await expect(
      q(
        `INSERT INTO tenant_access_periods (id, tenant_id, kind, plan_id, starts_at, ends_at, anchor_day, billing_cycle,
           contracted_price_cents, currency, payment_method, payment_received_on, confirmation_source, recorded_by_user_id, request_key)
         SELECT $1, tenant_id, 'PAID', plan_id, starts_at, ends_at, anchor_day, billing_cycle, 100, 'BRL', 'PIX', current_date, 'MANUAL',
                recorded_by_user_id, $2 FROM tenant_access_periods WHERE tenant_id = $3 LIMIT 1`,
        [id(), id(), est.tenantId],
      ),
    ).rejects.toMatchObject({ driverError: { constraint: 'ex_tenant_access_periods_paid_overlap' } });
  });

  it('vencimento com a sessão aberta: dados ficam, motivo na sessão, público fechado; pagamento regulariza', async () => {
    const est = await estabelecimento('vence', 'plan_equipe');
    const periodoId = id();
    await q(
      `INSERT INTO tenant_access_periods (id, tenant_id, kind, plan_id, starts_at, ends_at, recorded_by_user_id)
       VALUES ($1, $2, 'TRIAL', 'plan_equipe', now() - interval '13 days', now() + interval '1 day', $3)`,
      [periodoId, est.tenantId, est.dono.userId],
    );
    await q(`INSERT INTO public_booking_settings (tenant_id, enabled) VALUES ($1, true)`, [est.tenantId]);
    await q(
      `INSERT INTO consumers (id, tenant_id, name, whatsapp, whatsapp_normalized) VALUES ($1, $2, 'Cliente Fictício', '11999990000', $3)`,
      [id(), est.tenantId, `5511${Math.floor(Math.random() * 1e9)}`],
    );
    const dono = await entrar(est.dono.email);
    await dono.get(`/tenants/${est.tenantId}/consumers/page`).expect(200);
    await request(app.getHttpServer()).get(`/public/${est.slug}`).expect(200);
    const antes = (await dono.get('/auth/me').expect(200)).body.activeContext;
    expect(antes.access).toMatchObject({ state: 'TRIAL', blocked: false });
    expect(antes.areas).toContain('CLIENTES_VER');

    // O teste vence com a sessão do dono aberta.
    await q(`UPDATE tenant_access_periods SET ends_at = now() - interval '1 minute' WHERE id = $1`, [periodoId]);
    const recusa = await dono.get(`/tenants/${est.tenantId}/consumers/page`).expect(403);
    expect(recusa.body).toMatchObject({ code: 'ACESSO_VENCIDO' });
    expect(recusa.body.message).toContain('preservados');
    const depois = (await dono.get('/auth/me').expect(200)).body.activeContext;
    expect(depois).toMatchObject({ tenantId: est.tenantId, access: { state: 'EXPIRED', blocked: true, expiredKind: 'TRIAL' }, areas: [] });
    await request(app.getHttpServer()).get(`/public/${est.slug}`).expect(404);
    // Nada apagado.
    expect(await n(`SELECT count(*)::int AS n FROM consumers WHERE tenant_id = $1`, [est.tenantId])).toBe(1);

    // Suspensão administrativa durante o vencimento; o pagamento não a tira.
    let f = await ficha(master, est.tenantId);
    expect(f.access).toMatchObject({ state: 'EXPIRED', blocked: true });
    await master
      .post(`/platform/establishments/${est.tenantId}/suspend`)
      .send({ expectedUpdatedAt: f.updatedAt, reason: 'conferência administrativa' })
      .expect(200);
    f = await ficha(master, est.tenantId);
    await master.post(`/platform/establishments/${est.tenantId}/access/paid`).send(pago(f.updatedAt)).expect(200);
    f = await ficha(master, est.tenantId);
    expect(f).toMatchObject({ status: 'SUSPENDED', restoreStatus: 'ACTIVE', access: { state: 'PAID', blocked: false } });
    await dono.get(`/tenants/${est.tenantId}/consumers/page`).expect(404);

    // A reativação é outra ação, com confirmação própria: só ela devolve a operação.
    await master.post(`/platform/establishments/${est.tenantId}/reactivate`).send({ expectedUpdatedAt: f.updatedAt }).expect(200);
    await dono.get(`/tenants/${est.tenantId}/consumers/page`).expect(200);
    await request(app.getHttpServer()).get(`/public/${est.slug}`).expect(200);
    // Período pago válido: o teste antigo vencido não bloqueia mais.
    expect((await dono.get('/auth/me').expect(200)).body.activeContext.access).toMatchObject({ state: 'PAID', blocked: false });

    // Teste não volta depois de pago.
    f = await ficha(master, est.tenantId);
    const teste = await master
      .post(`/platform/establishments/${est.tenantId}/access/trial-extension`)
      .send({ expectedUpdatedAt: f.updatedAt, requestKey: `chave-${id()}`, days: 7, reason: 'pedido do cliente' })
      .expect(409);
    expect(teste.body.code).toBe('TESTE_ENCERRADO');
  });

  it('prorrogação do teste e cortesia encadeadas; arquivado recusa; sem reautenticação recusa', async () => {
    const est = await estabelecimento('teste', 'plan_essencial');
    let f = await ficha(master, est.tenantId);
    const prorroga = await master
      .post(`/platform/establishments/${est.tenantId}/access/trial-extension`)
      .send({ expectedUpdatedAt: f.updatedAt, requestKey: `chave-${id()}`, days: 5, reason: 'pedido do cliente' })
      .expect(200);
    // Teste derivado do cadastro venceu há meses: começa hoje, não reinicia 14 dias.
    expect(prorroga.body.period).toMatchObject({ kind: 'TRIAL', reason: 'pedido do cliente' });
    const dias = (Date.parse(prorroga.body.period.endsAt) - Date.parse(prorroga.body.period.startsAt)) / 86_400_000;
    expect(dias).toBe(5);
    f = await ficha(master, est.tenantId);
    expect(f).toMatchObject({ status: 'TRIAL', access: { state: 'TRIAL' } });

    const cortesia = await master
      .post(`/platform/establishments/${est.tenantId}/access/courtesy`)
      .send({ expectedUpdatedAt: f.updatedAt, requestKey: `chave-${id()}`, days: 10, reason: 'parceria do piloto' })
      .expect(200);
    expect(cortesia.body.period.startsAt).toBe(prorroga.body.period.endsAt);
    f = await ficha(master, est.tenantId);
    expect(f.status).toBe('ACTIVE');
    expect(
      await n(`SELECT count(*)::int AS n FROM audit_logs WHERE tenant_id = $1 AND action IN ('ACCESS_TRIAL_EXTENDED', 'ACCESS_COURTESY_GRANTED')`, [
        est.tenantId,
      ]),
    ).toBe(2);

    await master
      .post(`/platform/establishments/${est.tenantId}/archive`)
      .send({ expectedUpdatedAt: f.updatedAt, reason: 'encerrado', confirmSlug: est.slug })
      .expect(200);
    f = await ficha(master, est.tenantId);
    expect(f.allowedActions).toMatchObject({ recordPayment: false, grantCourtesy: false });
    const arquivado = await master.post(`/platform/establishments/${est.tenantId}/access/paid`).send(pago(f.updatedAt)).expect(409);
    expect(arquivado.body.code).toBe('ESTABELECIMENTO_ARQUIVADO');

    // Sem a senha confirmada nesta sessão, nada é gravado.
    const outro = await conta('master-sem-reauth', 'MASTER_OWNER');
    const semReauth = await entrar(outro.email);
    const est2 = await estabelecimento('semreauth', 'plan_essencial');
    const f2 = await ficha(semReauth, est2.tenantId);
    const r = await semReauth.post(`/platform/establishments/${est2.tenantId}/access/paid`).send(pago(f2.updatedAt)).expect(403);
    expect(r.body.code).toBe('REAUTENTICACAO_NECESSARIA');
    expect(await n(`SELECT count(*)::int AS n FROM tenant_access_periods WHERE tenant_id = $1`, [est2.tenantId])).toBe(0);
  });

  it('recurso fora do plano: nem o dono nem a concessão dele ao gerente liberam', async () => {
    const est = await estabelecimento('semrec', planoSemRecebimentos);
    const g = await gerente(est.tenantId, 'semrec-gerente', ['AGENDA_VISUALIZAR', 'PROFISSIONAIS_VISUALIZAR', 'RECEBIMENTOS_VISUALIZAR', 'CONSUMIDORES_VISUALIZAR']);
    const dono = await entrar(est.dono.email);
    const ger = await entrar(g.email);

    const doDono = await dono.get(`/tenants/${est.tenantId}/payments`).expect(403);
    expect(doDono.body.code).toBe('RECURSO_NAO_CONTRATADO');
    const doGerente = await ger.get(`/tenants/${est.tenantId}/payments`).expect(403);
    expect(doGerente.body.code).toBe('RECURSO_NAO_CONTRATADO');
    // O que o plano tem, o gerente usa com a concessão.
    await ger.get(`/tenants/${est.tenantId}/consumers/page`).expect(200);
    const areas = (await ger.get('/auth/me').expect(200)).body.activeContext.areas as string[];
    expect(areas).toContain('CLIENTES_VER');
    expect(areas.some((a) => a.startsWith('RECEBIMENTOS_'))).toBe(false);

    // Exceção explícita por estabelecimento liga o recurso.
    await q(
      `INSERT INTO tenant_feature_overrides (id, tenant_id, feature_id, enabled) SELECT $1, $2, id, true FROM features WHERE key = 'PAGAMENTOS'`,
      [id(), est.tenantId],
    );
    await dono.get(`/tenants/${est.tenantId}/payments`).expect(200);
    await ger.get(`/tenants/${est.tenantId}/payments`).expect(200);
  });

  it('dono e gerente de um Max não alcançam a administração da plataforma nem outro estabelecimento', async () => {
    const est = await estabelecimento('max', 'plan_pro');
    const outro = await estabelecimento('vizinho', 'plan_pro');
    const concedidas = ['AGENDA_VISUALIZAR', 'PROFISSIONAIS_VISUALIZAR', 'RECEBIMENTOS_VISUALIZAR', 'RECEBIMENTOS_REGISTRAR'];
    const g = await gerente(est.tenantId, 'max-gerente', concedidas);
    const periodosAntes = await n(`SELECT count(*)::int AS n FROM tenant_access_periods`);

    for (const pessoa of [est.dono, g]) {
      const agente = await entrar(pessoa.email);
      // A senha confirmada não muda nada: o que falta é o papel de plataforma.
      await reautenticar(agente);
      await agente.get('/platform/establishments').expect(403);
      await agente.get(`/platform/establishments/${outro.tenantId}`).expect(403);
      await agente.get(`/platform/establishments/${est.tenantId}`).expect(403);
      const corpo = pago(new Date().toISOString());
      await agente.post(`/platform/establishments/${est.tenantId}/access/paid`).send(corpo).expect(403);
      await agente
        .post(`/platform/establishments/${est.tenantId}/access/courtesy`)
        .send({ expectedUpdatedAt: corpo.expectedUpdatedAt, requestKey: `chave-${id()}`, days: 30, reason: 'por conta própria' })
        .expect(403);
      await agente
        .post(`/platform/establishments/${est.tenantId}/access/trial-extension`)
        .send({ expectedUpdatedAt: corpo.expectedUpdatedAt, requestKey: `chave-${id()}`, days: 30, reason: 'por conta própria' })
        .expect(403);
      await agente
        .put(`/platform/users/${pessoa.userId}/platform-access`)
        .send({ expectedUpdatedAt: corpo.expectedUpdatedAt, role: 'MASTER_OWNER', permissions: [] })
        .expect(403);
      await agente.post(`/platform/establishments/${outro.tenantId}/suspend`).send({ expectedUpdatedAt: corpo.expectedUpdatedAt, reason: 'teste' }).expect(403);
      // Nenhuma rota de estabelecimento mexe na validade.
      await agente.post(`/tenants/${est.tenantId}/access/paid`).send(corpo).expect(404);
      // Outro estabelecimento: a mesma resposta de inexistente.
      await agente.get(`/tenants/${outro.tenantId}/consumers/page`).expect(404);
    }

    // O gerente não recebe a situação comercial na sessão.
    const sessaoDoGerente = (await (await entrar(g.email)).get('/auth/me').expect(200)).body.activeContext;
    expect(sessaoDoGerente.access).toEqual({ state: null, blocked: false, validUntil: null, expiredAt: null, expiredKind: null });

    // O dono não concede permissão de plataforma ao gerente.
    const dono = await entrar(est.dono.email);
    await reautenticar(dono);
    await dono
      .put(`/tenants/${est.tenantId}/team/members/${g.membershipId}/permissions`)
      .send({ expectedGranted: concedidas, granted: [...concedidas, 'ESTABLISHMENTS_MANAGE'] })
      .expect(400);

    const papeis = await q<{ platform_role: string | null; platform_permissions: string[] | null }>(
      `SELECT platform_role::text AS platform_role, platform_permissions::text[] AS platform_permissions FROM users WHERE id = ANY($1)`,
      [[est.dono.userId, g.userId]],
    );
    expect(papeis.every((p) => p.platform_role === null && !p.platform_permissions?.length)).toBe(true);
    expect(await n(`SELECT count(*)::int AS n FROM tenant_access_periods`)).toBe(periodosAntes);
  });
  it('legado só pela marca: sem período e sem marca bloqueia; a criação grava estabelecimento e teste juntos, ou nada', async () => {
    // Anterior ao controle: "Validade ainda não definida", opera.
    const antigo = await estabelecimento('antigo', 'plan_essencial');
    expect((await ficha(master, antigo.tenantId)).access).toMatchObject({ state: 'UNTRACKED', legacy: true, blocked: false });
    await (await entrar(antigo.dono.email)).get(`/tenants/${antigo.tenantId}/consumers/page`).expect(200);

    // Sem período e sem a marca (o teste não foi gravado): bloqueado, nunca indefinido.
    const semTeste = await estabelecimento('semteste', 'plan_essencial', false);
    expect((await ficha(master, semTeste.tenantId)).access).toMatchObject({ state: 'MISSING', legacy: false, blocked: true });
    const dono = await entrar(semTeste.dono.email);
    expect((await dono.get(`/tenants/${semTeste.tenantId}/consumers/page`).expect(403)).body.code).toBe('ACESSO_VENCIDO');
    expect((await dono.get('/auth/me').expect(200)).body.activeContext.access).toMatchObject({ state: 'MISSING', blocked: true });

    // Criação pela API: estabelecimento e teste na mesma transação.
    const criar = (requestKey: string, nome: string) =>
      master.post('/platform/establishments').send({
        requestKey,
        businessName: `${marca} ${nome}`,
        category: 'OTHER',
        timezone: TZ,
        planId: 'plan_equipe',
        owner: { name: `Dono ${nome}`, email: `${marca}-${nome}-dono@example.test` },
      });
    const criado = await criar(`chave-${id()}`, 'novo').expect(200);
    const novoId = criado.body.tenant.id as string;
    expect(await n(`SELECT count(*)::int AS n FROM tenant_access_periods WHERE tenant_id = $1 AND kind = 'TRIAL'`, [novoId])).toBe(1);
    expect((await ficha(master, novoId)).access).toMatchObject({ state: 'TRIAL', legacy: false, blocked: false });

    // Uma falha ao gravar o teste desfaz o estabelecimento inteiro.
    await q(`ALTER TABLE tenant_access_periods ADD CONSTRAINT ck_teste_falha CHECK (kind <> 'TRIAL' OR tenant_id = 'x') NOT VALID`);
    try {
      await criar(`chave-${id()}`, 'parcial').expect(500);
    } finally {
      await q(`ALTER TABLE tenant_access_periods DROP CONSTRAINT ck_teste_falha`);
    }
    expect(await n(`SELECT count(*)::int AS n FROM units WHERE name = $1`, [`${marca} parcial`])).toBe(0);
    expect(await n(`SELECT count(*)::int AS n FROM invites WHERE target_email = $1`, [`${marca}-parcial-dono@example.test`])).toBe(0);
  });

  it('correção: anula sem apagar, mostra o impacto, recusa a cadeia, repete sem efeito e não toca papel global', async () => {
    const est = await estabelecimento('corrige', 'plan_pro');
    const g = await gerente(est.tenantId, 'corrige-gerente', ['AGENDA_VISUALIZAR']);
    let f = await ficha(master, est.tenantId);
    const p1 = (await master.post(`/platform/establishments/${est.tenantId}/access/paid`).send(pago(f.updatedAt)).expect(200)).body.period;
    f = await ficha(master, est.tenantId);
    const p2 = (
      await master
        .post(`/platform/establishments/${est.tenantId}/access/paid`)
        .send(pago(f.updatedAt, { amountCents: 99999, reference: 'digitado errado' }))
        .expect(200)
    ).body.period;
    f = await ficha(master, est.tenantId);
    expect(f.allowedActions.correctPeriod).toBe(true);

    // A ficha mostra o impacto antes: só o último pode ser anulado, e a
    // validade volta ao fim do primeiro.
    const [maisRecente, anterior] = f.accessPeriods;
    expect(maisRecente).toMatchObject({ id: p2.id, correction: { allowed: true, after: { state: 'PAID', validUntil: p1.endsAt } } });
    expect(anterior).toMatchObject({ id: p1.id, correction: { allowed: false, blockedByPeriodId: p2.id } });

    const corrigir = (periodId: string, corpo: Record<string, unknown>, agente: Agente = master) =>
      agente.post(`/platform/establishments/${est.tenantId}/access/periods/${periodId}/correction`).send(corpo);

    // A cadeia não é desfeita pelo meio.
    const cadeia = await corrigir(p1.id, { expectedUpdatedAt: f.updatedAt, requestKey: `chave-${id()}`, reason: 'teste' }).expect(409);
    expect(cadeia.body.code).toBe('CORRECAO_EM_CADEIA');
    expect(cadeia.body.message).toContain('Corrija primeiro o registro mais recente');

    // Dono, gerente e um MASTER_OWNER sem senha confirmada não corrigem.
    for (const pessoa of [est.dono, g]) {
      const agente = await entrar(pessoa.email);
      await reautenticar(agente);
      await corrigir(p2.id, { expectedUpdatedAt: f.updatedAt, requestKey: `chave-${id()}`, reason: 'por conta própria' }, agente).expect(403);
    }
    const outro = await conta('master-corrige-sem-reauth', 'MASTER_OWNER');
    const semReauth = await corrigir(
      p2.id,
      { expectedUpdatedAt: f.updatedAt, requestKey: `chave-${id()}`, reason: 'sem senha' },
      await entrar(outro.email),
    ).expect(403);
    expect(semReauth.body.code).toBe('REAUTENTICACAO_NECESSARIA');
    // Motivo é obrigatório.
    await corrigir(p2.id, { expectedUpdatedAt: f.updatedAt, requestKey: `chave-${id()}` }).expect(400);

    const papeisAntes = await q(`SELECT id, platform_role::text AS r, platform_permissions::text[] AS p FROM users ORDER BY id`);
    const corpo = { expectedUpdatedAt: f.updatedAt, requestKey: `chave-${id()}`, reason: 'valor digitado errado' };
    const feita = await corrigir(p2.id, corpo).expect(200);
    expect(feita.body).toMatchObject({
      created: true,
      period: { id: p2.id, amountCents: 99999, canceled: { reason: 'valor digitado errado' } },
    });
    // Repetir: a mesma correção, nada novo.
    const repetida = await corrigir(p2.id, corpo).expect(200);
    expect(repetida.body).toMatchObject({ created: false, period: { id: p2.id } });
    // Outra tentativa sobre o já anulado: recusada.
    f = await ficha(master, est.tenantId);
    const deNovo = await corrigir(p2.id, { expectedUpdatedAt: f.updatedAt, requestKey: `chave-${id()}`, reason: 'de novo' }).expect(409);
    expect(deNovo.body.code).toBe('PERIODO_JA_CORRIGIDO');

    // Nada apagado: o registro e o valor ficam, marcados como anulados.
    const [linha] = await q<{ contracted_price_cents: number; canceled_at: Date | null; cancel_reason: string }>(
      `SELECT contracted_price_cents, canceled_at, cancel_reason FROM tenant_access_periods WHERE id = $1`,
      [p2.id],
    );
    expect(linha).toMatchObject({ contracted_price_cents: 99999, cancel_reason: 'valor digitado errado' });
    expect(linha.canceled_at).not.toBeNull();
    expect(await n(`SELECT count(*)::int AS n FROM tenant_access_periods WHERE tenant_id = $1`, [est.tenantId])).toBe(2);
    expect(f.access.validUntil).toBe(p1.endsAt);
    expect(f.accessPeriods.find((p) => p.id === p2.id)).toMatchObject({ canceled: { reason: 'valor digitado errado' }, correction: null });
    expect(f.accessPeriods.find((p) => p.id === p1.id)?.correction).toMatchObject({ allowed: true });

    // Histórico: uma correção, dizendo que nenhum valor foi devolvido.
    const auditoria = await q<{ summary: string; new_data: Record<string, unknown>; previous_data: Record<string, unknown> }>(
      `SELECT summary, new_data, previous_data FROM audit_logs WHERE tenant_id = $1 AND action = 'ACCESS_PERIOD_CORRECTED'`,
      [est.tenantId],
    );
    expect(auditoria).toHaveLength(1);
    expect(auditoria[0].summary).toContain('nenhum valor foi devolvido ou movimentado');
    expect(auditoria[0].new_data).toMatchObject({ periodId: p2.id, moneyMoved: false, access: { validUntil: p1.endsAt } });
    expect(auditoria[0].previous_data).toMatchObject({ period: { amountCents: 99999 }, access: { validUntil: p2.endsAt } });

    // O registro certo depois da correção encosta no fim do primeiro, sem
    // sobrepor nem duplicar: o anulado não ocupa mais as datas.
    const certo = await master
      .post(`/platform/establishments/${est.tenantId}/access/paid`)
      .send(pago(f.updatedAt, { amountCents: 14990 }))
      .expect(200);
    expect(certo.body.period.startsAt).toBe(p1.endsAt);
    expect(certo.body.period.endsAt).toBe(p2.endsAt);

    // Trocar o plano, corrigir e repetir não mexeram em nenhum papel global.
    f = await ficha(master, est.tenantId);
    await master.put(`/platform/establishments/${est.tenantId}/plan`).send({ expectedUpdatedAt: f.updatedAt, planId: 'plan_essencial' }).expect(200);
    expect(await q(`SELECT id, platform_role::text AS r, platform_permissions::text[] AS p FROM users ORDER BY id`)).toEqual(papeisAntes);
  });
});
