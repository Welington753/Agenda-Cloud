import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module.js';

// `AppModule` importa `DatabaseModule` (TypeOrmModule), que registra um
// provider `DataSource` cuja fábrica chamaria `DataSource.initialize()` —
// abrindo uma conexão real (mesmo que fadada a falhar contra o host fictício
// de `e2e-env-setup.ts`). `overrideProvider` troca esse provider ANTES de
// `.compile()`, então essa fábrica nunca roda e nenhum socket é aberto — o
// stub abaixo só precisa satisfazer o que `TypeOrmCoreModule` usa dele
// (`isInitialized`/`destroy`, ver node_modules/@nestjs/typeorm/dist/typeorm-core.module.js).
const FAKE_DATA_SOURCE = {
  isInitialized: false,
  destroy: async () => {},
} as unknown as DataSource;

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DataSource)
      .useValue(FAKE_DATA_SOURCE)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  afterEach(async () => {
    await app.close();
  });
});
