// E2E HTTP das rotas de Web Push dentro do AppModule real — sem banco
// (`DataSource` falso, serviço substituído). Prova a camada HTTP: sessão
// obrigatória, proteção de origem (CSRF), corpo só JSON e validação estrita
// (campo desconhecido recusado, endpoint nunca na URL).
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, UnauthorizedException } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { DataSource } from 'typeorm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { SessionGuard } from '../src/auth/session.guard.js';
import { PushService } from '../src/push/push.service.js';

const FAKE_DATA_SOURCE = { isInitialized: false, destroy: async () => {} } as unknown as DataSource;
const FRONT = 'http://localhost:3000';
const INSCRICAO = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
  expirationTime: null,
  keys: { p256dh: 'BPublica', auth: 'segredo' },
};

describe('rotas de Web Push (e2e)', () => {
  let app: INestApplication<App>;
  let servico: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    servico = {
      configuracao: vi.fn().mockReturnValue({ enabled: true, publicKey: 'BChavePublica' }),
      ativar: vi.fn().mockResolvedValue({ active: true }),
      estado: vi.fn().mockResolvedValue({ active: false }),
      desativar: vi.fn().mockResolvedValue({ active: false }),
    };
    const guard = vi.fn().mockImplementation((context) => {
      const req = context.switchToHttp().getRequest();
      if (!req.cookies?.sessao) throw new UnauthorizedException();
      req.auth = { userId: 'user_1', sessionId: 'session_1' };
      return true;
    });
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(FAKE_DATA_SOURCE)
      .overrideProvider(PushService)
      .useValue(servico)
      .overrideGuard(SessionGuard)
      .useValue({ canActivate: guard })
      .compile();
    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('sem sessão: 401 em todas as rotas', async () => {
    const http = request(app.getHttpServer());
    await http.get('/push/config').expect(401);
    await http.put('/tenants/t1/push-subscription').set('Origin', FRONT).send(INSCRICAO).expect(401);
    await http.delete('/tenants/t1/push-subscription').set('Origin', FRONT).send({ endpoint: INSCRICAO.endpoint }).expect(401);
    expect(servico.ativar).not.toHaveBeenCalled();
  });

  it('configuração entrega só a chave pública', async () => {
    const r = await request(app.getHttpServer()).get('/push/config').set('Cookie', 'sessao=1').expect(200);
    expect(r.body).toEqual({ push: { enabled: true, publicKey: 'BChavePublica' } });
  });

  it('ativar: origem do próprio frontend e JSON; identidade vem da sessão, nunca do corpo', async () => {
    const r = await request(app.getHttpServer())
      .put('/tenants/t1/push-subscription')
      .set('Cookie', 'sessao=1')
      .set('Origin', FRONT)
      .send(INSCRICAO)
      .expect(200);
    expect(r.body).toEqual({ subscription: { active: true } });
    expect(servico.ativar).toHaveBeenCalledWith({ userId: 'user_1', sessionId: 'session_1' }, 't1', INSCRICAO);
  });

  it('CSRF: outro site, cross-site ou corpo que não é JSON são recusados antes do serviço', async () => {
    const http = request(app.getHttpServer());
    await http
      .put('/tenants/t1/push-subscription')
      .set('Cookie', 'sessao=1')
      .set('Origin', 'https://evil.example')
      .send(INSCRICAO)
      .expect(403);
    await http
      .post('/tenants/t1/push-subscription/status')
      .set('Cookie', 'sessao=1')
      .set('Sec-Fetch-Site', 'cross-site')
      .send({ endpoint: INSCRICAO.endpoint })
      .expect(403);
    await http
      .delete('/tenants/t1/push-subscription')
      .set('Cookie', 'sessao=1')
      .set('Origin', FRONT)
      .set('Content-Type', 'text/plain')
      .send(JSON.stringify({ endpoint: INSCRICAO.endpoint }))
      .expect(415);
    expect(servico.ativar).not.toHaveBeenCalled();
    expect(servico.estado).not.toHaveBeenCalled();
    expect(servico.desativar).not.toHaveBeenCalled();
  });

  it('validação estrita: campo desconhecido, sem chaves ou endpoint grande demais → 400 sem eco', async () => {
    const http = request(app.getHttpServer());
    for (const corpo of [
      { ...INSCRICAO, userId: 'outro' },
      { endpoint: INSCRICAO.endpoint },
      { ...INSCRICAO, endpoint: `https://fcm.googleapis.com/${'a'.repeat(2100)}` },
    ]) {
      const r = await http
        .put('/tenants/t1/push-subscription')
        .set('Cookie', 'sessao=1')
        .set('Origin', FRONT)
        .send(corpo)
        .expect(400);
      expect(JSON.stringify(r.body)).not.toContain('fcm.googleapis.com');
    }
    expect(servico.ativar).not.toHaveBeenCalled();
  });

  it('estado e desativar recebem o endpoint no corpo', async () => {
    const http = request(app.getHttpServer());
    await http
      .post('/tenants/t1/push-subscription/status')
      .set('Cookie', 'sessao=1')
      .set('Origin', FRONT)
      .send({ endpoint: INSCRICAO.endpoint })
      .expect(200, { subscription: { active: false } });
    await http
      .delete('/tenants/t1/push-subscription')
      .set('Cookie', 'sessao=1')
      .set('Origin', FRONT)
      .send({ endpoint: INSCRICAO.endpoint })
      .expect(200);
    expect(servico.desativar).toHaveBeenCalledWith({ userId: 'user_1', sessionId: 'session_1' }, 't1', INSCRICAO.endpoint);
  });
});
