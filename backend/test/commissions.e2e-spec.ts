// E2E HTTP da aplicação de comissões em massa dentro do AppModule real (rota
// registrada, DI, guard, pipe e mapeamento de erro para status), no padrão de
// professionals.e2e-spec.ts: `DataSource`, `CommissionsService` e
// `SessionGuard` substituídos. As regras ficam em
// src/commissions/commission-bulk.spec.ts e, contra Postgres real, em
// test/commissions-postgres.db-e2e-spec.ts.
import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, ForbiddenException, INestApplication, NotFoundException } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { DataSource } from 'typeorm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { SessionGuard } from '../src/auth/session.guard.js';
import { CommissionsService } from '../src/commissions/commissions.service.js';

const FAKE_DATA_SOURCE = { isInitialized: false, destroy: async () => {} } as unknown as DataSource;
const IMPRESSAO = 'f'.repeat(64);
const PREVIA = {
  target: 'ALL',
  mode: 'PRESERVE',
  defaultRule: { kind: 'PERCENTAGE', value: 1000 },
  exceptions: 'KEEP',
  fingerprint: IMPRESSAO,
  summary: { change: 1, preserve: 0, unchanged: 0, total: 1, exceptionsRemoved: 0 },
  professionals: [
    {
      professional: { id: 'prof_1', name: 'Ana' },
      current: { receivesCommission: true, defaultRule: null },
      next: { receivesCommission: true, defaultRule: { kind: 'PERCENTAGE', value: 1000 } },
      exceptions: { services: [], removed: false },
      outcome: 'CHANGE',
    },
  ],
};
const CORPO = { target: 'ALL', defaultRule: { kind: 'PERCENTAGE', value: 1000 }, mode: 'PRESERVE' };

