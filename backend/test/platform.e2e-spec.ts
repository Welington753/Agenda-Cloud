import { Test } from '@nestjs/testing';
import { ForbiddenException, type INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { SessionGuard } from '../src/auth/session.guard.js';
import { PlatformService } from '../src/platform/platform.service.js';
import { UnauthorizedException } from '@nestjs/common';

describe('administração da plataforma — HTTP', () => {
  let app: INestApplication;
  const guard = { canActivate: vi.fn() };
  const service = { access: vi.fn(), list: vi.fn(), detail: vi.fn() };
  beforeEach(async () => {
    vi.resetAllMocks();
    guard.canActivate.mockImplementation((context) => {
      context.switchToHttp().getRequest().auth = {
        userId: 'proven_user',
        sessionId: 'session',
      };
      return true;
    });
    service.access.mockResolvedValue({ canViewEstablishments: true });
    service.list.mockResolvedValue({ items: [], total: 0 });
    service.detail.mockResolvedValue({ id: 'tenant_a' });
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue({ isInitialized: false })
      .overrideProvider(PlatformService)
      .useValue(service)
      .overrideGuard(SessionGuard)
      .useValue(guard)
      .compile();
    app = module.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });
  afterEach(async () => {
    await app.close();
  });

  it('três leituras registradas, sem cache, identidade vinda do guard', async () => {
    await request(app.getHttpServer())
      .get('/platform/access')
      .expect(200)
      .expect('Cache-Control', 'private, no-store');
    await request(app.getHttpServer())
      .get('/platform/establishments?q=Estudio&page=2&pageSize=5')
      .expect(200);
    expect(service.list).toHaveBeenCalledWith('proven_user', {
      q: 'Estudio',
      page: 2,
      pageSize: 5,
    });
    await request(app.getHttpServer())
      .get('/platform/establishments/tenant_a')
      .expect(200);
    expect(service.detail).toHaveBeenCalledWith('proven_user', 'tenant_a');
  });
  it('sem sessão todas as rotas recusam antes de ler dados', async () => {
    guard.canActivate.mockImplementation(() => {
      throw new UnauthorizedException();
    });
    for (const path of [
      '/platform/access',
      '/platform/establishments',
      '/platform/establishments/tenant_a',
    ]) {
      await request(app.getHttpServer()).get(path).expect(401);
    }
    expect(service.access).not.toHaveBeenCalled();
    expect(service.list).not.toHaveBeenCalled();
    expect(service.detail).not.toHaveBeenCalled();
  });
  it('recusa paginação, filtros e identidade forjados', async () => {
    for (const query of [
      'page=0',
      'pageSize=500',
      'status=PAID',
      'q=a',
      'userId=master',
      'platformRole=MASTER_OWNER',
      'page=1&page=2',
    ]) {
      await request(app.getHttpServer())
        .get(`/platform/establishments?${query}`)
        .expect(400);
    }
    expect(service.list).not.toHaveBeenCalled();
  });
  it('403 do serviço não vira uma lista vazia nem vaza outro estabelecimento', async () => {
    service.list.mockRejectedValue(new ForbiddenException());
    service.detail.mockRejectedValue(new ForbiddenException());
    await request(app.getHttpServer())
      .get('/platform/establishments')
      .expect(403);
    await request(app.getHttpServer())
      .get('/platform/establishments/tenant_a')
      .expect(403);
  });
  it('a ficha só aceita os dados cadastrais: situação, endereço e papel pelo corpo são recusados', async () => {
    // Criar estabelecimento existe (gestão de contas), mas só com o formulário
    // completo: um corpo forjado nunca chega ao serviço.
    await request(app.getHttpServer())
      .post('/platform/establishments')
      .send({ platformRole: 'MASTER_OWNER' })
      .expect(400);
    await request(app.getHttpServer())
      .patch('/platform/establishments')
      .send({ status: 'ACTIVE' })
      .expect(404);
    // O PATCH da ficha existe, mas a situação muda só pelas ações próprias
    // (suspender, reativar, arquivar) e o endereço público nunca muda aqui.
    for (const corpo of [
      { expectedUpdatedAt: '2026-10-26T12:00:00.000Z', status: 'ACTIVE' },
      { expectedUpdatedAt: '2026-10-26T12:00:00.000Z', slug: 'outro-endereco' },
      { expectedUpdatedAt: '2026-10-26T12:00:00.000Z', planId: 'plan_pro' },
    ]) {
      await request(app.getHttpServer()).patch('/platform/establishments/tenant_a').send(corpo).expect(400);
    }
    await request(app.getHttpServer())
      .post('/platform/establishments/tenant_a')
      .send({ platformRole: 'MASTER_OWNER' })
      .expect(404);
    await request(app.getHttpServer())
      .post('/platform/access')
      .send({ platformRole: 'MASTER_OWNER' })
      .expect(404);
    await request(app.getHttpServer())
      .patch('/platform/access')
      .send({ status: 'ACTIVE' })
      .expect(404);
  });
});
