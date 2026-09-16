// E2E HTTP das rotas de horários semanais dentro do AppModule real (prova
// que o controller está registrado e a DI resolve de ponta a ponta) — mesmo
// padrão de professionals.e2e-spec.ts: `DataSource` substituído ANTES de
// `.compile()` (nunca abre socket), e serviço/guard substituídos porque a
// lógica deles já é coberta em src/professionals/working-hours*.spec.ts e
// contra Postgres real no arquivo db-e2e. Aqui se testa só a camada HTTP:
// rota, guard, pipe de validação e mapeamento de erro para status.
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
import { ProfessionalWorkingHoursService } from '../src/professionals/working-hours.service.js';

const FAKE_DATA_SOURCE = {
  isInitialized: false,
  destroy: async () => {},
} as unknown as DataSource;

const FAKE_IDENTITY_CONTEXT = { userId: 'user_1', sessionId: 'session_1' };

const SEMANA = {
  timezone: 'America/Sao_Paulo',
  days: [
    {
      weekday: 1,
      intervals: [
        { start: '09:00', end: '12:00' },
        { start: '13:00', end: '18:00' },
      ],
    },
  ],
};

const CAMINHO = '/tenants/tenant_a/professionals/professional_1/schedule';
const CORPO_VALIDO = { days: [{ weekday: 1, intervals: [{ start: '09:00', end: '18:00' }] }] };

describe('rotas de horários semanais (e2e)', () => {
  let app: INestApplication<App>;
  let getMock: ReturnType<typeof vi.fn>;
  let replaceMock: ReturnType<typeof vi.fn>;
  let guardMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    getMock = vi.fn().mockResolvedValue(SEMANA);
    replaceMock = vi.fn().mockResolvedValue(SEMANA);
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
      .overrideProvider(ProfessionalWorkingHoursService)
      .useValue({ get: getMock, replace: replaceMock })
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

  it('GET devolve a semana e o fuso, repassando o userId provado pelo guard', async () => {
    const resposta = await request(app.getHttpServer()).get(CAMINHO).expect(200);

    expect(resposta.body.schedule.timezone).toBe('America/Sao_Paulo');
    expect(resposta.body.schedule.days[0].intervals).toHaveLength(2);
    expect(getMock).toHaveBeenCalledWith('user_1', 'tenant_a', 'professional_1');
  });

  it('PUT substitui a semana e devolve 200', async () => {
    await request(app.getHttpServer()).put(CAMINHO).send(CORPO_VALIDO).expect(200);

    expect(replaceMock).toHaveBeenCalledWith('user_1', 'tenant_a', 'professional_1', CORPO_VALIDO);
  });

  it('PUT com semana vazia é válido — significa "não atende em nenhum dia"', async () => {
    await request(app.getHttpServer()).put(CAMINHO).send({ days: [] }).expect(200);

    expect(replaceMock).toHaveBeenCalledWith('user_1', 'tenant_a', 'professional_1', { days: [] });
  });

  it('nenhuma rota de horário existe sem sessão — o guard recusa antes do serviço', async () => {
    guardMock.mockImplementation(() => {
      throw new UnauthorizedException('Não autenticado.');
    });

    await request(app.getHttpServer()).get(CAMINHO).expect(401);
    await request(app.getHttpServer()).put(CAMINHO).send(CORPO_VALIDO).expect(401);

    expect(getMock).not.toHaveBeenCalled();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('sem vínculo vira 404, sem permissão vira 403 e regra de horário vira 400', async () => {
    getMock.mockRejectedValueOnce(new NotFoundException('Estabelecimento não encontrado.'));
    await request(app.getHttpServer())
      .get('/tenants/tenant_alheio/professionals/professional_1/schedule')
      .expect(404);

    replaceMock.mockRejectedValueOnce(new ForbiddenException('Sem permissão.'));
    await request(app.getHttpServer()).put(CAMINHO).send(CORPO_VALIDO).expect(403);

    getMock.mockRejectedValueOnce(new NotFoundException('Profissional não encontrado.'));
    await request(app.getHttpServer())
      .get('/tenants/tenant_a/professionals/professional_de_outro/schedule')
      .expect(404);

    replaceMock.mockRejectedValueOnce(new BadRequestException('Em segunda-feira, ... se sobrepõem.'));
    await request(app.getHttpServer()).put(CAMINHO).send(CORPO_VALIDO).expect(400);
  });

  it.each([
    ['hora sem zero à esquerda', { days: [{ weekday: 1, intervals: [{ start: '9:00', end: '18:00' }] }] }],
    ['hora inexistente', { days: [{ weekday: 1, intervals: [{ start: '24:00', end: '25:00' }] }] }],
    ['minuto inválido', { days: [{ weekday: 1, intervals: [{ start: '09:60', end: '18:00' }] }] }],
    ['dia fora da semana', { days: [{ weekday: 7, intervals: [] }] }],
    ['dia negativo', { days: [{ weekday: -1, intervals: [] }] }],
    ['dia fracionado', { days: [{ weekday: 1.5, intervals: [] }] }],
    ['days ausente', {}],
    ['days não-lista', { days: 'segunda' }],
  ])('corpo inválido (%s) é 400 antes de chegar no serviço', async (_rotulo, corpo) => {
    await request(app.getHttpServer()).put(CAMINHO).send(corpo).expect(400);
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it.each(['tenantId', 'professionalId', 'id', 'active'])(
    'recusa %s no corpo — campo de propriedade/autorização nunca vem do cliente',
    async (campo) => {
      await request(app.getHttpServer())
        .put(CAMINHO)
        .send({ ...CORPO_VALIDO, [campo]: 'forjado' })
        .expect(400);

      expect(replaceMock).not.toHaveBeenCalled();
    },
  );

  it('recusa campo desconhecido dentro do dia e dentro do intervalo', async () => {
    await request(app.getHttpServer())
      .put(CAMINHO)
      .send({ days: [{ weekday: 1, intervals: [], unitId: 'forjado' }] })
      .expect(400);

    await request(app.getHttpServer())
      .put(CAMINHO)
      .send({ days: [{ weekday: 1, intervals: [{ start: '09:00', end: '18:00', tenantId: 'x' }] }] })
      .expect(400);

    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('a mensagem de erro de validação nunca ecoa o valor recebido', async () => {
    const resposta = await request(app.getHttpServer())
      .put(CAMINHO)
      .send({ ...CORPO_VALIDO, tenantId: 'tenant-secreto-forjado' })
      .expect(400);

    expect(JSON.stringify(resposta.body)).not.toContain('tenant-secreto-forjado');
  });

  it('não existe exclusão física de horários por rota própria', async () => {
    await request(app.getHttpServer()).delete(CAMINHO).expect(404);
  });
});
