// E2E HTTP das rotas de agendamento e de clientes dentro do AppModule real
// (Lote 6D.5) — prova que os controllers estão registrados e a DI resolve de
// ponta a ponta. Mesmo padrão de availability.e2e-spec.ts: `DataSource`
// substituído ANTES de `.compile()` (nunca abre socket), serviços e guard
// substituídos porque a lógica deles já é coberta em src/**/*.spec.ts e
// contra Postgres real no arquivo db-e2e. Aqui se testa só a camada HTTP:
// rota, guard, pipe de validação e mapeamento de erro para status.
import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
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
import { AppointmentsService } from '../src/appointments/appointments.service.js';
import { ConsumersService } from '../src/consumers/consumers.service.js';

const FAKE_DATA_SOURCE = {
  isInitialized: false,
  destroy: async () => {},
} as unknown as DataSource;

const FAKE_IDENTITY_CONTEXT = { userId: 'user_1', sessionId: 'session_1' };

const AGENDAMENTO = {
  id: 'appointment_1',
  startAt: '2026-09-20T12:00:00.000Z',
  serviceEndAt: '2026-09-20T13:00:00.000Z',
  occupancyEndAt: '2026-09-20T13:10:00.000Z',
  localStart: '09:00',
  localServiceEnd: '10:00',
  timezone: 'America/Sao_Paulo',
  status: 'CONFIRMED',
  durationMinutes: 60,
  priceCents: 5000,
  notes: null,
  professional: { id: 'professional_1', name: 'Ana' },
  service: { id: 'service_1', name: 'Corte' },
  consumer: { id: 'consumer_1', name: 'Maria', whatsapp: '(11) 90000-0000' },
  unitId: 'unit_1',
  createdAt: '2026-09-19T12:00:00.000Z',
};

const CAMINHO = '/tenants/tenant_a/appointments';
const CAMINHO_CLIENTES = '/tenants/tenant_a/consumers';

const CORPO_VALIDO = {
  professionalId: 'professional_1',
  serviceId: 'service_1',
  startAt: '2026-09-20T12:00:00.000Z',
  consumer: { mode: 'existing', consumerId: 'consumer_1' },
};

describe('rotas de agendamento (e2e)', () => {
  let app: INestApplication<App>;
  let createMock: ReturnType<typeof vi.fn>;
  let listMock: ReturnType<typeof vi.fn>;
  let getMock: ReturnType<typeof vi.fn>;
  let searchConsumersMock: ReturnType<typeof vi.fn>;
  let createConsumerMock: ReturnType<typeof vi.fn>;
  let guardMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    createMock = vi.fn().mockResolvedValue(AGENDAMENTO);
    listMock = vi.fn().mockResolvedValue({
      timezone: 'America/Sao_Paulo',
      date: '2026-09-20',
      appointments: [AGENDAMENTO],
    });
    getMock = vi.fn().mockResolvedValue(AGENDAMENTO);
    searchConsumersMock = vi.fn().mockResolvedValue([]);
    createConsumerMock = vi
      .fn()
      .mockResolvedValue({ id: 'consumer_1', name: 'Maria', whatsapp: '(11) 90000-0000', email: null });

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
      .overrideProvider(AppointmentsService)
      .useValue({ create: createMock, list: listMock, get: getMock })
      .overrideProvider(ConsumersService)
      .useValue({ search: searchConsumersMock, create: createConsumerMock })
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

  it('POST cria e repassa o userId provado pelo guard', async () => {
    const resposta = await request(app.getHttpServer()).post(CAMINHO).send(CORPO_VALIDO).expect(201);

    expect(resposta.body.appointment.id).toBe('appointment_1');
    expect(createMock).toHaveBeenCalledWith('user_1', 'tenant_a', CORPO_VALIDO);
  });

  it('GET lista por data e devolve o fuso do estabelecimento', async () => {
    const resposta = await request(app.getHttpServer())
      .get(CAMINHO)
      .query({ date: '2026-09-20' })
      .expect(200);

    expect(resposta.body.timezone).toBe('America/Sao_Paulo');
    expect(resposta.body.appointments).toHaveLength(1);
    expect(listMock).toHaveBeenCalledWith('user_1', 'tenant_a', { date: '2026-09-20' });
  });

  it('GET de um agendamento devolve o detalhe', async () => {
    const resposta = await request(app.getHttpServer()).get(`${CAMINHO}/appointment_1`).expect(200);

    expect(resposta.body.appointment.id).toBe('appointment_1');
    expect(getMock).toHaveBeenCalledWith('user_1', 'tenant_a', 'appointment_1');
  });

  it('nenhuma rota existe sem sessão — o guard recusa antes do serviço', async () => {
    guardMock.mockImplementation(() => {
      throw new UnauthorizedException('Não autenticado.');
    });

    await request(app.getHttpServer()).post(CAMINHO).send(CORPO_VALIDO).expect(401);
    await request(app.getHttpServer()).get(CAMINHO).query({ date: '2026-09-20' }).expect(401);
    await request(app.getHttpServer()).get(CAMINHO_CLIENTES).query({ q: 'ma' }).expect(401);

    expect(createMock).not.toHaveBeenCalled();
    expect(listMock).not.toHaveBeenCalled();
  });

  it('sem vínculo vira 404 e sem permissão vira 403', async () => {
    createMock.mockRejectedValueOnce(new NotFoundException('Estabelecimento não encontrado.'));
    await request(app.getHttpServer()).post(CAMINHO).send(CORPO_VALIDO).expect(404);

    createMock.mockRejectedValueOnce(new ForbiddenException('Sem permissão.'));
    await request(app.getHttpServer()).post(CAMINHO).send(CORPO_VALIDO).expect(403);
  });

  it('conflito de horário vira 409, sem expor SQL nem nome de constraint', async () => {
    createMock.mockRejectedValueOnce(
      new ConflictException('Este horário acabou de ser ocupado. Consulte os horários disponíveis novamente.'),
    );

    const resposta = await request(app.getHttpServer()).post(CAMINHO).send(CORPO_VALIDO).expect(409);

    const corpo = JSON.stringify(resposta.body);
    expect(corpo).not.toMatch(/INSERT|SELECT|tstzrange|_excl|23P01/i);
    expect(resposta.body.message).toContain('horário');
  });

  it('horário que nunca foi válido vira 400, não 409', async () => {
    createMock.mockRejectedValueOnce(new BadRequestException('Este horário não está disponível.'));
    await request(app.getHttpServer()).post(CAMINHO).send(CORPO_VALIDO).expect(400);
  });

  it.each([
    ['sem profissional', { ...CORPO_VALIDO, professionalId: undefined }],
    ['sem serviço', { ...CORPO_VALIDO, serviceId: undefined }],
    ['sem cliente', { ...CORPO_VALIDO, consumer: undefined }],
    ['início sem fuso', { ...CORPO_VALIDO, startAt: '2026-09-20T09:00:00' }],
    ['preço enviado pelo navegador', { ...CORPO_VALIDO, priceCents: 1 }],
    ['status enviado pelo navegador', { ...CORPO_VALIDO, status: 'COMPLETED' }],
    ['fim enviado pelo navegador', { ...CORPO_VALIDO, endAt: '2026-09-20T23:00:00.000Z' }],
  ])('corpo inválido (%s) é 400 e nunca chega no serviço', async (_rotulo, corpo) => {
    await request(app.getHttpServer()).post(CAMINHO).send(corpo).expect(400);
    expect(createMock).not.toHaveBeenCalled();
  });

  it.each([
    ['sem data', {}],
    ['data fora do formato', { date: '20/09/2026' }],
    ['data inexistente', { date: '2026-02-30' }],
    ['parâmetro desconhecido', { date: '2026-09-20', tenantId: 'outro' }],
  ])('query inválida na listagem (%s) é 400', async (_rotulo, query) => {
    await request(app.getHttpServer())
      .get(CAMINHO)
      .query(query as Record<string, string>)
      .expect(400);
    expect(listMock).not.toHaveBeenCalled();
  });

  it('não existe rota de cancelamento, remarcação ou mudança de status neste lote', async () => {
    await request(app.getHttpServer()).delete(`${CAMINHO}/appointment_1`).expect(404);
    await request(app.getHttpServer()).patch(`${CAMINHO}/appointment_1`).send({}).expect(404);
    await request(app.getHttpServer()).put(`${CAMINHO}/appointment_1`).send({}).expect(404);
    await request(app.getHttpServer())
      .post(`${CAMINHO}/appointment_1/status`)
      .send({ status: 'CANCELED' })
      .expect(404);
  });
});

