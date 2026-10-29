// Equipe por estabelecimento, vagas do plano, agenda do funcionário e ciclo
// do estabelecimento contra PostgreSQL DESCARTÁVEL (com a migration
// TeamAccess aplicada). Os serviços rodam de verdade; o e-mail vai para uma
// caixa HTTP local (nada sai da máquina). Cada caso usa marcadores próprios.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { globSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DataSource } from 'typeorm';
import type { ConfigService } from '@nestjs/config';
import { ConflictException, ForbiddenException, GoneException, NotFoundException } from '@nestjs/common';
import { buildRuntimeDataSourceOptions } from '../src/database/runtime-data-source.js';
import { hashPassword, verifyPassword } from '../src/auth/password-hasher.js';
import { AuthService } from '../src/auth/auth.service.js';
import { AccountDelivery } from '../src/accounts/account-delivery.js';
import { AccountsAdminService } from '../src/accounts/accounts-admin.service.js';
import { AccountsDirectoryService } from '../src/accounts/accounts-directory.service.js';
import { InvitesService } from '../src/accounts/invites.service.js';
import { AppointmentsService } from '../src/appointments/appointments.service.js';
import { AvailabilityService } from '../src/availability/availability.service.js';
import { ConsumersService } from '../src/consumers/consumers.service.js';
import { ProfessionalsService } from '../src/professionals/professionals.service.js';
import { PublicBookingService } from '../src/public-booking/public-booking.service.js';
import { EstablishmentAdminService } from '../src/platform/establishment-admin.service.js';
import { PlatformService } from '../src/platform/platform.service.js';
import { TeamService } from '../src/team/team.service.js';
import { MyAgendaService } from '../src/team/my-agenda.service.js';
import { dataLocalDe } from '../src/availability/time-zone.js';
import { comTodosOsRecursos } from './support/plano-de-teste.js';

const url = process.env.DB_E2E_DIRECT_URL;
if (url && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)) {
  throw new Error('Este teste exige PostgreSQL descartável local.');
}
const id = () => randomUUID().replaceAll('-', '').slice(0, 24);
const SENHA = 'senha-de-teste-forte-1';

function caixaDeEmail() {
  const recebidos: { to: string; text: string }[] = [];
  const server: Server = createServer((req, res) => {
    let corpo = '';
    req.on('data', (parte) => (corpo += parte));
    req.on('end', () => {
      const json = JSON.parse(corpo) as { to: { email: string }[]; textContent: string };
      recebidos.push({ to: json.to[0].email, text: json.textContent });
      res.statusCode = 201;
      res.end(JSON.stringify({ messageId: id() }));
    });
  });
  return { server, recebidos };
}

const erroDe = async (promessa: Promise<unknown>) => {
  try {
    await promessa;
  } catch (error) {
    return error as Error & { getResponse?: () => { code?: string; excess?: { kind: string }[] } };
  }
  throw new Error('era esperado um erro');
};
const codigo = async (promessa: Promise<unknown>) => (await erroDe(promessa)).getResponse?.()?.code;

