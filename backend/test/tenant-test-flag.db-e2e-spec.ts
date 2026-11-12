// Marca de estabelecimento de teste e slugs reservados PELA API HTTP real
// (AppModule inteiro, sessão por cookie), contra PostgreSQL DESCARTÁVEL com a
// migration TenantTestFlag. Dados fictícios. Prova:
// - `is_test` nasce false em estabelecimento gravado sem a coluna (testes
//   antigos não são identificados sozinhos);
// - só o dono da plataforma marca; dono e profissional do estabelecimento
//   recebem 403 por chamada direta à API, e nada muda;
// - a marca é auditada com valor anterior e novo, repetir não grava nada e a
//   versão antiga é recusada;
// - só o estabelecimento-alvo muda (isolamento);
// - a página pública continua no ar, com `indexable: false` e sem expor a
//   marca; os outros estabelecimentos seguem indexáveis;
// - cadastro com nome que gera slug reservado recebe sufixo, e um
//   estabelecimento antigo com slug reservado continua na página pública e
//   aparece na conferência só de leitura de colisões;
// - o cadastro não aceita slug escolhido: `slug` no corpo é 400 e nada é
//   gravado (não há substituição silenciosa de um slug pedido);
// - cadastros simultâneos com o mesmo nome reservado recebem slugs
//   diferentes, nenhum reservado (UNIQUE + nova tentativa);
// - a conferência do piloto reconhece o estado "depois".
import { randomUUID } from 'node:crypto';
import { globSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import cookieParser from 'cookie-parser';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { hashPassword } from '../src/auth/password-hasher.js';
import { buildRuntimeDataSourceOptions } from '../src/database/runtime-data-source.js';
import type { PgClientLike } from '../scripts/lib/pg-client.js';
import { lerColisoesDeSlug } from '../scripts/lib/slugs-reservados-check.js';
import {
  falhasAntesDoTenantTeste,
  falhasDepoisDoTenantTeste,
  lerEstadoTenantTeste,
  MIGRATIONS_ATE_TENANT_TESTE,
} from '../scripts/lib/tenant-teste-schema.js';
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

async function comCliente<T>(fn: (client: PgClientLike) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: url!, ssl: { rejectUnauthorized: true } });
  await client.connect();
  try {
    return await fn(client as unknown as PgClientLike);
  } finally {
    await client.end();
  }
}

