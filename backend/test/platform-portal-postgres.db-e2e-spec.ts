// Portal da plataforma PELA API HTTP real (AppModule inteiro, sessão por
// cookie), contra PostgreSQL DESCARTÁVEL com a migration PlatformPortal.
// Dados e preços fictícios (plano de teste, nunca os planos reais). Prova:
// - o portal recusa dono, gerente e profissional de Básico, Pro e Max, e os
//   papéis delegados, em TODA rota do portal, por API direta;
// - o papel de proprietário dado ou retirado vale na próxima requisição, com
//   a mesma sessão aberta;
// - preço do catálogo, preço contratado e origem do valor no pagamento, sem
//   efeito retroativo, com repetição idempotente;
// - "sem vencimento": libera a validade na próxima requisição, não libera
//   recurso fora do plano, cede ao inativo, retirada com consequência e sem
//   voltar à exceção de legado; reativar não perdoa vencimento;
// - nada disso apaga ou cancela agendamento, nem toca papel.
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

describe.skipIf(!url)('portal da plataforma pela API contra PostgreSQL descartável', () => {
  let app: INestApplication;
  let db: DataSource;
  const marca = `ptl${id().slice(0, 8)}`;
  let hash: string;
  let master: Agente;
  let planoTeste: string;
  let planoSemRecebimentos: string;

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

  let ip = 0;
  async function entrar(email: string): Promise<Agente> {
    const agente = request.agent(app.getHttpServer());
    ip += 1;
    await agente
      .post('/auth/login')
      .set('x-agenda-proxy-secret', SEGREDO_DO_PROXY)
      .set('x-agenda-client-ip', `10.40.${Math.floor(ip / 250)}.${ip % 250}`)
      .send({ login: email, password: SENHA })
      .expect(200);
    return agente;
  }

  const reautenticar = (agente: Agente) => {
    ip += 1;
    return agente
      .post('/platform/reauth')
      .set('x-agenda-proxy-secret', SEGREDO_DO_PROXY)
      .set('x-agenda-client-ip', `10.50.${Math.floor(ip / 250)}.${ip % 250}`)
      .send({ password: SENHA })
      .expect(204);
  };

  /** `legado`: marcado como anterior ao controle. Sem a marca e sem período:
   * bloqueado (como um estabelecimento novo cujo teste não foi gravado). */
  async function estabelecimento(nome: string, planId: string, legado = false) {
    const tenantId = id();
    await q(
      `INSERT INTO tenants (id, slug, category, timezone, plan_id, status, created_at, access_legacy_since)
       VALUES ($1, $2, 'OTHER', $3, $4, 'TRIAL', now() - interval '200 days', CASE WHEN $5::boolean THEN now() END)`,
      [tenantId, `${marca}-${nome}`, TZ, planId, legado],
    );
    await q(`INSERT INTO units (id, tenant_id, name, address, timezone, is_primary) VALUES ($1, $2, $3, '', $4, true)`, [
      id(),
      tenantId,
      `Estabelecimento ${nome}`,
      TZ,
    ]);
    const dono = await conta(`${nome}-dono`);
    await q(`INSERT INTO memberships (id, user_id, tenant_id, role) VALUES ($1, $2, $3, 'DONO')`, [id(), dono.userId, tenantId]);
    return { tenantId, dono };
  }

  /** Teste vencido há 10 dias, gravado como período (não legado). */
  async function testeVencido(tenantId: string, planId: string, gravadoPor: string) {
    await q(
      `INSERT INTO tenant_access_periods (id, tenant_id, kind, plan_id, starts_at, ends_at, recorded_at, recorded_by_user_id)
       VALUES ($1, $2, 'TRIAL', $3, now() - interval '25 days', now() - interval '10 days', now() - interval '25 days', $4)`,
      [id(), tenantId, planId, gravadoPor],
    );
  }

  async function membro(tenantId: string, nome: string, role: 'GERENTE' | 'PROFISSIONAL') {
    const pessoa = await conta(nome);
    let professionalId: string | null = null;
    if (role === 'PROFISSIONAL') {
      professionalId = id();
      await q(
        `INSERT INTO professionals (id, tenant_id, name, avatar_initials, avatar_color, active) VALUES ($1, $2, $3, 'PX', '#000000', true)`,
        [professionalId, tenantId, nome],
      );
    }
    await q(
      `INSERT INTO memberships (id, user_id, tenant_id, role, professional_id, permissions_confirmed_at)
       VALUES ($1, $2, $3, $4::establishment_role, $5, now())`,
      [id(), pessoa.userId, tenantId, role, professionalId],
    );
    return pessoa;
  }

  const ficha = async (tenantId: string) =>
    (await master.get(`/platform/establishments/${tenantId}`).expect(200)).body as {
      updatedAt: string;
      status: string;
      operational: 'ACTIVE' | 'INACTIVE';
      access: { state: string; legacy: boolean; noExpiry: boolean; blocked: boolean };
      accessPeriods: { id: string; kind: string; amountCents: number | null; amountSource: string | null }[];
      allowedActions: Record<string, boolean>;
      noExpiry: {
        active: { id: string; reason: string } | null;
        history: { id: string; revoked: { reason: string } | null }[];
        revokePreview: { state: string; blocked: boolean } | null;
      };
      pricing: {
        planId: string;
        preferredCycle: string | null;
        cycles: { cycle: string; catalogCents: number | null; contractCents: number | null; suggestedCents: number | null; source: string }[];
      };
    };
  const ciclo = (f: Awaited<ReturnType<typeof ficha>>, c: string) => f.pricing.cycles.find((x) => x.cycle === c)!;

  /** Registra um pagamento com a versão atual da ficha e confere o status. */
  const pagar = async (tenantId: string, extra: Record<string, unknown>, status = 200) => {
    const f = await ficha(tenantId);
    const r = await master
      .post(`/platform/establishments/${tenantId}/access/paid`)
      .send({
        expectedUpdatedAt: f.updatedAt,
        requestKey: `chave-${id()}`,
        cycle: 'MONTHLY',
        paymentMethod: 'PIX',
        receivedOn: hoje(),
        manualConfirmation: true,
        ...extra,
      })
      .expect(status);
    return r.body;
  };

  const precoCatalogo = (planId: string, cycle: string, corpo: Record<string, unknown>) =>
    master.put(`/platform/plans/${planId}/prices/${cycle}`).send(corpo);

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

    // Planos fictícios: nenhum preço é gravado nos planos reais.
    planoTeste = `${marca}pt`;
    await q(
      comTodosOsRecursos(
        `INSERT INTO plans (id, code, name, short_description, max_professionals, max_units) VALUES ($1, $1, 'Plano fictício', '', 10, 1)`,
      ),
      [planoTeste],
    );
    planoSemRecebimentos = `${marca}sr`;
    await q(
      comTodosOsRecursos(
        `INSERT INTO plans (id, code, name, short_description, max_professionals, max_units) VALUES ($1, $1, 'Sem recebimentos', '', 5, 1)`,
      ),
      [planoSemRecebimentos],
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

  it('portal recusado a dono, gerente e profissional de Básico, Pro e Max e a papéis delegados, em toda rota', async () => {
    const alvo = await estabelecimento('alvo', planoTeste, true);
    const pessoas: { email: string }[] = [];
    for (const plano of ['plan_essencial', 'plan_equipe', 'plan_pro']) {
      const est = await estabelecimento(`rec-${plano}`, plano, true);
      pessoas.push(est.dono, await membro(est.tenantId, `rec-${plano}-ger`, 'GERENTE'));
      pessoas.push(await membro(est.tenantId, `rec-${plano}-pro`, 'PROFISSIONAL'));
    }
    pessoas.push(await conta('rec-admin', 'MASTER_ADMIN'), await conta('rec-suporte', 'MASTER_SUPPORT'), await conta('rec-comum'));
    await q(`UPDATE users SET platform_permissions = '{ESTABLISHMENTS_MANAGE}' WHERE email = ANY($1) AND platform_role IS NOT NULL`, [
      pessoas.map((p) => p.email),
    ]);
    const f = await ficha(alvo.tenantId);
    const t = alvo.tenantId;
    const corpo = { expectedUpdatedAt: f.updatedAt, requestKey: `chave-${id()}`, reason: 'tentativa', confirm: true };
    const leituras = [
      '/platform/establishments',
      `/platform/establishments/${t}`,
      `/platform/establishments/${t}/members`,
      '/platform/prices',
      '/platform/subscription-payments',
      '/platform/users',
      '/platform/invites',
      '/platform/audit',
      '/platform/roles',
      '/platform/plans',
      '/platform/establishment-options',
      `/platform/requests/chave-${id()}`,
    ];
    const periodosAntes = await n(`SELECT count(*)::int AS n FROM tenant_access_periods`);
    const papeisAntes = await q(`SELECT id, platform_role, platform_permissions::text FROM users ORDER BY id`);
    for (const pessoa of pessoas) {
      const agente = await entrar(pessoa.email);
      // A senha confirmada não muda nada: o que falta é ser proprietário.
      await reautenticar(agente);
      expect((await agente.get('/platform/access').expect(200)).body).toMatchObject({ canViewEstablishments: false });
      for (const rota of leituras) await agente.get(rota).expect(403);
      await agente.post('/platform/establishments').send({}).expect((r) => expect([400, 403]).toContain(r.status));
      await agente
        .post('/platform/establishments')
        .send({
          requestKey: `chave-${id()}`,
          businessName: 'Tentativa',
          category: 'OTHER',
          planId: 'plan_pro',
          owner: { name: 'Eu', email: `${marca}-tentativa-${id()}@example.test` },
        })
        .expect(403);
      await agente.put(`/platform/plans/${planoTeste}/prices/MONTHLY`).send({ requestKey: `chave-${id()}`, expectedCurrentCents: null, amountCents: 100 }).expect(403);
      await agente
        .put(`/platform/establishments/${t}/contract-price`)
        .send({ expectedUpdatedAt: f.updatedAt, requestKey: `chave-${id()}`, cycle: 'MONTHLY', amountCents: 100, reason: 'tentativa' })
        .expect(403);
      await agente.post(`/platform/establishments/${t}/access/no-expiry`).send(corpo).expect(403);
      await agente.post(`/platform/establishments/${t}/access/no-expiry/revoke`).send(corpo).expect(403);
      await agente.post(`/platform/establishments/${t}/suspend`).send({ expectedUpdatedAt: f.updatedAt, reason: 'tentativa' }).expect(403);
      await agente
        .post(`/platform/establishments/${t}/access/paid`)
        .send({
          expectedUpdatedAt: f.updatedAt,
          requestKey: `chave-${id()}`,
          cycle: 'MONTHLY',
          amountCents: 100,
          paymentMethod: 'PIX',
          receivedOn: hoje(),
          manualConfirmation: true,
        })
        .expect(403);
    }
    // Nada mudou: nem período, nem papel, nem o estabelecimento-alvo.
    expect(await n(`SELECT count(*)::int AS n FROM tenant_access_periods`)).toBe(periodosAntes);
    expect(await q(`SELECT id, platform_role, platform_permissions::text FROM users ORDER BY id`)).toEqual(papeisAntes);
    expect((await ficha(t)).updatedAt).toBe(f.updatedAt);
  });

  it('papel de proprietário dado e retirado vale na próxima requisição, com a sessão aberta', async () => {
    const pessoa = await conta('promovida');
    const agente = await entrar(pessoa.email);
    await agente.get('/platform/establishments').expect(403);
    await q(`UPDATE users SET platform_role = 'MASTER_OWNER' WHERE id = $1`, [pessoa.userId]);
    await agente.get('/platform/establishments').expect(200);
    expect((await agente.get('/platform/access').expect(200)).body).toMatchObject({ canViewEstablishments: true });
    await q(`UPDATE users SET platform_role = NULL WHERE id = $1`, [pessoa.userId]);
    await agente.get('/platform/establishments').expect(403);
    await agente.get('/platform/prices').expect(403);
  });

  it('preços: pendente, catálogo, contrato na criação, origem no pagamento, sem efeito retroativo', async () => {
    // Pendente: nem contrato nem catálogo; nunca zero.
    const semPreco = await estabelecimento('sem-preco', planoTeste, true);
    expect(ciclo(await ficha(semPreco.tenantId), 'MONTHLY')).toEqual({
      cycle: 'MONTHLY',
      catalogCents: null,
      contractCents: null,
      suggestedCents: null,
      source: 'PENDING',
    });

    // Catálogo fictício (centavos de teste, nunca preço aprovado).
    const chave = `chave-${id()}`;
    const r1 = await precoCatalogo(planoTeste, 'MONTHLY', { requestKey: chave, expectedCurrentCents: null, amountCents: 4990 }).expect(200);
    expect(r1.body).toMatchObject({ created: true, price: { amountCents: 4990, cycle: 'MONTHLY' } });
    // Repetir a mesma chave não grava de novo; a mesma chave com outro valor é recusada.
    expect((await precoCatalogo(planoTeste, 'MONTHLY', { requestKey: chave, expectedCurrentCents: null, amountCents: 4990 }).expect(200)).body).toMatchObject({ created: false });
    expect((await precoCatalogo(planoTeste, 'MONTHLY', { requestKey: chave, expectedCurrentCents: null, amountCents: 5000 }).expect(409)).body.code).toBe('CHAVE_REUTILIZADA');
    // Outra tela mudou antes: a versão lida não confere.
    expect((await precoCatalogo(planoTeste, 'MONTHLY', { requestKey: `chave-${id()}`, expectedCurrentCents: null, amountCents: 5100 }).expect(409)).body.code).toBe('ALTERADO_POR_OUTRA_TELA');
    expect(ciclo(await ficha(semPreco.tenantId), 'MONTHLY')).toMatchObject({ suggestedCents: 4990, source: 'CATALOG' });
    expect(ciclo(await ficha(semPreco.tenantId), 'QUARTERLY')).toMatchObject({ suggestedCents: null, source: 'PENDING' });
    // Sem senha confirmada nesta sessão, o proprietário também não muda preço.
    const outroMaster = await entrar((await conta('master-sem-reauth', 'MASTER_OWNER')).email);
    expect(
      (await outroMaster.put(`/platform/plans/${planoTeste}/prices/MONTHLY`).send({ requestKey: `chave-${id()}`, expectedCurrentCents: 4990, amountCents: 100 }).expect(403)).body.code,
    ).toBe('REAUTENTICACAO_NECESSARIA');

    // Criação com plano, ciclo e valor contratado específico: não registra pagamento.
    const criado = await master
      .post('/platform/establishments')
      .send({
        requestKey: `chave-${id()}`,
        businessName: `Cliente ${marca}`,
        category: 'BARBERSHOP',
        planId: planoTeste,
        billingCycle: 'MONTHLY',
        contractAmountCents: 3990,
        owner: { name: 'Responsável fictício', email: `${marca}-cliente@example.test` },
      })
      .expect(200);
    const tenantId = criado.body.tenant.id as string;
    let f = await ficha(tenantId);
    expect(f.pricing.preferredCycle).toBe('MONTHLY');
    expect(ciclo(f, 'MONTHLY')).toMatchObject({ catalogCents: 4990, contractCents: 3990, suggestedCents: 3990, source: 'CONTRACT' });
    expect(f.accessPeriods.filter((p) => p.kind === 'PAID')).toHaveLength(0);
    expect(f.access.state).toBe('TRIAL');

    // Pagamento no valor contratado.
    const p1 = (await pagar(tenantId, { amountCents: 3990 })).period;
    expect(p1).toMatchObject({ amountCents: 3990, amountSource: 'CONTRACT' });
    // Ajuste só deste pagamento: contrato fica como estava.
    const p2 = (await pagar(tenantId, { amountCents: 3500 })).period;
    expect(p2).toMatchObject({ amountCents: 3500, amountSource: 'ADJUSTED' });
    expect(ciclo(await ficha(tenantId), 'MONTHLY')).toMatchObject({ contractCents: 3990, source: 'CONTRACT' });
    // Alterar o contratado para as próximas renovações.
    const p3 = (await pagar(tenantId, { amountCents: 4200, updateContract: true })).period;
    expect(p3).toMatchObject({ amountCents: 4200, amountSource: 'ADJUSTED' });
    expect(ciclo(await ficha(tenantId), 'MONTHLY')).toMatchObject({ contractCents: 4200, suggestedCents: 4200 });
    // O navegador não escolhe a origem: campo desconhecido é recusado.
    await pagar(tenantId, { amountCents: 4200, amountSource: 'CATALOG' }, 400);

    // Mudar catálogo e contrato depois não recalcula nada já registrado.
    f = await ficha(tenantId);
    await precoCatalogo(planoTeste, 'MONTHLY', { requestKey: `chave-${id()}`, expectedCurrentCents: 4990, amountCents: 5990 }).expect(200);
    await master
      .put(`/platform/establishments/${tenantId}/contract-price`)
      .send({ expectedUpdatedAt: f.updatedAt, requestKey: `chave-${id()}`, cycle: 'MONTHLY', amountCents: null, reason: 'volta ao catálogo' })
      .expect(200);
    f = await ficha(tenantId);
    expect(ciclo(f, 'MONTHLY')).toMatchObject({ catalogCents: 5990, contractCents: null, suggestedCents: 5990, source: 'CATALOG' });
    const valores = await q<{ id: string; contracted_price_cents: number; amount_source: string }>(
      `SELECT id, contracted_price_cents, amount_source FROM tenant_access_periods WHERE tenant_id = $1 AND kind = 'PAID' ORDER BY starts_at`,
      [tenantId],
    );
    expect(valores.map((v) => [v.id, Number(v.contracted_price_cents), v.amount_source])).toEqual([
      [p1.id, 3990, 'CONTRACT'],
      [p2.id, 3500, 'ADJUSTED'],
      [p3.id, 4200, 'ADJUSTED'],
    ]);
    // A correção por anulação continua funcionando sobre o último registro.
    await master
      .post(`/platform/establishments/${tenantId}/access/periods/${p3.id}/correction`)
      .send({ expectedUpdatedAt: f.updatedAt, requestKey: `chave-${id()}`, reason: 'registro de teste' })
      .expect(200);
    expect(await n(`SELECT count(*)::int AS n FROM tenant_access_periods WHERE id = $1 AND canceled_at IS NOT NULL`, [p3.id])).toBe(1);
    // Histórico administrativo das mudanças de preço.
    expect(await n(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'CONTRACT_PRICE_CHANGED' AND tenant_id = $1`, [tenantId])).toBe(1);
    expect(await n(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'PLAN_PRICE_CHANGED' AND new_data->>'planId' = $1`, [planoTeste])).toBe(2);
    // Pagamentos das assinaturas: só períodos pagos, nunca recebimentos dos atendimentos.
    const lista = (await master.get(`/platform/subscription-payments?tenantId=${tenantId}`).expect(200)).body;
    expect(lista.total).toBe(3);
    expect(lista.items.map((i: { amountCents: number }) => i.amountCents).sort()).toEqual([3500, 3990, 4200]);
  });

  it('sem vencimento: libera a validade na próxima requisição, cede ao inativo, não libera recurso fora do plano', async () => {
    const est = await estabelecimento('nv', planoSemRecebimentos);
    const masterId = (await q<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [`${marca}-master@example.test`]))[0].id;
    await testeVencido(est.tenantId, planoSemRecebimentos, masterId);
    const vizinho = await estabelecimento('nv-vizinho', planoTeste, true);
    const reservasAntes = await n(`SELECT count(*)::int AS n FROM appointments WHERE tenant_id = $1`, [est.tenantId]);
    const dono = await entrar(est.dono.email);
    expect((await dono.get(`/tenants/${est.tenantId}/services`).expect(403)).body.code).toBe('ACESSO_VENCIDO');

    let f = await ficha(est.tenantId);
    expect(f.allowedActions).toMatchObject({ grantNoExpiry: true, revokeNoExpiry: false });
    // Sem motivo ou sem confirmação, recusado.
    await master.post(`/platform/establishments/${est.tenantId}/access/no-expiry`).send({ expectedUpdatedAt: f.updatedAt, requestKey: `chave-${id()}`, confirm: true }).expect(400);
    await master.post(`/platform/establishments/${est.tenantId}/access/no-expiry`).send({ expectedUpdatedAt: f.updatedAt, requestKey: `chave-${id()}`, reason: 'parceria' }).expect(400);
    const chave = `chave-${id()}`;
    const concedido = await master
      .post(`/platform/establishments/${est.tenantId}/access/no-expiry`)
      .send({ expectedUpdatedAt: f.updatedAt, requestKey: chave, reason: 'parceria fictícia', confirm: true })
      .expect(200);
    expect(concedido.body).toMatchObject({ created: true, grant: { reason: 'parceria fictícia', revoked: null } });
    // Repetição devolve o mesmo, sem duplicar.
    expect(
      (await master.post(`/platform/establishments/${est.tenantId}/access/no-expiry`).send({ expectedUpdatedAt: f.updatedAt, requestKey: chave, reason: 'parceria fictícia', confirm: true }).expect(200)).body,
    ).toMatchObject({ created: false, grant: { id: concedido.body.grant.id } });

    // Mesma sessão do dono, próxima requisição: opera.
    await dono.get(`/tenants/${est.tenantId}/services`).expect(200);
    const me = (await dono.get('/auth/me').expect(200)).body;
    const contexto = me.contexts.find((c: { tenantId: string }) => c.tenantId === est.tenantId);
    expect(contexto.access).toMatchObject({ state: 'NO_EXPIRY', blocked: false, validUntil: null });
    // Sem vencimento não libera recurso fora do plano.
    expect((await dono.get(`/tenants/${est.tenantId}/payments`).expect(403)).body.code).toBe('RECURSO_NAO_CONTRATADO');
    // Nem o estabelecimento vizinho.
    await dono.get(`/tenants/${vizinho.tenantId}/services`).expect(404);
    f = await ficha(est.tenantId);
    expect(f.access).toMatchObject({ state: 'NO_EXPIRY', noExpiry: true, blocked: false });
    expect(f.noExpiry.revokePreview).toMatchObject({ state: 'EXPIRED', blocked: true });
    expect(f.accessPeriods.some((p) => p.kind === 'PAID')).toBe(false);

    // Inativo prevalece sobre o sem vencimento.
    await master.post(`/platform/establishments/${est.tenantId}/suspend`).send({ expectedUpdatedAt: f.updatedAt, reason: 'inativar teste' }).expect(200);
    await dono.get(`/tenants/${est.tenantId}/services`).expect(404);
    f = await ficha(est.tenantId);
    expect(f.operational).toBe('INACTIVE');
    await master.post(`/platform/establishments/${est.tenantId}/reactivate`).send({ expectedUpdatedAt: f.updatedAt }).expect(200);
    await dono.get(`/tenants/${est.tenantId}/services`).expect(200);

    // Retirada: consequência calculada antes, vale na próxima requisição.
    f = await ficha(est.tenantId);
    await master
      .post(`/platform/establishments/${est.tenantId}/access/no-expiry/revoke`)
      .send({ expectedUpdatedAt: f.updatedAt, requestKey: `chave-${id()}`, reason: 'fim da parceria', confirm: true })
      .expect(200);
    expect((await dono.get(`/tenants/${est.tenantId}/services`).expect(403)).body.code).toBe('ACESSO_VENCIDO');
    f = await ficha(est.tenantId);
    expect(f.access).toMatchObject({ state: 'EXPIRED', noExpiry: false });
    expect(f.noExpiry.active).toBeNull();
    expect(f.noExpiry.history).toHaveLength(1);
    expect(f.noExpiry.history[0].revoked).toMatchObject({ reason: 'fim da parceria' });
    // Retirar de novo: nada em vigor.
    expect(
      (await master.post(`/platform/establishments/${est.tenantId}/access/no-expiry/revoke`).send({ expectedUpdatedAt: f.updatedAt, requestKey: `chave-${id()}`, reason: 'de novo', confirm: true }).expect(409)).body.code,
    ).toBe('SEM_CONCESSAO');
    // Nada apagado: reservas e histórico ficam; dois registros no histórico.
    expect(await n(`SELECT count(*)::int AS n FROM appointments WHERE tenant_id = $1`, [est.tenantId])).toBe(reservasAntes);
    expect(
      await n(`SELECT count(*)::int AS n FROM audit_logs WHERE tenant_id = $1 AND action::text IN ('ACCESS_NO_EXPIRY_GRANTED', 'ACCESS_NO_EXPIRY_REVOKED')`, [est.tenantId]),
    ).toBe(2);
  });

  it('retirar o sem vencimento de um anterior ao controle não volta à exceção de legado; reativar não perdoa vencimento', async () => {
    const legado = await estabelecimento('nv-legado', planoTeste, true);
    let f = await ficha(legado.tenantId);
    expect(f.access.state).toBe('UNTRACKED');
    await master
      .post(`/platform/establishments/${legado.tenantId}/access/no-expiry`)
      .send({ expectedUpdatedAt: f.updatedAt, requestKey: `chave-${id()}`, reason: 'teste legado', confirm: true })
      .expect(200);
    f = await ficha(legado.tenantId);
    // A prévia já mostra o bloqueio: sem período, não volta a "ainda não definida".
    expect(f.noExpiry.revokePreview).toMatchObject({ state: 'MISSING', blocked: true });
    await master
      .post(`/platform/establishments/${legado.tenantId}/access/no-expiry/revoke`)
      .send({ expectedUpdatedAt: f.updatedAt, requestKey: `chave-${id()}`, reason: 'retirada', confirm: true })
      .expect(200);
    f = await ficha(legado.tenantId);
    expect(f.access).toMatchObject({ state: 'MISSING', blocked: true, legacy: false });

    // Vencido, inativado e ativado de novo: continua vencido.
    const vencido = await estabelecimento('reativa', planoTeste);
    const masterId = (await q<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [`${marca}-master@example.test`]))[0].id;
    await testeVencido(vencido.tenantId, planoTeste, masterId);
    f = await ficha(vencido.tenantId);
    await master.post(`/platform/establishments/${vencido.tenantId}/suspend`).send({ expectedUpdatedAt: f.updatedAt, reason: 'inativar' }).expect(200);
    f = await ficha(vencido.tenantId);
    await master.post(`/platform/establishments/${vencido.tenantId}/reactivate`).send({ expectedUpdatedAt: f.updatedAt }).expect(200);
    f = await ficha(vencido.tenantId);
    expect(f).toMatchObject({ operational: 'ACTIVE', access: { state: 'EXPIRED', blocked: true } });
    const dono = await entrar(vencido.dono.email);
    expect((await dono.get(`/tenants/${vencido.tenantId}/services`).expect(403)).body.code).toBe('ACESSO_VENCIDO');
    // Perfil e segurança continuam: a sessão abre e lista o estabelecimento bloqueado.
    const me = (await dono.get('/auth/me').expect(200)).body;
    expect(me.contexts.find((c: { tenantId: string }) => c.tenantId === vencido.tenantId).access.blocked).toBe(true);
  });
});
