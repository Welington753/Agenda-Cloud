import { Test } from '@nestjs/testing';
import { ForbiddenException, type INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { SessionGuard } from '../src/auth/session.guard.js';
import { PlatformSecondFactorGuard } from '../src/second-factor/second-factor.guard.js';
import { PlatformService } from '../src/platform/platform.service.js';
import { EstablishmentAdminService } from '../src/platform/establishment-admin.service.js';
import { UnauthorizedException } from '@nestjs/common';

describe('administração da plataforma — HTTP', () => {
  let app: INestApplication;
  const guard = { canActivate: vi.fn() };
  const service = { access: vi.fn(), list: vi.fn(), detail: vi.fn(), report: vi.fn() };
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
    service.report.mockResolvedValue({ scope: 'CLIENTS' });
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue({ isInitialized: false })
      .overrideProvider(PlatformService)
      .useValue(service)
      .overrideGuard(SessionGuard)
      .useValue(guard)
      // O guard do segundo fator lê o banco; aqui só o controller é testado.
      // A aplicação dele em toda rota /platform: test/second-factor.e2e-spec.ts.
      .overrideGuard(PlatformSecondFactorGuard)
      .useValue({ canActivate: () => true })
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
      scope: 'CLIENTS',
    });
    await request(app.getHttpServer())
      .get('/platform/establishments?scope=INTERNAL')
      .expect(200);
    expect(service.list).toHaveBeenLastCalledWith('proven_user', { page: 1, pageSize: 20, scope: 'INTERNAL' });
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
      'scope=TESTE',
      'scope=CLIENTS&scope=ALL',
    ]) {
      await request(app.getHttpServer())
        .get(`/platform/establishments?${query}`)
        .expect(400);
    }
    expect(service.list).not.toHaveBeenCalled();
  });
  it('relatório por período: sem datas o serviço decide o mês; período e alcance chegam como pedidos', async () => {
    await request(app.getHttpServer())
      .get('/platform/reports')
      .expect(200)
      .expect('Cache-Control', 'private, no-store');
    expect(service.report).toHaveBeenLastCalledWith('proven_user', { scope: 'CLIENTS' });
    await request(app.getHttpServer()).get('/platform/reports?from=2026-10-01&to=2026-10-31&scope=INTERNAL').expect(200);
    expect(service.report).toHaveBeenLastCalledWith('proven_user', { from: '2026-10-01', to: '2026-10-31', scope: 'INTERNAL' });
    await request(app.getHttpServer()).get('/platform/establishments?createdFrom=2026-10-01&createdTo=2026-10-31').expect(200);
    expect(service.list).toHaveBeenLastCalledWith('proven_user', {
      createdFrom: '2026-10-01',
      createdTo: '2026-10-31',
      page: 1,
      pageSize: 20,
      scope: 'CLIENTS',
    });
  });
  it('relatório e lista recusam período inválido antes de ler dados', async () => {
    for (const query of [
      'from=2026-10-01',
      'from=2026-10-02&to=2026-10-01',
      'from=2026-02-29&to=2026-03-01',
      'from=2026-01-01&to=2027-01-02',
      'from=2026-10-01&to=2026-10-31&from=2026-11-01',
      'month=2026-10',
      'scope=TESTE',
      'userId=master',
    ]) {
      await request(app.getHttpServer()).get(`/platform/reports?${query}`).expect(400);
    }
    for (const query of ['createdFrom=2026-10-01', 'createdFrom=2026-10-31&createdTo=2026-10-01', 'createdFrom=ontem&createdTo=hoje']) {
      await request(app.getHttpServer()).get(`/platform/establishments?${query}`).expect(400);
    }
    expect(service.report).not.toHaveBeenCalled();
    expect(service.list).not.toHaveBeenCalled();
  });
  it('relatório: sem sessão 401; 403 do serviço passa adiante, nunca vira zero', async () => {
    service.report.mockRejectedValue(new ForbiddenException());
    await request(app.getHttpServer()).get('/platform/reports').expect(403);
    guard.canActivate.mockImplementation(() => {
      throw new UnauthorizedException();
    });
    service.report.mockClear();
    await request(app.getHttpServer()).get('/platform/reports').expect(401);
    expect(service.report).not.toHaveBeenCalled();
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

describe('marca de estabelecimento de teste — HTTP', () => {
  let app: INestApplication;
  const guard = { canActivate: vi.fn() };
  const admin = { setTestFlag: vi.fn() };
  const VERSAO = '2026-11-10T12:00:00.000Z';
  beforeEach(async () => {
    vi.resetAllMocks();
    guard.canActivate.mockImplementation((context) => {
      context.switchToHttp().getRequest().auth = { userId: 'proven_user', sessionId: 'session' };
      return true;
    });
    admin.setTestFlag.mockResolvedValue({ updatedAt: VERSAO, isTest: true });
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue({ isInitialized: false })
      .overrideProvider(EstablishmentAdminService)
      .useValue(admin)
      .overrideGuard(SessionGuard)
      .useValue(guard)
      // O guard do segundo fator lê o banco; aqui só o controller é testado.
      // A aplicação dele em toda rota /platform: test/second-factor.e2e-spec.ts.
      .overrideGuard(PlatformSecondFactorGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });
  afterEach(async () => {
    await app.close();
  });

  it('PUT com versão e booleano chega ao serviço com a identidade do guard, sem cache', async () => {
    await request(app.getHttpServer())
      .put('/platform/establishments/tenant_a/test-flag')
      .send({ expectedUpdatedAt: VERSAO, isTest: true })
      .expect(200)
      .expect('Cache-Control', 'private, no-store');
    expect(admin.setTestFlag).toHaveBeenCalledWith('proven_user', 'tenant_a', { expectedUpdatedAt: VERSAO, isTest: true });
  });

  it('corpo forjado ou incompleto nunca chega ao serviço', async () => {
    for (const corpo of [
      { isTest: true },
      { expectedUpdatedAt: VERSAO },
      { expectedUpdatedAt: VERSAO, isTest: 'true' },
      { expectedUpdatedAt: VERSAO, isTest: 1 },
      { expectedUpdatedAt: VERSAO, isTest: true, slug: 'portal' },
      { expectedUpdatedAt: VERSAO, isTest: true, tenantId: 'tenant_b' },
      { expectedUpdatedAt: VERSAO, isTest: true, userId: 'master' },
    ]) {
      await request(app.getHttpServer()).put('/platform/establishments/tenant_a/test-flag').send(corpo).expect(400);
    }
    expect(admin.setTestFlag).not.toHaveBeenCalled();
  });

  it('a edição de dados cadastrais não aceita a marca', async () => {
    await request(app.getHttpServer())
      .patch('/platform/establishments/tenant_a')
      .send({ expectedUpdatedAt: VERSAO, name: 'Outro nome', isTest: true })
      .expect(400);
  });

  it('sem sessão: 401; sem a capacidade (dono, equipe): o 403 do serviço passa adiante', async () => {
    guard.canActivate.mockImplementationOnce(() => {
      throw new UnauthorizedException();
    });
    await request(app.getHttpServer())
      .put('/platform/establishments/tenant_a/test-flag')
      .send({ expectedUpdatedAt: VERSAO, isTest: true })
      .expect(401);
    expect(admin.setTestFlag).not.toHaveBeenCalled();
    admin.setTestFlag.mockRejectedValue(new ForbiddenException());
    await request(app.getHttpServer())
      .put('/platform/establishments/tenant_a/test-flag')
      .send({ expectedUpdatedAt: VERSAO, isTest: true })
      .expect(403);
  });
});
