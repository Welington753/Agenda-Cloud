// "Equipe e acessos" e agenda do funcionário pela camada HTTP: identidade só
// do guard, corpo forjado recusado antes do serviço, rotas sem cache. As
// regras (vínculo, vaga, profissional) são provadas contra PostgreSQL em
// team-access-postgres.db-e2e-spec.ts.
import { Test } from '@nestjs/testing';
import { UnauthorizedException, type INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { SessionGuard } from '../src/auth/session.guard.js';
import { TeamService } from '../src/team/team.service.js';
import { MyAgendaService } from '../src/team/my-agenda.service.js';
import { InvitesService } from '../src/accounts/invites.service.js';
import { EstablishmentAdminService } from '../src/platform/establishment-admin.service.js';

const CHAVE = 'chave-de-formulario-0001';
const INSTANTE = '2026-10-27T13:00:00.000Z';

describe('equipe e agenda do funcionário — HTTP', () => {
  let app: INestApplication;
  const guard = { canActivate: vi.fn() };
  const team = { overview: vi.fn(), suspend: vi.fn(), reactivate: vi.fn(), remove: vi.fn(), setPermissions: vi.fn() };
  const agenda = { day: vi.fn(), changeOwnStatus: vi.fn() };
  const invites = { inviteStaff: vi.fn(), resendStaff: vi.fn(), revokeStaff: vi.fn() };
  const establishments = { update: vi.fn(), suspend: vi.fn(), archive: vi.fn(), reactivate: vi.fn(), changePlan: vi.fn() };

  beforeEach(async () => {
    vi.resetAllMocks();
    guard.canActivate.mockImplementation((context) => {
      context.switchToHttp().getRequest().auth = { userId: 'proven_user', sessionId: 'proven_session' };
      return true;
    });
    for (const fn of [...Object.values(team), ...Object.values(agenda), ...Object.values(invites), ...Object.values(establishments)]) {
      fn.mockResolvedValue({ ok: true });
    }
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue({ isInitialized: false })
      .overrideProvider(TeamService)
      .useValue(team)
      .overrideProvider(MyAgendaService)
      .useValue(agenda)
      .overrideProvider(InvitesService)
      .useValue(invites)
      .overrideProvider(EstablishmentAdminService)
      .useValue(establishments)
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

  it('sem sessão nada chega aos serviços', async () => {
    guard.canActivate.mockImplementation(() => {
      throw new UnauthorizedException();
    });
    await request(app.getHttpServer()).get('/tenants/t1/team').expect(401);
    await request(app.getHttpServer()).get('/tenants/t1/my-agenda?date=2026-10-27').expect(401);
    await request(app.getHttpServer())
      .post('/tenants/t1/my-agenda/a1/start')
      .send({ expectedStartAt: INSTANTE })
      .expect(401);
    expect(team.overview).not.toHaveBeenCalled();
    expect(agenda.day).not.toHaveBeenCalled();
    expect(agenda.changeOwnStatus).not.toHaveBeenCalled();
  });

  it('identidade vem do guard; resposta sem cache', async () => {
    await request(app.getHttpServer()).get('/tenants/t1/team').expect(200).expect('Cache-Control', 'private, no-store');
    expect(team.overview).toHaveBeenCalledWith('proven_user', 't1');
    await request(app.getHttpServer())
      .get('/tenants/t1/my-agenda?date=2026-10-27')
      .expect(200)
      .expect('Cache-Control', 'private, no-store');
    expect(agenda.day).toHaveBeenCalledWith('proven_user', 't1', { date: '2026-10-27' });
  });

  it('a agenda do funcionário não aceita profissional, estabelecimento ou usuário pela query', async () => {
    for (const query of [
      'date=2026-10-27&professionalId=p2',
      'date=2026-10-27&tenantId=t2',
      'date=2026-10-27&userId=u2',
      'date=2026-02-30',
      '',
    ]) {
      await request(app.getHttpServer()).get(`/tenants/t1/my-agenda?${query}`).expect(400);
    }
    expect(agenda.day).not.toHaveBeenCalled();
  });

  it('ações do funcionário: só o instante esperado no corpo, e só três ações', async () => {
    for (const corpo of [
      { expectedStartAt: INSTANTE, professionalId: 'p2' },
      { expectedStartAt: INSTANTE, status: 'COMPLETED' },
      { expectedStartAt: INSTANTE, tenantId: 't2' },
      {},
    ]) {
      await request(app.getHttpServer()).post('/tenants/t1/my-agenda/a1/complete').send(corpo).expect(400);
    }
    for (const acao of ['confirm', 'cancel', 'reschedule']) {
      await request(app.getHttpServer())
        .post(`/tenants/t1/my-agenda/a1/${acao}`)
        .send({ expectedStartAt: INSTANTE })
        .expect(404);
    }
    expect(agenda.changeOwnStatus).not.toHaveBeenCalled();
    await request(app.getHttpServer())
      .post('/tenants/t1/my-agenda/a1/no-show')
      .send({ expectedStartAt: INSTANTE })
      .expect(200);
    expect(agenda.changeOwnStatus).toHaveBeenCalledWith('proven_user', 't1', 'a1', 'no-show', {
      expectedStartAt: INSTANTE,
    });
  });

  it('convite de funcionário: nunca papel, senha, plataforma ou outro estabelecimento no corpo', async () => {
    const base = { requestKey: CHAVE, professionalId: 'p1', name: 'Pessoa da Equipe', email: 'pessoa@example.test' };
    for (const extra of [
      { role: 'DONO' },
      { platformRole: 'MASTER_OWNER' },
      { password: 'senha-escolhida-pelo-dono' },
      { tenantId: 't2' },
      { permissions: ['ATENDIMENTO_PROPRIO_INICIAR'] },
    ]) {
      await request(app.getHttpServer())
        .post('/tenants/t1/team/invites')
        .send({ ...base, ...extra })
        .expect(400);
    }
    expect(invites.inviteStaff).not.toHaveBeenCalled();
    await request(app.getHttpServer()).post('/tenants/t1/team/invites').send(base).expect(200);
    expect(invites.inviteStaff).toHaveBeenCalledWith('proven_user', 't1', base);
  });

  it('permissões: só as três do funcionário, sem duplicar', async () => {
    for (const granted of [['AGENDA_GERENCIAR'], ['ATENDIMENTO_PROPRIO_INICIAR', 'ATENDIMENTO_PROPRIO_INICIAR'], ['DONO']]) {
      await request(app.getHttpServer())
        .put('/tenants/t1/team/members/m1/permissions')
        .send({ expectedGranted: [], granted })
        .expect(400);
    }
    expect(team.setPermissions).not.toHaveBeenCalled();
    await request(app.getHttpServer())
      .put('/tenants/t1/team/members/m1/permissions')
      .send({ expectedGranted: [], granted: ['ATENDIMENTO_PROPRIO_CONCLUIR'] })
      .expect(200);
    expect(team.setPermissions).toHaveBeenCalledWith('proven_user', 'proven_session', 't1', 'm1', {
      expectedGranted: [],
      granted: ['ATENDIMENTO_PROPRIO_CONCLUIR'],
    });
  });

  it('suspender, reativar e remover levam a sessão para a reautenticação', async () => {
    await request(app.getHttpServer()).post('/tenants/t1/team/members/m1/suspend').expect(200);
    await request(app.getHttpServer()).post('/tenants/t1/team/members/m1/reactivate').expect(200);
    await request(app.getHttpServer()).delete('/tenants/t1/team/members/m1').expect(204);
    expect(team.suspend).toHaveBeenCalledWith('proven_user', 'proven_session', 't1', 'm1');
    expect(team.reactivate).toHaveBeenCalledWith('proven_user', 'proven_session', 't1', 'm1');
    expect(team.remove).toHaveBeenCalledWith('proven_user', 'proven_session', 't1', 'm1');
  });

  it('ciclo do estabelecimento: arquivar exige motivo e confirmação; plano só com id', async () => {
    await request(app.getHttpServer())
      .post('/platform/establishments/t1/archive')
      .send({ expectedUpdatedAt: INSTANTE, reason: 'Encerrou as atividades' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/platform/establishments/t1/suspend')
      .send({ expectedUpdatedAt: INSTANTE })
      .expect(400);
    await request(app.getHttpServer())
      .put('/platform/establishments/t1/plan')
      .send({ expectedUpdatedAt: INSTANTE, planId: 'plan_pro', maxProfessionals: 99 })
      .expect(400);
    expect(establishments.archive).not.toHaveBeenCalled();
    expect(establishments.changePlan).not.toHaveBeenCalled();
    await request(app.getHttpServer())
      .post('/platform/establishments/t1/archive')
      .send({ expectedUpdatedAt: INSTANTE, reason: 'Encerrou as atividades', confirmSlug: 'estudio' })
      .expect(200);
    expect(establishments.archive).toHaveBeenCalledWith('proven_user', 'proven_session', 't1', {
      expectedUpdatedAt: INSTANTE,
      reason: 'Encerrou as atividades',
      confirmSlug: 'estudio',
    });
  });
});