describe.skipIf(!url)('equipe, vagas do plano e agenda do funcionário contra PostgreSQL descartável', () => {
  let db: DataSource;
  let invites: InvitesService;
  let team: TeamService;
  let agenda: MyAgendaService;
  let appointments: AppointmentsService;
  let profissionais: ProfessionalsService;
  let admin: AccountsAdminService;
  let directory: AccountsDirectoryService;
  let auth: AuthService;
  let estabelecimentos: EstablishmentAdminService;
  let plataforma: PlatformService;
  let publico: PublicBookingService;
  const caixa = caixaDeEmail();
  const marca = `equipe-${id()}`;
  const email = (nome: string) => `${marca}-${nome}@example.test`;
  let hash: string;
  const planos: Record<number, string> = {};

  async function conta(nome: string, opcoes: { role?: string; status?: string } = {}) {
    const userId = id();
    await db.query(
      `INSERT INTO users (id, name, email, status, platform_role, email_verified)
       VALUES ($1, $2, $3, $4::user_status, $5::platform_role, true)`,
      [userId, `Pessoa ${nome}`, email(nome), opcoes.status ?? 'ACTIVE', opcoes.role ?? null],
    );
    await db.query(`INSERT INTO credentials (id, user_id, password_hash, algorithm) VALUES ($1, $2, $3, 'argon2id')`, [
      id(),
      userId,
      hash,
    ]);
    const sessionId = id();
    await db.query(
      `INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, now() + interval '1 day')`,
      [sessionId, userId, id() + id()],
    );
    return { userId, sessionId };
  }

  /** Estabelecimento com dono (que também tem conta e sessão). */
  async function estabelecimento(nome: string, maxProfissionais: number, status = 'ACTIVE') {
    const tenantId = id();
    const unitId = id();
    await db.query(
      `INSERT INTO tenants (id, slug, category, timezone, plan_id, status, access_legacy_since) VALUES ($1, $2, 'OTHER', 'America/Sao_Paulo', $3, $4::tenant_status, now())`,
      [tenantId, `${marca}-${nome}`, planos[maxProfissionais], status],
    );
    await db.query(
      `INSERT INTO units (id, tenant_id, name, address, timezone, is_primary) VALUES ($1, $2, $3, '', 'America/Sao_Paulo', true)`,
      [unitId, tenantId, `${marca} ${nome}`],
    );
    const dono = await conta(`${nome}-dono`);
    await db.query(`INSERT INTO memberships (id, user_id, tenant_id, role) VALUES ($1, $2, $3, 'DONO')`, [
      id(),
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
      `INSERT INTO consumers (id, tenant_id, name, whatsapp, whatsapp_normalized) VALUES ($1, $2, 'Cliente Sigiloso', '11999990000', $3)`,
      [consumerId, tenantId, `5511${Math.floor(Math.random() * 1e9)}`],
    );
    return { tenantId, unitId, dono, serviceId, consumerId, slug: `${marca}-${nome}` };
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
       VALUES ($1, $2, $3, $4, 'Cliente Sigiloso', '11999990000', $5, $6, $7, $8::appointment_status, 'observação interna')`,
      [appointmentId, est.tenantId, est.unitId, est.consumerId, professionalId, inicio, new Date(inicio.getTime() + 3_600_000), status],
    );
    await db.query(
      `INSERT INTO appointment_items (id, tenant_id, appointment_id, service_id, duration_minutes_snapshot, price_cents_snapshot)
       VALUES ($1, $2, $3, $4, 60, 5000)`,
      [id(), est.tenantId, appointmentId, est.serviceId],
    );
    return appointmentId;
  }

  const requestKey = () => `chave-${id()}`;
  const ultimoToken = (destino: string) =>
    /#t=([0-9a-f]{64})/.exec([...caixa.recebidos].reverse().find((m) => m.to === destino)!.text)![1];
  const reauth = (quem: { userId: string; sessionId: string }) => admin.reauthenticate(quem.userId, quem.sessionId, SENHA);
  const convidar = (est: Est, professionalId: string, nome: string) =>
    invites.inviteStaff(est.dono.userId, est.tenantId, {
      requestKey: requestKey(),
      professionalId,
      name: `Funcionária ${nome}`,
      email: email(nome),
    });
  /** Convida e aceita como conta nova: devolve a conta do funcionário. */
  async function funcionario(est: Est, professionalId: string, nome: string) {
    await convidar(est, professionalId, nome);
    const aceito = await invites.accept(ultimoToken(email(nome)), 'senha-da-funcionaria-1', { now: new Date() });
    const [vinculo] = await db.query(`SELECT id FROM memberships WHERE user_id = $1 AND tenant_id = $2`, [
      aceito.userId,
      est.tenantId,
    ]);
    const sessionId = id();
    await db.query(
      `INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, now() + interval '1 day')`,
      [sessionId, aceito.userId, id() + id()],
    );
    return { userId: aceito.userId, sessionId, membershipId: vinculo.id as string, destination: aceito.destination };
  }
  const hoje = () => new Date().toISOString().slice(0, 10);
  /** Dia do calendário em que o instante cai NO FUSO DO ESTABELECIMENTO (o
   * mesmo critério de `MyAgendaService.day`). A data UTC erra perto da
   * meia-noite: 22:18 em São Paulo já é o dia seguinte em UTC. */
  const diaLocal = async (est: Est, instante: Date) => {
    const [{ timezone }] = (await db.query('SELECT timezone FROM tenants WHERE id = $1', [est.tenantId])) as {
      timezone: string;
    }[];
    return dataLocalDe(instante, timezone);
  };
  const vagas = async (est: Est) => (await team.overview(est.dono.userId, est.tenantId)).seats;
  const versaoDo = async (tenantId: string) =>
    ((await db.query('SELECT updated_at FROM tenants WHERE id = $1', [tenantId])) as { updated_at: Date }[])[0].updated_at.toISOString();

  beforeAll(async () => {
    await new Promise<void>((resolve) => caixa.server.listen(0, '127.0.0.1', resolve));
    const porta = (caixa.server.address() as AddressInfo).port;
    const directoryPath = path.dirname(fileURLToPath(import.meta.url));
    const entities: (new () => object)[] = [];
    for (const file of globSync(path.join(directoryPath, '../src/entities/**/*.entity.ts'))) {
      const exports = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
      for (const value of Object.values(exports)) if (typeof value === 'function') entities.push(value as new () => object);
    }
    db = new DataSource({ ...buildRuntimeDataSourceOptions(url!), entities, logging: ['error'] });
    await db.initialize();
    const valores: Record<string, string> = {
      EMAIL_PROVIDER: 'brevo',
      EMAIL_API_KEY: 'chave-local',
      EMAIL_FROM: 'nao-responda@example.test',
      EMAIL_API_BASE_URL: `http://127.0.0.1:${porta}`,
      FRONTEND_URL: 'http://localhost:3000',
    };
    const config = { get: (k: string) => valores[k], getOrThrow: (k: string) => valores[k] } as unknown as ConfigService;
    invites = new InvitesService(db, new AccountDelivery(db, config));
    team = new TeamService(db);
    const relogio = () => new Date();
    const disponibilidade = new AvailabilityService(db, relogio);
    appointments = new AppointmentsService(db, disponibilidade, new ConsumersService(db), relogio);
    agenda = new MyAgendaService(db, appointments);
    profissionais = new ProfessionalsService(db);
    admin = new AccountsAdminService(db);
    directory = new AccountsDirectoryService(db);
    auth = new AuthService(db);
    estabelecimentos = new EstablishmentAdminService(db);
    plataforma = new PlatformService(db);
    publico = new PublicBookingService(db, disponibilidade, appointments, relogio);
    hash = await hashPassword(SENHA);
    for (const max of [1, 2, 3, 5]) {
      planos[max] = id();
      await db.query(
        comTodosOsRecursos(`INSERT INTO plans (id, code, name, short_description, max_professionals, max_units) VALUES ($1, $2, $3, '', $4, 1)`),
        [planos[max], `${marca}-${max}`, `Plano de teste ${max}`, max],
      );
    }
  });

  afterAll(async () => {
    caixa.server.close();
    if (db?.isInitialized) await db.destroy();
  });

  it('plano de três, três profissionais: um login por profissional além do dono; o quarto não cabe', async () => {
    const est = await estabelecimento('tres', 3);
    const p = [await profissional(est, 'A'), await profissional(est, 'B'), await profissional(est, 'C')];
    // O dono também atende: o cadastro dele conta como profissional, o
    // acesso de dono não ocupa vaga de funcionário.
    await db.query(`UPDATE memberships SET professional_id = $1 WHERE user_id = $2`, [p[0], est.dono.userId]);
    expect(await codigo(convidar(est, p[0], 'tres-dono-de-novo'))).toBe('PROFISSIONAL_COM_ACESSO');
    await db.query(`UPDATE memberships SET professional_id = NULL WHERE user_id = $1`, [est.dono.userId]);

    const f1 = await funcionario(est, p[0], 'tres-1');
    await funcionario(est, p[1], 'tres-2');
    await convidar(est, p[2], 'tres-3');
    expect(f1.destination).toBe('/conta/minha-agenda');
    expect(await vagas(est)).toMatchObject({ limit: 3, activeAccesses: 2, pendingInvites: 1, used: 3, available: 0 });
    // Vincular login a profissional existente não cria profissional.
    const [{ total }] = await db.query(`SELECT count(*)::int AS total FROM professionals WHERE tenant_id = $1`, [est.tenantId]);
    expect(total).toBe(3);
    // Um quarto profissional não cabe no plano.
    expect(
      await codigo(profissionais.create(est.dono.userId, est.tenantId, { name: 'Quarta Pessoa', serviceIds: [] })),
    ).toBe('LIMITE_DE_PROFISSIONAIS');
    // Cada profissional, um acesso ou convite.
    expect(await codigo(convidar(est, p[1], 'tres-outra'))).toBe('PROFISSIONAL_COM_ACESSO');
    expect(await codigo(convidar(est, p[2], 'tres-outra'))).toBe('CONVITE_PENDENTE');
    const historico = await db.query(
      `SELECT action::text FROM audit_logs WHERE tenant_id = $1 AND action::text IN ('USER_INVITED', 'INVITE_ACCEPTED')`,
      [est.tenantId],
    );
    expect(historico).toHaveLength(5);
  });

  it('duas operações disputando a última vaga: uma passa, a outra é recusada', async () => {
    const est = await estabelecimento('corrida', 2);
    // Estabelecimento acima do limite antes desta regra (três ativos num
    // plano de dois): nada é desligado, mas as vagas de acesso valem.
    const p = [await profissional(est, 'A'), await profissional(est, 'B'), await profissional(est, 'C')];
    await convidar(est, p[0], 'corrida-1');
    const resultados = await Promise.allSettled([convidar(est, p[1], 'corrida-2'), convidar(est, p[2], 'corrida-3')]);
    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const recusa = resultados.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect((recusa.reason as ConflictException).getResponse()).toMatchObject({ code: 'LIMITE_DO_PLANO' });
    expect(await vagas(est)).toMatchObject({ used: 2, available: 0 });
    const [{ pendentes }] = await db.query(
      `SELECT count(*)::int AS pendentes FROM invites WHERE tenant_id = $1 AND status = 'PENDING'`,
      [est.tenantId],
    );
    expect(pendentes).toBe(2);
  });

  it('reenvio não ocupa outra vaga; revogação e expiração liberam; convite vencido só volta se couber', async () => {
    const est = await estabelecimento('reenvio', 2);
    const p = [await profissional(est, 'A'), await profissional(est, 'B')];
    const c1 = await convidar(est, p[0], 'reenvio-1');
    const reenviado = await invites.resendStaff(est.dono.userId, est.tenantId, c1.invite.id);
    expect(reenviado.invite.sendCount).toBe(2);
    expect(await vagas(est)).toMatchObject({ used: 1 });
    // O primeiro link deixou de valer; o novo vale.
    expect(caixa.recebidos.filter((m) => m.to === email('reenvio-1'))).toHaveLength(2);

    const c2 = await convidar(est, p[1], 'reenvio-2');
    expect(await vagas(est)).toMatchObject({ used: 2, available: 0 });
    await invites.revokeStaff(est.dono.userId, est.tenantId, c2.invite.id);
    expect(await vagas(est)).toMatchObject({ used: 1, available: 1 });
    await expect(invites.accept(ultimoToken(email('reenvio-2')), 'senha-qualquer-1', { now: new Date() })).rejects.toThrow(
      GoneException,
    );

    // Expira o primeiro: libera a vaga; outro ocupa; reenviar o vencido não cabe.
    await db.query(`UPDATE invites SET expires_at = now() - interval '1 minute', created_at = now() - interval '2 days' WHERE id = $1`, [
      c1.invite.id,
    ]);
    expect(await vagas(est)).toMatchObject({ used: 0 });
    await expect(invites.accept(ultimoToken(email('reenvio-1')), 'senha-qualquer-1', { now: new Date() })).rejects.toThrow(
      GoneException,
    );
    // Vencido pelo prazo e ainda não marcado: reenviar volta a ocupar a vaga,
    // mas só se couber. Vagas ocupadas por acessos ativos (sem novo convite,
    // que marcaria o vencido como EXPIRED):
    const p3 = await profissional(est, 'C');
    const ocupantes: string[] = [];
    for (const [nome, prof] of [['reenvio-x', p[1]], ['reenvio-y', p3]] as const) {
      const pessoa = await conta(nome);
      const vinculo = id();
      ocupantes.push(vinculo);
      await db.query(
        `INSERT INTO memberships (id, user_id, tenant_id, role, professional_id) VALUES ($1, $2, $3, 'PROFISSIONAL', $4)`,
        [vinculo, pessoa.userId, est.tenantId, prof],
      );
    }
    expect(await codigo(invites.resendStaff(est.dono.userId, est.tenantId, c1.invite.id))).toBe('LIMITE_DO_PLANO');
    await db.query('DELETE FROM memberships WHERE id = $1', [ocupantes[0]]);
    const devolvido = await invites.resendStaff(est.dono.userId, est.tenantId, c1.invite.id);
    expect(devolvido.invite.status).toBe('PENDING');
    expect(await vagas(est)).toMatchObject({ used: 2, available: 0 });
    // Um convite novo marca os vencidos; o marcado não é mais reenviado.
    await db.query(`UPDATE invites SET expires_at = now() - interval '1 minute' WHERE id = $1`, [c1.invite.id]);
    await convidar(est, p[1], 'reenvio-3');
    expect(await codigo(invites.resendStaff(est.dono.userId, est.tenantId, c1.invite.id))).toBe('CONVITE_ENCERRADO');
    // Convite de outro estabelecimento é inalcançável pelo dono.
    const outro = await estabelecimento('reenvio-outro', 2);
    await expect(invites.revokeStaff(outro.dono.userId, outro.tenantId, c1.invite.id)).rejects.toThrow(NotFoundException);
  });

  it('aceite revalida: profissional desativado depois do convite não vira acesso', async () => {
    const est = await estabelecimento('aceite', 3);
    const p = await profissional(est, 'A');
    await convidar(est, p, 'aceite-1');
    await profissionais.deactivate(est.dono.userId, est.tenantId, p);
    expect(await codigo(invites.accept(ultimoToken(email('aceite-1')), 'senha-qualquer-1', { now: new Date() }))).toBe(
      'PROFISSIONAL_INATIVO',
    );
    const [{ total }] = await db.query(`SELECT count(*)::int AS total FROM memberships WHERE tenant_id = $1`, [est.tenantId]);
    expect(total).toBe(1);
  });

  it('conta existente aceita com a própria senha: nome, senha e outros acessos ficam como estavam', async () => {
    const outra = await estabelecimento('existente-outra', 3);
    const est = await estabelecimento('existente', 3);
    const pessoa = await conta('existente-pessoa');
    await db.query(`INSERT INTO memberships (id, user_id, tenant_id, role) VALUES ($1, $2, $3, 'DONO')`, [
      id(),
      pessoa.userId,
      outra.tenantId,
    ]);
    const [antes] = await db.query(
      `SELECT u.name, c.password_hash FROM users u JOIN credentials c ON c.user_id = u.id WHERE u.id = $1`,
      [pessoa.userId],
    );
    const p = await profissional(est, 'A');
    const r = await invites.inviteStaff(est.dono.userId, est.tenantId, {
      requestKey: requestKey(),
      professionalId: p,
      name: 'Nome Que O Dono Digitou',
      email: email('existente-pessoa'),
    });
    expect(r.invite.targetUser?.hasCredential).toBe(true);
    await expect(invites.accept(ultimoToken(email('existente-pessoa')), 'senha-errada-123', { now: new Date() })).rejects.toThrow();
    await invites.accept(ultimoToken(email('existente-pessoa')), SENHA, { now: new Date() });
    const [depois] = await db.query(
      `SELECT u.name, c.password_hash FROM users u JOIN credentials c ON c.user_id = u.id WHERE u.id = $1`,
      [pessoa.userId],
    );
    expect(depois).toEqual(antes);
    const contextos = await auth.getSessionContext(pessoa.userId);
    expect(contextos.contexts.map((c) => [c.tenantId, c.role]).sort()).toEqual(
      [
        [outra.tenantId, 'DONO'],
        [est.tenantId, 'PROFISSIONAL'],
      ].sort(),
    );
    // O dono não usa este fluxo para o próprio e-mail.
    expect(
      await codigo(
        invites.inviteStaff(est.dono.userId, est.tenantId, {
          requestKey: requestKey(),
          professionalId: await profissional(est, 'B'),
          name: 'Eu Mesmo',
          email: email('existente-dono'),
        }),
      ),
    ).toBe('PROPRIA_CONTA');
  });

  it('funcionário vê só a própria agenda, com dados mínimos; colega, outro estabelecimento e ids trocados dão 404', async () => {
    const est = await estabelecimento('agenda', 3);
    const outro = await estabelecimento('agenda-outro', 3);
    const p1 = await profissional(est, 'A');
    const p2 = await profissional(est, 'B');
    const f1 = await funcionario(est, p1, 'agenda-1');
    await funcionario(est, p2, 'agenda-2');
    const daqui = new Date(Date.now() + 2 * 3_600_000);
    const minha = await reserva(est, p1, daqui);
    const doColega = await reserva(est, p2, daqui);
    const deFora = await reserva(outro, await profissional(outro, 'X'), daqui);

    const dia = await agenda.day(f1.userId, est.tenantId, { date: await diaLocal(est, daqui) });
    const ids = dia.appointments.map((a) => a.id);
    expect(ids).toContain(minha);
    expect(ids).not.toContain(doColega);
    expect(dia.professional.id).toBe(p1);
    expect(dia.appointments[0]).toMatchObject({ consumer: { name: 'Cliente Sigiloso' }, service: { name: 'Corte' } });
    const json = JSON.stringify(dia);
    expect(json).not.toMatch(/11999990000|observação interna|5000|priceCents|whatsapp|notes/);

    const instante = { expectedStartAt: daqui.toISOString() };
    await db.query(
      `INSERT INTO membership_permission_overrides (id, tenant_id, membership_id, permission, mode)
       VALUES ($1, $2, $3, 'ATENDIMENTO_PROPRIO_INICIAR', 'GRANTED')`,
      [id(), est.tenantId, f1.membershipId],
    );
    await expect(agenda.changeOwnStatus(f1.userId, est.tenantId, doColega, 'start', instante)).rejects.toThrow(NotFoundException);
    await expect(agenda.changeOwnStatus(f1.userId, est.tenantId, deFora, 'start', instante)).rejects.toThrow(NotFoundException);
    await expect(agenda.changeOwnStatus(f1.userId, outro.tenantId, deFora, 'start', instante)).rejects.toThrow(NotFoundException);
    await expect(agenda.day(f1.userId, outro.tenantId, { date: hoje() })).rejects.toThrow(NotFoundException);
    // As rotas do dono continuam fechadas ao funcionário.
    await expect(appointments.list(f1.userId, est.tenantId, { date: hoje() })).rejects.toThrow(ForbiddenException);
    await expect(team.overview(f1.userId, est.tenantId)).rejects.toThrow(ForbiddenException);
    await expect(profissionais.list(f1.userId, est.tenantId)).rejects.toThrow(ForbiddenException);
    await expect(appointments.listPending(f1.userId, est.tenantId)).rejects.toThrow(ForbiddenException);
    // Reservas do colega e de fora intactas.
    const estados = await db.query(`SELECT id, status::text FROM appointments WHERE id = ANY($1) ORDER BY id`, [[doColega, deFora]]);
    expect(estados.every((e: { status: string }) => e.status === 'CONFIRMED')).toBe(true);
    // O dono não vê agenda de funcionário por esta rota (a dele é a geral).
    await expect(agenda.day(est.dono.userId, est.tenantId, { date: hoje() })).rejects.toThrow(ForbiddenException);
  });

  it('agenda do funcionário perto da meia-noite: o dia é o do fuso do estabelecimento, não o UTC', async () => {
    const est = await estabelecimento('meia-noite', 3);
    const p1 = await profissional(est, 'A');
    const p2 = await profissional(est, 'B');
    const f1 = await funcionario(est, p1, 'meia-noite-1');
    // 01:18Z = 22:18 do dia 7 em São Paulo: o mesmo instante da falha do CI
    // (23:18Z + 2 h). Na data UTC já seria o dia 8.
    const fimDaNoite = new Date('2031-03-08T01:18:00.000Z');
    // Uma hora cada, sem sobreposição (restrição de exclusão por profissional).
    const ultimaHora = new Date('2031-03-08T02:20:00.000Z'); // 23:20 do dia 7
    const depoisDaVirada = new Date('2031-03-08T03:20:00.000Z'); // 00:20 do dia 8
    expect(fimDaNoite.toISOString().slice(0, 10)).toBe('2031-03-08');
    expect(await diaLocal(est, fimDaNoite)).toBe('2031-03-07');
    expect(await diaLocal(est, ultimaHora)).toBe('2031-03-07');
    expect(await diaLocal(est, depoisDaVirada)).toBe('2031-03-08');

    const r1 = await reserva(est, p1, fimDaNoite);
    const r2 = await reserva(est, p1, ultimaHora);
    const r3 = await reserva(est, p1, depoisDaVirada);
    const doColega = await reserva(est, p2, fimDaNoite);

    const dia7 = await agenda.day(f1.userId, est.tenantId, { date: '2031-03-07' });
    expect(dia7.professional.id).toBe(p1);
    expect(dia7.appointments.map((a) => a.id).sort()).toEqual([r1, r2].sort());
    const dia8 = await agenda.day(f1.userId, est.tenantId, { date: '2031-03-08' });
    expect(dia8.appointments.map((a) => a.id)).toEqual([r3]);
    // A reserva do colega, no mesmo instante, não aparece em dia nenhum.
    expect([...dia7.appointments, ...dia8.appointments].map((a) => a.id)).not.toContain(doColega);
  });

  it('ações liberadas uma a uma; permissão retirada vale na próxima requisição; dono só concede o que pode', async () => {
    const est = await estabelecimento('acoes', 3);
    const p = await profissional(est, 'A');
    const f = await funcionario(est, p, 'acoes-1');
    const comecou = new Date(Date.now() - 10 * 60_000);
    const r1 = await reserva(est, p, comecou);
    const r2 = await reserva(est, p, new Date(comecou.getTime() - 2 * 3_600_000));
    const em = (inicio: Date) => ({ expectedStartAt: inicio.toISOString() });

    // Inicial: só consultar.
    const antes = await agenda.day(f.userId, est.tenantId, { date: await diaLocal(est, comecou) });
    expect(antes.permissions).toEqual({ start: false, complete: false, 'no-show': false });
    expect(antes.appointments.every((a) => a.actions.length === 0)).toBe(true);
    await expect(agenda.changeOwnStatus(f.userId, est.tenantId, r1, 'start', em(comecou))).rejects.toThrow(ForbiddenException);

    // Sem reautenticação recente, o dono não muda permissões.
    expect(
      await codigo(
        team.setPermissions(est.dono.userId, est.dono.sessionId, est.tenantId, f.membershipId, {
          expectedGranted: [],
          granted: ['ATENDIMENTO_PROPRIO_INICIAR'],
        }),
      ),
    ).toBe('REAUTENTICACAO_NECESSARIA');
    await reauth(est.dono);
    await team.setPermissions(est.dono.userId, est.dono.sessionId, est.tenantId, f.membershipId, {
      expectedGranted: [],
      granted: ['ATENDIMENTO_PROPRIO_INICIAR', 'ATENDIMENTO_PROPRIO_FALTA'],
    });
    const iniciado = await agenda.changeOwnStatus(f.userId, est.tenantId, r1, 'start', em(comecou));
    expect(iniciado.status).toBe('IN_PROGRESS');
    // Concluir não foi liberado.
    await expect(agenda.changeOwnStatus(f.userId, est.tenantId, r1, 'complete', em(comecou))).rejects.toThrow(
      ForbiddenException,
    );
    // Mesmas regras de horário: tela desatualizada dá 409.
    expect(
      (await erroDe(agenda.changeOwnStatus(f.userId, est.tenantId, r2, 'no-show', em(comecou)))) instanceof ConflictException,
    ).toBe(true);
    // Retirada com a sessão do funcionário aberta: vale na próxima requisição.
    await team.setPermissions(est.dono.userId, est.dono.sessionId, est.tenantId, f.membershipId, {
      expectedGranted: ['ATENDIMENTO_PROPRIO_FALTA', 'ATENDIMENTO_PROPRIO_INICIAR'],
      granted: ['ATENDIMENTO_PROPRIO_INICIAR'],
    });
    const r2Inicio = new Date(comecou.getTime() - 2 * 3_600_000);
    await expect(agenda.changeOwnStatus(f.userId, est.tenantId, r2, 'no-show', em(r2Inicio))).rejects.toThrow(ForbiddenException);
    // Tela velha de permissões: 409, nada gravado.
    expect(
      await codigo(
        team.setPermissions(est.dono.userId, est.dono.sessionId, est.tenantId, f.membershipId, {
          expectedGranted: [],
          granted: [],
        }),
      ),
    ).toBe('ALTERADO_POR_OUTRA_TELA');
    // Dono com a agenda restrita não concede o que não pode fazer.
    const [donoVinculo] = await db.query(`SELECT id FROM memberships WHERE user_id = $1`, [est.dono.userId]);
    await db.query(
      `INSERT INTO membership_permission_overrides (id, tenant_id, membership_id, permission, mode) VALUES ($1, $2, $3, 'AGENDA_GERENCIAR', 'DENIED')`,
      [id(), est.tenantId, donoVinculo.id],
    );
    expect(
      await codigo(
        team.setPermissions(est.dono.userId, est.dono.sessionId, est.tenantId, f.membershipId, {
          expectedGranted: ['ATENDIMENTO_PROPRIO_INICIAR'],
          granted: ['ATENDIMENTO_PROPRIO_INICIAR', 'ATENDIMENTO_PROPRIO_CONCLUIR'],
        }),
      ),
    ).toBe('PERMISSAO_NAO_DISPONIVEL');
    // Dono sem a gestão de equipe não chega aqui.
    await db.query(
      `INSERT INTO membership_permission_overrides (id, tenant_id, membership_id, permission, mode) VALUES ($1, $2, $3, 'EQUIPE_GERENCIAR', 'DENIED')`,
      [id(), est.tenantId, donoVinculo.id],
    );
    await expect(team.overview(est.dono.userId, est.tenantId)).rejects.toThrow(ForbiddenException);
    const historico = await db.query(
      `SELECT new_data FROM audit_logs WHERE tenant_id = $1 AND action::text = 'USER_PERMISSION_CHANGED' ORDER BY occurred_at`,
      [est.tenantId],
    );
    expect(historico.map((h: { new_data: { granted: string[] } }) => h.new_data.granted)).toEqual([
      ['ATENDIMENTO_PROPRIO_FALTA', 'ATENDIMENTO_PROPRIO_INICIAR'],
      ['ATENDIMENTO_PROPRIO_INICIAR'],
    ]);
  });

  it('suspender, reativar e remover: só neste estabelecimento, com vaga, sem tocar na conta nem nas reservas', async () => {
    const est = await estabelecimento('suspensao', 1);
    const outra = await estabelecimento('suspensao-outra', 3);
    const p = await profissional(est, 'A');
    const f = await funcionario(est, p, 'suspensao-1');
    // A mesma pessoa é funcionária em outra empresa, com outro profissional.
    const pOutra = await profissional(outra, 'X');
    await invites.inviteStaff(outra.dono.userId, outra.tenantId, {
      requestKey: requestKey(),
      professionalId: pOutra,
      name: 'Mesma Pessoa',
      email: email('suspensao-1'),
    });
    await invites.accept(ultimoToken(email('suspensao-1')), 'senha-da-funcionaria-1', { now: new Date() });
    const futura = await reserva(est, p, new Date(Date.now() + 86_400_000));

    await reauth(est.dono);
    await team.suspend(est.dono.userId, est.dono.sessionId, est.tenantId, f.membershipId);
    // Sessão aberta: na próxima requisição já não opera aqui; na outra, sim.
    await expect(agenda.day(f.userId, est.tenantId, { date: hoje() })).rejects.toThrow(ForbiddenException);
    expect((await agenda.day(f.userId, outra.tenantId, { date: hoje() })).professional.id).toBe(pOutra);
    const contexto = await auth.getSessionContext(f.userId);
    expect(contexto.contexts.map((c) => c.tenantId)).toEqual([outra.tenantId]);
    expect(await vagas(est)).toMatchObject({ used: 0, suspendedAccesses: 1 });

    // Vaga ocupada por outro convite: reativar não cabe.
    const p2 = await profissional(est, 'B').catch(() => null);
    expect(p2).not.toBeNull();
    const c = await convidar(est, p2!, 'suspensao-2');
    expect(await codigo(team.reactivate(est.dono.userId, est.dono.sessionId, est.tenantId, f.membershipId))).toBe('LIMITE_DO_PLANO');
    await invites.revokeStaff(est.dono.userId, est.tenantId, c.invite.id);
    // Conta bloqueada pela plataforma: o dono não reativa.
    await db.query(`UPDATE users SET status = 'SUSPENDED' WHERE id = $1`, [f.userId]);
    expect(await codigo(team.reactivate(est.dono.userId, est.dono.sessionId, est.tenantId, f.membershipId))).toBe('CONTA_BLOQUEADA');
    await db.query(`UPDATE users SET status = 'ACTIVE' WHERE id = $1`, [f.userId]);
    await team.reactivate(est.dono.userId, est.dono.sessionId, est.tenantId, f.membershipId);
    expect((await agenda.day(f.userId, est.tenantId, { date: hoje() })).professional.id).toBe(p);

    // Remover: só este vínculo; conta, outro acesso e reservas ficam.
    await team.remove(est.dono.userId, est.dono.sessionId, est.tenantId, f.membershipId);
    await expect(agenda.day(f.userId, est.tenantId, { date: hoje() })).rejects.toThrow(NotFoundException);
    expect((await agenda.day(f.userId, outra.tenantId, { date: hoje() })).professional.id).toBe(pOutra);
    const [conta] = await db.query(`SELECT status FROM users WHERE id = $1`, [f.userId]);
    expect(conta.status).toBe('ACTIVE');
    const [ainda] = await db.query(`SELECT status::text, professional_id FROM appointments WHERE id = $1`, [futura]);
    expect(ainda).toEqual({ status: 'CONFIRMED', professional_id: p });
    const [{ ativos }] = await db.query(`SELECT count(*)::int AS ativos FROM professionals WHERE id = $1 AND active`, [p]);
    expect(ativos).toBe(1);
    // O dono de outra empresa não alcança este vínculo.
    const [vinculoOutra] = await db.query(`SELECT id FROM memberships WHERE user_id = $1 AND tenant_id = $2`, [
      f.userId,
      outra.tenantId,
    ]);
    await reauth(est.dono);
    await expect(team.suspend(est.dono.userId, est.dono.sessionId, est.tenantId, vinculoOutra.id)).rejects.toThrow(
      NotFoundException,
    );
    // O dono não suspende a si mesmo nem outro dono por aqui.
    const [donoVinculo] = await db.query(`SELECT id FROM memberships WHERE user_id = $1`, [est.dono.userId]);
    await expect(team.suspend(est.dono.userId, est.dono.sessionId, est.tenantId, donoVinculo.id)).rejects.toThrow(
      NotFoundException,
    );
    const acoes = await db.query(
      `SELECT action::text FROM audit_logs WHERE tenant_id = $1 AND target_user_id = $2 ORDER BY occurred_at`,
      [est.tenantId, f.userId],
    );
    expect(acoes.map((a: { action: string }) => a.action)).toEqual([
      'USER_INVITED',
      'INVITE_ACCEPTED',
      'MEMBERSHIP_SUSPENDED',
      'MEMBERSHIP_REACTIVATED',
      'MEMBERSHIP_REMOVED',
    ]);
  });

  it('profissional desativado: acesso operacional para, reservas ficam e o dono é avisado', async () => {
    const est = await estabelecimento('desativado', 3);
    const p = await profissional(est, 'A');
    const f = await funcionario(est, p, 'desativado-1');
    await reserva(est, p, new Date(Date.now() + 86_400_000));
    await reserva(est, p, new Date(Date.now() + 2 * 86_400_000), 'PENDING');
    const desativado = await profissionais.deactivate(est.dono.userId, est.tenantId, p);
    expect(desativado.futureAppointments).toBe(2);
    await expect(agenda.day(f.userId, est.tenantId, { date: hoje() })).rejects.toThrow(ForbiddenException);
    const visao = await team.overview(est.dono.userId, est.tenantId);
    const linha = visao.members.find((m) => m.professional.id === p)!;
    expect(linha.situation).toBe('PROFESSIONAL_INACTIVE');
    expect(linha.professional.futureAppointments).toBe(2);
    await profissionais.reactivate(est.dono.userId, est.tenantId, p);
    expect((await agenda.day(f.userId, est.tenantId, { date: hoje() })).professional.id).toBe(p);
  });

  it('plataforma: suspender, arquivar e reativar preservam dados e o acesso aos outros estabelecimentos', async () => {
    const master = await conta('ciclo-master', { role: 'MASTER_OWNER' });
    const delegado = await conta('ciclo-delegado', { role: 'MASTER_ADMIN' });
    await db.query(`UPDATE users SET platform_permissions = '{ESTABLISHMENTS_MANAGE}' WHERE id = $1`, [delegado.userId]);
    const est = await estabelecimento('ciclo', 3, 'TRIAL');
    const outra = await estabelecimento('ciclo-outra', 3);
    const p = await profissional(est, 'A');
    const f = await funcionario(est, p, 'ciclo-1');
    await db.query(`INSERT INTO memberships (id, user_id, tenant_id, role) VALUES ($1, $2, $3, 'DONO')`, [
      id(),
      est.dono.userId,
      outra.tenantId,
    ]);
    const marcada = await reserva(est, p, new Date(Date.now() + 86_400_000));
    await publico.updateSettings(est.dono.userId, est.tenantId, true);
    expect((await publico.profile(est.slug)).establishment.slug).toBe(est.slug);

    // Sem reautenticação; e o administrador delegado não muda a situação.
    expect(
      await codigo(estabelecimentos.suspend(master.userId, master.sessionId, est.tenantId, { expectedUpdatedAt: await versaoDo(est.tenantId), reason: 'Teste' })),
    ).toBe('REAUTENTICACAO_NECESSARIA');
    await reauth(delegado);
    await expect(
      estabelecimentos.suspend(delegado.userId, delegado.sessionId, est.tenantId, {
        expectedUpdatedAt: await versaoDo(est.tenantId),
        reason: 'Teste',
      }),
    ).rejects.toThrow(ForbiddenException);
    await reauth(master);
    await estabelecimentos.suspend(master.userId, master.sessionId, est.tenantId, {
      expectedUpdatedAt: await versaoDo(est.tenantId),
      reason: 'Pedido do responsável',
    });
    // Operação bloqueada; outros estabelecimentos continuam; dados intactos.
    await expect(publico.profile(est.slug)).rejects.toThrow(NotFoundException);
    await expect(agenda.day(f.userId, est.tenantId, { date: hoje() })).rejects.toThrow(NotFoundException);
    await expect(appointments.list(est.dono.userId, est.tenantId, { date: hoje() })).rejects.toThrow(NotFoundException);
    expect((await auth.getSessionContext(est.dono.userId)).contexts.map((c) => c.tenantId)).toEqual([outra.tenantId]);
    expect(
      await codigo(
        invites.inviteStaff(outra.dono.userId, est.tenantId, {
          requestKey: requestKey(),
          professionalId: p,
          name: 'Qualquer',
          email: email('ciclo-x'),
        }),
      ),
    ).toBeUndefined(); // 404 de estabelecimento: sem vínculo, sem código.

    // Arquivar: exige confirmar o endereço; preserva tudo.
    expect(
      await codigo(
        estabelecimentos.archive(master.userId, master.sessionId, est.tenantId, {
          expectedUpdatedAt: await versaoDo(est.tenantId),
          reason: 'Encerrou',
          confirmSlug: 'outro',
        }),
      ),
    ).toBe('CONFIRMACAO_DIFERENTE');
    await estabelecimentos.archive(master.userId, master.sessionId, est.tenantId, {
      expectedUpdatedAt: await versaoDo(est.tenantId),
      reason: 'Encerrou',
      confirmSlug: est.slug.toUpperCase(),
    });
    const [depois] = await db.query(
      `SELECT t.status::text, t.slug::text, (SELECT count(*)::int FROM memberships WHERE tenant_id = t.id) AS vinculos,
              (SELECT status::text FROM appointments WHERE id = $2) AS reserva
         FROM tenants t WHERE t.id = $1`,
      [est.tenantId, marcada],
    );
    expect(depois).toEqual({ status: 'ARCHIVED', slug: est.slug, vinculos: 2, reserva: 'CONFIRMED' });
    // Tela desatualizada: 409.
    expect(
      await codigo(
        estabelecimentos.reactivate(master.userId, master.sessionId, est.tenantId, {
          expectedUpdatedAt: new Date(0).toISOString(),
        }),
      ),
    ).toBe('ALTERADO_POR_OUTRA_TELA');
    await estabelecimentos.reactivate(master.userId, master.sessionId, est.tenantId, {
      expectedUpdatedAt: await versaoDo(est.tenantId),
    });
    const [voltou] = await db.query(`SELECT status::text, restore_status FROM tenants WHERE id = $1`, [est.tenantId]);
    expect(voltou).toEqual({ status: 'TRIAL', restore_status: null });
    expect((await agenda.day(f.userId, est.tenantId, { date: hoje() })).professional.id).toBe(p);
    const historico = await db.query(
      `SELECT action::text, actor_user_id FROM audit_logs WHERE tenant_id = $1 AND action::text LIKE 'TENANT_%' ORDER BY occurred_at`,
      [est.tenantId],
    );
    expect(historico.map((h: { action: string }) => h.action)).toEqual(['TENANT_SUSPENDED', 'TENANT_ARCHIVED', 'TENANT_REACTIVATED']);
    expect(historico.every((h: { actor_user_id: string }) => h.actor_user_id === master.userId)).toBe(true);
  });

  it('plataforma: editar preserva o endereço; trocar para plano menor é recusado até o uso caber', async () => {
    const master = await conta('plano-master', { role: 'MASTER_OWNER' });
    const est = await estabelecimento('plano', 3);
    const p = [await profissional(est, 'A'), await profissional(est, 'B')];
    const f1 = await funcionario(est, p[0], 'plano-1');
    await convidar(est, p[1], 'plano-2');

    await estabelecimentos.update(master.userId, est.tenantId, {
      expectedUpdatedAt: await versaoDo(est.tenantId),
      name: `${marca} Nome Novo`,
      taxDocument: '12345678000190',
    });
    const [editado] = await db.query(
      `SELECT t.slug::text, t.tax_document, u.name FROM tenants t JOIN units u ON u.tenant_id = t.id AND u.is_primary WHERE t.id = $1`,
      [est.tenantId],
    );
    expect(editado).toEqual({ slug: est.slug, tax_document: '12345678000190', name: `${marca} Nome Novo` });

    const ficha = await plataforma.detail(master.userId, est.tenantId);
    expect(ficha.usage.staffSeats).toMatchObject({ used: 2, limit: 3 });
    expect(ficha.planOptions.find((o) => o.id === planos[1])!.excess.map((e) => e.kind)).toEqual([
      'PROFESSIONALS',
      'STAFF_ACCESSES',
    ]);
    expect(ficha.planOptions.find((o) => o.id === planos[5])!.excess).toEqual([]);

    await reauth(master);
    const recusa = await erroDe(
      estabelecimentos.changePlan(master.userId, master.sessionId, est.tenantId, {
        expectedUpdatedAt: await versaoDo(est.tenantId),
        planId: planos[1],
      }),
    );
    expect(recusa.getResponse!()).toMatchObject({ code: 'PLANO_EXCEDIDO' });
    const [semMudanca] = await db.query(`SELECT plan_id FROM tenants WHERE id = $1`, [est.tenantId]);
    expect(semMudanca.plan_id).toBe(planos[3]);
    // Ninguém foi desligado para caber.
    expect((await agenda.day(f1.userId, est.tenantId, { date: hoje() })).professional.id).toBe(p[0]);

    // Ajustado (convite revogado, um profissional desativado), cabe no plano de 1.
    const pendente = (await team.overview(est.dono.userId, est.tenantId)).members.find((m) => m.invite)!.invite!;
    await invites.revokeStaff(est.dono.userId, est.tenantId, pendente.id);
    await profissionais.deactivate(est.dono.userId, est.tenantId, p[1]);
    await estabelecimentos.changePlan(master.userId, master.sessionId, est.tenantId, {
      expectedUpdatedAt: await versaoDo(est.tenantId),
      planId: planos[1],
    });
    expect(await vagas(est)).toMatchObject({ limit: 1, used: 1, available: 0 });
    const [mudou] = await db.query(
      `SELECT previous_data, new_data FROM audit_logs WHERE tenant_id = $1 AND action::text = 'TENANT_PLAN_CHANGED'`,
      [est.tenantId],
    );
    expect(mudou.new_data.planId).toBe(planos[1]);
    // Suporte e administradores sem a capacidade não trocam plano.
    const suporte = await conta('plano-suporte', { role: 'MASTER_SUPPORT' });
    await reauth(suporte);
    await expect(
      estabelecimentos.changePlan(suporte.userId, suporte.sessionId, est.tenantId, {
        expectedUpdatedAt: await versaoDo(est.tenantId),
        planId: planos[5],
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('a ficha da administração mostra o vínculo do funcionário com situação e profissional', async () => {
    const master = await conta('ficha-master', { role: 'MASTER_OWNER' });
    const est = await estabelecimento('ficha', 3);
    const p = await profissional(est, 'A');
    const f = await funcionario(est, p, 'ficha-1');
    await reauth(est.dono);
    await team.suspend(est.dono.userId, est.dono.sessionId, est.tenantId, f.membershipId);
    const membros = await directory.establishmentMembers(master.userId, est.tenantId);
    const funcionaria = membros.members.find((m) => m.user.id === f.userId)!;
    expect(funcionaria).toMatchObject({
      role: 'PROFISSIONAL',
      status: 'SUSPENDED',
      professional: { id: p, active: true },
      ineffectiveOverrides: [],
    });
    const senha = await db.query(`SELECT password_hash FROM credentials WHERE user_id = $1`, [f.userId]);
    expect(await verifyPassword(senha[0].password_hash, 'senha-da-funcionaria-1')).toBe(true);
  });
});