describe('rotas de clientes (e2e)', () => {
  let app: INestApplication<App>;
  let searchMock: ReturnType<typeof vi.fn>;
  let createMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    searchMock = vi.fn().mockResolvedValue([
      { id: 'consumer_1', name: 'Maria', whatsapp: '(11) 90000-0000', email: null },
    ]);
    createMock = vi
      .fn()
      .mockResolvedValue({ id: 'consumer_2', name: 'João', whatsapp: '(11) 98888-7777', email: null });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DataSource)
      .useValue(FAKE_DATA_SOURCE)
      .overrideProvider(ConsumersService)
      .useValue({ search: searchMock, create: createMock })
      .overrideGuard(SessionGuard)
      .useValue({
        canActivate: (context: { switchToHttp: () => { getRequest: () => Record<string, unknown> } }) => {
          context.switchToHttp().getRequest().auth = FAKE_IDENTITY_CONTEXT;
          return true;
        },
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET busca por termo', async () => {
    const resposta = await request(app.getHttpServer())
      .get(CAMINHO_CLIENTES)
      .query({ q: 'Maria' })
      .expect(200);

    expect(resposta.body.consumers).toHaveLength(1);
    expect(searchMock).toHaveBeenCalledWith('user_1', 'tenant_a', 'Maria');
  });

  it('busca sem termo é 400 — a rota nunca lista a base inteira', async () => {
    await request(app.getHttpServer()).get(CAMINHO_CLIENTES).expect(400);
    expect(searchMock).not.toHaveBeenCalled();
  });

  it('POST cadastra o cliente mínimo', async () => {
    const resposta = await request(app.getHttpServer())
      .post(CAMINHO_CLIENTES)
      .send({ name: 'João', whatsapp: '(11) 98888-7777' })
      .expect(201);

    expect(resposta.body.consumer.id).toBe('consumer_2');
  });

  it.each([
    ['senha', { name: 'João', whatsapp: '(11) 98888-7777', password: 'x' }],
    ['papel', { name: 'João', whatsapp: '(11) 98888-7777', role: 'DONO' }],
  ])('cadastro com %s é 400 — cliente nunca vira usuário', async (_rotulo, corpo) => {
    await request(app.getHttpServer()).post(CAMINHO_CLIENTES).send(corpo).expect(400);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('não existe rota de listagem completa de clientes', async () => {
    await request(app.getHttpServer()).delete(`${CAMINHO_CLIENTES}/consumer_1`).expect(404);
    await request(app.getHttpServer()).patch(`${CAMINHO_CLIENTES}/consumer_1`).send({}).expect(404);
  });
});
