// Rotas da gestão de contas pelo HTTP real do Nest, com os serviços
// substituídos: prova sessão obrigatória, identidade vinda do guard,
// validação estrita (campos forjados nunca chegam ao serviço) e o cookie só
// depois de um aceite bem-sucedido.
import { Test } from '@nestjs/testing';
import { GoneException, UnauthorizedException, type INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { SessionGuard } from '../src/auth/session.guard.js';
import { AccountsAdminService } from '../src/accounts/accounts-admin.service.js';
import { AccountsDirectoryService } from '../src/accounts/accounts-directory.service.js';
import { InvitesService } from '../src/accounts/invites.service.js';
import { PasswordResetsService } from '../src/accounts/password-resets.service.js';

const TOKEN = 'a'.repeat(64);
const KEY = 'chave-do-formulario-0001';

describe('gestão de contas — HTTP', () => {
  let app: INestApplication;
  const guard = { canActivate: vi.fn() };
  const directory = {
    roles: vi.fn(),
    plans: vi.fn(),
    establishmentOptions: vi.fn(),
    listUsers: vi.fn(),
    userDetail: vi.fn(),
    establishmentMembers: vi.fn(),
    listInvites: vi.fn(),
    listAudit: vi.fn(),
  };
  const admin = {
    updateUser: vi.fn(),
    block: vi.fn(),
    reactivate: vi.fn(),
    setPlatformAccess: vi.fn(),
    removeMembership: vi.fn(),
    setDeniedPermissions: vi.fn(),
    reauthenticate: vi.fn(),
  };
  const invites = {
    createEstablishment: vi.fn(),
    inviteMember: vi.fn(),
    invitePlatform: vi.fn(),
    findByRequestKey: vi.fn(),
    resend: vi.fn(),
    revoke: vi.fn(),
    preview: vi.fn(),
    accept: vi.fn(),
  };
  const resets = { request: vi.fn(), findByRequestKey: vi.fn(), preview: vi.fn(), complete: vi.fn() };

  beforeEach(async () => {
    vi.resetAllMocks();
    guard.canActivate.mockImplementation((context) => {
      context.switchToHttp().getRequest().auth = { userId: 'proven_user', sessionId: 'proven_session' };
      return true;
    });
    for (const fn of [...Object.values(directory), ...Object.values(admin), ...Object.values(invites), ...Object.values(resets)]) {
      fn.mockResolvedValue({ ok: true });
    }
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue({ isInitialized: false })
      .overrideProvider(AccountsDirectoryService)
      .useValue(directory)
      .overrideProvider(AccountsAdminService)
      .useValue(admin)
      .overrideProvider(InvitesService)
      .useValue(invites)
      .overrideProvider(PasswordResetsService)
      .useValue(resets)
      .overrideGuard(SessionGuard)
      .useValue(guard)
      .compile();
    app = module.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });
  afterEach(async () => {
    await app.close();
  });

  const server = () => app.getHttpServer();

  it('sem sessão, nenhuma rota da administração chega ao serviço', async () => {
    guard.canActivate.mockImplementation(() => {
      throw new UnauthorizedException();
    });
    await request(server()).get('/platform/users').expect(401);
    await request(server()).get('/platform/invites').expect(401);
    await request(server()).get('/platform/audit').expect(401);
    await request(server()).post('/platform/reauth').send({ password: 'senha-qualquer-1' }).expect(401);
    await request(server()).post('/platform/users/u1/block').send({ expectedUpdatedAt: new Date().toISOString() }).expect(401);
    expect(directory.listUsers).not.toHaveBeenCalled();
    expect(admin.block).not.toHaveBeenCalled();
  });

  it('identidade e sessão vêm do guard, nunca do corpo', async () => {
    const quando = new Date().toISOString();
    await request(server())
      .post('/platform/users/alvo/block')
      .send({ expectedUpdatedAt: quando })
      .expect(200)
      .expect('Cache-Control', 'private, no-store');
    expect(admin.block).toHaveBeenCalledWith('proven_user', 'proven_session', 'alvo', { expectedUpdatedAt: quando });
    await request(server()).post('/platform/users/alvo/block').send({ expectedUpdatedAt: quando, userId: 'outro' }).expect(400);
  });

  it('recusa campos forjados, papéis sem efeito e permissões que não liberam nada', async () => {
    const base = { requestKey: KEY, name: 'Pessoa Teste', email: 'pessoa@example.test' };
    await request(server()).post('/platform/establishments/t1/invites').send({ ...base, role: 'GERENTE' }).expect(400);
    await request(server()).post('/platform/establishments/t1/invites').send({ ...base, role: 'DONO', platformRole: 'MASTER_OWNER' }).expect(400);
    await request(server()).post('/platform/establishments/t1/invites').send({ ...base, role: 'DONO', email: 'sem-arroba' }).expect(400);
    await request(server())
      .post('/platform/invites')
      .send({ ...base, platformRole: 'MASTER_ADMIN', permissions: ['SUPPORT_ACCESS'] })
      .expect(400);
    await request(server())
      .put('/platform/users/u1/platform-access')
      .send({ expectedUpdatedAt: new Date().toISOString(), role: 'MASTER_ADMIN', permissions: ['PLANS_MANAGE'] })
      .expect(400);
    await request(server())
      .put('/platform/memberships/m1/denied-permissions')
      .send({ expectedDenied: [], denied: ['DASHBOARD_VISUALIZAR'] })
      .expect(400);
    expect(invites.inviteMember).not.toHaveBeenCalled();
    expect(invites.invitePlatform).not.toHaveBeenCalled();
    expect(admin.setPlatformAccess).not.toHaveBeenCalled();
    expect(admin.setDeniedPermissions).not.toHaveBeenCalled();

    await request(server()).post('/platform/establishments/t1/invites').send({ ...base, role: 'DONO', email: ' Pessoa@Example.TEST ' }).expect(200);
    expect(invites.inviteMember).toHaveBeenCalledWith('proven_user', 't1', { ...base, role: 'DONO', email: 'pessoa@example.test' });
  });

  it('consulta de formulário perdido: 404 quando nada foi criado', async () => {
    invites.findByRequestKey.mockResolvedValue(null);
    resets.findByRequestKey.mockResolvedValue(null);
    await request(server()).get(`/platform/requests/${KEY}`).expect(404);
    invites.findByRequestKey.mockResolvedValue({ created: false, invite: { id: 'i1' } });
    const resposta = await request(server()).get(`/platform/requests/${KEY}`).expect(200);
    expect(resposta.body).toMatchObject({ kind: 'invite', created: false });
  });

  it('aceite: token no corpo, cookie só depois do sucesso, nunca na falha', async () => {
    await request(server()).post('/invites/accept').send({ token: 'curto', password: 'senha-forte-123' }).expect(400);
    invites.accept.mockRejectedValue(new GoneException({ code: 'CONVITE_EXPIRED' }));
    const falha = await request(server()).post('/invites/accept').send({ token: TOKEN, password: 'senha-forte-123' }).expect(410);
    expect(falha.headers['set-cookie']).toBeUndefined();
    invites.accept.mockResolvedValue({ sessionToken: 'b'.repeat(64), userId: 'u1', destination: '/conta/visao-geral' });
    const ok = await request(server()).post('/invites/accept').send({ token: TOKEN, password: 'senha-forte-123' }).expect(200);
    expect(ok.body).toEqual({ destination: '/conta/visao-geral' });
    expect(String(ok.headers['set-cookie'])).toContain('session_token=');
    expect(JSON.stringify(ok.body)).not.toContain('b'.repeat(64));
  });

  it('redefinição: consulta não consome, conclusão sem sessão', async () => {
    await request(server()).post('/password-resets/preview').send({ token: TOKEN }).expect(200);
    expect(resets.preview).toHaveBeenCalledWith(TOKEN);
    const ok = await request(server()).post('/password-resets/complete').send({ token: TOKEN, password: 'senha-nova-123' }).expect(204);
    expect(ok.headers['set-cookie']).toBeUndefined();
  });
});
