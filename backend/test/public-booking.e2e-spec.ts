// E2E HTTP das rotas do agendamento online dentro do AppModule real — sem
// banco (`DataSource` falso, serviço substituído). Prova a camada HTTP:
// rota pública SEM sessão, rotas privadas COM `SessionGuard`, validação
// estrita, 201/200 do reenvio e os limites por IP, que são próprios e não
// tocam os de login e cadastro.
import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, INestApplication, UnauthorizedException } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { DataSource } from 'typeorm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { SessionGuard } from '../src/auth/session.guard.js';
import { AuthService } from '../src/auth/auth.service.js';
import {
  PUBLIC_READ_RATE_LIMIT_MAX,
  PUBLIC_REQUEST_RATE_LIMIT_MAX,
} from '../src/public-booking/public-booking-rate-limit.js';
import { PublicBookingService } from '../src/public-booking/public-booking.service.js';

const FAKE_DATA_SOURCE = {
  isInitialized: false,
  destroy: async () => {},
} as unknown as DataSource;

const RECIBO = {
  status: 'PENDING',
  startAt: '2027-03-07T13:00:00.000Z',
  localDate: '2027-03-07',
  localStart: '10:00',
  timezone: 'America/Sao_Paulo',
  serviceName: 'Sessão',
  professionalName: 'Ana',
  establishmentName: 'Clínica',
  replayed: false,
};

const PEDIDO = {
  serviceId: 'service_1',
  professionalId: 'professional_1',
  startAt: '2027-03-07T13:00:00.000Z',
  name: 'Joana',
  whatsapp: '(11) 98765-4321',
  idempotencyKey: 'abcdefghij0123456789',
};

