// E2E de POST /auth/login, GET /auth/me e POST /auth/logout dentro do
// AppModule real (prova que AuthModule está corretamente registrado e a DI
// resolve de ponta a ponta) — mesmo padrão de auth-register.e2e-spec.ts:
// `DataSource` é substituído ANTES de `.compile()` (nunca abre socket
// nenhum). `AuthService` e `SessionGuard` também são substituídos aqui — a
// lógica de negócio já é coberta em profundidade por auth.service.login.spec.ts,
// auth.service.logout.spec.ts e session.guard.spec.ts; este arquivo testa só
// a camada HTTP: rota, pipe de validação, rate limit, guard e cookie.
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, UnauthorizedException } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/auth/auth.service.js';
import { InvalidCredentialsError } from '../src/auth/auth.errors.js';
import { SessionGuard } from '../src/auth/session.guard.js';
import { SESSION_COOKIE_NAME } from '../src/config/session-cookie.config.js';

const FAKE_DATA_SOURCE = {
  isInitialized: false,
  destroy: async () => {},
} as unknown as DataSource;

const VALID_LOGIN_BODY = {
  email: 'maria@example.com',
  password: 'senha-valida-123',
};

const FAKE_TENANT_CONTEXT = {
  membershipId: 'membership_1',
  tenantId: 'tenant_1',
  tenantName: 'Studio Bela',
  tenantSlug: 'studio-bela',
  role: 'DONO',
  unit: { id: 'unit_1', name: 'Studio Bela', isPrimary: true },
  planCode: 'equipe',
  planName: 'Gestão',
  trial: {
    trialStartAt: new Date('2026-09-10T12:00:00.000Z'),
    trialEndAt: new Date('2026-09-24T12:00:00.000Z'),
    durationDays: 14,
  },
  tenantStatus: 'TRIAL',
};

const FAKE_SESSION_CONTEXT_RESULT = {
  user: { id: 'user_1', name: 'Maria Souza', email: 'maria@example.com' },
  contexts: [FAKE_TENANT_CONTEXT],
  activeContext: FAKE_TENANT_CONTEXT,
  requiresTenantSelection: false,
  hasEstablishmentAccess: true,
};

const FAKE_LOGIN_RESULT = {
  token: 'token-login-e2e-fake',
  ...FAKE_SESSION_CONTEXT_RESULT,
};

const FAKE_IDENTITY_CONTEXT = { userId: 'user_1', sessionId: 'session_1' };

