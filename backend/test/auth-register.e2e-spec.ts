// E2E de POST /auth/register dentro do AppModule real, na versão de reserva da
// API: o cadastro público está FECHADO. Sem rota, a resposta é 404, sem cookie
// e sem chamar o AuthService, para qualquer corpo e em qualquer número de
// tentativas (não há rate limit que troque o 404 por 429). Mesmo padrão de
// app.e2e-spec.ts: `DataSource` substituído antes de `.compile()`, sem socket.
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/auth/auth.service.js';

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

describe('POST /auth/register (e2e, cadastro fechado)', () => {
  let app: INestApplication<App>;
  let registerMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    registerMock = vi.fn();

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

  it('404 sem cookie e sem chamar o serviço, com corpo válido, inválido ou vazio', async () => {
    for (const body of [VALID_BODY, { ...VALID_BODY, email: 'nao-e-email' }, {}]) {
      const response = await request(app.getHttpServer()).post('/auth/register').send(body);
      expect(response.status).toBe(404);
      expect(response.headers['set-cookie']).toBeUndefined();
    }
    expect(registerMock).not.toHaveBeenCalled();
  });

  it('continua 404 depois de muitas tentativas (nunca vira 429 nem 201)', async () => {
    for (let i = 0; i < 8; i++) {
      await request(app.getHttpServer()).post('/auth/register').send(VALID_BODY).expect(404);
    }
    expect(registerMock).not.toHaveBeenCalled();
  });
});