describe.skipIf(!url)('estabelecimento de teste e slugs reservados contra PostgreSQL descartável', () => {
  let app: INestApplication;
  let db: DataSource;
  const marca = `tst${id().slice(0, 8)}`;
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
      .set('x-agenda-client-ip', `10.60.${Math.floor(ip / 250)}.${ip % 250}`)
      .send({ login: email, password: SENHA })
      .expect(200);
    return agente;
  }

  /** Estabelecimento legado com a página pública LIGADA. O INSERT não cita
   * `is_test`: é como um cadastro anterior à migration. */
  async function estabelecimento(nome: string, slug = `${marca}-${nome}`) {
    const tenantId = id();
    await q(
      `INSERT INTO tenants (id, slug, category, timezone, plan_id, status, access_legacy_since)
       VALUES ($1, $2, 'OTHER', $3, $4, 'ACTIVE', now())`,
      [tenantId, slug, TZ, plano],
    );
    await q(`INSERT INTO units (id, tenant_id, name, address, timezone, is_primary) VALUES ($1, $2, $3, '', $4, true)`, [
      id(),
      tenantId,
      `Estabelecimento ${nome}`,
      TZ,
    ]);
    const dono = await conta(`${nome}-dono`);
    await q(`INSERT INTO memberships (id, user_id, tenant_id, role) VALUES ($1, $2, $3, 'DONO')`, [id(), dono.userId, tenantId]);
    await q(`INSERT INTO public_booking_settings (tenant_id, enabled, updated_by, updated_at) VALUES ($1, true, $2, now())`, [
      tenantId,
      dono.userId,
    ]);
    return { tenantId, slug, dono };
  }

  async function profissional(tenantId: string, nome: string) {
    const pessoa = await conta(nome);
    const professionalId = id();
    await q(
      `INSERT INTO professionals (id, tenant_id, name, avatar_initials, avatar_color, active) VALUES ($1, $2, $3, 'PX', '#000000', true)`,
      [professionalId, tenantId, nome],
    );
    await q(
      `INSERT INTO memberships (id, user_id, tenant_id, role, professional_id, permissions_confirmed_at)
       VALUES ($1, $2, $3, 'PROFISSIONAL', $4, now())`,
      [id(), pessoa.userId, tenantId, professionalId],
    );
    return pessoa;
  }

  const ficha = async (tenantId: string) =>
    (await master.get(`/platform/establishments/${tenantId}`).expect(200)).body as {
      updatedAt: string;
      isTest: boolean;
      allowedActions: Record<string, boolean>;
    };
  const isTest = async (tenantId: string) =>
    (await q<{ is_test: boolean }>('SELECT is_test FROM tenants WHERE id = $1', [tenantId]))[0].is_test;
  const auditorias = (tenantId: string) =>
    q<{ actor_user_id: string; previous_data: unknown; new_data: unknown }>(
      `SELECT actor_user_id, previous_data, new_data FROM audit_logs
        WHERE tenant_id = $1 AND action = 'TENANT_TEST_FLAG_CHANGED' ORDER BY occurred_at, id`,
      [tenantId],
    );
  const publico = (slug: string) => request(app.getHttpServer()).get(`/public/${slug}`);

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
  });

  afterAll(async () => {
    await app?.close();
    if (db?.isInitialized) await db.destroy();
  });

  it('nasce false sem citar a coluna; a ficha mostra a marca e a ação permitida ao dono da plataforma', async () => {
    const est = await estabelecimento('nasce');
    expect(await isTest(est.tenantId)).toBe(false);
    const f = await ficha(est.tenantId);
    expect(f.isTest).toBe(false);
    expect(f.allowedActions.markTest).toBe(true);
    const r = await publico(est.slug).expect(200);
    expect(r.body.profile.indexable).toBe(true);
  });

  it('dono da plataforma marca e desmarca: auditoria com valor anterior e novo, repetição sem registro, versão antiga recusada, só o alvo muda', async () => {
    const alvo = await estabelecimento('alvo');
    const vizinho = await estabelecimento('vizinho');
    const v0 = (await ficha(alvo.tenantId)).updatedAt;
    const vizinhoAntes = (await ficha(vizinho.tenantId)).updatedAt;

    const marcou = await master.put(`/platform/establishments/${alvo.tenantId}/test-flag`).send({ expectedUpdatedAt: v0, isTest: true }).expect(200);
    expect(marcou.body.isTest).toBe(true);
    expect(await isTest(alvo.tenantId)).toBe(true);
    expect(await auditorias(alvo.tenantId)).toEqual([
      { actor_user_id: masterId, previous_data: { isTest: false }, new_data: { isTest: true } },
    ]);

    // Isolamento: o vizinho não muda nem ganha registro.
    expect(await isTest(vizinho.tenantId)).toBe(false);
    expect((await ficha(vizinho.tenantId)).updatedAt).toBe(vizinhoAntes);
    expect(await auditorias(vizinho.tenantId)).toEqual([]);

    // Versão antiga: 409 sem mudar nada.
    const velha = await master.put(`/platform/establishments/${alvo.tenantId}/test-flag`).send({ expectedUpdatedAt: v0, isTest: false }).expect(409);
    expect(velha.body.code).toBe('ALTERADO_POR_OUTRA_TELA');
    expect(await isTest(alvo.tenantId)).toBe(true);

    // Mesmo valor com a versão atual: idempotente pelo estado, sem registro novo.
    const v1 = (await ficha(alvo.tenantId)).updatedAt;
    const repetido = await master.put(`/platform/establishments/${alvo.tenantId}/test-flag`).send({ expectedUpdatedAt: v1, isTest: true }).expect(200);
    expect(new Date(repetido.body.updatedAt).toISOString()).toBe(v1);
    expect(await auditorias(alvo.tenantId)).toHaveLength(1);

    await master.put(`/platform/establishments/${alvo.tenantId}/test-flag`).send({ expectedUpdatedAt: v1, isTest: false }).expect(200);
    expect(await isTest(alvo.tenantId)).toBe(false);
    expect((await auditorias(alvo.tenantId)).at(-1)).toEqual({
      actor_user_id: masterId,
      previous_data: { isTest: true },
      new_data: { isTest: false },
    });
  });

  it('dono e profissional do estabelecimento: 403 por chamada direta, nada muda e nada é auditado', async () => {
    const est = await estabelecimento('proprio');
    const pro = await profissional(est.tenantId, 'proprio-pro');
    const v = (await ficha(est.tenantId)).updatedAt;
    for (const pessoa of [est.dono, pro]) {
      const agente = await entrar(pessoa.email);
      for (const isTestPedido of [true, false]) {
        await agente.put(`/platform/establishments/${est.tenantId}/test-flag`).send({ expectedUpdatedAt: v, isTest: isTestPedido }).expect(403);
      }
    }
    expect(await isTest(est.tenantId)).toBe(false);
    expect((await ficha(est.tenantId)).updatedAt).toBe(v);
    expect(await auditorias(est.tenantId)).toEqual([]);
  });

  it('página pública de teste continua no ar com indexable false, sem expor a marca; o vizinho segue indexável', async () => {
    const teste = await estabelecimento('publico-teste');
    const real = await estabelecimento('publico-real');
    await master
      .put(`/platform/establishments/${teste.tenantId}/test-flag`)
      .send({ expectedUpdatedAt: (await ficha(teste.tenantId)).updatedAt, isTest: true })
      .expect(200);

    const r = await publico(teste.slug).expect(200);
    expect(r.body.profile.indexable).toBe(false);
    expect(r.body.profile.establishment).toEqual({ name: 'Estabelecimento publico-teste', slug: teste.slug, timezone: TZ });
    expect(JSON.stringify(r.body)).not.toMatch(/is_?test/i);
    // O slug em maiúsculas chega ao mesmo estabelecimento (citext), com a mesma marca.
    expect((await publico(teste.slug.toUpperCase()).expect(200)).body.profile.indexable).toBe(false);
    expect((await publico(real.slug).expect(200)).body.profile.indexable).toBe(true);

    // Página desligada continua sendo o mesmo 404 genérico, marcada ou não.
    await q('UPDATE public_booking_settings SET enabled = false WHERE tenant_id = $1', [teste.tenantId]);
    await publico(teste.slug).expect(404);
  });

  it('cadastro com nome que gera slug reservado recebe sufixo; o antigo com slug reservado continua no ar e aparece na conferência', async () => {
    for (const businessName of ['Portal', 'Login', 'Dom Navalha']) {
      const criado = await master
        .post('/platform/establishments')
        .send({
          requestKey: `chave-${id()}`,
          businessName,
          category: 'OTHER',
          planId: plano,
          owner: { name: 'Dono convidado', email: `${marca}-res-${id()}@example.test` },
        })
        .expect(200);
      const [{ slug }] = await q<{ slug: string }>('SELECT slug::text AS slug FROM tenants WHERE id = $1', [criado.body.tenant.id]);
      const base = businessName.toLowerCase().replace(' ', '-');
      expect(slug).not.toBe(base);
      expect(slug).toMatch(new RegExp(`^${base}-\\d+$`));
    }

    // Cadastro antigo com slug reservado (gravado antes da lista): não é
    // renomeado, a página pública responde e a conferência o lista.
    const antigo = await estabelecimento('antigo', 'conta');
    try {
      expect((await publico('conta').expect(200)).body.profile.establishment.slug).toBe('conta');
      const v = (await ficha(antigo.tenantId)).updatedAt;
      // Editar outros dados do cadastro antigo funciona e mantém o slug.
      await master.patch(`/platform/establishments/${antigo.tenantId}`).send({ expectedUpdatedAt: v, name: 'Outro nome' }).expect(200);
      const [{ slug }] = await q<{ slug: string }>('SELECT slug::text AS slug FROM tenants WHERE id = $1', [antigo.tenantId]);
      expect(slug).toBe('conta');

      const relatorio = await comCliente(lerColisoesDeSlug);
      expect(relatorio.colisoes).toContainEqual({ slug: 'conta', status: 'ACTIVE' });
      expect(relatorio.colisoes.map((c) => c.slug)).not.toContain('portal-2');
    } finally {
      await q('DELETE FROM audit_logs WHERE tenant_id = $1', [antigo.tenantId]);
      await q('DELETE FROM public_booking_settings WHERE tenant_id = $1', [antigo.tenantId]);
      await q('DELETE FROM memberships WHERE tenant_id = $1', [antigo.tenantId]);
      await q('DELETE FROM units WHERE tenant_id = $1', [antigo.tenantId]);
      await q('DELETE FROM tenants WHERE id = $1', [antigo.tenantId]);
    }
  });

  it('slug escolhido no cadastro é recusado (400) e nada é gravado; sem ele, o mesmo pedido gera o slug', async () => {
    const businessName = `Escolhido ${marca}`;
    const corpo = (extra: Record<string, unknown>) => ({
      requestKey: `chave-${id()}`,
      businessName,
      category: 'OTHER',
      planId: plano,
      owner: { name: 'Dono convidado', email: `${marca}-esc-${id()}@example.test` },
      ...extra,
    });
    const contar = async () =>
      Number((await q<{ n: string }>('SELECT count(*) AS n FROM units WHERE name = $1', [businessName]))[0].n);

    for (const slug of ['portal', 'escolhido-livre']) {
      await master.post('/platform/establishments').send(corpo({ slug })).expect(400);
    }
    expect(await contar()).toBe(0);

    const criado = await master.post('/platform/establishments').send(corpo({})).expect(200);
    const [{ slug }] = await q<{ slug: string }>('SELECT slug::text AS slug FROM tenants WHERE id = $1', [criado.body.tenant.id]);
    expect(slug).toBe(`escolhido-${marca}`.toLowerCase());
    expect(await contar()).toBe(1);
  });

  it('cadastros simultâneos com o mesmo nome reservado: slugs diferentes, nenhum reservado', async () => {
    const respostas = await Promise.all(
      [1, 2, 3].map(() =>
        master.post('/platform/establishments').send({
          requestKey: `chave-${id()}`,
          businessName: 'Administração',
          category: 'OTHER',
          planId: plano,
          owner: { name: 'Dono convidado', email: `${marca}-sim-${id()}@example.test` },
        }),
      ),
    );
    expect(respostas.map((r) => r.status)).toEqual([200, 200, 200]);
    const ids = respostas.map((r) => r.body.tenant.id as string);
    const linhas = await q<{ slug: string }>('SELECT slug::text AS slug FROM tenants WHERE id = ANY($1::varchar[])', [ids]);
    const slugs = linhas.map((l) => l.slug);
    expect(new Set(slugs).size).toBe(3);
    for (const slug of slugs) expect(slug).toMatch(/^administracao-\d+$/);
  });

  it('a conferência do piloto reconhece o estado "depois" e recusa o "antes"', async () => {
    const estado = await comCliente(lerEstadoTenantTeste);
    // Outras suítes criam planos de teste com todos os recursos no banco
    // compartilhado; o baseline das comissões conta só o catálogo.
    // Migrations criadas depois deste kit: o kit as recusa de propósito (só
    // serve no commit dele); o teste as conhece por nome e as tira daqui.
    const POSTERIORES_AO_KIT = ['AdminSecondFactor1793750400000'];
    const soCatalogo = {
      ...estado,
      migrationNames: estado.migrationNames.slice(0, MIGRATIONS_ATE_TENANT_TESTE.length),
      regraGeral: {
        ...estado.regraGeral,
        comissoes: {
          ...estado.regraGeral.comissoes,
          planosComComissoes: estado.regraGeral.comissoes.planosComComissoes.filter((p) =>
            ['plan_essencial', 'plan_equipe', 'plan_pro'].includes(p),
          ),
        },
      },
    };
    expect(estado.migrationNames).toEqual([...MIGRATIONS_ATE_TENANT_TESTE, ...POSTERIORES_AO_KIT]);
    expect(falhasDepoisDoTenantTeste(soCatalogo)).toEqual([]);
    expect(falhasAntesDoTenantTeste(soCatalogo)).toEqual(['migration_history', 'is_test_column_already_exists']);
    expect(estado.marcadosComoTeste).toBeGreaterThanOrEqual(0);
  });
});
