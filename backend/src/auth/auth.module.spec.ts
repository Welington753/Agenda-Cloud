import { Global, INestApplication, Module, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthModule } from './auth.module.js';
import { AuthService } from './auth.service.js';
import { SessionGuard } from './session.guard.js';

// Na aplicação real, `DataSource` vem de `DatabaseModule` (TypeOrmModule),
// que o `@nestjs/typeorm` registra como `@Global()` — por isso `AuthModule`
// nunca precisa importar `DatabaseModule` diretamente (mesma razão de
// `AuthService` já injetar `DataSource` sem isso). Este módulo replica só
// essa globalidade para o teste isolado de `AuthModule` conseguir resolver a
// dependência de `SessionGuard` — nunca usado de verdade (o valor é
// substituído por `overrideGuard` abaixo).
@Global()
@Module({
  providers: [{ provide: DataSource, useValue: {} }],
  exports: [DataSource],
})
class GlobalDataSourceStubModule {}

const VALID_REGISTER_BODY = {
  ownerName: 'Maria Souza',
  businessName: 'Studio Bela',
  email: 'maria@example.com',
  phone: '+5511987654321',
  password: 'senha-valida-123',
};

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
  trial: { trialStartAt: new Date(), trialEndAt: new Date(), durationDays: 14 },
  tenantStatus: 'TRIAL',
};

const FAKE_SESSION_CONTEXT_RESULT = {
  user: { id: 'user_1', name: 'Maria', email: 'maria@example.com' },
  contexts: [FAKE_TENANT_CONTEXT],
  activeContext: FAKE_TENANT_CONTEXT,
  requiresTenantSelection: false,
  hasEstablishmentAccess: true,
};

const FAKE_IDENTITY_CONTEXT = { userId: 'user_1', sessionId: 'session_1' };

