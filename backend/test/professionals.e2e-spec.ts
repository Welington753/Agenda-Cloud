// E2E HTTP das rotas de profissionais dentro do AppModule real (prova que
// ProfessionalsModule está registrado e a DI resolve de ponta a ponta) —
// mesmo padrão de services.e2e-spec.ts: `DataSource` é substituído ANTES de
// `.compile()`, e `ProfessionalsService`/`SessionGuard` são substituídos
// porque a lógica deles já é coberta em
// src/professionals/professionals.service.spec.ts e contra Postgres real em
// test/professionals-postgres.db-e2e-spec.ts. Aqui se testa só a camada
// HTTP: rota, guard, pipe de validação e mapeamento de erro de domínio para
// status.
import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
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
import { ProfessionalsService } from '../src/professionals/professionals.service.js';

const FAKE_DATA_SOURCE = {
  isInitialized: false,
  destroy: async () => {},
} as unknown as DataSource;

const FAKE_IDENTITY_CONTEXT = { userId: 'user_1', sessionId: 'session_1' };

const FAKE_PROFESSIONAL = {
  id: 'professional_1',
  name: 'João Silva',
  avatarInitials: 'JS',
  avatarColor: '#B5651D',
  active: true,
  createdAt: new Date('2026-09-01T12:00:00.000Z'),
  services: [],
};

const CORPO_VALIDO = { name: 'João Silva' };

