// `GET /health` pela API HTTP (AppModule inteiro), sem banco: o provider
// `DataSource` é trocado antes de compilar, como em app.e2e-spec.ts. Prova o
// contrato da rota e que `GET /` continua igual e independente do banco.
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { DataSource } from 'typeorm';
import { AppModule } from './../src/app.module.js';

async function subir(query: () => Promise<unknown>): Promise<INestApplication<App>> {
  const dataSource = { isInitialized: false, destroy: async () => {}, query } as unknown as DataSource;
  const modulo = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DataSource)
    .useValue(dataSource)
    .compile();
  const app = modulo.createNestApplication<INestApplication<App>>();
  await app.init();
  return app;
}

describe('GET /health (e2e)', () => {
  let app: INestApplication<App>;

  afterEach(async () => {
    await app.close();
  });

  it('banco responde: 200, corpo fixo e sem cache', async () => {
    const consultas: unknown[][] = [];
    app = await subir(async (...argumentos: unknown[]) => {
      consultas.push(argumentos);
      return [{ '?column?': 1 }];
    });

    const resposta = await request(app.getHttpServer()).get('/health').expect(200);
    expect(resposta.body).toEqual({ status: 'ok' });
    expect(resposta.headers['cache-control']).toBe('no-store');
    expect(consultas).toEqual([['SELECT 1']]);
  });

  it('banco falha: 503, sem repassar o erro', async () => {
    app = await subir(async () => {
      throw Object.assign(new Error('connect ECONNREFUSED postgresql://usuario:senha-secreta@banco.exemplo:5432/base'), {
        code: 'ECONNREFUSED',
      });
    });

    const resposta = await request(app.getHttpServer()).get('/health').expect(503);
    expect(resposta.body).toEqual({ status: 'unavailable' });
    expect(resposta.headers['cache-control']).toBe('no-store');
    expect(resposta.text).not.toMatch(/senha-secreta|ECONNREFUSED|banco\.exemplo/);
  });

  it('não exige sessão nem cookie', async () => {
    app = await subir(async () => []);
    const resposta = await request(app.getHttpServer()).get('/health');
    expect(resposta.status).toBe(200);
    expect(resposta.headers['set-cookie']).toBeUndefined();
  });

  it('GET / continua respondendo sem tocar no banco, mesmo com o banco fora', async () => {
    let consultas = 0;
    app = await subir(async () => {
      consultas += 1;
      throw new Error('banco fora');
    });

    await request(app.getHttpServer()).get('/').expect(200).expect('Hello World!');
    expect(consultas).toBe(0);
  });
});
