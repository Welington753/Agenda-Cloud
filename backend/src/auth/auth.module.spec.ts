import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthModule } from './auth.module.js';
import { AuthService } from './auth.service.js';

const VALID_BODY = {
  ownerName: 'Maria Souza',
  businessName: 'Studio Bela',
  email: 'maria@example.com',
  phone: '+5511987654321',
  password: 'senha-valida-123',
};

describe('AuthModule', () => {
  let app: INestApplication<App>;
  let registerMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    registerMock = vi.fn().mockImplementation(async () => ({
      token: 'token-fake',
      user: { id: 'user_1', name: 'Maria', email: 'maria@example.com' },
      tenant: { id: 'tenant_1', slug: 'studio-bela', status: 'TRIAL' },
      unit: { id: 'unit_1', name: 'Studio Bela', isPrimary: true },
      membership: { role: 'DONO' },
      plan: { code: 'equipe', name: 'Gestão', priceCents: null },
      trial: {
        trialStartAt: new Date(),
        trialEndAt: new Date(),
        durationDays: 14,
      },
    }));

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AuthModule],
    })
      .overrideProvider(AuthService)
      .useValue({ register: registerMock })
      .overrideProvider(ConfigService)
      .useValue({ getOrThrow: () => 'development' })
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
      .send(VALID_BODY)
      .expect(201);

    expect(registerMock).toHaveBeenCalledTimes(1);
  });

  it('bloqueia a sexta tentativa em POST /auth/register com 429 e não chama o AuthService pela sexta vez', async () => {
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

  it('rejeita payload inválido com 400 antes de chamar o AuthService', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ ...VALID_BODY, email: 'nao-e-email' })
      .expect(400);

    expect(registerMock).not.toHaveBeenCalled();
  });
});