describe('rotas de profissionais (e2e)', () => {
  let app: INestApplication<App>;
  let listMock: ReturnType<typeof vi.fn>;
  let createMock: ReturnType<typeof vi.fn>;
  let updateMock: ReturnType<typeof vi.fn>;
  let deactivateMock: ReturnType<typeof vi.fn>;
  let reactivateMock: ReturnType<typeof vi.fn>;
  let setServicesMock: ReturnType<typeof vi.fn>;
  let guardMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    listMock = vi.fn().mockResolvedValue([FAKE_PROFESSIONAL]);
    createMock = vi.fn().mockResolvedValue(FAKE_PROFESSIONAL);
    updateMock = vi.fn().mockResolvedValue(FAKE_PROFESSIONAL);
    deactivateMock = vi.fn().mockResolvedValue({ ...FAKE_PROFESSIONAL, active: false });
    reactivateMock = vi.fn().mockResolvedValue({ ...FAKE_PROFESSIONAL, active: true });
    setServicesMock = vi.fn().mockResolvedValue({
      ...FAKE_PROFESSIONAL,
      services: [{ id: 'link_1', serviceId: 'service_1', serviceName: 'Corte', serviceActive: true }],
    });
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
      .overrideProvider(ProfessionalsService)
      .useValue({
        list: listMock,
        create: createMock,
        update: updateMock,
        deactivate: deactivateMock,
        reactivate: reactivateMock,
        setServices: setServicesMock,
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

  it('GET lista os profissionais do tenant pedido e repassa o userId provado pelo guard', async () => {
    const resposta = await request(app.getHttpServer())
      .get('/tenants/tenant_a/professionals')
      .expect(200);

    expect(resposta.body.professionals).toHaveLength(1);
    expect(listMock).toHaveBeenCalledWith('user_1', 'tenant_a');
  });

  it('POST cria e devolve 201', async () => {
    const resposta = await request(app.getHttpServer())
      .post('/tenants/tenant_a/professionals')
      .send(CORPO_VALIDO)
      .expect(201);

    expect(resposta.body.professional.id).toBe('professional_1');
    expect(createMock).toHaveBeenCalledWith(
      'user_1',
      'tenant_a',
      expect.objectContaining({ name: 'João Silva' }),
    );
  });

  it('PATCH edita, POST /deactivate desativa e POST /reactivate reativa', async () => {
    await request(app.getHttpServer())
      .patch('/tenants/tenant_a/professionals/professional_1')
      .send({ name: 'João S. Silva' })
      .expect(200);
    expect(updateMock).toHaveBeenCalledWith('user_1', 'tenant_a', 'professional_1', {
      name: 'João S. Silva',
    });

    const resposta = await request(app.getHttpServer())
      .post('/tenants/tenant_a/professionals/professional_1/deactivate')
      .expect(200);
    expect(resposta.body.professional.active).toBe(false);
    expect(deactivateMock).toHaveBeenCalledWith('user_1', 'tenant_a', 'professional_1');

    const respostaReativacao = await request(app.getHttpServer())
      .post('/tenants/tenant_a/professionals/professional_1/reactivate')
      .expect(200);
    expect(respostaReativacao.body.professional.active).toBe(true);
    expect(reactivateMock).toHaveBeenCalledWith('user_1', 'tenant_a', 'professional_1');
  });

  it('PUT /services define o conjunto de vínculos', async () => {
    const resposta = await request(app.getHttpServer())
      .put('/tenants/tenant_a/professionals/professional_1/services')
      .send({ serviceIds: ['service_1'] })
      .expect(200);

    expect(resposta.body.professional.services).toHaveLength(1);
    expect(setServicesMock).toHaveBeenCalledWith('user_1', 'tenant_a', 'professional_1', {
      serviceIds: ['service_1'],
    });
  });

  it('nenhuma rota de profissional existe sem sessão — o guard recusa antes do serviço', async () => {
    guardMock.mockImplementation(() => {
      throw new UnauthorizedException('Não autenticado.');
    });

    await request(app.getHttpServer()).get('/tenants/tenant_a/professionals').expect(401);
    await request(app.getHttpServer())
      .post('/tenants/tenant_a/professionals')
      .send(CORPO_VALIDO)
      .expect(401);
    await request(app.getHttpServer())
      .patch('/tenants/tenant_a/professionals/professional_1')
      .send({ name: 'x' })
      .expect(401);
    await request(app.getHttpServer())
      .post('/tenants/tenant_a/professionals/professional_1/deactivate')
      .expect(401);
    await request(app.getHttpServer())
      .post('/tenants/tenant_a/professionals/professional_1/reactivate')
      .expect(401);
    await request(app.getHttpServer())
      .put('/tenants/tenant_a/professionals/professional_1/services')
      .send({ serviceIds: [] })
      .expect(401);

    expect(listMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(deactivateMock).not.toHaveBeenCalled();
    expect(reactivateMock).not.toHaveBeenCalled();
    expect(setServicesMock).not.toHaveBeenCalled();
  });

  it('sem vínculo vira 404, sem permissão vira 403 e seleção inválida vira 400, com a mensagem do domínio', async () => {
    listMock.mockRejectedValueOnce(new NotFoundException('Estabelecimento não encontrado.'));
    await request(app.getHttpServer()).get('/tenants/tenant_alheio/professionals').expect(404);

    createMock.mockRejectedValueOnce(new ForbiddenException('Sem permissão.'));
    await request(app.getHttpServer())
      .post('/tenants/tenant_a/professionals')
      .send(CORPO_VALIDO)
      .expect(403);

    setServicesMock.mockRejectedValueOnce(new BadRequestException('Seleção inválida.'));
    await request(app.getHttpServer())
      .put('/tenants/tenant_a/professionals/professional_1/services')
      .send({ serviceIds: ['service_de_outro_tenant'] })
      .expect(400);

    reactivateMock.mockRejectedValueOnce(new NotFoundException('Profissional não encontrado.'));
    await request(app.getHttpServer())
      .post('/tenants/tenant_a/professionals/professional_de_outro/reactivate')
      .expect(404);
  });

  it('corpo inválido é 400 antes de chegar no serviço', async () => {
    await request(app.getHttpServer())
      .post('/tenants/tenant_a/professionals')
      .send({ name: '' })
      .expect(400);

    await request(app.getHttpServer())
      .patch('/tenants/tenant_a/professionals/professional_1')
      .send({})
      .expect(400);

    await request(app.getHttpServer())
      .put('/tenants/tenant_a/professionals/professional_1/services')
      .send({})
      .expect(400);

    expect(createMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(setServicesMock).not.toHaveBeenCalled();
  });

  it('tentar mandar tenantId/id/unitId/avatarInitials/avatarColor/active no corpo é 400 — nunca aplicado', async () => {
    for (const campo of ['tenantId', 'id', 'unitId', 'avatarInitials', 'avatarColor', 'active']) {
      await request(app.getHttpServer())
        .post('/tenants/tenant_a/professionals')
        .send({ ...CORPO_VALIDO, [campo]: 'forjado' })
        .expect(400);

      await request(app.getHttpServer())
        .patch('/tenants/tenant_a/professionals/professional_1')
        .send({ name: 'João Silva', [campo]: 'forjado' })
        .expect(400);
    }

    expect(createMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('a mensagem de erro de validação nunca ecoa o valor recebido', async () => {
    const resposta = await request(app.getHttpServer())
      .post('/tenants/tenant_a/professionals')
      .send({ ...CORPO_VALIDO, tenantId: 'tenant-secreto-forjado' })
      .expect(400);

    expect(JSON.stringify(resposta.body)).not.toContain('tenant-secreto-forjado');
  });

  it('não existe rota de exclusão física de profissional', async () => {
    await request(app.getHttpServer())
      .delete('/tenants/tenant_a/professionals/professional_1')
      .expect(404);
  });
});
