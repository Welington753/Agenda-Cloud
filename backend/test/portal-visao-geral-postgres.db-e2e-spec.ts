// Visão geral e listagem comercial do portal PELA API HTTP real (AppModule
// inteiro, sessão por cookie), contra PostgreSQL DESCARTÁVEL. Dados e preços
// fictícios (plano de teste, nunca os planos reais). Prova:
// - os totais usam a regra central de acesso (situação administrativa +
//   validade), abrangem o conjunto completo (mais registros que uma página)
//   e não duplicam estabelecimentos com renovações e vários períodos;
// - pagamentos do mês: só confirmados manualmente, não anulados, pela data de
//   recebimento registrada, somando o valor gravado;
// - filtros da listagem (validade em 7 dias, validade bloqueando, acesso
//   liberado/bloqueado, condição contratada pendente) com paginação;
// - condição contratada mensal e trimestral ao mesmo tempo, separada do
//   catálogo; pendente nunca vira zero;
// - recusa a quem não é MASTER_OWNER, ao proprietário suspenso e ao que tem
//   troca de senha obrigatória.
//
// O banco é compartilhado com os outros arquivos (em série): os totais são
// conferidos pela DIFERENÇA antes/depois de criar os dados deste arquivo.
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
/** `YYYY-MM-DD` de hoje + `dias` (data de calendário). */
/** Último dia do mês anterior: um recebimento fora do mês corrente. */
const antesDoMes = () => new Date(Date.UTC(Number(hoje().slice(0, 4)), Number(hoje().slice(5, 7)) - 1, 0)).toISOString().slice(0, 10);
const dia = (dias: number) => {
  const [y, m, d] = hoje().split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + dias)).toISOString().slice(0, 10);
};

type Agente = ReturnType<typeof request.agent>;

interface Visao {
  establishments: {
    total: number;
    allowed: number;
    blocked: number;
    blockedByStatus: number;
    blockedByValidity: number;
    expiringSoon: number;
    validityBlocked: number;
    suspended: number;
    contractPending: number;
    byState: Record<string, number>;
  };
  payments: {
    timeZone: string;
    month: string;
    from: string;
    to: string;
    count: number;
    totalCents: number;
    canceledCount: number;
  };
  attention: {
    total: number;
    byReason: { VALIDITY_BLOCKED: number; EXPIRING_SOON: number };
    items: { tenant: { id: string; name: string }; reason: string; lastDay: string | null; daysLeft: number | null }[];
  };
}

interface Item {
  id: string;
  status: string;
  operational: string;
  access: { state: string; effective: string; lastDay: string | null; daysLeft: number | null; blocked: boolean };
  commercial: {
    agreedCycle: string | null;
    contractPending: boolean;
    cycles: { cycle: string; catalogCents: number | null; contractCents: number | null; suggestedCents: number | null; source: string }[];
  };
}

