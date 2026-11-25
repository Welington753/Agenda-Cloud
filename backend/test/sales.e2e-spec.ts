// E2E HTTP das vendas dentro do AppModule real (rota registrada, DI, guard,
// pipe e mapeamento de erro para status), com `DataSource`, os serviços de
// vendas e o `SessionGuard` substituídos. As regras, contra PostgreSQL real:
// test/sales-postgres.db-e2e-spec.ts e test/sales-access-postgres.db-e2e-spec.ts.
import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, ForbiddenException, INestApplication, NotFoundException } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { DataSource } from 'typeorm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { SessionGuard } from '../src/auth/session.guard.js';
import { SalesService } from '../src/sales/sales.service.js';
import { SalePaymentsService } from '../src/sales/sale-payments.service.js';

const FAKE_DATA_SOURCE = { isInitialized: false, destroy: async () => {} } as unknown as DataSource;
const CHAVE = 'chave_de_teste_0001';
const ITEM = { productId: 'p1', quantityMilli: 2000, expectedUnit: 'UN', expectedSuggestedPriceCents: 1500, unitPriceCents: 1500 };

describe('rotas de vendas (e2e)', () => {
  let app: INestApplication<App>;
  const vendas = { catalog: vi.fn(), searchConsumers: vi.fn(), create: vi.fn(), list: vi.fn(), get: vi.fn(), cancel: vi.fn(), purchases: vi.fn() };
  const recebimentos = { record: vi.fn(), refund: vi.fn(), list: vi.fn() };

  beforeEach(async () => {
    for (const grupo of [vendas, recebimentos]) for (const fn of Object.values(grupo)) fn.mockReset().mockResolvedValue({ ok: true });
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(FAKE_DATA_SOURCE)
      .overrideProvider(SalesService)
      .useValue(vendas)
      .overrideProvider(SalePaymentsService)
      .useValue(recebimentos)
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

  it('catálogo e busca de clientes: rotas fixas antes de :saleId, sem cache', async () => {
    const r = await servidor().get('/tenants/t1/sales/catalog?q=pomada').expect(200);
    expect(r.headers['cache-control']).toBe('private, no-store');
    expect(vendas.catalog).toHaveBeenCalledWith('user_1', 't1', { q: 'pomada' });
    await servidor().get('/tenants/t1/sales/consumers?q=Ana').expect(200);
    expect(vendas.searchConsumers).toHaveBeenCalledWith('user_1', 't1', 'Ana');
    await servidor().get('/tenants/t1/sales/payments?scope=all&from=2026-11-01&to=2026-11-30').expect(200);
    expect(recebimentos.list).toHaveBeenCalledWith('user_1', 't1', { scope: 'all', from: '2026-11-01', to: '2026-11-30' });
    expect(vendas.get).not.toHaveBeenCalled();
  });

  it('busca de clientes com 1 caractere: 400 sem chamar o serviço', async () => {
    await servidor().get('/tenants/t1/sales/consumers?q=A').expect(400);
    expect(vendas.searchConsumers).not.toHaveBeenCalled();
  });

  it('POST venda: 200 com o corpo validado; consulta própria por padrão', async () => {
    const corpo = { requestKey: CHAVE, consumerId: null, items: [ITEM] };
    await servidor().post('/tenants/t1/sales').send(corpo).expect(200);
    expect(vendas.create).toHaveBeenCalledWith('user_1', 't1', corpo);
    await servidor().get('/tenants/t1/sales').expect(200);
    expect(vendas.list).toHaveBeenCalledWith('user_1', 't1', { scope: 'mine' });
  });

  it.each([
    ['total no corpo', { requestKey: CHAVE, consumerId: null, items: [ITEM], totalCents: 3000 }],
    ['linha no corpo', { requestKey: CHAVE, consumerId: null, items: [{ ...ITEM, lineTotalCents: 3000 }] }],
    ['produto repetido', { requestKey: CHAVE, consumerId: null, items: [ITEM, ITEM] }],
    ['quantidade com vírgula', { requestKey: CHAVE, consumerId: null, items: [{ ...ITEM, quantityMilli: 1.5 }] }],
    ['preço zero', { requestKey: CHAVE, consumerId: null, items: [{ ...ITEM, unitPriceCents: 0 }] }],
    ['cliente pelo texto', { requestKey: CHAVE, consumerName: 'Ana', items: [ITEM] }],
  ])('POST venda com %s: 400', async (_, corpo) => {
    await servidor().post('/tenants/t1/sales').send(corpo).expect(400);
    expect(vendas.create).not.toHaveBeenCalled();
  });

  it('cancelamento e estorno levam a sessão (senha confirmada há pouco)', async () => {
    await servidor().post('/tenants/t1/sales/s1/cancel').send({ reason: 'Cliente desistiu' }).expect(200);
    expect(vendas.cancel).toHaveBeenCalledWith('user_1', 'session_1', 't1', 's1', { reason: 'Cliente desistiu' });
    await servidor().post('/tenants/t1/sales/payments/pg1/refund').send({ reason: 'Pagamento duplicado' }).expect(200);
    expect(recebimentos.refund).toHaveBeenCalledWith('user_1', 'session_1', 't1', 'pg1', { reason: 'Pagamento duplicado' });
    await servidor().post('/tenants/t1/sales/s1/cancel').send({ reason: 'x' }).expect(400);
  });

  it('recebimento: sem valor no corpo; detalhe e compras na ficha', async () => {
    const corpo = { requestKey: CHAVE, method: 'PIX', receivedOn: '2026-11-25' };
    await servidor().post('/tenants/t1/sales/s1/payments').send(corpo).expect(200);
    expect(recebimentos.record).toHaveBeenCalledWith('user_1', 't1', 's1', { ...corpo, notes: null });
    await servidor().post('/tenants/t1/sales/s1/payments').send({ ...corpo, amountCents: 100 }).expect(400);
    await servidor().get('/tenants/t1/sales/s1').expect(200);
    expect(vendas.get).toHaveBeenCalledWith('user_1', 't1', 's1');
    await servidor().get('/tenants/t1/consumers/c1/purchases').expect(200);
    expect(vendas.purchases).toHaveBeenCalledWith('user_1', 't1', 'c1', {});
  });

  it('recusas do serviço viram 403, 404 e 409 com o código', async () => {
    vendas.create.mockRejectedValueOnce(new ForbiddenException({ code: 'PRECO_NAO_AUTORIZADO', message: 'x' }));
    const r1 = await servidor().post('/tenants/t1/sales').send({ requestKey: CHAVE, consumerId: null, items: [ITEM] }).expect(403);
    expect(r1.body.code).toBe('PRECO_NAO_AUTORIZADO');
    vendas.get.mockRejectedValueOnce(new NotFoundException('Venda não encontrada.'));
    await servidor().get('/tenants/t1/sales/s9').expect(404);
    vendas.cancel.mockRejectedValueOnce(new ConflictException({ code: 'RECEBIMENTO_ATIVO', message: 'x' }));
    const r2 = await servidor().post('/tenants/t1/sales/s1/cancel').send({ reason: 'Cliente desistiu' }).expect(409);
    expect(r2.body.code).toBe('RECEBIMENTO_ATIVO');
  });
});
