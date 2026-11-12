// Segundo fator pela API HTTP, sem banco: o guard REAL do segundo fator
// roda em TODA rota registrada sob `/platform` (lida dos controllers pela
// metadata do Nest, não de uma lista escrita à mão), com os fatos da sessão
// vindos de um DataSource falso. Prova que a etapa da senha sozinha nunca
// chega a uma ação administrativa por chamada direta à API, e que as rotas do
// próprio segundo fator têm corpo estrito, origem conferida e só JSON.
import { globSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import cookieParser from 'cookie-parser';
import { RequestMethod, type INestApplication } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module.js';
import { SessionGuard } from '../src/auth/session.guard.js';
import { ROTAS_SEM_SEGUNDO_FATOR } from '../src/second-factor/second-factor.guard.js';
import { SecondFactorService } from '../src/second-factor/second-factor.service.js';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');

interface Rota {
  metodo: string;
  caminho: string;
}

async function rotasDePlataforma(): Promise<Rota[]> {
  const rotas: Rota[] = [];
  for (const arquivo of globSync('**/*.controller.ts', { cwd: SRC })) {
    const modulo = (await import(pathToFileURL(path.join(SRC, arquivo)).href)) as Record<string, unknown>;
    for (const valor of Object.values(modulo)) {
      if (typeof valor !== 'function') continue;
      const base = Reflect.getMetadata(PATH_METADATA, valor) as string | undefined;
      if (typeof base !== 'string' || !base.startsWith('platform')) continue;
      const proto = (valor as { prototype: Record<string, unknown> }).prototype;
      for (const nome of Object.getOwnPropertyNames(proto)) {
        const handler = proto[nome];
        if (nome === 'constructor' || typeof handler !== 'function') continue;
        const sub = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
        const metodo = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
        if (sub === undefined || metodo === undefined) continue;
        const caminho = `/${base}/${sub}`.replace(/\/+/g, '/').replace(/\/$/, '');
        rotas.push({ metodo: RequestMethod[metodo], caminho });
      }
    }
  }
  return rotas;
}

const preencher = (caminho: string) => caminho.replace(/:[A-Za-z]+/g, 'valor_ficticio_1');

describe('segundo fator — HTTP (guard real, sem banco)', () => {
  let app: INestApplication;
  let linha: Record<string, unknown>;
  const service = {
    status: vi.fn(),
    verify: vi.fn(),
    recover: vi.fn(),
    redeemGrant: vi.fn(),
    startEnrollment: vi.fn(),
    confirmEnrollment: vi.fn(),
    regenerateRecoveryCodes: vi.fn(),
    issueGrant: vi.fn(),
  };

  const fatos = (extra: Record<string, unknown>) => ({
    name: 'Pessoa fictícia',
    email: 'pessoa@example.test',
    email_verified: true,
    status: 'ACTIVE',
    platform_role: 'MASTER_OWNER',
    second_factor_enrollment_required: false,
    second_factor_verified_at: null,
    second_factor_enrollment_allowed_until: null,
    reauthenticated_at: null,
    expires_at: new Date(Date.now() + 86_400_000),
    factor_active: true,
    grant_pending: false,
    ...extra,
  });

  beforeAll(async () => {
    for (const fn of Object.values(service)) fn.mockResolvedValue({ ok: true });
    const query = vi.fn(async () => [linha]);
    const modulo = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue({ isInitialized: false, manager: { query } })
      .overrideProvider(SecondFactorService)
      .useValue(service)
      .overrideGuard(SessionGuard)
      .useValue({
        canActivate: (context: { switchToHttp: () => { getRequest: () => Record<string, unknown> } }) => {
          context.switchToHttp().getRequest().auth = { userId: 'conta_ficticia', sessionId: 'sessao_ficticia' };
          return true;
        },
      })
      .compile();
    app = modulo.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('a lista de rotas de plataforma foi lida dos controllers (não está vazia)', async () => {
    const rotas = await rotasDePlataforma();
    expect(rotas.length).toBeGreaterThan(40);
    expect(rotas).toContainEqual({ metodo: 'POST', caminho: '/platform/users/:userId/second-factor/grants' });
    expect(rotas).toContainEqual({ metodo: 'GET', caminho: '/platform/reports' });
  });

  it('fator ativo e sessão só com senha: TODA rota de plataforma responde 403 SEGUNDO_FATOR_NECESSARIO', async () => {
    linha = fatos({});
    const rotas = (await rotasDePlataforma()).filter((r) => !ROTAS_SEM_SEGUNDO_FATOR.includes(`${r.metodo} ${r.caminho}`));
    for (const r of rotas) {
      const resposta = await request(app.getHttpServer())
        [r.metodo.toLowerCase() as 'get'](preencher(r.caminho))
        .send({});
      expect(resposta.status, `${r.metodo} ${r.caminho}`).toBe(403);
      expect(resposta.body.code, `${r.metodo} ${r.caminho}`).toBe('SEGUNDO_FATOR_NECESSARIO');
    }
    expect(service.issueGrant).not.toHaveBeenCalled();
  });

  it('verificação vencida (mais de 12 horas) também recusa', async () => {
    linha = fatos({ second_factor_verified_at: new Date(Date.now() - 12 * 3_600_000 - 1000) });
    const r = await request(app.getHttpServer()).get('/platform/overview');
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('SEGUNDO_FATOR_NECESSARIO');
  });

  it('master novo sem fator (mesmo na fase optional): 403 SEGUNDO_FATOR_CADASTRO_NECESSARIO', async () => {
    linha = fatos({ factor_active: false, second_factor_enrollment_required: true });
    for (const caminho of ['/platform/overview', '/platform/users', '/platform/audit']) {
      const r = await request(app.getHttpServer()).get(caminho);
      expect(r.status, caminho).toBe(403);
      expect(r.body.code, caminho).toBe('SEGUNDO_FATOR_CADASTRO_NECESSARIO');
    }
  });

  it('liberação usada nesta sessão permite cadastrar, mas não abre o portal', async () => {
    linha = fatos({ second_factor_enrollment_allowed_until: new Date(Date.now() + 600_000) });
    const r = await request(app.getHttpServer()).get('/platform/users');
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('SEGUNDO_FATOR_NECESSARIO');
  });

  it('sessão revogada no meio do caminho: 401, nunca acesso', async () => {
    linha = undefined as never;
    const r = await request(app.getHttpServer()).get('/platform/overview');
    expect(r.status).toBe(401);
  });

  describe('rotas do próprio segundo fator', () => {
    beforeEach(() => {
      linha = fatos({});
    });

    it('corpo estrito: campo extra ou código ausente nunca chega ao serviço', async () => {
      await request(app.getHttpServer()).post('/auth/second-factor/verify').send({ code: '123456', userId: 'outra' }).expect(400);
      await request(app.getHttpServer()).post('/auth/second-factor/verify').send({}).expect(400);
      await request(app.getHttpServer()).post('/auth/second-factor/enrollment').send({ secret: 'escolhido' }).expect(400);
      await request(app.getHttpServer()).post('/auth/second-factor/grant').send({ token: 'x', userId: 'outra' }).expect(400);
      expect(service.verify).not.toHaveBeenCalled();
      expect(service.startEnrollment).not.toHaveBeenCalled();
      expect(service.redeemGrant).not.toHaveBeenCalled();
    });

    it('origem de outro site e corpo que não é JSON são recusados antes do serviço', async () => {
      await request(app.getHttpServer())
        .post('/auth/second-factor/verify')
        .set('Sec-Fetch-Site', 'cross-site')
        .send({ code: '123456' })
        .expect(403);
      await request(app.getHttpServer())
        .post('/auth/second-factor/verify')
        .set('Origin', 'https://outro-site.example')
        .send({ code: '123456' })
        .expect(403);
      await request(app.getHttpServer())
        .post('/auth/second-factor/verify')
        .set('Content-Type', 'text/plain')
        .send('code=123456')
        .expect(415);
      expect(service.verify).not.toHaveBeenCalled();
    });

    it('identidade e sessão vêm do guard, nunca do corpo; resposta sem cache', async () => {
      const r = await request(app.getHttpServer()).post('/auth/second-factor/verify').send({ code: '123 456' }).expect(200);
      expect(service.verify).toHaveBeenCalledWith('conta_ficticia', 'sessao_ficticia', '123 456');
      expect(r.headers['cache-control']).toBe('private, no-store');
      const s = await request(app.getHttpServer()).get('/auth/second-factor').expect(200);
      expect(s.headers['cache-control']).toBe('private, no-store');
      expect(service.status).toHaveBeenCalledWith('conta_ficticia', 'sessao_ficticia');
    });

    it('as rotas do segundo fator funcionam com a sessão só de senha (são o caminho até o portal)', async () => {
      linha = fatos({ second_factor_enrollment_required: true, factor_active: false });
      await request(app.getHttpServer()).post('/auth/second-factor/enrollment').send({}).expect(200);
      await request(app.getHttpServer()).post('/auth/second-factor/grant').send({ token: 'a'.repeat(64) }).expect(200);
      expect(service.startEnrollment).toHaveBeenCalledWith('conta_ficticia', 'sessao_ficticia', undefined);
    });
  });
});