describe('rotas da aplicação de comissões em massa (e2e)', () => {
  let app: INestApplication<App>;
  let previewMock: ReturnType<typeof vi.fn>;
  let applyMock: ReturnType<typeof vi.fn>;
  let settingsMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    previewMock = vi.fn().mockResolvedValue(PREVIA);
    applyMock = vi.fn().mockResolvedValue({ ...PREVIA, applied: true, operationId: 'op_1' });
    settingsMock = vi.fn().mockResolvedValue({ ok: true });
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(FAKE_DATA_SOURCE)
      .overrideProvider(CommissionsService)
      .useValue({ previewBulkSettings: previewMock, applyBulkSettings: applyMock, setSettings: settingsMock })
      .overrideGuard(SessionGuard)
      .useValue({
        canActivate: (context: { switchToHttp: () => { getRequest: () => Record<string, unknown> } }) => {
          context.switchToHttp().getRequest().auth = { userId: 'user_1', sessionId: 'session_1' };
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

  it('POST preview responde 200, sem cache, com o userId do guard e o tenant do caminho', async () => {
    const r = await request(app.getHttpServer()).post('/tenants/tenant_a/commissions/bulk-settings/preview').send(CORPO).expect(200);
    expect(r.headers['cache-control']).toBe('private, no-store');
    expect(r.body).toEqual(PREVIA);
    expect(previewMock).toHaveBeenCalledWith('user_1', 'tenant_a', CORPO);
    expect(applyMock).not.toHaveBeenCalled();
  });

  it('POST aplica com a impressão e responde 200', async () => {
    const corpo = { ...CORPO, mode: 'REPLACE', fingerprint: IMPRESSAO, confirmReplace: true };
    const r = await request(app.getHttpServer()).post('/tenants/tenant_a/commissions/bulk-settings').send(corpo).expect(200);
    expect(r.body).toMatchObject({ applied: true, operationId: 'op_1' });
    expect(applyMock).toHaveBeenCalledWith('user_1', 'tenant_a', corpo);
  });

  it.each([
    ['substituir sem confirmação', { ...CORPO, mode: 'REPLACE', fingerprint: IMPRESSAO }],
    ['sem impressão', CORPO],
    ['201 escolhidos', { ...CORPO, target: 'SELECTED', professionalIds: Array.from({ length: 201 }, (_, i) => `p${i}`), fingerprint: IMPRESSAO }],
    ['preservar removendo exceções', { ...CORPO, exceptions: 'REMOVE', confirmRemoveExceptions: true, fingerprint: IMPRESSAO }],
    [
      'remover exceções sem confirmar a remoção',
      { ...CORPO, mode: 'REPLACE', confirmReplace: true, exceptions: 'REMOVE', fingerprint: IMPRESSAO },
    ],
  ])('POST aplicar recusa %s com 400, sem chamar o serviço', async (_nome, corpo) => {
    await request(app.getHttpServer()).post('/tenants/tenant_a/commissions/bulk-settings').send(corpo).expect(400);
    expect(applyMock).not.toHaveBeenCalled();
  });

  it('POST aplica substituindo e removendo exceções, com as duas confirmações', async () => {
    const corpo = { ...CORPO, mode: 'REPLACE', exceptions: 'REMOVE', fingerprint: IMPRESSAO, confirmReplace: true, confirmRemoveExceptions: true };
    await request(app.getHttpServer()).post('/tenants/tenant_a/commissions/bulk-settings').send(corpo).expect(200);
    expect(applyMock).toHaveBeenCalledWith('user_1', 'tenant_a', corpo);
  });

  it('PUT da configuração individual: remover exceções exige regra geral, impressão e confirmação', async () => {
    const caminho = '/tenants/tenant_a/commissions/settings/prof_1';
    const remover = {
      receivesCommission: true,
      defaultRule: { kind: 'PERCENTAGE', value: 2000 },
      exceptions: 'REMOVE',
      exceptionsFingerprint: IMPRESSAO,
      confirmRemoveExceptions: true,
    };
    for (const invalido of [
      { ...remover, confirmRemoveExceptions: undefined },
      { ...remover, exceptionsFingerprint: undefined },
      { ...remover, defaultRule: null },
    ]) {
      await request(app.getHttpServer()).put(caminho).send(invalido).expect(400);
    }
    expect(settingsMock).not.toHaveBeenCalled();
    await request(app.getHttpServer()).put(caminho).send(remover).expect(200);
    expect(settingsMock).toHaveBeenCalledWith('user_1', 'tenant_a', 'prof_1', remover);
    settingsMock.mockRejectedValueOnce(new ConflictException({ code: 'EXCECOES_DESATUALIZADAS', message: 'As exceções mudaram.' }));
    const r = await request(app.getHttpServer()).put(caminho).send(remover).expect(409);
    expect(r.body.code).toBe('EXCECOES_DESATUALIZADAS');
  });

  it('POST preview recusa corpo inválido com 400', async () => {
    await request(app.getHttpServer())
      .post('/tenants/tenant_a/commissions/bulk-settings/preview')
      .send({ ...CORPO, target: 'SELECTED' })
      .expect(400);
    expect(previewMock).not.toHaveBeenCalled();
  });

  it.each([
    ['403', new ForbiddenException('Você não tem permissão para configurar as comissões deste estabelecimento.'), 403, undefined],
    ['404', new NotFoundException('Profissional não encontrado.'), 404, undefined],
    [
      '409 com code',
      new ConflictException({ code: 'PREVIA_DESATUALIZADA', message: 'As comissões mudaram desde a prévia.' }),
      409,
      'PREVIA_DESATUALIZADA',
    ],
  ])('erro de domínio %s vira o status certo', async (_nome, erro, status, code) => {
    applyMock.mockRejectedValueOnce(erro);
    const r = await request(app.getHttpServer())
      .post('/tenants/tenant_a/commissions/bulk-settings')
      .send({ ...CORPO, fingerprint: IMPRESSAO })
      .expect(status);
    if (code) expect(r.body.code).toBe(code);
  });
});