describe('AuthModule', () => {
  let app: INestApplication<App>;
  let registerMock: ReturnType<typeof vi.fn>;
  let loginMock: ReturnType<typeof vi.fn>;
  let logoutMock: ReturnType<typeof vi.fn>;
  let getSessionContextMock: ReturnType<typeof vi.fn>;
  let guardCanActivateMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    registerMock = vi.fn().mockImplementation(async () => ({
      token: 'token-fake',
      user: { id: 'user_1', name: 'Maria', email: 'maria@example.com' },
      tenant: { id: 'tenant_1', slug: 'studio-bela', status: 'TRIAL' },
      unit: { id: 'unit_1', name: 'Studio Bela', isPrimary: true },
      membership: { role: 'DONO' },
      plan: { code: 'equipe', name: 'Gestão', priceCents: null },
      trial: { trialStartAt: new Date(), trialEndAt: new Date(), durationDays: 14 },
    }));
    loginMock = vi.fn().mockImplementation(async () => ({
      token: 'token-login-fake',
      ...FAKE_SESSION_CONTEXT_RESULT,
    }));
    logoutMock = vi.fn().mockResolvedValue(undefined);
    getSessionContextMock = vi.fn().mockResolvedValue(FAKE_SESSION_CONTEXT_RESULT);
    guardCanActivateMock = vi.fn().mockImplementation((context) => {
      const req = context.switchToHttp().getRequest();
      req.auth = FAKE_IDENTITY_CONTEXT;
      return true;
    });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [GlobalDataSourceStubModule, AuthModule],
    })
      .overrideProvider(AuthService)
      .useValue({
        register: registerMock,
        login: loginMock,
        logout: logoutMock,
        getSessionContext: getSessionContextMock,
      })
      .overrideProvider(ConfigService)
      .useValue({ getOrThrow: () => 'development' })
      .overrideGuard(SessionGuard)
      .useValue({ canActivate: guardCanActivateMock })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('POST /auth/register chama o AuthService e responde 201', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send(VALID_REGISTER_BODY)
      .expect(201);

    expect(registerMock).toHaveBeenCalledTimes(1);
  });

  it('bloqueia a sexta tentativa em POST /auth/register com 429 e não chama o AuthService pela sexta vez', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer()).post('/auth/register').send(VALID_REGISTER_BODY);
    }
    registerMock.mockClear();

    const sixth = await request(app.getHttpServer())
      .post('/auth/register')
      .send(VALID_REGISTER_BODY);

    expect(sixth.status).toBe(429);
    expect(registerMock).not.toHaveBeenCalled();
  });

  it('rejeita payload inválido com 400 antes de chamar o AuthService', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ ...VALID_REGISTER_BODY, email: 'nao-e-email' })
      .expect(400);

    expect(registerMock).not.toHaveBeenCalled();
  });

  it('POST /auth/login chama o AuthService e responde 200', async () => {
    await request(app.getHttpServer()).post('/auth/login').send(VALID_LOGIN_BODY).expect(200);

    expect(loginMock).toHaveBeenCalledTimes(1);
  });

  it('bloqueia a sexta tentativa em POST /auth/login com 429 e não chama o AuthService pela sexta vez', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer()).post('/auth/login').send(VALID_LOGIN_BODY);
    }
    loginMock.mockClear();

    const sixth = await request(app.getHttpServer()).post('/auth/login').send(VALID_LOGIN_BODY);

    expect(sixth.status).toBe(429);
    expect(loginMock).not.toHaveBeenCalled();
  });

  it('o limiter de /auth/login é independente do de /auth/register (esgotar um não afeta o outro)', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer()).post('/auth/register').send(VALID_REGISTER_BODY);
    }
    const sixthRegister = await request(app.getHttpServer())
      .post('/auth/register')
      .send(VALID_REGISTER_BODY);
    expect(sixthRegister.status).toBe(429);

    const firstLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send(VALID_LOGIN_BODY);
    expect(firstLogin.status).toBe(200);
  });

  it('rejeita payload de login inválido com 400 antes de chamar o AuthService', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ ...VALID_LOGIN_BODY, email: 'nao-e-email' })
      .expect(400);

    expect(loginMock).not.toHaveBeenCalled();
  });

  it('GET /auth/me passa pelo SessionGuard e responde 200 com o contexto anexado', async () => {
    const response = await request(app.getHttpServer()).get('/auth/me').expect(200);

    expect(guardCanActivateMock).toHaveBeenCalledTimes(1);
    expect(response.body.user).toEqual(FAKE_SESSION_CONTEXT_RESULT.user);
  });

  it('GET /auth/me responde 401 quando o guard recusa (sem chamar nenhum método do AuthService)', async () => {
    guardCanActivateMock.mockImplementation(() => {
      throw new UnauthorizedException('Não autenticado.');
    });

    await request(app.getHttpServer()).get('/auth/me').expect(401);

    expect(registerMock).not.toHaveBeenCalled();
    expect(loginMock).not.toHaveBeenCalled();
  });

  it('GET /auth/me nunca é bloqueado pelo rate limit (sem limite neste lote)', async () => {
    for (let i = 0; i < 10; i++) {
      await request(app.getHttpServer()).get('/auth/me').expect(200);
    }
  });

  it('POST /auth/logout responde 204 e chama o AuthService', async () => {
    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', 'session_token=alguma-coisa')
      .expect(204);

    expect(logoutMock).toHaveBeenCalledTimes(1);
  });

  it('POST /auth/logout responde 204 mesmo sem cookie nenhum', async () => {
    await request(app.getHttpServer()).post('/auth/logout').expect(204);

    expect(logoutMock).toHaveBeenCalledWith(undefined);
  });

  it('POST /auth/logout nunca é bloqueado pelo rate limit (sem limite neste lote)', async () => {
    for (let i = 0; i < 10; i++) {
      await request(app.getHttpServer()).post('/auth/logout').expect(204);
    }
  });
});
