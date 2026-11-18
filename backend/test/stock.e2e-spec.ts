// E2E HTTP do estoque dentro do AppModule real (rota registrada, DI, guard,
// pipe e mapeamento de erro para status), com `DataSource`, os serviços do
// estoque e o `SessionGuard` substituídos. As regras, contra PostgreSQL real:
// test/stock-postgres.db-e2e-spec.ts.
import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, ForbiddenException, INestApplication, NotFoundException } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { DataSource } from 'typeorm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { SessionGuard } from '../src/auth/session.guard.js';
import { StockCategoriesService } from '../src/stock/stock-categories.service.js';
import { StockCountsService } from '../src/stock/stock-counts.service.js';
import { StockMovementsService } from '../src/stock/stock-movements.service.js';
import { StockProductsService } from '../src/stock/stock-products.service.js';

const FAKE_DATA_SOURCE = { isInitialized: false, destroy: async () => {} } as unknown as DataSource;
const CHAVE = 'chave_de_teste_0001';

describe('rotas do estoque (e2e)', () => {
  let app: INestApplication<App>;
  const categorias = { list: vi.fn(), create: vi.fn(), rename: vi.fn(), archive: vi.fn(), reactivate: vi.fn(), createSubcategory: vi.fn(), renameSubcategory: vi.fn(), archiveSubcategory: vi.fn(), reactivateSubcategory: vi.fn() };
  const produtos = { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), archive: vi.fn(), reactivate: vi.fn() };
  const movimentos = { list: vi.fn(), create: vi.fn(), reverse: vi.fn() };
  const conferencias = { list: vi.fn(), get: vi.fn(), create: vi.fn() };

  beforeEach(async () => {
    for (const grupo of [categorias, produtos, movimentos, conferencias]) {
      for (const fn of Object.values(grupo)) fn.mockReset().mockResolvedValue({ ok: true });
    }
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(FAKE_DATA_SOURCE)
      .overrideProvider(StockCategoriesService)
      .useValue(categorias)
      .overrideProvider(StockProductsService)
      .useValue(produtos)
      .overrideProvider(StockMovementsService)
      .useValue(movimentos)
      .overrideProvider(StockCountsService)
      .useValue(conferencias)
      .overrideGuard(SessionGuard)
      .useValue({
        canActivate: (context: { switchToHttp: () => { getRequest: () => Record<string, unknown> } }) => {
          context.switchToHttp().getRequest().auth = { userId: 'user_1', sessionId: 'session_1' };
          return true;
        },
      })
      .compile();
    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const servidor = () => request(app.getHttpServer());

  it('GET produtos repassa usuário, estabelecimento e filtros, sem cache', async () => {
    const r = await servidor().get('/tenants/tenant_a/stock/products?q=pomada&categoryId=cat_1&low=true').expect(200);
    expect(r.headers['cache-control']).toBe('private, no-store');
    expect(produtos.list).toHaveBeenCalledWith('user_1', 'tenant_a', { q: 'pomada', categoryId: 'cat_1', low: true, status: 'ACTIVE' });
  });

  it('POST movimentação válida responde 200 com o corpo normalizado', async () => {
    const corpo = { requestKey: CHAVE, productId: 'p1', kind: 'ENTRADA_COMPRA', quantityMilli: 3000, expectedUnit: 'UN' };
    await servidor().post('/tenants/tenant_a/stock/movements').send(corpo).expect(200);
    expect(movimentos.create).toHaveBeenCalledWith('user_1', 'tenant_a', { ...corpo, reason: null });
  });

  it.each([
    ['saldo no corpo da edição', 'patch', '/tenants/t/stock/products/p1', { name: 'X', categoryId: 'c', purpose: 'VENDA', unit: 'UN', minQuantityMilli: 0, expectedUpdatedAt: '2026-11-18T10:00:00.000Z', balanceMilli: 5000 }],
    ['quantidade com vírgula', 'post', '/tenants/t/stock/movements', { requestKey: CHAVE, productId: 'p1', kind: 'ENTRADA_COMPRA', quantityMilli: 1.5, expectedUnit: 'UN' }],
    ['quantidade negativa', 'post', '/tenants/t/stock/movements', { requestKey: CHAVE, productId: 'p1', kind: 'SAIDA_VENDA', quantityMilli: -1000, expectedUnit: 'UN' }],
    ['casas que a unidade não aceita', 'post', '/tenants/t/stock/movements', { requestKey: CHAVE, productId: 'p1', kind: 'ENTRADA_COMPRA', quantityMilli: 1500, expectedUnit: 'UN' }],
    ['ajuste direto', 'post', '/tenants/t/stock/movements', { requestKey: CHAVE, productId: 'p1', kind: 'AJUSTE_CONFERENCIA', quantityMilli: 1000, expectedUnit: 'UN', reason: 'Ajuste' }],
    ['perda sem motivo', 'post', '/tenants/t/stock/movements', { requestKey: CHAVE, productId: 'p1', kind: 'SAIDA_PERDA', quantityMilli: 1000, expectedUnit: 'UN' }],
    ['estorno sem motivo', 'post', '/tenants/t/stock/movements/m1/reversal', { requestKey: CHAVE }],
    ['conferência vazia', 'post', '/tenants/t/stock/counts', { requestKey: CHAVE, items: [] }],
    ['estabelecimento no corpo', 'post', '/tenants/t/stock/categories', { name: 'Cabelo', tenantId: 'outro' }],
  ] as const)('400 sem chamar o serviço: %s', async (_nome, metodo, caminho, corpo) => {
    const r = await servidor()[metodo](caminho).send(corpo).expect(400);
    expect(r.body.message).toMatch(/Dados inválidos/);
    for (const grupo of [categorias, produtos, movimentos, conferencias]) {
      for (const fn of Object.values(grupo)) expect(fn).not.toHaveBeenCalled();
    }
  });

  it('id com caractere inválido no caminho: 400', async () => {
    await servidor().get('/tenants/t/stock/products/..%2F..').expect(400);
    expect(produtos.get).not.toHaveBeenCalled();
  });

  it('erros do serviço viram status e `code` no corpo', async () => {
    produtos.get.mockRejectedValueOnce(new NotFoundException('Estabelecimento não encontrado.'));
    await servidor().get('/tenants/outro/stock/products/p1').expect(404);

    produtos.list.mockRejectedValueOnce(new ForbiddenException({ code: 'RECURSO_NAO_CONTRATADO', message: 'Este recurso não faz parte do plano do estabelecimento.' }));
    const sem = await servidor().get('/tenants/t/stock/products').expect(403);
    expect(sem.body.code).toBe('RECURSO_NAO_CONTRATADO');

    movimentos.create.mockRejectedValueOnce(new ConflictException({ code: 'SALDO_INSUFICIENTE', message: 'Saldo insuficiente.' }));
    const saldo = await servidor()
      .post('/tenants/t/stock/movements')
      .send({ requestKey: CHAVE, productId: 'p1', kind: 'SAIDA_VENDA', quantityMilli: 1000, expectedUnit: 'UN' })
      .expect(409);
    expect(saldo.body.code).toBe('SALDO_INSUFICIENTE');

    conferencias.create.mockRejectedValueOnce(
      new ConflictException({ code: 'CONFERENCIA_DESATUALIZADA', message: 'Mudou.', items: [{ productId: 'p1', balanceMilli: 0, balanceVersion: 3, unit: 'CX', archived: false }] }),
    );
    const desatualizada = await servidor()
      .post('/tenants/t/stock/counts')
      .send({ requestKey: CHAVE, items: [{ productId: 'p1', expectedBalanceVersion: 2, expectedUnit: 'UN', countedMilli: 0 }] })
      .expect(409);
    expect(desatualizada.body).toMatchObject({ code: 'CONFERENCIA_DESATUALIZADA', items: [{ productId: 'p1', unit: 'CX' }] });
  });

  it('as rotas de categoria, subcategoria, produto e conferência chegam ao serviço certo', async () => {
    await servidor().post('/tenants/t/stock/categories').send({ name: 'Cabelo' }).expect(200);
    await servidor().patch('/tenants/t/stock/categories/c1').send({ name: 'Barba' }).expect(200);
    await servidor().post('/tenants/t/stock/categories/c1/archive').expect(200);
    await servidor().post('/tenants/t/stock/categories/c1/subcategories').send({ name: 'Pomadas' }).expect(200);
    await servidor().post('/tenants/t/stock/subcategories/s1/reactivate').expect(200);
    await servidor().post('/tenants/t/stock/products/p1/archive').expect(200);
    await servidor().get('/tenants/t/stock/counts/k1').expect(200);
    await servidor().post('/tenants/t/stock/movements/m1/reversal').send({ requestKey: CHAVE, reason: 'Lançado errado' }).expect(200);
    expect(categorias.create).toHaveBeenCalledWith('user_1', 't', { name: 'Cabelo' });
    expect(categorias.rename).toHaveBeenCalledWith('user_1', 't', 'c1', { name: 'Barba' });
    expect(categorias.archive).toHaveBeenCalledWith('user_1', 't', 'c1');
    expect(categorias.createSubcategory).toHaveBeenCalledWith('user_1', 't', 'c1', { name: 'Pomadas' });
    expect(categorias.reactivateSubcategory).toHaveBeenCalledWith('user_1', 't', 's1');
    expect(produtos.archive).toHaveBeenCalledWith('user_1', 't', 'p1');
    expect(conferencias.get).toHaveBeenCalledWith('user_1', 't', 'k1');
    expect(movimentos.reverse).toHaveBeenCalledWith('user_1', 't', 'm1', { requestKey: CHAVE, reason: 'Lançado errado' });
  });
});
