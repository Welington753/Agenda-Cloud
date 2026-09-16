// E2E HTTP da rota de disponibilidade dentro do AppModule real (Lote 6D.4) —
// prova que o controller está registrado e a DI resolve de ponta a ponta.
// Mesmo padrão de professional-working-hours.e2e-spec.ts: `DataSource`
// substituído ANTES de `.compile()` (nunca abre socket), serviço e guard
// substituídos porque a lógica deles já é coberta em
// src/availability/*.spec.ts e contra Postgres real no arquivo db-e2e. Aqui
// se testa só a camada HTTP: rota, guard, pipe de validação da query e
// mapeamento de erro para status.
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
import { AvailabilityService } from '../src/availability/availability.service.js';

const FAKE_DATA_SOURCE = {
  isInitialized: false,
  destroy: async () => {},
} as unknown as DataSource;

const FAKE_IDENTITY_CONTEXT = { userId: 'user_1', sessionId: 'session_1' };

const DISPONIBILIDADE = {
  professionalId: 'professional_1',
  serviceId: 'service_1',
  date: '2026-09-20',
  timezone: 'America/Sao_Paulo',
  durationMinutes: 30,
  bufferAfterMinutes: 0,
  slotStepMinutes: 15,
  minLeadMinutes: null,
  maxFutureDays: null,
  slots: [
    {
      startAt: '2026-09-20T12:00:00.000Z',
      endAt: '2026-09-20T12:30:00.000Z',
      localStart: '09:00',
      localEnd: '09:30',
      offsetMinutes: -180,
      offsetLabel: '-03:00',
    },
  ],
  emptyReason: null,
};

const CAMINHO = '/tenants/tenant_a/professionals/professional_1/availability';
const QUERY = { serviceId: 'service_1', date: '2026-09-20' };

describe('rota de disponibilidade (e2e)', () => {
  let app: INestApplication<App>;
  let consultMock: ReturnType<typeof vi.fn>;
  let guardMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    consultMock = vi.fn().mockResolvedValue(DISPONIBILIDADE);
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
      .overrideProvider(AvailabilityService)
      .useValue({ consult: consultMock })
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

  it('GET devolve os horários e repassa o userId provado pelo guard', async () => {
    const resposta = await request(app.getHttpServer()).get(CAMINHO).query(QUERY).expect(200);

    expect(resposta.body.availability.timezone).toBe('America/Sao_Paulo');
    expect(resposta.body.availability.slots).toHaveLength(1);
    expect(consultMock).toHaveBeenCalledWith('user_1', 'tenant_a', 'professional_1', QUERY);
  });

  it('a rota não existe sem sessão — o guard recusa antes do serviço', async () => {
    guardMock.mockImplementation(() => {
      throw new UnauthorizedException('Não autenticado.');
    });

    await request(app.getHttpServer()).get(CAMINHO).query(QUERY).expect(401);

    expect(consultMock).not.toHaveBeenCalled();
  });

  it('sem vínculo vira 404 e sem permissão vira 403', async () => {
    consultMock.mockRejectedValueOnce(new NotFoundException('Estabelecimento não encontrado.'));
    await request(app.getHttpServer())
      .get('/tenants/tenant_alheio/professionals/professional_1/availability')
      .query(QUERY)
      .expect(404);

    consultMock.mockRejectedValueOnce(new ForbiddenException('Sem permissão.'));
    await request(app.getHttpServer()).get(CAMINHO).query(QUERY).expect(403);
  });

  it('profissional ou serviço de outro estabelecimento vira 404', async () => {
    consultMock.mockRejectedValueOnce(new NotFoundException('Profissional não encontrado.'));
    await request(app.getHttpServer())
      .get('/tenants/tenant_a/professionals/professional_de_outro/availability')
      .query(QUERY)
      .expect(404);

    consultMock.mockRejectedValueOnce(new NotFoundException('Serviço não encontrado.'));
    await request(app.getHttpServer())
      .get(CAMINHO)
      .query({ ...QUERY, serviceId: 'service_de_outro' })
      .expect(404);
  });

  it('vínculo ausente entre profissional e serviço vira 400', async () => {
    consultMock.mockRejectedValueOnce(
      new BadRequestException('Este profissional não realiza o serviço selecionado.'),
    );

    await request(app.getHttpServer()).get(CAMINHO).query(QUERY).expect(400);
  });

  it.each([
    ['sem serviço', { date: '2026-09-20' }],
    ['sem data', { serviceId: 'service_1' }],
    ['data fora do formato', { serviceId: 'service_1', date: '20/09/2026' }],
    ['data inexistente', { serviceId: 'service_1', date: '2026-02-30' }],
    ['parâmetro desconhecido', { ...QUERY, tenantId: 'tenant_outro' }],
  ])('query inválida (%s) é 400 e nunca chega no serviço', async (_rotulo, query) => {
    await request(app.getHttpServer())
      .get(CAMINHO)
      .query(query as Record<string, string>)
      .expect(400);

    expect(consultMock).not.toHaveBeenCalled();
  });

  it('a resposta não carrega nenhum dado de cliente', async () => {
    const resposta = await request(app.getHttpServer()).get(CAMINHO).query(QUERY).expect(200);
    const chaves = Object.keys(resposta.body.availability.slots[0]);

    expect(chaves).toEqual([
      'startAt',
      'endAt',
      'localStart',
      'localEnd',
      'offsetMinutes',
      'offsetLabel',
    ]);
  });

  it('não existe rota de gravação neste lote', async () => {
    await request(app.getHttpServer()).post(CAMINHO).send({}).expect(404);
    await request(app.getHttpServer()).put(CAMINHO).send({}).expect(404);
    await request(app.getHttpServer()).delete(CAMINHO).expect(404);
  });
});
