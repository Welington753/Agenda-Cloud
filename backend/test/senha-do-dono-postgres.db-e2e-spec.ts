// Senha escolhida pelo dono para o acesso interno e calendário individual do
// funcionário, contra PostgreSQL DESCARTÁVEL (as 11 migrations aplicadas, sem
// migration nova): criação com senha definitiva, login sem troca
// obrigatória, repetição do formulário sem nova conta nem nova senha, nova
// senha definida pelo dono (senha e sessões anteriores invalidadas), troca
// voluntária, contas antigas com senha temporária preservadas, recusas de
// alcance e o isolamento da agenda entre dois profissionais no mesmo dia.
// Também: a edição de perfil e profissional de um acesso existente (mesmo
// vínculo, sem mover reservas, sem conceder nada sozinha, valendo na próxima
// requisição) e os logs de uma gravação de credencial que falha (sem senha,
// hash nem token).
import { randomUUID } from 'node:crypto';
import { inspect } from 'node:util';
import { globSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DataSource, QueryFailedError } from 'typeorm';
import { ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DatabaseErrorFilter } from '../src/common/database-error.filter.js';
import { buildRuntimeDataSourceOptions } from '../src/database/runtime-data-source.js';
import { hashPassword, verifyPassword } from '../src/auth/password-hasher.js';
import { AuthService } from '../src/auth/auth.service.js';
import { loginSchema } from '../src/auth/login.dto.js';
import { SessionGuard } from '../src/auth/session.guard.js';
import { hashSessionToken } from '../src/auth/session-token.js';
import { AppointmentsService } from '../src/appointments/appointments.service.js';
import { ownAgendaPeriodSchema } from '../src/appointments/appointment.dto.js';
import { AvailabilityService } from '../src/availability/availability.service.js';
import { ConsumersService } from '../src/consumers/consumers.service.js';
import { MyAgendaService } from '../src/team/my-agenda.service.js';
import { StaffAccountsService } from '../src/team/staff-accounts.service.js';
import { TeamService } from '../src/team/team.service.js';
import { staffAccessChangeSchema, staffAccountSchema, staffPasswordSchema } from '../src/team/team.dto.js';
import { comTodosOsRecursos } from './support/plano-de-teste.js';

const url = process.env.DB_E2E_DIRECT_URL;
if (url && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)) {
  throw new Error('Este teste exige PostgreSQL descartável local.');
}
const id = () => randomUUID().replaceAll('-', '').slice(0, 24);
const SENHA = 'senha-de-teste-forte-1';
const ESCOLHIDA = 'escolhida-pelo-dono-1';
const OUTRA = 'outra-senha-do-dono-2';

const erroDe = async (promessa: Promise<unknown>) => {
  try {
    await promessa;
  } catch (error) {
    return error as Error & { getResponse?: () => { code?: string } };
  }
  throw new Error('era esperado um erro');
};
const codigo = async (promessa: Promise<unknown>) => (await erroDe(promessa)).getResponse?.()?.code;

