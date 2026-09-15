// E2E HTTP das rotas de serviços dentro do AppModule real (prova que
// ServicesModule está registrado e a DI resolve de ponta a ponta) — mesmo
// padrão de auth-session.e2e-spec.ts: `DataSource` é substituído ANTES de
// `.compile()` (nunca abre socket nenhum), e `ServicesService`/`SessionGuard`
// são substituídos porque a lógica deles já é coberta em
// `src/services/services.service.spec.ts` e contra Postgres real em
// `services-postgres.db-e2e-spec.ts`. Aqui se testa só a camada HTTP: rota,
// guard, pipe de validação e mapeamento de erro de domínio para status.
import { Test, TestingModule } from '@nestjs/testing';
import {
  ForbiddenException,
  INestApplication,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { SessionGuard } from '../src/auth/session.guard.js';
import { ServicesService } from '../src/services/services.service.js';

const FAKE_DATA_SOURCE = {
  isInitialized: false,
  destroy: async () => {},
} as unknown as DataSource;

const FAKE_IDENTITY_CONTEXT = { userId: 'user_1', sessionId: 'session_1' };

const FAKE_SERVICE = {
  id: 'service_1',
  name: 'Corte',
  shortDescription: 'Corte simples',
  priceCents: 8500,
  priceVisible: true,
  durationMinutes: 45,
  bufferAfterMinutes: 10,
  modality: 'IN_PERSON',
  activeInPublicBooking: true,
  requiresManualConfirmation: false,
  active: true,
  createdAt: new Date('2026-09-01T12:00:00.000Z'),
};

const CORPO_VALIDO = { name: 'Corte', durationMinutes: 45 };

describe('rotas de serviços (e2e)', () => {
  let app: INestApplication<App>;
  let listMock: ReturnType<typeof vi.fn>;
  let createMock: ReturnType<typeof vi.fn>;
  let updateMock: ReturnType<typeof vi.fn>;
  let deactivateMock: ReturnType<typeof vi.fn>;
  let reactivateMock: ReturnType<typeof vi.fn>;
  let guardMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    listMock = vi.fn().mockResolvedValue([FAKE_SERVICE]);
    createMock = vi.fn().mockResolvedValue(FAKE_SERVICE);
    updateMock = vi.fn().mockResolvedValue(FAKE_SERVICE);
    deactivateMock = vi.fn().mockResolvedValue({ ...FAKE_SERVICE, active: false });
    reactivateMock = vi.fn().mockResolvedValue({ ...FAKE_SERVICE, active: true });
    guardMock = vi.fn().mockImplementation((context) => {
      const req = context.switchToHttp().getRequest();
      req.auth = FAKE_IDENTITY_CONTEXT;
      return true;
    });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DataSource)
      .useValue(FAKE_DATA_SOURCE)
      .overrideProvider(ServicesService)
      .useValue({
        list: listMock,
        create: createMock,
        update: updateMock,
        deactivate: deactivateMock,
        reactivate: reactivateMock,
      })
      .overrideGuard(SessionGuard)
      .useValue({ canActivate: guardMock })
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET lista os serviços do tenant pedido e repassa o userId provado pelo guard', async () => {
    const resposta = await request(app.getHttpServer()).get('/tenants/tenant_a/services').expect(200);

    expect(resposta.body.services).toHaveLength(1);
    expect(listMock).toHaveBeenCalledWith('user_1', 'tenant_a');
  });

  it('POST cria e devolve 201', async () => {
    const resposta = await request(app.getHttpServer())
      .post('/tenants/tenant_a/services')
      .send(CORPO_VALIDO)
      .expect(201);

    expect(resposta.body.service.id).toBe('service_1');
    expect(createMock).toHaveBeenCalledWith(
      'user_1',
      'tenant_a',
      expect.objectContaining({ name: 'Corte', durationMinutes: 45 }),
    );
  });

  it('PATCH edita, POST /deactivate desativa e POST /reactivate reativa', async () => {
    await request(app.getHttpServer())
      .patch('/tenants/tenant_a/services/service_1')
      .send({ name: 'Corte masculino' })
      .expect(200);
    expect(updateMock).toHaveBeenCalledWith('user_1', 'tenant_a', 'service_1', {
      name: 'Corte masculino',
    });

    const resposta = await request(app.getHttpServer())
      .post('/tenants/tenant_a/services/service_1/deactivate')
      .expect(200);
    expect(resposta.body.service.active).toBe(false);
    expect(deactivateMock).toHaveBeenCalledWith('user_1', 'tenant_a', 'service_1');

    const respostaReativacao = await request(app.getHttpServer())
      .post('/tenants/tenant_a/services/service_1/reactivate')
      .expect(200);
    expect(respostaReativacao.body.service.active).toBe(true);
    expect(reactivateMock).toHaveBeenCalledWith('user_1', 'tenant_a', 'service_1');
  });

  it('nenhuma rota de serviço existe sem sessão — o guard recusa antes do serviço', async () => {
    guardMock.mockImplementation(() => {
      throw new UnauthorizedException('Não autenticado.');
    });

    await request(app.getHttpServer()).get('/tenants/tenant_a/services').expect(401);
    await request(app.getHttpServer())
      .post('/tenants/tenant_a/services')
      .send(CORPO_VALIDO)
      .expect(401);
    await request(app.getHttpServer())
      .patch('/tenants/tenant_a/services/service_1')
      .send({ name: 'x' })
      .expect(401);
    await request(app.getHttpServer())
      .post('/tenants/tenant_a/services/service_1/deactivate')
      .expect(401);
    await request(app.getHttpServer())
      .post('/tenants/tenant_a/services/service_1/reactivate')
      .expect(401);

    expect(listMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(deactivateMock).not.toHaveBeenCalled();
    expect(reactivateMock).not.toHaveBeenCalled();
  });

  it('sem vínculo vira 404 e sem permissão vira 403, com a mensagem do domínio', async () => {
    listMock.mockRejectedValueOnce(new NotFoundException('Estabelecimento não encontrado.'));
    await request(app.getHttpServer()).get('/tenants/tenant_alheio/services').expect(404);

    createMock.mockRejectedValueOnce(new ForbiddenException('Sem permissão.'));
    await request(app.getHttpServer())
      .post('/tenants/tenant_a/services')
      .send(CORPO_VALIDO)
      .expect(403);

    reactivateMock.mockRejectedValueOnce(new NotFoundException('Serviço não encontrado.'));
    await request(app.getHttpServer())
      .post('/tenants/tenant_a/services/service_de_outro/reactivate')
      .expect(404);
  });

  it('corpo inválido é 400 antes de chegar no serviço', async () => {
    await request(app.getHttpServer())
      .post('/tenants/tenant_a/services')
      .send({ name: '', durationMinutes: 0 })
      .expect(400);

    await request(app.getHttpServer())
      .patch('/tenants/tenant_a/services/service_1')
      .send({})
      .expect(400);

    expect(createMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('tentar mandar tenantId/id/active no corpo é 400 — nunca aplicado', async () => {
    for (const campo of ['tenantId', 'id', 'active']) {
      await request(app.getHttpServer())
        .post('/tenants/tenant_a/services')
        .send({ ...CORPO_VALIDO, [campo]: 'forjado' })
        .expect(400);

      await request(app.getHttpServer())
        .patch('/tenants/tenant_a/services/service_1')
        .send({ name: 'Corte', [campo]: 'forjado' })
        .expect(400);
    }

    expect(createMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('a mensagem de erro de validação nunca ecoa o valor recebido', async () => {
    const resposta = await request(app.getHttpServer())
      .post('/tenants/tenant_a/services')
      .send({ ...CORPO_VALIDO, tenantId: 'tenant-secreto-forjado' })
      .expect(400);

    expect(JSON.stringify(resposta.body)).not.toContain('tenant-secreto-forjado');
  });

  it('não existe rota de exclusão física de serviço', async () => {
    await request(app.getHttpServer()).delete('/tenants/tenant_a/services/service_1').expect(404);
  });
});