describe.skipIf(!url)('visão geral e listagem do portal pela API contra PostgreSQL descartável', () => {
  let app: INestApplication;
  let db: DataSource;
  const marca = `pvg${id().slice(0, 8)}`;
  let hash: string;
  let master: Agente;
  let masterId: string;
  let plano: string;

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
      .set('x-agenda-client-ip', `10.70.${Math.floor(ip / 250)}.${ip % 250}`)
      .send({ login: email, password: SENHA })
      .expect(200);
    return agente;
  }

  /** `legado`: marcado como anterior ao controle de validade. */
  async function estabelecimento(nome: string, status = 'ACTIVE', legado = false) {
    const tenantId = id();
    await q(
      `INSERT INTO tenants (id, slug, category, timezone, plan_id, status, created_at, access_legacy_since)
       VALUES ($1, $2, 'OTHER', $3, $4, $5::tenant_status, now() - interval '200 days', CASE WHEN $6::boolean THEN now() END)`,
      [tenantId, `${marca}-${nome}`, TZ, plano, status, legado],
    );
    await q(`INSERT INTO units (id, tenant_id, name, address, timezone, is_primary) VALUES ($1, $2, $3, '', $4, true)`, [
      id(),
      tenantId,
      `Estabelecimento ${marca} ${nome}`,
      TZ,
    ]);
    return tenantId;
  }

  /** Período de `inicio` a `fim` dias a partir de hoje (meia-noite local). */
  async function periodo(
    tenantId: string,
    kind: 'TRIAL' | 'PAID' | 'COURTESY',
    inicio: number,
    fim: number,
    pago: { cents?: number; recebidoEm?: string; anulado?: boolean } = {},
  ) {
    const meiaNoite = (d: number) => `(($1::date + ${d})::timestamp AT TIME ZONE '${TZ}')`;
    const periodId = id();
    const ehPago = kind === 'PAID';
    await q(
      `INSERT INTO tenant_access_periods (id, tenant_id, kind, plan_id, starts_at, ends_at, anchor_day, billing_cycle,
         contracted_price_cents, currency, payment_method, payment_received_on, confirmation_source, reason, recorded_by_user_id,
         request_key, canceled_at, canceled_by_user_id, cancel_reason, cancel_request_key)
       VALUES ($2, $3, $4::access_period_kind, $5, ${meiaNoite(inicio)}, ${meiaNoite(fim)}, $6, $7::billing_cycle,
         $8, $9, $10, $11::date, $12, $13, $14, $15, $16, $17, $18, $19)`,
      [
        hoje(),
        periodId,
        tenantId,
        kind,
        plano,
        ehPago ? 1 : null,
        ehPago ? 'MONTHLY' : null,
        ehPago ? (pago.cents ?? 5000) : null,
        ehPago ? 'BRL' : null,
        ehPago ? 'PIX' : null,
        ehPago ? (pago.recebidoEm ?? hoje()) : null,
        ehPago ? 'MANUAL' : null,
        kind === 'COURTESY' ? 'cortesia fictícia' : null,
        masterId,
        kind === 'TRIAL' ? null : `chave-${id()}`,
        pago.anulado ? new Date() : null,
        pago.anulado ? masterId : null,
        pago.anulado ? 'registro de teste anulado' : null,
        pago.anulado ? `anula-${id()}` : null,
      ],
    );
    return periodId;
  }

  async function contrato(tenantId: string, cycle: 'MONTHLY' | 'QUARTERLY', cents: number | null, ha: number) {
    await q(
      `INSERT INTO tenant_contract_prices (id, tenant_id, plan_id, billing_cycle, amount_cents, reason, recorded_at, recorded_by_user_id, request_key)
       VALUES ($1, $2, $3, $4::billing_cycle, $5, 'condição fictícia', now() - make_interval(mins => $6), $7, $8)`,
      [id(), tenantId, plano, cycle, cents, ha, masterId, `chave-${id()}`],
    );
  }

  const visao = async (agente = master) => (await agente.get('/platform/overview').expect(200)).body as Visao;

  /** Todos os itens de uma busca, página por página. */
  async function todos(filtro = ''): Promise<{ items: Item[]; total: number; paginas: number }> {
    const items: Item[] = [];
    let total = 0;
    let paginas = 0;
    for (let page = 1; ; page += 1) {
      const r = (await master.get(`/platform/establishments?q=${marca}&pageSize=10&page=${page}${filtro}`).expect(200)).body as {
        items: Item[];
        total: number;
      };
      paginas += 1;
      total = r.total;
      items.push(...r.items);
      if (page * 10 >= r.total) break;
    }
    return { items, total, paginas };
  }

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
    // Catálogo fictício só no mensal: o trimestral fica pendente.
    await q(
      `INSERT INTO plan_prices (id, plan_id, billing_cycle, amount_cents, recorded_by_user_id, request_key)
       VALUES ($1, $2, 'MONTHLY', 9900, $3, $4)`,
      [id(), plano, masterId, `chave-${id()}`],
    );
  });

  afterAll(async () => {
    await app?.close();
    if (db?.isInitialized) await db.destroy();
  });

  it('totais, pagamentos do mês, atenção, filtros e condição contratada sobre o conjunto completo', async () => {
    const antes = await visao();
    expect(antes.payments).toMatchObject({ timeZone: TZ, month: hoje().slice(0, 7), from: `${hoje().slice(0, 8)}01` });
    const g: Record<string, string[]> = {};
    const add = (grupo: string, tenantId: string) => (g[grupo] ??= []).push(tenantId);

    // Pagos com renovação: teste antigo + pago atual + pago futuro encostado.
    // O atual termina em 3 dias, mas a renovação já registrada empurra a
    // validade para longe: não entra na janela de 7 dias.
    for (let i = 0; i < 3; i += 1) {
      const t = await estabelecimento(`renovado${i}`);
      await periodo(t, 'TRIAL', -60, -45);
      await periodo(t, 'PAID', -45, -27, { cents: 5000, recebidoEm: antesDoMes() });
      await periodo(t, 'PAID', -27, 3, { cents: 5000, recebidoEm: hoje() });
      await periodo(t, 'PAID', 3, 33, { cents: 7000, recebidoEm: hoje() });
      add('renovado', t);
    }
    // Teste terminando em 2 dias (status TRIAL): em operação, vence em breve.
    for (let i = 0; i < 2; i += 1) {
      const t = await estabelecimento(`teste${i}`, 'TRIAL');
      await periodo(t, 'TRIAL', -12, 3);
      add('vencendo', t);
    }
    // Limite da janela: último dia em hoje + 6 entra; hoje + 7 não.
    const limiteDentro = await estabelecimento('limite6');
    await periodo(limiteDentro, 'PAID', -20, 7, { cents: 4000, recebidoEm: antesDoMes() });
    add('vencendo', limiteDentro);
    const limiteFora = await estabelecimento('limite7');
    await periodo(limiteFora, 'PAID', -20, 8, { cents: 4000, recebidoEm: antesDoMes() });
    add('liberadoSemJanela', limiteFora);
    // Pago vencido (em operação): validade bloqueia.
    for (let i = 0; i < 2; i += 1) {
      const t = await estabelecimento(`vencido${i}`);
      await periodo(t, 'PAID', -40, -10, { cents: 3000, recebidoEm: antesDoMes() });
      add('vencido', t);
    }
    // Sem período e sem marca de anterior: bloqueado (ausente).
    const ausente = await estabelecimento('ausente');
    add('vencido', ausente);
    // Legado: "Validade ainda não definida", liberado.
    for (let i = 0; i < 9; i += 1) add('legado', await estabelecimento(`legado${i}`, 'ACTIVE', true));
    // Sem vencimento em vigor.
    const semVencimento = await estabelecimento('semvenc');
    await periodo(semVencimento, 'TRIAL', -40, -25);
    await q(
      `INSERT INTO tenant_no_expiry_grants (id, tenant_id, granted_by_user_id, grant_reason, grant_request_key) VALUES ($1, $2, $3, 'fictício', $4)`,
      [id(), semVencimento, masterId, `chave-${id()}`],
    );
    // Cortesia em curso (20 dias).
    const cortesia = await estabelecimento('cortesia');
    await periodo(cortesia, 'COURTESY', -10, 20);
    // Suspensos com pago em curso, terminando em 2 dias: bloqueados pela
    // situação; continuam na janela de validade, fora da "atenção".
    for (let i = 0; i < 2; i += 1) {
      const t = await estabelecimento(`suspenso${i}`, 'SUSPENDED');
      await periodo(t, 'PAID', -28, 3, { cents: 6000, recebidoEm: antesDoMes() });
      add('suspenso', t);
    }
    // Arquivado legado.
    const arquivado = await estabelecimento('arquivado', 'ARCHIVED', true);
    // Pagamento anulado no mês e pagamento recebido no mês anterior: fora.
    const anulado = await estabelecimento('anulado', 'ACTIVE', true);
    await periodo(anulado, 'PAID', 40, 70, { cents: 99_000, recebidoEm: hoje(), anulado: true });
    const mesPassado = await estabelecimento('mespassado');
    await periodo(mesPassado, 'PAID', -10, 25, { cents: 88_000, recebidoEm: antesDoMes() });

    // Condição contratada: os dois ciclos; só trimestral; "segue o catálogo".
    const [doisCiclos, soTrimestral, segueCatalogo] = g.legado;
    await contrato(doisCiclos, 'MONTHLY', 8900, 30);
    await contrato(doisCiclos, 'QUARTERLY', 24900, 10);
    await contrato(soTrimestral, 'QUARTERLY', 26000, 5);
    await contrato(segueCatalogo, 'MONTHLY', 8000, 60);
    await contrato(segueCatalogo, 'MONTHLY', null, 1);

    const N = 26;
    const depois = await visao();
    const d = (k: keyof Visao['establishments']) => (depois.establishments[k] as number) - (antes.establishments[k] as number);
    expect(d('total')).toBe(N);
    // Liberados: 3 renovados, 2 testes, 2 limites, 9 legados, sem vencimento,
    // cortesia, anulado (legado) e mês passado.
    expect(d('allowed')).toBe(20);
    expect(d('blocked')).toBe(6);
    expect(d('blockedByStatus')).toBe(3);
    expect(d('blockedByValidity')).toBe(3);
    // 2 testes + limite de 6 dias + 2 suspensos.
    expect(d('expiringSoon')).toBe(5);
    expect(d('validityBlocked')).toBe(3);
    expect(d('suspended')).toBe(2);
    expect(d('contractPending')).toBe(N - 2);
    const estado = (k: string) => (depois.establishments.byState[k] ?? 0) - (antes.establishments.byState[k] ?? 0);
    expect(estado('PAID')).toBe(3 + 2 + 2 + 1);
    expect(estado('TRIAL')).toBe(2);
    expect(estado('EXPIRED')).toBe(2);
    expect(estado('MISSING')).toBe(1);
    expect(estado('UNTRACKED')).toBe(11);
    expect(estado('NO_EXPIRY')).toBe(1);
    expect(estado('COURTESY')).toBe(1);

    // Pagamentos do mês: 3 × (5000 + 7000) recebidos hoje. O anulado e o do
    // mês anterior ficam fora; o anulado aparece só na contagem de anulados.
    expect(depois.payments.count - antes.payments.count).toBe(6);
    expect(depois.payments.totalCents - antes.payments.totalCents).toBe(36_000);
    expect(depois.payments.canceledCount - antes.payments.canceledCount).toBe(1);

    // Atenção: só quem está em operação (suspensos fora).
    expect(depois.attention.byReason.VALIDITY_BLOCKED - antes.attention.byReason.VALIDITY_BLOCKED).toBe(3);
    expect(depois.attention.byReason.EXPIRING_SOON - antes.attention.byReason.EXPIRING_SOON).toBe(3);
    expect(depois.attention.items.length).toBeLessThanOrEqual(20);
    if (depois.attention.total <= 20) {
      const ids = depois.attention.items.map((i) => i.tenant.id);
      for (const t of [...g.vencido, ...g.vencendo]) expect(ids).toContain(t);
      for (const t of g.suspenso) expect(ids).not.toContain(t);
    }

    // Listagem: mais registros que uma página, sem repetir nenhum.
    const lista = await todos();
    expect(lista.total).toBe(N);
    expect(lista.paginas).toBe(3);
    expect(new Set(lista.items.map((i) => i.id)).size).toBe(N);
    const item = (t: string) => lista.items.find((i) => i.id === t)!;

    const renovado = item(g.renovado[0]);
    expect(renovado.access).toMatchObject({ state: 'PAID', effective: 'ALLOWED', lastDay: dia(32), daysLeft: 32 });
    expect(item(g.vencendo[0]).access).toMatchObject({ state: 'TRIAL', effective: 'ALLOWED', lastDay: dia(2), daysLeft: 2 });
    expect(item(g.vencendo[0]).operational).toBe('ACTIVE');
    expect(item(limiteDentro).access.daysLeft).toBe(6);
    expect(item(limiteFora).access.daysLeft).toBe(7);
    expect(item(ausente).access).toMatchObject({ state: 'MISSING', effective: 'BLOCKED_VALIDITY', lastDay: null, daysLeft: null });
    expect(item(g.suspenso[0])).toMatchObject({ operational: 'INACTIVE', access: { state: 'PAID', effective: 'BLOCKED_STATUS' } });
    expect(item(arquivado)).toMatchObject({ status: 'ARCHIVED', operational: 'INACTIVE' });
    expect(item(semVencimento).access).toMatchObject({ state: 'NO_EXPIRY', lastDay: null, daysLeft: null });
    expect(item(g.legado[3]).access).toMatchObject({ state: 'UNTRACKED', lastDay: null });

    // Condição contratada separada do catálogo; pendente nunca é zero.
    expect(item(doisCiclos).commercial).toEqual({
      agreedCycle: 'QUARTERLY',
      contractPending: false,
      cycles: [
        { cycle: 'MONTHLY', catalogCents: 9900, contractCents: 8900, suggestedCents: 8900, source: 'CONTRACT' },
        { cycle: 'QUARTERLY', catalogCents: null, contractCents: 24900, suggestedCents: 24900, source: 'CONTRACT' },
      ],
    });
    expect(item(soTrimestral).commercial).toMatchObject({ agreedCycle: 'QUARTERLY', contractPending: false });
    expect(item(soTrimestral).commercial.cycles[0]).toMatchObject({ source: 'CATALOG', suggestedCents: 9900, contractCents: null });
    expect(item(segueCatalogo).commercial).toMatchObject({ agreedCycle: 'MONTHLY', contractPending: true });
    expect(item(segueCatalogo).commercial.cycles[0]).toMatchObject({ source: 'CATALOG', contractCents: null });
    // Pagamentos registrados não viram contrato.
    expect(renovado.commercial).toMatchObject({ agreedCycle: null, contractPending: true });
    expect(renovado.commercial.cycles[1]).toMatchObject({ source: 'PENDING', suggestedCents: null });

    // Filtros, sempre sobre o conjunto completo e paginados.
    const ids = async (filtro: string) => new Set((await todos(filtro)).items.map((i) => i.id));
    expect(await ids('&filter=EXPIRING_SOON')).toEqual(new Set([...g.vencendo, ...g.suspenso]));
    expect(await ids('&filter=VALIDITY_BLOCKED')).toEqual(new Set(g.vencido));
    expect(await ids('&filter=ACCESS_BLOCKED')).toEqual(new Set([...g.vencido, ...g.suspenso, arquivado]));
    expect((await todos('&filter=ACCESS_ALLOWED')).total).toBe(20);
    expect((await todos('&filter=CONTRACT_PENDING')).total).toBe(N - 2);
    expect(await ids('&status=SUSPENDED')).toEqual(new Set(g.suspenso));
    expect(await ids('&status=SUSPENDED&filter=EXPIRING_SOON')).toEqual(new Set(g.suspenso));
    await master.get('/platform/establishments?filter=QUALQUER').expect(400);
  });

  it('recusa quem não é MASTER_OWNER, o proprietário suspenso e o que precisa trocar a senha', async () => {
    const dono = await conta('dono');
    const tenantId = await estabelecimento('do-dono', 'ACTIVE', true);
    await q(`INSERT INTO memberships (id, user_id, tenant_id, role) VALUES ($1, $2, $3, 'DONO')`, [id(), dono.userId, tenantId]);
    const agenteDono = await entrar(dono.email);
    await agenteDono.get('/platform/overview').expect(403);
    await agenteDono.get('/platform/establishments?filter=EXPIRING_SOON').expect(403);

    for (const papel of ['MASTER_ADMIN', 'MASTER_SUPPORT']) {
      const delegado = await conta(`delegado-${papel}`, papel);
      await (await entrar(delegado.email)).get('/platform/overview').expect(403);
    }

    const trocar = await conta('trocar', 'MASTER_OWNER');
    const agenteTrocar = await entrar(trocar.email);
    await agenteTrocar.get('/platform/overview').expect(200);
    await q(`UPDATE users SET must_change_password = true WHERE id = $1`, [trocar.userId]);
    const recusa = await agenteTrocar.get('/platform/overview').expect(403);
    expect(recusa.body).toMatchObject({ code: 'TROCA_DE_SENHA_OBRIGATORIA' });
    await agenteTrocar.get('/platform/establishments?filter=CONTRACT_PENDING').expect(403);

    const suspenso = await conta('suspenso', 'MASTER_OWNER');
    const agenteSuspenso = await entrar(suspenso.email);
    await agenteSuspenso.get('/platform/overview').expect(200);
    await q(`UPDATE users SET status = 'SUSPENDED' WHERE id = $1`, [suspenso.userId]);
    const r = await agenteSuspenso.get('/platform/overview');
    expect([401, 403]).toContain(r.status);
    expect(r.body).not.toHaveProperty('establishments');
  });
});