describe('rotas do agendamento online (e2e)', () => {
  let app: INestApplication<App>;
  let servico: Record<string, ReturnType<typeof vi.fn>>;
  let guardMock: ReturnType<typeof vi.fn>;
  let loginMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    servico = {
      profile: vi.fn().mockResolvedValue({ establishment: { name: 'Clínica', slug: 'clinica', timezone: 'America/Sao_Paulo' }, services: [], professionals: [] }),
      availabilityFor: vi.fn().mockResolvedValue({ date: '2027-03-07', timezone: 'America/Sao_Paulo', slots: [], emptyReason: 'SEM_JORNADA' }),
      request: vi.fn().mockResolvedValue(RECIBO),
      settings: vi.fn().mockResolvedValue({ enabled: false, slug: 'clinica', updatedAt: null }),
      updateSettings: vi.fn().mockResolvedValue({ enabled: true, slug: 'clinica', updatedAt: null }),
      pendingRequests: vi.fn().mockResolvedValue({ requests: [], complete: true }),
    };
    // Guard real substituído por um que exige o cookie: sem cookie, 401.
    guardMock = vi.fn().mockImplementation((context) => {
      const req = context.switchToHttp().getRequest();
      if (!req.cookies?.sessao) throw new UnauthorizedException();
      req.auth = { userId: 'user_1', sessionId: 'session_1' };
      return true;
    });
    loginMock = vi.fn().mockRejectedValue(new UnauthorizedException());

    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(FAKE_DATA_SOURCE)
      .overrideProvider(PublicBookingService)
      .useValue(servico)
      .overrideProvider(AuthService)
      .useValue({ login: loginMock })
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

  it('rotas públicas respondem sem sessão e nunca passam pelo guard', async () => {
    const http = request(app.getHttpServer());
    const perfil = await http.get('/public/Clinica').expect(200);
    expect(perfil.body.profile.establishment.slug).toBe('clinica');
    expect(servico.profile).toHaveBeenCalledWith('clinica');

    await http
      .get('/public/clinica/availability')
      .query({ serviceId: 'service_1', professionalId: 'professional_1', date: '2027-03-07' })
      .expect(200);

    const criado = await http.post('/public/clinica/booking-requests').send(PEDIDO).expect(201);
    expect(criado.body.request).toEqual(RECIBO);
    expect(guardMock).not.toHaveBeenCalled();
  });

  it('reenvio com a mesma chave responde 200 (mesmo pedido), não 201', async () => {
    servico.request.mockResolvedValueOnce({ ...RECIBO, replayed: true });
    const resposta = await request(app.getHttpServer())
      .post('/public/clinica/booking-requests')
      .send(PEDIDO)
      .expect(200);
    expect(resposta.body.request.replayed).toBe(true);
  });

  it('validação estrita: status, e-mail ou tenant no corpo, slug inválido e telefone ruim são recusados', async () => {
    const http = request(app.getHttpServer());
    for (const extra of [{ status: 'CONFIRMED' }, { email: 'a@b.c' }, { tenantId: 't' }, { notes: 'x' }]) {
      await http.post('/public/clinica/booking-requests').send({ ...PEDIDO, ...extra }).expect(400);
    }
    await http.post('/public/clinica/booking-requests').send({ ...PEDIDO, whatsapp: '123' }).expect(400);
    await http.post('/public/clinica/booking-requests').send({ ...PEDIDO, idempotencyKey: 'curta' }).expect(400);
    await http.post('/public/clinica/booking-requests').send({ ...PEDIDO, startAt: '2027-03-07T10:00:00' }).expect(400);
    await http.get('/public/..%2Ftenants').expect(400);
    expect(servico.request).not.toHaveBeenCalled();
  });

  it('erro do serviço vira o status certo (409 de horário ocupado)', async () => {
    servico.request.mockRejectedValueOnce(new ConflictException('Este horário acabou de ser ocupado.'));
    const resposta = await request(app.getHttpServer())
      .post('/public/clinica/booking-requests')
      .send(PEDIDO)
      .expect(409);
    expect(resposta.body.message).toBe('Este horário acabou de ser ocupado.');
  });

  it(`envio: ${PUBLIC_REQUEST_RATE_LIMIT_MAX} por hora por IP, depois 429 com mensagem — e o login segue com o próprio limite`, async () => {
    const http = request(app.getHttpServer());
    for (let i = 0; i < PUBLIC_REQUEST_RATE_LIMIT_MAX; i += 1) {
      await http.post('/public/clinica/booking-requests').send(PEDIDO).expect(201);
    }
    const bloqueado = await http.post('/public/clinica/booking-requests').send(PEDIDO).expect(429);
    expect(bloqueado.body.message).toMatch(/Muitas tentativas/);
    expect(servico.request).toHaveBeenCalledTimes(PUBLIC_REQUEST_RATE_LIMIT_MAX);
    // Outro slug, mesmo IP: o limite é por IP, não por estabelecimento.
    await http.post('/public/outro/booking-requests').send(PEDIDO).expect(429);
    // A leitura continua liberada (limiter próprio).
    await http.get('/public/clinica').expect(200);
    // O login não foi consumido: responde pelo serviço (401), não 429.
    await http.post('/auth/login').send({ email: 'a@example.test', password: 'senha-qualquer-123' }).expect(401);
  });

  it(`leitura: ${PUBLIC_READ_RATE_LIMIT_MAX} por janela por IP, depois 429`, async () => {
    const http = request(app.getHttpServer());
    for (let i = 0; i < PUBLIC_READ_RATE_LIMIT_MAX; i += 1) {
      await http.get('/public/clinica').expect(200);
    }
    await http.get('/public/clinica').expect(429);
    await http
      .get('/public/clinica/availability')
      .query({ serviceId: 's', professionalId: 'p', date: '2027-03-07' })
      .expect(429);
  });

  it('rotas privadas exigem sessão: sem cookie 401; com sessão repassam o userId provado', async () => {
    const http = request(app.getHttpServer());
    await http.get('/tenants/tenant_a/booking-requests').expect(401);
    await http.get('/tenants/tenant_a/public-booking').expect(401);
    await http.put('/tenants/tenant_a/public-booking').send({ enabled: true }).expect(401);
    expect(servico.pendingRequests).not.toHaveBeenCalled();
    expect(servico.updateSettings).not.toHaveBeenCalled();

    await http.get('/tenants/tenant_a/booking-requests').set('Cookie', 'sessao=1').expect(200);
    expect(servico.pendingRequests).toHaveBeenCalledWith('user_1', 'tenant_a');
    await http.put('/tenants/tenant_a/public-booking').set('Cookie', 'sessao=1').send({ enabled: true }).expect(200);
    expect(servico.updateSettings).toHaveBeenCalledWith('user_1', 'tenant_a', true);
    await http
      .put('/tenants/tenant_a/public-booking')
      .set('Cookie', 'sessao=1')
      .send({ enabled: true, slug: 'outro' })
      .expect(400);
  });
});