describe.skipIf(!url)('senha do dono e calendário do funcionário contra PostgreSQL descartável', () => {
  let db: DataSource;
  let contas: StaffAccountsService;
  let auth: AuthService;
  let agenda: MyAgendaService;
  let team: TeamService;
  let appointments: AppointmentsService;
  let hash: string;
  const marca = `senhadono${id().slice(0, 8)}`;
  let plano: string;

  async function conta(nome: string, opcoes: { email?: string | null; role?: string } = {}) {
    const userId = id();
    await db.query(
      `INSERT INTO users (id, name, email, status, platform_role, email_verified) VALUES ($1, $2, $3, 'ACTIVE', $4::platform_role, true)`,
      [userId, `Pessoa ${nome}`, opcoes.email === undefined ? `${marca}-${nome}@example.test` : opcoes.email, opcoes.role ?? null],
    );
    await db.query(`INSERT INTO credentials (id, user_id, password_hash, algorithm) VALUES ($1, $2, $3, 'argon2id')`, [
      id(),
      userId,
      hash,
    ]);
    return { userId, sessionId: await sessao(userId) };
  }

  async function sessao(userId: string, token = id() + id()) {
    const sessionId = id();
    await db.query(
      `INSERT INTO sessions (id, user_id, token_hash, expires_at, reauthenticated_at) VALUES ($1, $2, $3, now() + interval '1 day', now())`,
      [sessionId, userId, hashSessionToken(token)],
    );
    return sessionId;
  }

  async function estabelecimento(nome: string) {
    const tenantId = id();
    const unitId = id();
    await db.query(
      `INSERT INTO tenants (id, slug, category, timezone, plan_id, status, access_legacy_since) VALUES ($1, $2, 'OTHER', 'America/Sao_Paulo', $3, 'ACTIVE', now())`,
      [tenantId, `${marca}-${nome}`, plano],
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
    return { tenantId, unitId, dono, serviceId };
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

  async function reserva(est: Est, professionalId: string, inicio: Date, cliente: string) {
    const appointmentId = id();
    const consumerId = id();
    await db.query(
      `INSERT INTO consumers (id, tenant_id, name, whatsapp, whatsapp_normalized) VALUES ($1, $2, $3, '11999990000', $4)`,
      [consumerId, est.tenantId, cliente, `5511${Math.floor(Math.random() * 1e9)}`],
    );
    await db.query(
      `INSERT INTO appointments (id, tenant_id, unit_id, consumer_id, consumer_name_snapshot, consumer_whatsapp_snapshot,
          professional_id, start_at, end_at, status)
       VALUES ($1, $2, $3, $4, $5, '11999990000', $6, $7, $8, 'CONFIRMED')`,
      [appointmentId, est.tenantId, est.unitId, consumerId, cliente, professionalId, inicio, new Date(inicio.getTime() + 3_600_000)],
    );
    await db.query(
      `INSERT INTO appointment_items (id, tenant_id, appointment_id, service_id, duration_minutes_snapshot, price_cents_snapshot)
       VALUES ($1, $2, $3, $4, 60, 5000)`,
      [id(), est.tenantId, appointmentId, est.serviceId],
    );
    return appointmentId;
  }

  /** Mesmo caminho da rota: o corpo passa pelo schema do controller. */
  const criar = (est: Est, professionalId: string, username: string, extra: Record<string, unknown> = {}) =>
    contas.create(
      est.dono.userId,
      est.dono.sessionId,
      est.tenantId,
      staffAccountSchema.parse({
        requestKey: `chave-${id()}`,
        professionalId,
        name: `Funcionária ${username}`,
        username,
        permissions: [],
        password: ESCOLHIDA,
        ...extra,
      }),
    );
  const definir = (est: Est, membershipId: string, password: string) =>
    contas.setPassword(est.dono.userId, est.dono.sessionId, est.tenantId, membershipId, staffPasswordSchema.parse({ password }).password);

  const login = (identificador: string, password: string) =>
    auth.login(loginSchema.parse({ login: identificador, password }), { now: new Date(), userAgent: 'teste', ipAddress: '127.0.0.1' });

  /** O guard real numa rota operacional (sem `@PermiteSenhaTemporaria`). */
  async function rotaOperacional(token: string) {
    const guard = new SessionGuard(db, new Reflector());
    const contexto = {
      switchToHttp: () => ({ getRequest: () => ({ cookies: { session_token: token } }) }),
      getHandler: () => TeamService.prototype.overview,
      getClass: () => TeamService,
    } as unknown as ExecutionContext;
    return guard.canActivate(contexto);
  }

  const usuarioDe = async (userId: string) =>
    (
      await db.query(`SELECT must_change_password FROM users WHERE id = $1`, [userId])
    )[0] as { must_change_password: boolean };
  const hashDe = async (userId: string) =>
    ((await db.query(`SELECT password_hash FROM credentials WHERE user_id = $1`, [userId]))[0] as { password_hash: string })
      .password_hash;

  beforeAll(async () => {
    const directoryPath = path.dirname(fileURLToPath(import.meta.url));
    const entities: (new () => object)[] = [];
    for (const file of globSync(path.join(directoryPath, '../src/entities/**/*.entity.ts'))) {
      const exports = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
      for (const value of Object.values(exports)) if (typeof value === 'function') entities.push(value as new () => object);
    }
    db = new DataSource({ ...buildRuntimeDataSourceOptions(url!), entities, logging: ['error'] });
    await db.initialize();
    contas = new StaffAccountsService(db);
    auth = new AuthService(db);
    const relogio = () => new Date();
    appointments = new AppointmentsService(db, new AvailabilityService(db, relogio), new ConsumersService(db), relogio);
    agenda = new MyAgendaService(db, appointments);
    team = new TeamService(db);
    hash = await hashPassword(SENHA);
    plano = id();
    await db.query(
      comTodosOsRecursos(`INSERT INTO plans (id, code, name, short_description, max_professionals, max_units) VALUES ($1, $2, 'Plano 5', '', 5, 1)`),
      [plano, `${marca}-5`],
    );
  });

  afterAll(async () => {
    if (db?.isInitialized) await db.destroy();
  });

  it('criação com senha escolhida: definitiva, fora da resposta, do histórico e da chave; repetição não cria nem troca', async () => {
    const est = await estabelecimento('cria');
    const p = await profissional(est, 'Ana');
    const corpo = {
      requestKey: `chave-${id()}`,
      professionalId: p,
      name: 'Ana Funcionária',
      username: `${marca}.ana`,
      permissions: [],
      password: ESCOLHIDA,
    };
    const criado = await contas.create(est.dono.userId, est.dono.sessionId, est.tenantId, staffAccountSchema.parse(corpo));
    expect(criado).toMatchObject({ created: true, username: `${marca}.ana`, temporaryPassword: null });
    expect(JSON.stringify(criado)).not.toContain(ESCOLHIDA);
    expect(await usuarioDe(criado.userId)).toEqual({ must_change_password: false });
    const hashCriado = await hashDe(criado.userId);
    expect(hashCriado).not.toContain(ESCOLHIDA);
    expect(await verifyPassword(hashCriado, ESCOLHIDA)).toBe(true);

    // Nada da senha no histórico nem na chave do formulário.
    const historico = await db.query(`SELECT summary, new_data::text AS dados FROM audit_logs WHERE target_user_id = $1`, [
      criado.userId,
    ]);
    expect(historico).toHaveLength(1);
    expect(historico[0].summary).toMatch(/senha definida pelo responsável/);
    expect(JSON.parse(historico[0].dados)).toMatchObject({ mustChangePassword: false });
    const chave = await db.query(`SELECT row_to_json(r)::text AS linha FROM staff_account_requests r WHERE user_id = $1`, [
      criado.userId,
    ]);
    for (const texto of [JSON.stringify(historico), JSON.stringify(chave)]) {
      expect(texto).not.toContain(ESCOLHIDA);
      expect(texto).not.toContain(hashCriado);
    }

    // O mesmo formulário de novo, até com outra senha: o mesmo acesso, sem
    // conta nova e sem mexer na senha gravada.
    const repetido = await contas.create(
      est.dono.userId,
      est.dono.sessionId,
      est.tenantId,
      staffAccountSchema.parse({ ...corpo, password: OUTRA }),
    );
    expect(repetido).toEqual({ ...criado, created: false });
    expect(await hashDe(criado.userId)).toBe(hashCriado);
    const [{ total }] = await db.query(`SELECT count(*)::int AS total FROM users WHERE username::text = $1`, [`${marca}.ana`]);
    expect(total).toBe(1);
    expect(await db.query(`SELECT 1 FROM audit_logs WHERE target_user_id = $1`, [criado.userId])).toHaveLength(1);

    // Login direto, sem troca obrigatória: as rotas operacionais abrem.
    const entrada = await login(`${marca}.ana`, ESCOLHIDA);
    expect(entrada.user).toMatchObject({ username: `${marca}.ana`, mustChangePassword: false });
    await expect(rotaOperacional(entrada.token)).resolves.toBe(true);
  });

  it('a política de senha vale no servidor', () => {
    const base = { requestKey: `chave-${id()}`, professionalId: id(), name: 'Pessoa', username: `${marca}.politica`, permissions: [] };
    expect(staffAccountSchema.safeParse({ ...base, password: 'curta' }).success).toBe(false);
    expect(staffAccountSchema.safeParse({ ...base, password: 'a'.repeat(129) }).success).toBe(false);
    expect(staffAccountSchema.safeParse({ ...base, password: 'a'.repeat(10) }).success).toBe(true);
    expect(staffPasswordSchema.safeParse({ password: '123456789' }).success).toBe(false);
    expect(staffPasswordSchema.safeParse({ password: ESCOLHIDA, mustChangePassword: true }).success).toBe(false);
  });

  it('nova senha do dono: definitiva, invalida senha e sessões anteriores, histórico sem senha', async () => {
    const est = await estabelecimento('redefine');
    const p = await profissional(est, 'Bia');
    const criado = await criar(est, p, `${marca}.bia`);
    const antes = await login(`${marca}.bia`, ESCOLHIDA);
    await sessao(criado.userId);

    const resposta = await definir(est, criado.membershipId, OUTRA);
    expect(resposta).toEqual({ membershipId: criado.membershipId, username: `${marca}.bia` });
    expect(await usuarioDe(criado.userId)).toEqual({ must_change_password: false });
    const sessoes = await db.query(`SELECT revoked_at FROM sessions WHERE user_id = $1`, [criado.userId]);
    expect(sessoes.length).toBeGreaterThanOrEqual(2);
    expect(sessoes.every((s: { revoked_at: Date | null }) => s.revoked_at !== null)).toBe(true);
    await expect(rotaOperacional(antes.token)).rejects.toThrow(UnauthorizedException);

    await expect(login(`${marca}.bia`, ESCOLHIDA)).rejects.toThrow();
    const depois = await login(`${marca}.bia`, OUTRA);
    expect(depois.user.mustChangePassword).toBe(false);
    await expect(rotaOperacional(depois.token)).resolves.toBe(true);

    const historico = await db.query(
      `SELECT actor_user_id, tenant_id, summary, new_data::text AS dados FROM audit_logs
        WHERE target_user_id = $1 AND action = 'STAFF_PASSWORD_RESET'`,
      [criado.userId],
    );
    expect(historico).toHaveLength(1);
    expect(historico[0]).toMatchObject({ actor_user_id: est.dono.userId, tenant_id: est.tenantId });
    expect(historico[0].summary).toMatch(/definida pelo responsável/);
    expect(JSON.stringify(historico)).not.toContain(OUTRA);
    expect(JSON.stringify(historico)).not.toContain(await hashDe(criado.userId));

    // Sem senha do dono confirmada há pouco: nada muda.
    const hashAtual = await hashDe(criado.userId);
    await db.query(`UPDATE sessions SET reauthenticated_at = now() - interval '1 hour' WHERE id = $1`, [est.dono.sessionId]);
    expect(await codigo(definir(est, criado.membershipId, 'mais-uma-senha-3'))).toBe('REAUTENTICACAO_NECESSARIA');
    expect(await hashDe(criado.userId)).toBe(hashAtual);
    await db.query(`UPDATE sessions SET reauthenticated_at = now() WHERE id = $1`, [est.dono.sessionId]);
  });

  it('troca voluntária pelo Perfil: exige a senha atual e encerra as outras sessões', async () => {
    const est = await estabelecimento('voluntaria');
    const p = await profissional(est, 'Cris');
    const criado = await criar(est, p, `${marca}.cris`);
    const entrada = await login(`${marca}.cris`, ESCOLHIDA);
    const [atual] = await db.query(`SELECT id FROM sessions WHERE token_hash = $1`, [hashSessionToken(entrada.token)]);
    const outra = await sessao(criado.userId);
    await expect(
      auth.changePassword(criado.userId, atual.id, { currentPassword: 'nao-e-essa-123', newPassword: 'minha-propria-1' }, new Date()),
    ).rejects.toThrow(UnauthorizedException);
    await auth.changePassword(criado.userId, atual.id, { currentPassword: ESCOLHIDA, newPassword: 'minha-propria-1' }, new Date());
    await expect(rotaOperacional(entrada.token)).resolves.toBe(true);
    const [s] = await db.query(`SELECT revoked_at FROM sessions WHERE id = $1`, [outra]);
    expect(s.revoked_at).not.toBeNull();
    expect((await login(`${marca}.cris`, 'minha-propria-1')).user.mustChangePassword).toBe(false);
    await expect(login(`${marca}.cris`, ESCOLHIDA)).rejects.toThrow();
  });

  it('contas antigas com senha temporária continuam com a troca obrigatória; nada é limpo em massa', async () => {
    const est = await estabelecimento('antigas');
    const [p1, p2] = [await profissional(est, 'Antiga'), await profissional(est, 'Nova')];
    // Corpo da tela anterior (sem senha): temporária, troca obrigatória.
    const antiga = await contas.create(
      est.dono.userId,
      est.dono.sessionId,
      est.tenantId,
      staffAccountSchema.parse({ requestKey: `chave-${id()}`, professionalId: p1, name: 'Antiga', username: `${marca}.antiga`, permissions: [] }),
    );
    expect(antiga.temporaryPassword).toMatch(/^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/);
    expect(await usuarioDe(antiga.userId)).toEqual({ must_change_password: true });

    // Criar e redefinir OUTRA conta não toca nesta.
    const nova = await criar(est, p2, `${marca}.nova`);
    await definir(est, nova.membershipId, OUTRA);
    expect(await usuarioDe(antiga.userId)).toEqual({ must_change_password: true });
    const entrada = await login(`${marca}.antiga`, antiga.temporaryPassword!);
    expect(entrada.user.mustChangePassword).toBe(true);
    expect(await codigo(rotaOperacional(entrada.token))).toBe('TROCA_DE_SENHA_OBRIGATORIA');

    // A rota antiga de senha temporária continua marcando a troca.
    const temporaria = await contas.resetTemporaryPassword(est.dono.userId, est.dono.sessionId, est.tenantId, nova.membershipId);
    expect(await usuarioDe(nova.userId)).toEqual({ must_change_password: true });
    expect((await login(`${marca}.nova`, temporaria.temporaryPassword)).user.mustChangePassword).toBe(true);

    // Só a conta redefinida pelo dono sai da troca obrigatória.
    await definir(est, antiga.membershipId, 'definitiva-da-antiga-1');
    expect(await usuarioDe(antiga.userId)).toEqual({ must_change_password: false });
    expect(await usuarioDe(nova.userId)).toEqual({ must_change_password: true });
  });

  it('recusas: e-mail real, conta compartilhada, papel de plataforma, outro estabelecimento, o próprio dono, bloqueada', async () => {
    const est = await estabelecimento('recusas');
    const outro = await estabelecimento('recusas-outro');
    const [p1, p2, p3, p4] = await Promise.all(['R1', 'R2', 'R3', 'R4'].map((n) => profissional(est, n)));
    const naoMuda = async (userId: string, membershipId: string, esperado: string | undefined) => {
      const antes = await hashDe(userId);
      const recusa = await erroDe(definir(est, membershipId, 'tentativa-indevida-1'));
      if (esperado) expect(recusa.getResponse?.()?.code).toBe(esperado);
      expect(await hashDe(userId)).toBe(antes);
      return recusa;
    };

    // Conta com e-mail real (convite antigo).
    const comEmail = await conta('recusa-email');
    const vinculoComEmail = id();
    await db.query(`INSERT INTO memberships (id, user_id, tenant_id, role, professional_id) VALUES ($1, $2, $3, 'PROFISSIONAL', $4)`, [
      vinculoComEmail,
      comEmail.userId,
      est.tenantId,
      p1,
    ]);
    await naoMuda(comEmail.userId, vinculoComEmail, 'SENHA_NAO_E_DO_ESTABELECIMENTO');

    // Conta compartilhada: também trabalha em outro estabelecimento.
    const dupla = await criar(est, p2, `${marca}.dupla`);
    await db.query(`INSERT INTO memberships (id, user_id, tenant_id, role, professional_id) VALUES ($1, $2, $3, 'PROFISSIONAL', $4)`, [
      id(),
      dupla.userId,
      outro.tenantId,
      await profissional(outro, 'Fora'),
    ]);
    await naoMuda(dupla.userId, dupla.membershipId, 'SENHA_NAO_E_DO_ESTABELECIMENTO');

    // Papel na plataforma.
    const suporte = await criar(est, p3, `${marca}.suporte`);
    await db.query(`UPDATE users SET platform_role = 'MASTER_SUPPORT' WHERE id = $1`, [suporte.userId]);
    await naoMuda(suporte.userId, suporte.membershipId, 'SENHA_NAO_E_DO_ESTABELECIMENTO');

    // Outro estabelecimento não alcança o vínculo daqui (404, como inexistente).
    const daqui = await criar(est, p4, `${marca}.daqui`);
    const antes = await hashDe(daqui.userId);
    expect(
      await erroDe(contas.setPassword(outro.dono.userId, outro.dono.sessionId, outro.tenantId, daqui.membershipId, 'tentativa-indevida-1')),
    ).toBeInstanceOf(NotFoundException);
    // Nem com o id deste estabelecimento: o outro dono não tem vínculo aqui.
    expect(
      await erroDe(contas.setPassword(outro.dono.userId, outro.dono.sessionId, est.tenantId, daqui.membershipId, 'tentativa-indevida-1')),
    ).toBeInstanceOf(NotFoundException);
    expect(await hashDe(daqui.userId)).toBe(antes);

    // O vínculo de DONO não é acesso de equipe.
    const [vinculoDono] = await db.query(`SELECT id FROM memberships WHERE user_id = $1 AND tenant_id = $2`, [
      est.dono.userId,
      est.tenantId,
    ]);
    expect(await naoMuda(est.dono.userId, vinculoDono.id, undefined)).toBeInstanceOf(NotFoundException);

    // Funcionário (nem gerente) não define senha de ninguém.
    const entradaDaqui = await login(`${marca}.daqui`, ESCOLHIDA);
    const [sessaoDaqui] = await db.query(`SELECT id FROM sessions WHERE token_hash = $1`, [hashSessionToken(entradaDaqui.token)]);
    await db.query(`UPDATE sessions SET reauthenticated_at = now() WHERE id = $1`, [sessaoDaqui.id]);
    expect(
      await erroDe(contas.setPassword(daqui.userId, sessaoDaqui.id, est.tenantId, suporte.membershipId, 'tentativa-indevida-1')),
    ).toBeInstanceOf(ForbiddenException);

    // Conta bloqueada pela plataforma.
    await db.query(`UPDATE users SET status = 'SUSPENDED' WHERE id = $1`, [daqui.userId]);
    await naoMuda(daqui.userId, daqui.membershipId, 'CONTA_BLOQUEADA');
  });

  it('calendário: dois profissionais no mesmo dia; cada um só vê os próprios em mês, semana e dia', async () => {
    const est = await estabelecimento('calendario');
    const [pa, pb] = [await profissional(est, 'Alfa'), await profissional(est, 'Beta')];
    const a = await criar(est, pa, `${marca}.alfa`);
    const b = await criar(est, pb, `${marca}.beta`);
    // 2031-03-12 (quarta), no fuso de São Paulo (UTC-3): 10h e 14h de cada um.
    const ra = [
      await reserva(est, pa, new Date('2031-03-12T13:00:00Z'), 'Cliente da Alfa 1'),
      await reserva(est, pa, new Date('2031-03-12T17:00:00Z'), 'Cliente da Alfa 2'),
    ];
    const rb = [
      await reserva(est, pb, new Date('2031-03-12T14:00:00Z'), 'Cliente do Beta 1'),
      await reserva(est, pb, new Date('2031-03-12T18:00:00Z'), 'Cliente do Beta 2'),
    ];
    // Fora do dia, mas na mesma semana e mês, e perto da meia-noite local.
    const raNoite = await reserva(est, pa, new Date('2031-03-14T02:30:00Z'), 'Cliente da Alfa noite');

    const periodos = {
      mes: { from: '2031-03-01', to: '2031-04-11' },
      semana: { from: '2031-03-09', to: '2031-03-15' },
      dia: { from: '2031-03-12', to: '2031-03-12' },
    };
    for (const [visao, periodo] of Object.entries(periodos)) {
      const query = ownAgendaPeriodSchema.parse(periodo);
      const daAlfa = await agenda.range(a.userId, est.tenantId, query);
      const doBeta = await agenda.range(b.userId, est.tenantId, query);
      const idsAlfa = daAlfa.appointments.map((x) => x.id);
      const idsBeta = doBeta.appointments.map((x) => x.id);
      expect(idsAlfa, visao).toEqual(visao === 'dia' ? ra : [...ra, raNoite]);
      expect(idsBeta, visao).toEqual(rb);
      expect(daAlfa.professional.id).toBe(pa);
      expect(doBeta.professional.id).toBe(pb);
      expect(JSON.stringify(daAlfa)).not.toMatch(/Cliente do Beta/);
      expect(JSON.stringify(doBeta)).not.toMatch(/Cliente da Alfa/);
    }
    // 23:30 de 13/03 em São Paulo: fica no dia 13 do fuso do estabelecimento.
    const noite = await agenda.range(a.userId, est.tenantId, ownAgendaPeriodSchema.parse({ from: '2031-03-13', to: '2031-03-13' }));
    expect(noite.appointments.map((x) => [x.id, x.localDate, x.localStart])).toEqual([[raNoite, '2031-03-13', '23:30']]);

    // A lista do dia (a outra rota) tem o mesmo recorte.
    const diaAlfa = await agenda.day(a.userId, est.tenantId, { date: '2031-03-12' });
    expect(diaAlfa.appointments.map((x) => x.id)).toEqual(ra);
    expect(Object.keys(diaAlfa.appointments[0]).sort()).toEqual(
      ['actions', 'consumer', 'durationMinutes', 'id', 'localDate', 'localServiceEnd', 'localStart', 'service', 'startAt', 'status'].sort(),
    );

    // A agenda do estabelecimento continua só do dono, e com os dois.
    const doDono = await appointments.listRange(est.dono.userId, est.tenantId, { from: '2031-03-12', to: '2031-03-12' });
    expect(doDono.appointments.map((x) => x.id).sort()).toEqual([...ra, ...rb].sort());
    await expect(appointments.listRange(a.userId, est.tenantId, { from: '2031-03-12', to: '2031-03-12' })).rejects.toThrow(
      ForbiddenException,
    );
    await expect(appointments.list(b.userId, est.tenantId, { date: '2031-03-12' })).rejects.toThrow(ForbiddenException);

    // Ação sobre a reserva do colega: indistinguível de inexistente.
    await db.query(
      `INSERT INTO membership_permission_overrides (id, tenant_id, membership_id, permission, mode) VALUES ($1, $2, $3, 'ATENDIMENTO_PROPRIO_FALTA', 'GRANTED')`,
      [id(), est.tenantId, a.membershipId],
    );
    await expect(
      agenda.changeOwnStatus(a.userId, est.tenantId, rb[0], 'no-show', { expectedStartAt: '2031-03-12T14:00:00.000Z' }),
    ).rejects.toThrow(NotFoundException);

    // Outro estabelecimento: nenhum vínculo, nenhum dado.
    const outro = await estabelecimento('calendario-outro');
    await expect(agenda.range(a.userId, outro.tenantId, ownAgendaPeriodSchema.parse(periodos.dia))).rejects.toThrow(
      NotFoundException,
    );
  });

  describe('editar um acesso existente', () => {
    const editar = (est: Est, membershipId: string, corpo: Record<string, unknown>, ator = est.dono) =>
      team.changeAccess(ator.userId, ator.sessionId, est.tenantId, membershipId, staffAccessChangeSchema.parse(corpo));
    const vinculoDe = async (membershipId: string) =>
      (
        await db.query(
          `SELECT m.id, m.user_id, m.role::text AS role, m.professional_id, m.status::text AS status,
                  m.permissions_confirmed_at IS NOT NULL AS confirmado,
                  COALESCE((SELECT array_agg(o.permission::text || ':' || o.mode::text ORDER BY o.permission::text)
                    FROM membership_permission_overrides o WHERE o.membership_id = m.id), '{}') AS ajustes
             FROM memberships m WHERE m.id = $1`,
          [membershipId],
        )
      )[0] as { id: string; user_id: string; role: string; professional_id: string | null; status: string; confirmado: boolean; ajustes: string[] };
    const vagasDe = async (est: Est) => (await team.overview(est.dono.userId, est.tenantId)).seats;

    it('troca perfil e profissional no MESMO vínculo, sem mover reservas nem conceder nada; vale na próxima requisição', async () => {
      const est = await estabelecimento('edita');
      const [pa, pb] = [await profissional(est, 'Edita A'), await profissional(est, 'Edita B')];
      const criado = await criar(est, pa, `${marca}.edita`, { permissions: ['ATENDIMENTO_PROPRIO_INICIAR'] });
      const reservaA = await reserva(est, pa, new Date('2031-05-06T13:00:00Z'), 'Cliente do Edita A');
      const reservaB = await reserva(est, pb, new Date('2031-05-06T15:00:00Z'), 'Cliente do Edita B');
      const entrada = await login(`${marca}.edita`, ESCOLHIDA);
      const hashAntes = await hashDe(criado.userId);
      const vagasAntes = await vagasDe(est);
      const dia = ownAgendaPeriodSchema.parse({ from: '2031-05-06', to: '2031-05-06' });
      expect((await agenda.range(criado.userId, est.tenantId, dia)).appointments.map((x) => x.id)).toEqual([reservaA]);
      await expect(appointments.listRange(criado.userId, est.tenantId, { from: '2031-05-06', to: '2031-05-06' })).rejects.toThrow(
        ForbiddenException,
      );

      // Profissional para gerente sem profissional, com uma área marcada e
      // conferida pelo dono. A ação própria marcada antes sai (não se aplica).
      const comoGerente = await editar(est, criado.membershipId, {
        expected: { role: 'PROFISSIONAL', professionalId: pa, granted: ['ATENDIMENTO_PROPRIO_INICIAR'] },
        role: 'GERENTE',
        professionalId: null,
        granted: ['AGENDA_VISUALIZAR', 'PROFISSIONAIS_VISUALIZAR'],
      });
      expect(comoGerente).toEqual({
        membershipId: criado.membershipId,
        role: 'GERENTE',
        professionalId: null,
        grantedPermissions: ['AGENDA_VISUALIZAR', 'PROFISSIONAIS_VISUALIZAR'],
      });
      expect(await vinculoDe(criado.membershipId)).toMatchObject({
        id: criado.membershipId,
        user_id: criado.userId,
        role: 'GERENTE',
        professional_id: null,
        status: 'ACTIVE',
        confirmado: true,
        ajustes: ['AGENDA_VISUALIZAR:GRANTED', 'PROFISSIONAIS_VISUALIZAR:GRANTED'],
      });
      // A mesma conta, o mesmo login, a mesma senha, a sessão aberta segue.
      expect(await hashDe(criado.userId)).toBe(hashAntes);
      await expect(rotaOperacional(entrada.token)).resolves.toBe(true);
      // Vale já na próxima requisição da sessão aberta: a agenda do
      // estabelecimento abre, a própria agenda (sem profissional) fecha.
      const doEstabelecimento = await appointments.listRange(criado.userId, est.tenantId, { from: '2031-05-06', to: '2031-05-06' });
      expect(doEstabelecimento.appointments.map((x) => x.id).sort()).toEqual([reservaA, reservaB].sort());
      await expect(agenda.range(criado.userId, est.tenantId, dia)).rejects.toThrow(ForbiddenException);
      // As reservas ficaram com o profissional de antes.
      const donos = await db.query(`SELECT id, professional_id FROM appointments WHERE id = ANY($1) ORDER BY id`, [[reservaA, reservaB]]);
      expect(Object.fromEntries(donos.map((r: { id: string; professional_id: string }) => [r.id, r.professional_id]))).toEqual({
        [reservaA]: pa,
        [reservaB]: pb,
      });
      expect(await vagasDe(est)).toEqual(vagasAntes);

      // De volta a profissional, agora ligado a B, sem nenhuma permissão: a
      // área de gerente sai, nada entra sozinho.
      await editar(est, criado.membershipId, {
        expected: { role: 'GERENTE', professionalId: null, granted: ['AGENDA_VISUALIZAR', 'PROFISSIONAIS_VISUALIZAR'] },
        role: 'PROFISSIONAL',
        professionalId: pb,
        granted: [],
      });
      expect(await vinculoDe(criado.membershipId)).toMatchObject({
        role: 'PROFISSIONAL',
        professional_id: pb,
        confirmado: false,
        ajustes: [],
      });
      await expect(appointments.listRange(criado.userId, est.tenantId, { from: '2031-05-06', to: '2031-05-06' })).rejects.toThrow(
        ForbiddenException,
      );
      const agoraB = await agenda.range(criado.userId, est.tenantId, dia);
      expect(agoraB.professional.id).toBe(pb);
      expect(agoraB.appointments.map((x) => x.id)).toEqual([reservaB]);
      expect(JSON.stringify(agoraB)).not.toMatch(/Cliente do Edita A/);
      expect(Object.values(agoraB.permissions).some(Boolean)).toBe(false);
      expect(await vagasDe(est)).toEqual(vagasAntes);
      const entradaDepois = await login(`${marca}.edita`, ESCOLHIDA);
      expect(entradaDepois.user.mustChangePassword).toBe(false);

      // Histórico: autor, estabelecimento, antes e depois, sem senha nem hash.
      const historico = await db.query(
        `SELECT actor_user_id, tenant_id, summary, previous_data::text AS antes, new_data::text AS depois
           FROM audit_logs WHERE target_user_id = $1 AND action = 'USER_PERMISSION_CHANGED' ORDER BY occurred_at`,
        [criado.userId],
      );
      expect(historico).toHaveLength(2);
      expect(historico[0]).toMatchObject({ actor_user_id: est.dono.userId, tenant_id: est.tenantId });
      expect(historico[0].summary).toMatch(/perfil de profissional para gerente/);
      expect(historico[0].summary).toMatch(/Nenhum agendamento mudou de profissional/);
      expect(JSON.parse(historico[0].antes)).toEqual({ role: 'PROFISSIONAL', professionalId: pa, granted: ['ATENDIMENTO_PROPRIO_INICIAR'] });
      expect(JSON.parse(historico[1].depois)).toEqual({ role: 'PROFISSIONAL', professionalId: pb, granted: [] });
      expect(JSON.stringify(historico)).not.toContain(ESCOLHIDA);
      expect(JSON.stringify(historico)).not.toContain(hashAntes);
    });

    it('recusas: profissional ocupado, com convite, desativado ou de fora; perfil de conta compartilhada ou de plataforma; tela velha; sem reautenticação; sem ser dono', async () => {
      const est = await estabelecimento('edita-recusa');
      const outro = await estabelecimento('edita-recusa-outro');
      const [p1, p2, p3, p4, p5, p6] = await Promise.all(['E1', 'E2', 'E3', 'E4', 'E5', 'E6'].map((n) => profissional(est, n)));
      const alvo = await criar(est, p1, `${marca}.alvo`);
      const ocupante = await criar(est, p2, `${marca}.ocupante`);
      await db.query(
        `INSERT INTO invites (id, type, target_name, target_email, tenant_id, establishment_role, status, token_hash,
                              created_by_user_id, created_at, expires_at, professional_id)
         VALUES ($1, 'ESTABLISHMENT', 'Convidada', $2, $3, 'PROFISSIONAL', 'PENDING', $4, $5, now(), now() + interval '2 days', $6)`,
        [id(), `${marca}-convidada@example.test`, est.tenantId, id(), est.dono.userId, p3],
      );
      await db.query(`UPDATE professionals SET active = false WHERE id = $1`, [p4]);
      const deFora = await profissional(outro, 'Fora');
      const base = { expected: { role: 'PROFISSIONAL', professionalId: p1, granted: [] }, role: 'PROFISSIONAL', granted: [] };
      const semMudar = async (fazer: () => Promise<unknown>, esperado: string | (new (...a: never[]) => Error)) => {
        const antes = await vinculoDe(alvo.membershipId);
        const recusa = await erroDe(fazer());
        if (typeof esperado === 'string') expect(recusa.getResponse?.()?.code).toBe(esperado);
        else expect(recusa).toBeInstanceOf(esperado);
        expect(await vinculoDe(alvo.membershipId)).toEqual(antes);
      };

      await semMudar(() =>editar(est, alvo.membershipId, { ...base, professionalId: p2 }), 'PROFISSIONAL_COM_ACESSO');
      await semMudar(() =>editar(est, alvo.membershipId, { ...base, professionalId: p3 }), 'CONVITE_PENDENTE');
      await semMudar(() =>editar(est, alvo.membershipId, { ...base, professionalId: p4 }), 'PROFISSIONAL_INATIVO');
      await semMudar(() =>editar(est, alvo.membershipId, { ...base, professionalId: deFora }), NotFoundException);
      // Profissional sempre com profissional: recusado já no corpo.
      expect(() => staffAccessChangeSchema.parse({ ...base, professionalId: null })).toThrow();
      // Área de gerente num profissional: não se aplica.
      await semMudar(() =>
        editar(est, alvo.membershipId, { ...base, professionalId: p1, granted: ['AGENDA_VISUALIZAR'] }),
        'PERMISSAO_NAO_SE_APLICA',
      );
      // A tela mostrava outra coisa.
      await semMudar(() =>
        editar(est, alvo.membershipId, {
          ...base,
          expected: { ...base.expected, professionalId: p5 },
          professionalId: p6,
        }),
        'ALTERADO_POR_OUTRA_TELA',
      );
      // Outro estabelecimento não alcança o vínculo daqui.
      await semMudar(() =>
        team.changeAccess(
          outro.dono.userId,
          outro.dono.sessionId,
          outro.tenantId,
          alvo.membershipId,
          staffAccessChangeSchema.parse({ ...base, professionalId: p5 }),
        ),
        NotFoundException,
      );
      // O vínculo do dono não é acesso de equipe.
      const [vinculoDono] = await db.query(`SELECT id FROM memberships WHERE user_id = $1 AND tenant_id = $2`, [
        est.dono.userId,
        est.tenantId,
      ]);
      expect(await erroDe(editar(est, vinculoDono.id, { ...base, professionalId: p5 }))).toBeInstanceOf(NotFoundException);
      // Funcionário não edita ninguém, nem a si mesmo.
      const entradaOcupante = await login(`${marca}.ocupante`, ESCOLHIDA);
      const [sessaoOcupante] = await db.query(`SELECT id FROM sessions WHERE token_hash = $1`, [hashSessionToken(entradaOcupante.token)]);
      await db.query(`UPDATE sessions SET reauthenticated_at = now() - interval '1 second' WHERE id = $1`, [sessaoOcupante.id]);
      await semMudar(() =>
        editar(est, alvo.membershipId, { ...base, professionalId: p5 }, { userId: ocupante.userId, sessionId: sessaoOcupante.id }),
        ForbiddenException,
      );
      // Sem senha do dono confirmada há pouco.
      await db.query(`UPDATE sessions SET reauthenticated_at = now() - interval '1 hour' WHERE id = $1`, [est.dono.sessionId]);
      expect(await codigo(editar(est, alvo.membershipId, { ...base, professionalId: p5 }))).toBe('REAUTENTICACAO_NECESSARIA');
      await db.query(`UPDATE sessions SET reauthenticated_at = now() - interval '1 second' WHERE id = $1`, [est.dono.sessionId]);

      // Perfil de conta que também trabalha em outro lugar ou administra a
      // plataforma: não muda por aqui. O profissional ligado muda.
      const dupla = await criar(est, p5, `${marca}.edupla`);
      await db.query(`INSERT INTO memberships (id, user_id, tenant_id, role, professional_id) VALUES ($1, $2, $3, 'PROFISSIONAL', $4)`, [
        id(),
        dupla.userId,
        outro.tenantId,
        deFora,
      ]);
      const paraGerente = { expected: { role: 'PROFISSIONAL', professionalId: p5, granted: [] }, role: 'GERENTE', professionalId: p5, granted: [] };
      expect(await codigo(editar(est, dupla.membershipId, paraGerente))).toBe('PERFIL_NAO_E_DO_ESTABELECIMENTO');
      await db.query(`UPDATE users SET platform_role = 'MASTER_SUPPORT' WHERE id = $1`, [alvo.userId]);
      expect(await codigo(editar(est, alvo.membershipId, { ...paraGerente, expected: base.expected, professionalId: p1 }))).toBe(
        'PERFIL_NAO_E_DO_ESTABELECIMENTO',
      );
      await editar(est, dupla.membershipId, { ...paraGerente, role: 'PROFISSIONAL', professionalId: p6 });
      expect(await vinculoDe(dupla.membershipId)).toMatchObject({ role: 'PROFISSIONAL', professional_id: p6 });
      expect(await db.query(`SELECT 1 FROM memberships WHERE user_id = $1 AND tenant_id = $2 AND professional_id = $3`, [dupla.userId, outro.tenantId, deFora])).toHaveLength(1);
      // Nada mudou no papel da plataforma.
      expect((await db.query(`SELECT platform_role::text AS papel FROM users WHERE id = $1`, [alvo.userId]))[0].papel).toBe('MASTER_SUPPORT');
    });
  });

  describe('logs sem senha, hash nem token quando a gravação da credencial falha', () => {
    /** Tudo o que o processo escreve em stdout e stderr enquanto `fn` roda. */
    async function saidaDe(fn: () => Promise<unknown>): Promise<{ saida: string; erro: unknown }> {
      let saida = '';
      const capturar = (pedaco: unknown) => {
        saida += String(pedaco);
        return true;
      };
      const out = vi.spyOn(process.stdout, 'write').mockImplementation(capturar);
      const err = vi.spyOn(process.stderr, 'write').mockImplementation(capturar);
      let erro: unknown;
      try {
        await fn();
      } catch (e) {
        erro = e;
      } finally {
        out.mockRestore();
        err.mockRestore();
      }
      return { saida, erro };
    }

    const limpa = (saida: string) => {
      expect(saida).not.toContain(ESCOLHIDA);
      expect(saida).not.toContain(OUTRA);
      expect(saida).not.toMatch(/\$argon2/);
      expect(saida).not.toMatch(/\b[0-9a-f]{64}\b/);
      expect(saida).not.toMatch(/Failing row|DETAIL|PARAMETERS/);
    };

    it('o gatilho que recusa repete o valor na mensagem; o log mostra SQL, código e tabela, nunca o valor', async () => {
      const est = await estabelecimento('logs');
      const [p1, p2] = [await profissional(est, 'Log 1'), await profissional(est, 'Log 2')];
      const existente = await criar(est, p1, `${marca}.logexiste`);
      const funcao = `${marca}_recusa_log`;
      // Só para as contas deste teste: os outros arquivos podem rodar junto.
      await db.query(`
        CREATE FUNCTION ${funcao}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND username::text LIKE '${marca}.log%') THEN
            IF TG_TABLE_NAME = 'sessions' THEN
              RAISE EXCEPTION 'sessão recusada: %', NEW.token_hash USING DETAIL = 'token ' || NEW.token_hash;
            END IF;
            RAISE EXCEPTION 'gravação recusada: %', NEW.password_hash USING DETAIL = 'hash ' || NEW.password_hash;
          END IF;
          RETURN NEW;
        END $$`);
      await db.query(`CREATE TRIGGER ${funcao} BEFORE INSERT OR UPDATE ON credentials FOR EACH ROW EXECUTE FUNCTION ${funcao}()`);
      await db.query(`CREATE TRIGGER ${funcao} BEFORE INSERT ON sessions FOR EACH ROW EXECUTE FUNCTION ${funcao}()`);
      try {
        const filtro = new DatabaseErrorFilter({
          httpAdapter: { reply: vi.fn(), isHeadersSent: () => false, end: vi.fn() },
        } as never);
        const http = { getType: () => 'http', switchToHttp: () => ({ getResponse: () => ({}) }) } as never;

        // Criar acesso: INSERT em credentials.
        const criacao = await saidaDe(() => criar(est, p2, `${marca}.lognovo`));
        expect(criacao.erro).toBeInstanceOf(QueryFailedError);
        // Sem a proteção, o próprio erro levaria o hash para o log.
        expect(inspect(criacao.erro)).toMatch(/\$argon2id\$/);
        expect(criacao.saida).toContain('query que falhou: INSERT INTO credentials');
        expect(criacao.saida).toContain('code=P0001');
        expect(criacao.saida).toContain('gravação recusada: [omitido]');
        limpa(criacao.saida);
        const naBorda = await saidaDe(async () => filtro.catch(criacao.erro as QueryFailedError, http));
        expect(naBorda.saida).toContain('ExceptionsHandler');
        limpa(naBorda.saida);
        expect(await db.query(`SELECT 1 FROM users WHERE username::text = $1`, [`${marca}.lognovo`])).toHaveLength(0);

        // Definir nova senha: UPDATE em credentials; nada muda.
        const hashAntes = await hashDe(existente.userId);
        const redefinicao = await saidaDe(() => definir(est, existente.membershipId, OUTRA));
        expect(redefinicao.erro).toBeInstanceOf(QueryFailedError);
        expect(redefinicao.saida).toContain('query que falhou: UPDATE credentials SET password_hash = $2');
        expect(redefinicao.saida).toContain('[string(24), string(97), string(8), Date]');
        limpa(redefinicao.saida);
        limpa((await saidaDe(async () => filtro.catch(redefinicao.erro as QueryFailedError, http))).saida);
        expect(await hashDe(existente.userId)).toBe(hashAntes);

        // Entrar: INSERT em sessions, com o hash do token.
        const entrada = await saidaDe(() => login(`${marca}.logexiste`, ESCOLHIDA));
        expect(entrada.erro).toBeInstanceOf(QueryFailedError);
        expect(inspect(entrada.erro)).toMatch(/\b[0-9a-f]{64}\b/);
        expect(entrada.saida).toMatch(/query que falhou: INSERT INTO "?sessions"?/);
        expect(entrada.saida).toContain('sessão recusada: [omitido]');
        limpa(entrada.saida);
        limpa((await saidaDe(async () => filtro.catch(entrada.erro as QueryFailedError, http))).saida);
      } finally {
        await db.query(`DROP TRIGGER IF EXISTS ${funcao} ON credentials`);
        await db.query(`DROP TRIGGER IF EXISTS ${funcao} ON sessions`);
        await db.query(`DROP FUNCTION IF EXISTS ${funcao}()`);
      }
    });
  });
});
