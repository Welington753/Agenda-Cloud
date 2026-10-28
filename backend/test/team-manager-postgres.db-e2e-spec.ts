// Gerente com permissões dadas pelo dono e login interno com aparência de
// e-mail, contra PostgreSQL DESCARTÁVEL (migration TeamManagerAccess
// aplicada). Dados fictícios. Prova no servidor, nas consultas e nas
// respostas: criação sem e-mail, login sem ambiguidade, áreas só por
// concessão, revogação na requisição seguinte, isolamento entre
// estabelecimentos, colisões de login, disputa pela última vaga e
// compatibilidade com gerentes, usuários e convites antigos.
import { randomUUID } from 'node:crypto';
import { globSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DataSource } from 'typeorm';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { AccountDelivery } from '../src/accounts/account-delivery.js';
import { InvitesService, LOGIN_IDENTIFIER_IN_USE_MESSAGE } from '../src/accounts/invites.service.js';
import { buildRuntimeDataSourceOptions } from '../src/database/runtime-data-source.js';
import { hashPassword } from '../src/auth/password-hasher.js';
import { AuthService } from '../src/auth/auth.service.js';
import { loginSchema } from '../src/auth/login.dto.js';
import { InvalidCredentialsError } from '../src/auth/auth.errors.js';
import { AppointmentsService } from '../src/appointments/appointments.service.js';
import { AvailabilityService } from '../src/availability/availability.service.js';
import { ConsumersService } from '../src/consumers/consumers.service.js';
import { PaymentsService } from '../src/payments/payments.service.js';
import { DashboardService } from '../src/dashboard/dashboard.service.js';
import { ServicesService } from '../src/services/services.service.js';
import { StaffAccountsService } from '../src/team/staff-accounts.service.js';
import { TeamService } from '../src/team/team.service.js';
import { MyAgendaService } from '../src/team/my-agenda.service.js';
import { dataLocalDe } from '../src/availability/time-zone.js';
import { staffAccountSchema, staffInviteSchema } from '../src/team/team.dto.js';

const url = process.env.DB_E2E_DIRECT_URL;
if (url && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)) {
  throw new Error('Este teste exige PostgreSQL descartável local.');
}
const id = () => randomUUID().replaceAll('-', '').slice(0, 24);
const SENHA = 'senha-de-teste-forte-1';
const AGENDA = ['AGENDA_VISUALIZAR', 'PROFISSIONAIS_VISUALIZAR'];

const erroDe = async (promessa: Promise<unknown>) => {
  try {
    await promessa;
  } catch (error) {
    return error as Error & { getResponse?: () => { code?: string } };
  }
  throw new Error('era esperado um erro');
};
const codigo = async (promessa: Promise<unknown>) => (await erroDe(promessa)).getResponse?.()?.code;