describe('POST /auth/login, GET /auth/me, POST /auth/logout (e2e)', () => {
  let app: INestApplication<App>;
  let loginMock: ReturnType<typeof vi.fn>;
  let logoutMock: ReturnType<typeof vi.fn>;
  let getSessionContextMock: ReturnType<typeof vi.fn>;
  let guardMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    loginMock = vi.fn().mockResolvedValue(FAKE_LOGIN_RESULT);
    logoutMock = vi.fn().mockResolvedValue(undefined);
    getSessionContextMock = vi.fn().mockResolvedValue(FAKE_SESSION_CONTEXT_RESULT);
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
      .overrideProvider(AuthService)
      .useValue({
        login: loginMock,
        logout: logoutMock,
        register: vi.fn(),
        getSessionContext: getSessionContextMock,
      })
      .overrideGuard(SessionGuard)
      .useValue({ canActivate: guardMock })
      .compile();

    app = moduleFixture.createNestApplication();
    // `main.ts` registra isto no bootstrap real; `createNestApplication()`
    // não roda `main.ts`, então login/me/logout (que dependem de ler
    // `req.cookies`) precisam do parser aqui também.
    app.use(cookieParser());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('POST /auth/login: 200 com corpo sanitizado e cookie HttpOnly de sessão', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send(VALID_LOGIN_BODY)
      .expect(200);

    expect(response.body).toEqual({
      user: FAKE_LOGIN_RESULT.user,
      contexts: [
        {
          ...FAKE_TENANT_CONTEXT,
          trial: {
            trialStartAt: FAKE_TENANT_CONTEXT.trial.trialStartAt.toISOString(),
            trialEndAt: FAKE_TENANT_CONTEXT.trial.trialEndAt.toISOString(),
            durationDays: 14,
          },
        },
      ],
      activeContext: {
        ...FAKE_TENANT_CONTEXT,
        trial: {
          trialStartAt: FAKE_TENANT_CONTEXT.trial.trialStartAt.toISOString(),
          trialEndAt: FAKE_TENANT_CONTEXT.trial.trialEndAt.toISOString(),
          durationDays: 14,
        },
      },
      requiresTenantSelection: false,
      hasEstablishmentAccess: true,
    });

    const setCookie = response.headers['set-cookie'];
    const sessionCookie = setCookie.find((c: string) => c.startsWith(`${SESSION_COOKIE_NAME}=`));
    expect(sessionCookie).toContain('HttpOnly');
    expect(sessionCookie).toContain(FAKE_LOGIN_RESULT.token);
  });

  it('nunca expõe o token de login na resposta JSON, só no cookie', async () => {
    const response = await request(app.getHttpServer()).post('/auth/login').send(VALID_LOGIN_BODY);
    expect(JSON.stringify(response.body)).not.toContain(FAKE_LOGIN_RESULT.token);
  });

  it('400 quando o DTO de login é inválido, sem chamar o serviço', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ ...VALID_LOGIN_BODY, email: 'invalido' })
      .expect(400);

    expect(loginMock).not.toHaveBeenCalled();
  });

  it('401 em credenciais inválidas, sem cookie e sem detalhe de qual etapa falhou', async () => {
    loginMock.mockRejectedValueOnce(new InvalidCredentialsError());

    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send(VALID_LOGIN_BODY)
      .expect(401);

    expect(response.headers['set-cookie']).toBeUndefined();
    expect(JSON.stringify(response.body).toLowerCase()).not.toContain('e-mail');
  });

  it('rate limit: a sexta tentativa de login em 15 minutos retorna 429', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer()).post('/auth/login').send(VALID_LOGIN_BODY);
    }
    loginMock.mockClear();

    const sixth = await request(app.getHttpServer()).post('/auth/login').send(VALID_LOGIN_BODY);

    expect(sixth.status).toBe(429);
    expect(loginMock).not.toHaveBeenCalled();
  });

  it('GET /auth/me: passa pelo SessionGuard e responde 200 com o contexto sanitizado', async () => {
    const response = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', `${SESSION_COOKIE_NAME}=qualquer-coisa`)
      .expect(200);

    expect(guardMock).toHaveBeenCalledTimes(1);
    expect(getSessionContextMock).toHaveBeenCalledWith(FAKE_IDENTITY_CONTEXT.userId);
    expect(response.body.user).toEqual(FAKE_SESSION_CONTEXT_RESULT.user);
  });

  it('GET /auth/me: 401 quando o guard recusa', async () => {
    guardMock.mockImplementation(() => {
      throw new UnauthorizedException('Não autenticado.');
    });

    await request(app.getHttpServer()).get('/auth/me').expect(401);
  });

  it('POST /auth/logout: 204, chama o serviço e limpa o cookie', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', `${SESSION_COOKIE_NAME}=qualquer-coisa`)
      .expect(204);

    expect(logoutMock).toHaveBeenCalledWith('qualquer-coisa');
    const setCookie = response.headers['set-cookie'];
    const cleared = setCookie.find((c: string) => c.startsWith(`${SESSION_COOKIE_NAME}=`));
    expect(cleared).toBeDefined();
  });

  it('POST /auth/logout: 204 mesmo sem cookie nenhum', async () => {
    await request(app.getHttpServer()).post('/auth/logout').expect(204);
    expect(logoutMock).toHaveBeenCalledWith(undefined);
  });
});
