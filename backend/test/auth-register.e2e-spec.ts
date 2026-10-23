// O cadastro livre foi FECHADO: `POST /auth/register` não existe no AppModule
// real. Chamar a API diretamente (com corpo válido, repetidas vezes, com
// cabeçalhos quaisquer) devolve 404 sem tocar em serviço nenhum e sem emitir
// cookie. Contas novas só nascem por convite (test/accounts.e2e-spec.ts e
// test/accounts-postgres.db-e2e-spec.ts provam o fluxo e que nada é gravado
// fora dele).
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';

const FAKE_DATA_SOURCE = {
  isInitialized: false,
  destroy: async () => {},
  // Qualquer escrita aqui seria um vazamento do cadastro fechado.
  transaction: vi.fn(),
  query: vi.fn(),
} as unknown as DataSource;

const CORPO_DO_ANTIGO_CADASTRO = {
  ownerName: 'Maria Souza',
  businessName: 'Studio Bela',
  email: 'maria@example.com',
  phone: '+5511987654321',
  password: 'senha-valida-123',
};

describe('POST /auth/register fechado (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(FAKE_DATA_SOURCE)
      .compile();
    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('responde 404 sem cookie e sem nenhuma consulta ou transação', async () => {
    for (let i = 0; i < 8; i++) {
      const resposta = await request(app.getHttpServer())
        .post('/auth/register')
        .set('X-Forwarded-For', `203.0.113.${i}`)
        .send(CORPO_DO_ANTIGO_CADASTRO);
      expect(resposta.status).toBe(404);
      expect(resposta.headers['set-cookie']).toBeUndefined();
    }
    expect(FAKE_DATA_SOURCE.transaction).not.toHaveBeenCalled();
    expect(FAKE_DATA_SOURCE.query).not.toHaveBeenCalled();
  });

  it('nenhuma variação de rota recria o cadastro', async () => {
    for (const rota of ['/auth/register/', '/auth/signup', '/auth/registro', '/register']) {
      await request(app.getHttpServer()).post(rota).send(CORPO_DO_ANTIGO_CADASTRO).expect(404);
    }
  });
});
