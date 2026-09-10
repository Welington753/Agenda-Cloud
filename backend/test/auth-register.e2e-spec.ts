// E2E de POST /auth/register dentro do AppModule real (prova que AuthModule
// está corretamente registrado e a DI resolve de ponta a ponta) — mesmo
// padrão de app.e2e-spec.ts: `DataSource` é substituído ANTES de `.compile()`
// (nunca abre socket nenhum). `AuthService` também é substituído aqui — a
// lógica transacional real já é coberta em profundidade por
// auth.service.spec.ts (com EntityManager fake, incluindo rollback e
// corrida); este arquivo testa só a camada HTTP: rota, pipe de validação,
// rate limit e cookie.
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/auth/auth.service.js';
import { EmailAlreadyInUseError } from '../src/auth/auth.errors.js';
import { SESSION_COOKIE_NAME } from '../src/config/session-cookie.config.js';

const FAKE_DATA_SOURCE = {
  isInitialized: false,
  destroy: async () => {},
} as unknown as DataSource;

const VALID_BODY = {
  ownerName: 'Maria Souza',
  businessName: 'Studio Bela',
  email: 'maria@example.com',
  phone: '+5511987654321',
  password: 'senha-valida-123',
};

const FAKE_REGISTER_RESULT = {
  token: 'token-e2e-fake',
  user: { id: 'user_1', name: 'Maria Souza', email: 'maria@example.com' },
  tenant: { id: 'tenant_1', slug: 'studio-bela', status: 'TRIAL' },
  unit: { id: 'unit_1', name: 'Studio Bela', isPrimary: true },
  membership: { role: 'DONO' },
  plan: { code: 'equipe', name: 'Gestão', priceCents: null },
  trial: {
    trialStartAt: new Date('2026-09-10T12:00:00.000Z'),
    trialEndAt: new Date('2026-09-24T12:00:00.000Z'),
    durationDays: 14,
  },
};

describe('POST /auth/register (e2e)', () => {
  let app: INestApplication<App>;
  let registerMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    registerMock = vi.fn().mockResolvedValue(FAKE_REGISTER_RESULT);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DataSource)
      .useValue(FAKE_DATA_SOURCE)
      .overrideProvider(AuthService)
      .useValue({ register: registerMock })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('responde 201 com corpo sanitizado e cookie HttpOnly de sessão', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send(VALID_BODY)
      .expect(201);

    expect(response.body).toEqual({
      user: FAKE_REGISTER_RESULT.user,
      tenant: FAKE_REGISTER_RESULT.tenant,
      unit: FAKE_REGISTER_RESULT.unit,
      membership: FAKE_REGISTER_RESULT.membership,
      plan: FAKE_REGISTER_RESULT.plan,
      trial: {
        trialStartAt: FAKE_REGISTER_RESULT.trial.trialStartAt.toISOString(),
        trialEndAt: FAKE_REGISTER_RESULT.trial.trialEndAt.toISOString(),
        durationDays: 14,
      },
    });

    const setCookie = response.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    const sessionCookie = setCookie.find((c: string) => c.startsWith(`${SESSION_COOKIE_NAME}=`));
    expect(sessionCookie).toContain('HttpOnly');
    expect(sessionCookie).toContain(FAKE_REGISTER_RESULT.token);
  });

  it('nunca expõe o token na resposta JSON, só no cookie', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send(VALID_BODY);

    expect(JSON.stringify(response.body)).not.toContain(FAKE_REGISTER_RESULT.token);
  });

  it('400 quando o DTO é inválido, sem chamar o serviço', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ ...VALID_BODY, email: 'invalido' })
      .expect(400);

    expect(registerMock).not.toHaveBeenCalled();
  });

  it('409 em e-mail duplicado, sem detalhe de banco na resposta', async () => {
    registerMock.mockRejectedValueOnce(new EmailAlreadyInUseError());

    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send(VALID_BODY)
      .expect(409);

    expect(JSON.stringify(response.body).toLowerCase()).not.toContain('constraint');
    expect(JSON.stringify(response.body).toLowerCase()).not.toContain('uq_users_email');
  });

  it('rate limit: a sexta tentativa em 15 minutos retorna 429', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer()).post('/auth/register').send(VALID_BODY);
    }
    registerMock.mockClear();

    const sixth = await request(app.getHttpServer())
      .post('/auth/register')
      .send(VALID_BODY);

    expect(sixth.status).toBe(429);
    expect(registerMock).not.toHaveBeenCalled();
  });
});