describe.skipIf(!url)('gerente e login interno contra PostgreSQL descartável', () => {
  let db: DataSource;
  let contas: StaffAccountsService;
  let team: TeamService;
  let auth: AuthService;
  let appointments: AppointmentsService;
  let consumers: ConsumersService;
  let payments: PaymentsService;
  let dashboard: DashboardService;
  let services: ServicesService;
  let agenda: MyAgendaService;
  let invites: InvitesService;
  let hash: string;
  const marca = `ger${id().slice(0, 8)}`;
  const planos: Record<number, string> = {};

  async function sessao(userId: string) {
    const sessionId = id();
    await db.query(
      `INSERT INTO sessions (id, user_id, token_hash, expires_at, reauthenticated_at) VALUES ($1, $2, $3, now() + interval '1 day', now())`,
      [sessionId, userId, id() + id()],
    );
    return sessionId;
  }

  async function conta(nome: string, email: string | null = `${marca}-${nome}@example.test`) {
    const userId = id();
    await db.query(`INSERT INTO users (id, name, email, status, email_verified) VALUES ($1, $2, $3, 'ACTIVE', true)`, [
      userId,
      `Pessoa ${nome}`,
      email,
    ]);
    await db.query(`INSERT INTO credentials (id, user_id, password_hash, algorithm) VALUES ($1, $2, $3, 'argon2id')`, [
      id(),
      userId,
      hash,
    ]);
    return { userId, sessionId: await sessao(userId) };
  }

  async function estabelecimento(nome: string, max: number) {
    const tenantId = id();
    const unitId = id();
    await db.query(
      `INSERT INTO tenants (id, slug, category, timezone, plan_id, status) VALUES ($1, $2, 'OTHER', 'America/Sao_Paulo', $3, 'ACTIVE')`,
      [tenantId, `${marca}-${nome}`, planos[max]],
    );
    await db.query(
      `INSERT INTO units (id, tenant_id, name, address, timezone, is_primary) VALUES ($1, $2, $3, '', 'America/Sao_Paulo', true)`,
      [unitId, tenantId, `${marca} ${nome}`],
    );
    const dono = await conta(`${nome}-dono`);
    const donoMembership = id();
    await db.query(`INSERT INTO memberships (id, user_id, tenant_id, role) VALUES ($1, $2, $3, 'DONO')`, [
      donoMembership,
      dono.userId,
      tenantId,
    ]);
    const serviceId = id();
    await db.query(
      `INSERT INTO services (id, tenant_id, name, short_description, duration_minutes, price_cents) VALUES ($1, $2, 'Corte', '', 60, 5000)`,
      [serviceId, tenantId],
    );
    const consumerId = id();
    await db.query(
      `INSERT INTO consumers (id, tenant_id, name, whatsapp, whatsapp_normalized) VALUES ($1, $2, 'Cliente Fictício', '11999990000', $3)`,
      [consumerId, tenantId, `5511${Math.floor(Math.random() * 1e9)}`],
    );
    return { tenantId, unitId, dono, donoMembership, serviceId, consumerId };
  }
  type Est = Awaited<ReturnType<typeof estabelecimento>>;

  async function profissional(est: Est, nome: string) {
    const professionalId = id();
    await db.query(
      `INSERT INTO professionals (id, tenant_id, name, avatar_initials, avatar_color) VALUES ($1, $2, $3, 'PX', '#000000')`,
      [professionalId, est.tenantId, `Profissional ${nome}`],
    );
    return professionalId;
  }

  async function reserva(est: Est, professionalId: string, inicio: Date, status = 'CONFIRMED') {
    const appointmentId = id();
    await db.query(
      `INSERT INTO appointments (id, tenant_id, unit_id, consumer_id, consumer_name_snapshot, consumer_whatsapp_snapshot,
          professional_id, start_at, end_at, status, notes)
       VALUES ($1, $2, $3, $4, 'Cliente Fictício', '11999990000', $5, $6, $7, $8::appointment_status, 'observação interna')`,
      [appointmentId, est.tenantId, est.unitId, est.consumerId, professionalId, inicio, new Date(inicio.getTime() + 3_600_000), status],
    );
    await db.query(
      `INSERT INTO appointment_items (id, tenant_id, appointment_id, service_id, duration_minutes_snapshot, price_cents_snapshot)
       VALUES ($1, $2, $3, $4, 60, 5000)`,
      [id(), est.tenantId, appointmentId, est.serviceId],
    );
    return appointmentId;
  }

  const criar = (
    est: Est,
    dados: { role?: 'PROFISSIONAL' | 'GERENTE'; username: string; professionalId?: string | null; permissions?: string[] },
  ) =>
    // Pelo mesmo DTO da rota: normalização e formato do login incluídos.
    contas.create(
      est.dono.userId,
      est.dono.sessionId,
      est.tenantId,
      staffAccountSchema.parse({
        requestKey: `chave-${id()}`,
        role: dados.role ?? 'GERENTE',
        professionalId: dados.professionalId ?? null,
        name: `Equipe ${dados.username.slice(0, 40)}`,
        username: dados.username,
        permissions: dados.permissions ?? [],
      }),
    );

  const login = (identificador: string, senha: string) =>
    auth.login(loginSchema.parse({ login: identificador, password: senha }), { now: new Date(), userAgent: 'teste' });

  const permissoes = async (est: Est, membershipId: string, granted: string[]) => {
    const visao = await team.overview(est.dono.userId, est.tenantId);
    const atual = visao.accesses.find((a) => a.membershipId === membershipId)!;
    return team.setPermissions(est.dono.userId, est.dono.sessionId, est.tenantId, membershipId, {
      expectedGranted: atual.grantedPermissions as never,
      granted: granted as never,
    });
  };

  const diaLocal = (instante: Date) => dataLocalDe(instante, 'America/Sao_Paulo');
  const contagem = async (sql: string, params: unknown[]) =>
    ((await db.query(sql, params)) as { n: number }[])[0].n;

  beforeAll(async () => {
    const directoryPath = path.dirname(fileURLToPath(import.meta.url));
    const entities: (new () => object)[] = [];
    for (const file of globSync(path.join(directoryPath, '../src/entities/**/*.entity.ts'))) {
      const exports = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
      for (const value of Object.values(exports)) if (typeof value === 'function') entities.push(value as new () => object);
    }
    db = new DataSource({ ...buildRuntimeDataSourceOptions(url!), entities, logging: ['error'] });
    await db.initialize();
    const relogio = () => new Date();
    consumers = new ConsumersService(db);
    appointments = new AppointmentsService(db, new AvailabilityService(db, relogio), consumers, relogio);
    contas = new StaffAccountsService(db);
    team = new TeamService(db);
    auth = new AuthService(db);
    payments = new PaymentsService(db);
    dashboard = new DashboardService(db);
    services = new ServicesService(db);
    agenda = new MyAgendaService(db, appointments);
    // Sem provedor de e-mail: nenhum envio, só o link.
    const valores: Record<string, string> = { FRONTEND_URL: 'http://localhost:3000' };
    const config = { get: (k: string) => valores[k], getOrThrow: (k: string) => valores[k] } as unknown as ConfigService;
    invites = new InvitesService(db, new AccountDelivery(db, config));
    hash = await hashPassword(SENHA);
    for (const max of [1, 2, 3]) {
      planos[max] = id();
      await db.query(
        `INSERT INTO plans (id, code, name, short_description, max_professionals, max_units) VALUES ($1, $2, $3, '', $4, 1)`,
        [planos[max], `${marca}-${max}`, `Plano ${max}`, max],
      );
    }
  });

  afterAll(async () => {
    if (db?.isInitialized) await db.destroy();
  });

  it('gerente sem profissional: conta nova sem e-mail, login com @, troca obrigatória, vaga ocupada e nenhum profissional criado', async () => {
    const est = await estabelecimento('cria', 2);
    const antes = await contagem('SELECT count(*)::int AS n FROM professionals WHERE tenant_id = $1', [est.tenantId]);
    const login1 = `recepcao@${marca}.salao`;
    const criado = await criar(est, { username: login1.toUpperCase(), permissions: AGENDA });
    expect(criado).toMatchObject({ created: true, role: 'GERENTE', username: login1 });

    const [usuario] = await db.query(
      `SELECT email, username::text AS username, email_verified, must_change_password FROM users WHERE id = $1`,
      [criado.userId],
    );
    // O login com @ NÃO vira e-mail: nada para enviar, nada verificado.
    expect(usuario).toEqual({ email: null, username: login1, email_verified: false, must_change_password: true });
    const [vinculo] = await db.query(
      `SELECT role::text AS role, professional_id, permissions_confirmed_at IS NOT NULL AS confirmado FROM memberships WHERE id = $1`,
      [criado.membershipId],
    );
    expect(vinculo).toEqual({ role: 'GERENTE', professional_id: null, confirmado: true });
    expect(await contagem('SELECT count(*)::int AS n FROM professionals WHERE tenant_id = $1', [est.tenantId])).toBe(antes);
    expect(await contagem(`SELECT count(*)::int AS n FROM notification_jobs WHERE tenant_id = $1`, [est.tenantId])).toBe(0);

    const visao = await team.overview(est.dono.userId, est.tenantId);
    expect(visao.seats).toMatchObject({ activeAccesses: 1, used: 1, limit: 2 });
    expect(visao.accesses.find((a) => a.membershipId === criado.membershipId)).toMatchObject({
      role: 'GERENTE',
      professional: null,
      situation: 'ACTIVE',
      canResetTemporaryPassword: true,
      grantedPermissions: ['AGENDA_VISUALIZAR', 'PROFISSIONAIS_VISUALIZAR'],
    });

    // Entra pelo login (qualquer caixa), com a senha temporária, e precisa trocar.
    const entrou = await login(` ${login1.toUpperCase()} `, criado.temporaryPassword!);
    expect(entrou.user).toMatchObject({ email: null, username: login1, mustChangePassword: true });
    expect(entrou.activeContext).toMatchObject({ role: 'GERENTE', areas: expect.arrayContaining(['AGENDA_VER']) });
    expect(entrou.activeContext!.areas).not.toContain('EQUIPE');
    const sessionId = ((await db.query('SELECT id FROM sessions WHERE user_id = $1', [criado.userId])) as { id: string }[])[0].id;
    await auth.changePassword(criado.userId, sessionId, { currentPassword: criado.temporaryPassword!, newPassword: 'senha-escolhida-1' }, new Date());
    expect((await login(login1, 'senha-escolhida-1')).user.mustChangePassword).toBe(false);
    await expect(login(login1, criado.temporaryPassword!)).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('logins antigos sem @ continuam entrando; o responsável continua entrando pelo e-mail', async () => {
    const est = await estabelecimento('antigo', 2);
    const p = await profissional(est, 'Bia');
    const criado = await criar(est, { role: 'PROFISSIONAL', username: `${marca}.bia`, professionalId: p });
    expect((await login(`${marca}.bia`, criado.temporaryPassword!)).user.username).toBe(`${marca}.bia`);
    const dono = await login(`${marca}-antigo-dono@example.test`, SENHA);
    expect(dono.user).toMatchObject({ email: `${marca}-antigo-dono@example.test`, username: null, mustChangePassword: false });
    // O corpo antigo (`email`) também.
    const pelaTelaAntiga = await auth.login(loginSchema.parse({ email: `${marca}-antigo-dono@example.test`, password: SENHA }), {
      now: new Date(),
    });
    expect(pelaTelaAntiga.user.id).toBe(dono.user.id);
  });

  it('colisões: login igual ao e-mail ou ao login de outra conta é recusado, sem assumir nem criar conta', async () => {
    const est = await estabelecimento('colide', 3);
    const outra = `${marca}-alguem@example.test`;
    await conta('alguem', outra);
    const usuarios = await contagem('SELECT count(*)::int AS n FROM users', []);
    expect(await codigo(criar(est, { username: outra.toUpperCase() }))).toBe('USUARIO_EM_USO');
    await criar(est, { username: `caixa@${marca}` });
    expect(await codigo(criar(est, { username: `CAIXA@${marca}` }))).toBe('USUARIO_EM_USO');
    expect(await contagem('SELECT count(*)::int AS n FROM users', [])).toBe(usuarios + 1);
    expect(await contagem(`SELECT count(*)::int AS n FROM memberships WHERE tenant_id = $1`, [est.tenantId])).toBe(2);

    // O caminho inverso, direto no banco: um e-mail igual a um login existente.
    const erro = await erroDe(
      db.query(`INSERT INTO users (id, name, email, status) VALUES ($1, 'Pessoa', $2, 'INVITED')`, [id(), `caixa@${marca}`]),
    );
    expect((erro as unknown as { driverError: { constraint: string } }).driverError.constraint).toBe('uq_users_login_identifier');
  });

  it('e-mail e login simultâneos com o mesmo texto: só um grava', async () => {
    const texto = `corrida@${marca}.test`;
    const tentativa = (coluna: 'email' | 'username') =>
      db.transaction(async (tx) => {
        await tx.query(
          `INSERT INTO users (id, name, ${coluna}, status) VALUES ($1, 'Pessoa Corrida', $2, 'INVITED')`,
          [id(), texto],
        );
        await tx.query('SELECT pg_sleep(0.3)');
      });
    const resultados = await Promise.allSettled([tentativa('email'), tentativa('username')]);
    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await contagem('SELECT count(*)::int AS n FROM users WHERE email = $1 OR username = $1', [texto])).toBe(1);
  });

  it('última vaga disputada por um profissional e um gerente: só um entra', async () => {
    const est = await estabelecimento('vaga', 1);
    const p = await profissional(est, 'Corrida');
    const resultados = await Promise.allSettled([
      criar(est, { role: 'PROFISSIONAL', username: `${marca}.prof`, professionalId: p }),
      criar(est, { username: `gerente@${marca}.vaga` }),
    ]);
    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const recusa = resultados.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(recusa.reason.getResponse().code).toBe('LIMITE_DO_PLANO');
    expect(await contagem(`SELECT count(*)::int AS n FROM memberships WHERE tenant_id = $1 AND role <> 'DONO'`, [est.tenantId])).toBe(1);
    // Ninguém fica sem vínculo.
    expect(
      await contagem(
        `SELECT count(*)::int AS n FROM users u WHERE u.username::text IN ($1, $2) AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = u.id)`,
        [`${marca}.prof`, `gerente@${marca}.vaga`],
      ),
    ).toBe(0);
  });

  it('o dono só concede o que tem, com as dependências; o gerente nunca recebe equipe nem permissão de funcionário sem profissional', async () => {
    const est = await estabelecimento('concede', 3);
    expect(await codigo(criar(est, { username: `g1@${marca}`, permissions: ['AGENDAMENTO_CRIAR'] }))).toBe('PERMISSOES_INCOMPLETAS');
    expect(await codigo(criar(est, { username: `g2@${marca}`, permissions: ['ATENDIMENTO_PROPRIO_INICIAR'] }))).toBe(
      'PERMISSAO_NAO_SE_APLICA',
    );
    const p = await profissional(est, 'Prof');
    expect(
      await codigo(criar(est, { role: 'PROFISSIONAL', username: `p1@${marca}`, professionalId: p, permissions: AGENDA })),
    ).toBe('PERMISSAO_NAO_SE_APLICA');
    // A administração restringiu a agenda do dono: ele não pode concedê-la.
    await db.query(
      `INSERT INTO membership_permission_overrides (id, tenant_id, membership_id, permission, mode) VALUES ($1, $2, $3, 'AGENDA_VISUALIZAR', 'DENIED')`,
      [id(), est.tenantId, est.donoMembership],
    );
    expect(await codigo(criar(est, { username: `g3@${marca}`, permissions: AGENDA }))).toBe('PERMISSAO_NAO_DISPONIVEL');
    expect(await contagem(`SELECT count(*)::int AS n FROM memberships WHERE tenant_id = $1 AND role <> 'DONO'`, [est.tenantId])).toBe(0);
  });

  it('gerente opera só as áreas concedidas, por API direta; a resposta esconde contato e preço; retirar e suspender valem na requisição seguinte', async () => {
    const est = await estabelecimento('areas', 3);
    const p = await profissional(est, 'Agenda');
    const amanha = new Date(Date.now() + 26 * 3_600_000);
    const confirmada = await reserva(est, p, amanha);
    const criado = await criar(est, { username: `gerente@${marca}.areas`, permissions: AGENDA });
    const g = criado.userId;
    const dia = { date: diaLocal(amanha) };

    const lista = await appointments.list(g, est.tenantId, dia);
    const vista = lista.appointments.find((a) => a.id === confirmada)!;
    expect(vista.consumer).toMatchObject({ name: 'Cliente Fictício', whatsapp: null });
    expect(vista).toMatchObject({ notes: null, priceCents: null, hidden: ['price', 'contact'] });
    // O dono continua vendo tudo.
    const doDono = (await appointments.list(est.dono.userId, est.tenantId, dia)).appointments.find((a) => a.id === confirmada)!;
    expect(doDono).toMatchObject({ notes: 'observação interna', priceCents: 5000 });
    expect(doDono.hidden).toBeUndefined();

    // Sem concessão, recusado no servidor mesmo chamando a API direto.
    for (const negado of [
      () => consumers.search(g, est.tenantId, 'Cli'),
      () => payments.list(g, est.tenantId, {}),
      () => dashboard.summary(g, est.tenantId, {}),
      () => services.list(g, est.tenantId),
      () => appointments.changeStatus(g, est.tenantId, confirmada, 'start', { expectedStartAt: amanha.toISOString() }),
      () => appointments.cancel(g, est.tenantId, confirmada, { expectedStartAt: amanha.toISOString() }),
    ]) {
      expect(await erroDe(negado())).toBeInstanceOf(ForbiddenException);
    }
    // Gerente não administra a equipe nem as próprias permissões.
    expect(await erroDe(team.overview(g, est.tenantId))).toBeInstanceOf(ForbiddenException);
    expect(
      await erroDe(team.setPermissions(g, await sessao(g), est.tenantId, criado.membershipId, { expectedGranted: [], granted: [] })),
    ).toBeInstanceOf(ForbiddenException);

    // Clientes e recebimentos concedidos: o contato e o preço aparecem.
    await permissoes(est, criado.membershipId, [...AGENDA, 'CONSUMIDORES_VISUALIZAR', 'RECEBIMENTOS_VISUALIZAR']);
    expect((await consumers.search(g, est.tenantId, 'Cli')).length).toBeGreaterThan(0);
    await payments.list(g, est.tenantId, {});
    const comTudo = (await appointments.list(g, est.tenantId, dia)).appointments.find((a) => a.id === confirmada)!;
    expect(comTudo).toMatchObject({ notes: 'observação interna', priceCents: 5000 });
    expect(comTudo.consumer.whatsapp).toBe('11999990000');

    // Retirada com a "sessão" aberta: a próxima chamada já é recusada.
    await permissoes(est, criado.membershipId, AGENDA);
    expect(await erroDe(consumers.search(g, est.tenantId, 'Cli'))).toBeInstanceOf(ForbiddenException);
    expect(await erroDe(payments.list(g, est.tenantId, {}))).toBeInstanceOf(ForbiddenException);
    await team.suspend(est.dono.userId, est.dono.sessionId, est.tenantId, criado.membershipId);
    expect(await erroDe(appointments.list(g, est.tenantId, dia))).toBeInstanceOf(ForbiddenException);
    expect((await team.overview(est.dono.userId, est.tenantId)).seats.used).toBe(0);
  });

  it('solicitações: o gerente que só trata solicitações confirma e recusa pedidos pendentes, nada além', async () => {
    const est = await estabelecimento('pedidos', 3);
    const p = await profissional(est, 'Pedidos');
    const base = Date.now() + 30 * 3_600_000;
    const pedido1 = await reserva(est, p, new Date(base), 'PENDING');
    const pedido2 = await reserva(est, p, new Date(base + 2 * 3_600_000), 'PENDING');
    const confirmada = await reserva(est, p, new Date(base + 4 * 3_600_000));
    const criado = await criar(est, { username: `pedidos@${marca}`, permissions: ['SOLICITACOES_VISUALIZAR', 'SOLICITACOES_TRATAR'] });
    const g = criado.userId;
    const pendentes = await appointments.listPending(g, est.tenantId);
    expect(pendentes.appointments.map((a) => a.id).sort()).toEqual([pedido1, pedido2].sort());
    expect(pendentes.appointments[0].consumer.whatsapp).toBeNull();
    expect(await erroDe(appointments.list(g, est.tenantId, { date: diaLocal(new Date(base)) }))).toBeInstanceOf(ForbiddenException);

    const aceito = await appointments.changeStatus(g, est.tenantId, pedido1, 'confirm', { expectedStartAt: new Date(base).toISOString() });
    expect(aceito.status).toBe('CONFIRMED');
    const recusado = await appointments.cancel(g, est.tenantId, pedido2, {
      expectedStartAt: new Date(base + 2 * 3_600_000).toISOString(),
    });
    expect(recusado.status).toBe('CANCELED');
    // Uma reserva já confirmada não é solicitação: nem cancelar nem iniciar.
    const instante = new Date(base + 4 * 3_600_000).toISOString();
    expect(await erroDe(appointments.cancel(g, est.tenantId, confirmada, { expectedStartAt: instante }))).toBeInstanceOf(
      ForbiddenException,
    );
    expect(await erroDe(appointments.changeStatus(g, est.tenantId, confirmada, 'start', { expectedStartAt: instante }))).toBeInstanceOf(
      ForbiddenException,
    );
    const [{ status }] = (await db.query('SELECT status::text AS status FROM appointments WHERE id = $1', [confirmada])) as {
      status: string;
    }[];
    expect(status).toBe('CONFIRMED');
  });

  it('isolamento: o gerente de um estabelecimento não alcança outro, nem por id', async () => {
    const a = await estabelecimento('iso-a', 2);
    const b = await estabelecimento('iso-b', 2);
    const pb = await profissional(b, 'B');
    const reservaB = await reserva(b, pb, new Date(Date.now() + 40 * 3_600_000));
    const criado = await criar(a, { username: `iso@${marca}`, permissions: [...AGENDA, 'AGENDA_GERENCIAR'] });
    expect(await erroDe(appointments.list(criado.userId, b.tenantId, { date: diaLocal(new Date()) }))).toBeInstanceOf(
      NotFoundException,
    );
    expect(await erroDe(appointments.get(criado.userId, a.tenantId, reservaB))).toBeInstanceOf(NotFoundException);
    expect(
      await erroDe(
        team.suspend(a.dono.userId, a.dono.sessionId, b.tenantId, criado.membershipId),
      ),
    ).toBeInstanceOf(NotFoundException);
  });

  it('gerente com profissional ligado vê a própria agenda; o profissional continua só com a dele', async () => {
    const est = await estabelecimento('propria', 3);
    const pg = await profissional(est, 'Gerente');
    const pp = await profissional(est, 'Colega');
    const inicio = new Date(Date.now() + 50 * 3_600_000);
    const minha = await reserva(est, pg, inicio);
    const doColega = await reserva(est, pp, new Date(inicio.getTime() + 2 * 3_600_000));
    const gerente = await criar(est, { username: `com-prof@${marca}`, professionalId: pg, permissions: ['ATENDIMENTO_PROPRIO_INICIAR'] });
    const colega = await criar(est, { role: 'PROFISSIONAL', username: `${marca}.colega`, professionalId: pp });
    const dia = { date: diaLocal(inicio) };
    const doGerente = await agenda.day(gerente.userId, est.tenantId, dia);
    expect(doGerente.appointments.map((a: { id: string }) => a.id)).toEqual([minha]);
    const doProf = await agenda.day(colega.userId, est.tenantId, dia);
    expect(doProf.appointments.map((a: { id: string }) => a.id)).toEqual([doColega]);
    // Sem a agenda do estabelecimento concedida, o gerente não vê a do colega.
    expect(await erroDe(appointments.list(gerente.userId, est.tenantId, dia))).toBeInstanceOf(ForbiddenException);
    expect(await erroDe(appointments.list(colega.userId, est.tenantId, dia))).toBeInstanceOf(ForbiddenException);
  });

  it('gerente antigo: GRANTED gravado não vale até o dono confirmar; convites pendentes antigos continuam visíveis e contando vaga', async () => {
    const est = await estabelecimento('legado', 3);
    const antigo = await conta('gerente-antigo');
    const membershipId = id();
    await db.query(`INSERT INTO memberships (id, user_id, tenant_id, role) VALUES ($1, $2, $3, 'GERENTE')`, [
      membershipId,
      antigo.userId,
      est.tenantId,
    ]);
    for (const permission of AGENDA) {
      await db.query(
        `INSERT INTO membership_permission_overrides (id, tenant_id, membership_id, permission, mode) VALUES ($1, $2, $3, $4::permission, 'GRANTED')`,
        [id(), est.tenantId, membershipId, permission],
      );
    }
    const dia = { date: diaLocal(new Date()) };
    expect(await erroDe(appointments.list(antigo.userId, est.tenantId, dia))).toBeInstanceOf(ForbiddenException);
    const entrou = await login(`${marca}-gerente-antigo@example.test`, SENHA);
    expect(entrou.activeContext).toMatchObject({ role: 'GERENTE', areas: [] });

    const visao = await team.overview(est.dono.userId, est.tenantId);
    expect(visao.accesses.find((a) => a.membershipId === membershipId)).toMatchObject({
      situation: 'PERMISSIONS_PENDING',
      permissionsPending: true,
      grantedPermissions: [],
      // Conta com e-mail: a senha dela não é do estabelecimento.
      canResetTemporaryPassword: false,
    });
    expect(visao.seats.activeAccesses).toBe(1);

    // O dono confirma SÓ a agenda: o que ele não marcou sai.
    await permissoes(est, membershipId, ['PROFISSIONAIS_VISUALIZAR']);
    expect(await erroDe(appointments.list(antigo.userId, est.tenantId, dia))).toBeInstanceOf(ForbiddenException);
    const gravados = (await db.query(
      `SELECT permission::text AS permission FROM membership_permission_overrides WHERE membership_id = $1 AND mode = 'GRANTED'`,
      [membershipId],
    )) as { permission: string }[];
    expect(gravados.map((g) => g.permission)).toEqual(['PROFISSIONAIS_VISUALIZAR']);
    await permissoes(est, membershipId, AGENDA);
    await appointments.list(antigo.userId, est.tenantId, dia);
    // E-mail e vínculo da conta antiga ficaram como estavam.
    const [usuario] = await db.query(`SELECT email::text AS email FROM users WHERE id = $1`, [antigo.userId]);
    expect(usuario.email).toBe(`${marca}-gerente-antigo@example.test`);
  });

  const convidar = (est: Est, professionalId: string, email: string) =>
    invites.inviteStaff(
      est.dono.userId,
      est.tenantId,
      staffInviteSchema.parse({ requestKey: `chave-${id()}`, professionalId, name: 'Pessoa Convidada', email }),
    );

  it('convite por e-mail igual a um login interno: recusa genérica, sem tocar na conta; convite e login simultâneos: só um grava', async () => {
    const est = await estabelecimento('convite', 3);
    const p1 = await profissional(est, 'Um');
    await criar(est, { username: `recepcao@${marca}.test` });
    const usuarios = await contagem('SELECT count(*)::int AS n FROM users', []);
    const recusa = await erroDe(convidar(est, p1, `Recepcao@${marca}.test`));
    expect(recusa.getResponse?.()).toMatchObject({ code: 'IDENTIFICADOR_EM_USO', message: LOGIN_IDENTIFIER_IN_USE_MESSAGE });
    // A mensagem não diz que o texto é um login, nem de quem.
    expect(LOGIN_IDENTIFIER_IN_USE_MESSAGE).not.toMatch(/login|equipe|estabelecimento/i);
    expect(await contagem('SELECT count(*)::int AS n FROM users', [])).toBe(usuarios);
    expect(await contagem('SELECT count(*)::int AS n FROM invites WHERE tenant_id = $1', [est.tenantId])).toBe(0);

    // Corrida pelos dois caminhos de criação com o mesmo texto.
    const p2 = await profissional(est, 'Dois');
    const texto = `dupla@${marca}.test`;
    const resultados = await Promise.allSettled([convidar(est, p2, texto), criar(est, { username: texto })]);
    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const perdeu = resultados.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(['IDENTIFICADOR_EM_USO', 'USUARIO_EM_USO']).toContain(perdeu.reason.getResponse().code);
    expect(await contagem('SELECT count(*)::int AS n FROM users WHERE email = $1 OR username = $1', [texto])).toBe(1);
    // O login continua achando no máximo uma conta.
    expect(await contagem('SELECT count(*)::int AS n FROM users WHERE email = $1 OR username = $1', [`recepcao@${marca}.test`])).toBe(1);
  });

  it('acima do limite: acessos e permissões ficam como estão; só o que aumenta o uso é recusado', async () => {
    const est = await estabelecimento('excesso', 1);
    const atual = await criar(est, { username: `atual@${marca}`, permissions: AGENDA });
    const [{ membershipId: atualId }] = (await db.query('SELECT id AS "membershipId" FROM memberships WHERE user_id = $1', [
      atual.userId,
    ])) as { membershipId: string }[];
    // Gerente antigo, de antes da migration: passa a ocupar vaga também.
    const antigo = await conta('excesso-antigo');
    const antigoId = id();
    await db.query(`INSERT INTO memberships (id, user_id, tenant_id, role) VALUES ($1, $2, $3, 'GERENTE')`, [
      antigoId,
      antigo.userId,
      est.tenantId,
    ]);
    await db.query(
      `INSERT INTO membership_permission_overrides (id, tenant_id, membership_id, permission, mode) VALUES ($1, $2, $3, 'AGENDA_VISUALIZAR', 'GRANTED')`,
      [id(), est.tenantId, antigoId],
    );
    const fotografia = async () =>
      db.query(
        `SELECT m.id, m.status::text AS status, m.permissions_confirmed_at,
                (SELECT array_agg(o.permission::text || ':' || o.mode::text ORDER BY o.permission::text) FROM membership_permission_overrides o WHERE o.membership_id = m.id) AS ajustes
           FROM memberships m WHERE m.tenant_id = $1 ORDER BY m.id`,
        [est.tenantId],
      );
    const antes = await fotografia();
    const visao = await team.overview(est.dono.userId, est.tenantId);
    expect(visao.seats).toMatchObject({ limit: 1, activeAccesses: 2, used: 2, available: 0 });
    // Ler a visão e o próprio acesso não muda nada: quem já tinha continua tendo.
    await appointments.list(atual.userId, est.tenantId, { date: diaLocal(new Date()) });
    expect(await fotografia()).toEqual(antes);

    expect(await codigo(criar(est, { username: `novo@${marca}` }))).toBe('LIMITE_DO_PLANO');
    // Confirmar permissões de quem já está lá não ocupa vaga.
    await permissoes(est, antigoId, []);
    await team.suspend(est.dono.userId, est.dono.sessionId, est.tenantId, atualId);
    // Continua acima (1 ativo = limite): reativar aumentaria o uso.
    expect(await codigo(team.reactivate(est.dono.userId, est.dono.sessionId, est.tenantId, atualId))).toBe('LIMITE_DO_PLANO');
    const [suspenso] = (await db.query('SELECT status::text AS status FROM memberships WHERE id = $1', [atualId])) as { status: string }[];
    expect(suspenso.status).toBe('SUSPENDED');
    expect(
      await contagem(`SELECT count(*)::int AS n FROM membership_permission_overrides WHERE membership_id = $1 AND mode = 'GRANTED'`, [atualId]),
    ).toBe(AGENDA.length);
  });
});
