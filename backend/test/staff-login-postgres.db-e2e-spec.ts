// Acesso de funcionário por nome de usuário e senha temporária contra
// PostgreSQL DESCARTÁVEL (com a migration StaffLogin aplicada): criação
// atômica, vagas do plano e concorrência pela última vaga, login antigo e
// por usuário, troca obrigatória de senha e a nova senha temporária só para a
// conta que é do estabelecimento.
import { randomUUID } from 'node:crypto';
import { globSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DataSource } from 'typeorm';
import { ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { buildRuntimeDataSourceOptions } from '../src/database/runtime-data-source.js';
import { hashPassword, verifyPassword } from '../src/auth/password-hasher.js';
import { AuthService } from '../src/auth/auth.service.js';
import { loginSchema } from '../src/auth/login.dto.js';
import { SessionGuard } from '../src/auth/session.guard.js';
import { AuthController } from '../src/auth/auth.controller.js';
import { hashSessionToken } from '../src/auth/session-token.js';
import type { ConfigService } from '@nestjs/config';
import { AccountDelivery } from '../src/accounts/account-delivery.js';
import { PasswordResetsService } from '../src/accounts/password-resets.service.js';
import { StaffAccountsService } from '../src/team/staff-accounts.service.js';
import { TeamService } from '../src/team/team.service.js';
import { comTodosOsRecursos } from './support/plano-de-teste.js';

const url = process.env.DB_E2E_DIRECT_URL;
if (url && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)) {
  throw new Error('Este teste exige PostgreSQL descartável local.');
}
const id = () => randomUUID().replaceAll('-', '').slice(0, 24);
const SENHA = 'senha-de-teste-forte-1';

const erroDe = async (promessa: Promise<unknown>) => {
  try {
    await promessa;
  } catch (error) {
    return error as Error & { getResponse?: () => { code?: string } };
  }
  throw new Error('era esperado um erro');
};
const codigo = async (promessa: Promise<unknown>) => (await erroDe(promessa)).getResponse?.()?.code;

describe.skipIf(!url)('acesso de funcionário por usuário e senha contra PostgreSQL descartável', () => {
  let db: DataSource;
  let contas: StaffAccountsService;
  let team: TeamService;
  let auth: AuthService;
  let resets: PasswordResetsService;
  let hash: string;
  const marca = `usuario${id().slice(0, 8)}`;
  const planos: Record<number, string> = {};

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

  async function estabelecimento(nome: string, maxProfissionais: number) {
    const tenantId = id();
    await db.query(
      `INSERT INTO tenants (id, slug, category, timezone, plan_id, status, access_legacy_since) VALUES ($1, $2, 'OTHER', 'America/Sao_Paulo', $3, 'ACTIVE', now())`,
      [tenantId, `${marca}-${nome}`, planos[maxProfissionais]],
    );
    await db.query(
      `INSERT INTO units (id, tenant_id, name, address, timezone, is_primary) VALUES ($1, $2, $3, '', 'America/Sao_Paulo', true)`,
      [id(), tenantId, `${marca} ${nome}`],
    );
    const dono = await conta(`${nome}-dono`);
    await db.query(`INSERT INTO memberships (id, user_id, tenant_id, role) VALUES ($1, $2, $3, 'DONO')`, [
      id(),
      dono.userId,
      tenantId,
    ]);
    return { tenantId, dono };
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

  const criar = (est: Est, professionalId: string, username: string, permissions: string[] = []) =>
    contas.create(est.dono.userId, est.dono.sessionId, est.tenantId, {
      requestKey: `chave-${id()}`,
      professionalId,
      name: `Funcionária ${username}`,
      username,
      permissions: permissions as never,
    });

  const login = (corpo: Record<string, string>) =>
    auth.login(loginSchema.parse(corpo), { now: new Date(), userAgent: 'teste', ipAddress: '127.0.0.1' });

  /** O guard real, com o Reflector real, sobre uma rota marcada ou não. */
  async function guardar(token: string, rotaComSenhaTemporaria: boolean) {
    const guard = new SessionGuard(db, new Reflector());
    const handler = rotaComSenhaTemporaria ? AuthController.prototype.me : TeamService.prototype.overview;
    const contexto = {
      switchToHttp: () => ({ getRequest: () => ({ cookies: { session_token: token } }) }),
      getHandler: () => handler,
      getClass: () => (rotaComSenhaTemporaria ? AuthController : TeamService),
    } as unknown as ExecutionContext;
    return guard.canActivate(contexto);
  }

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
    team = new TeamService(db);
    auth = new AuthService(db);
    // Sem provedor de e-mail: nada sai da máquina.
    const config = { get: () => undefined, getOrThrow: () => 'http://localhost:3000' } as unknown as ConfigService;
    resets = new PasswordResetsService(db, new AccountDelivery(db, config));
    hash = await hashPassword(SENHA);
    for (const max of [1, 2, 3]) {
      planos[max] = id();
      await db.query(
        comTodosOsRecursos(`INSERT INTO plans (id, code, name, short_description, max_professionals, max_units) VALUES ($1, $2, $3, '', $4, 1)`),
        [planos[max], `${marca}-${max}`, `Plano ${max}`, max],
      );
    }
  });

  afterAll(async () => {
    if (db?.isInitialized) await db.destroy();
  });

  it('cria conta, credencial e vínculo de uma vez, sem e-mail fictício; a senha só vem na criação', async () => {
    const est = await estabelecimento('cria', 2);
    const p = await profissional(est, 'Ana');
    const chave = `chave-${id()}`;
    const dto = { requestKey: chave, professionalId: p, name: 'Ana Funcionária', username: `${marca}.ana`, permissions: ['ATENDIMENTO_PROPRIO_INICIAR'] as never };
    const criado = await contas.create(est.dono.userId, est.dono.sessionId, est.tenantId, dto);
    expect(criado).toMatchObject({ created: true, username: `${marca}.ana` });
    expect(criado.temporaryPassword).toMatch(/^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/);

    const [usuario] = await db.query(
      `SELECT email, username::text AS username, email_verified, must_change_password FROM users WHERE id = $1`,
      [criado.userId],
    );
    expect(usuario).toEqual({ email: null, username: `${marca}.ana`, email_verified: false, must_change_password: true });
    const [credencial] = await db.query(`SELECT password_hash FROM credentials WHERE user_id = $1`, [criado.userId]);
    expect(credencial.password_hash).not.toContain(criado.temporaryPassword);
    expect(await verifyPassword(credencial.password_hash, criado.temporaryPassword!)).toBe(true);
    const [vinculo] = await db.query(`SELECT role, professional_id, status FROM memberships WHERE id = $1`, [criado.membershipId]);
    expect(vinculo).toEqual({ role: 'PROFISSIONAL', professional_id: p, status: 'ACTIVE' });

    // O histórico registra quem criou, sem senha nenhuma.
    const historico = await db.query(`SELECT summary, new_data::text AS dados FROM audit_logs WHERE target_user_id = $1`, [
      criado.userId,
    ]);
    expect(historico).toHaveLength(1);
    expect(JSON.stringify(historico)).not.toContain(criado.temporaryPassword);

    // O mesmo formulário de novo: o mesmo acesso, sem senha.
    const repetido = await contas.create(est.dono.userId, est.dono.sessionId, est.tenantId, dto);
    expect(repetido).toEqual({ ...criado, created: false, temporaryPassword: null });

    // A visão da equipe mostra o usuário e permite gerar nova senha.
    const visao = await team.overview(est.dono.userId, est.tenantId);
    const membro = visao.members.find((m) => m.professional.id === p)!;
    expect(membro.access).toMatchObject({
      user: { username: `${marca}.ana`, hasEmail: false, email: `${marca}.ana` },
      canResetTemporaryPassword: true,
      grantedPermissions: ['ATENDIMENTO_PROPRIO_INICIAR'],
    });
  });

  it('recusas não deixam conta órfã: usuário em uso, profissional com acesso, sem vaga, permissão indevida, sem reautenticação', async () => {
    const est = await estabelecimento('recusas', 1);
    const [p1, p2] = [await profissional(est, 'Um'), await profissional(est, 'Dois')];
    await criar(est, p1, `${marca}.um`);
    const contar = async () => Number((await db.query(`SELECT count(*) FROM users WHERE username::text LIKE $1`, [`${marca}.%`]))[0].count);
    const antes = await contar();

    expect(await codigo(criar(est, p2, `${marca}.UM`))).toBe('LIMITE_DO_PLANO');
    await db.query(`UPDATE tenants SET plan_id = $2 WHERE id = $1`, [est.tenantId, planos[3]]);
    expect(await codigo(criar(est, p2, `${marca}.um`))).toBe('USUARIO_EM_USO');
    expect(await codigo(criar(est, p1, `${marca}.outro`))).toBe('PROFISSIONAL_COM_ACESSO');
    await db.query(
      `INSERT INTO membership_permission_overrides (id, tenant_id, membership_id, permission, mode)
       SELECT $1, $2::varchar, id, 'AGENDA_GERENCIAR', 'DENIED' FROM memberships WHERE user_id = $3 AND tenant_id = $2::varchar`,
      [id(), est.tenantId, est.dono.userId],
    );
    expect(await codigo(criar(est, p2, `${marca}.dois`, ['ATENDIMENTO_PROPRIO_CONCLUIR']))).toBe('PERMISSAO_NAO_DISPONIVEL');
    await db.query(`UPDATE sessions SET reauthenticated_at = now() - interval '1 hour' WHERE id = $1`, [est.dono.sessionId]);
    expect(await codigo(criar(est, p2, `${marca}.dois`))).toBe('REAUTENTICACAO_NECESSARIA');
    expect(await contar()).toBe(antes);
  });

  it('duas criações simultâneas pela última vaga: uma passa, a outra recusa, nenhuma conta sobra', async () => {
    const est = await estabelecimento('corrida', 1);
    const [p1, p2] = [await profissional(est, 'A'), await profissional(est, 'B')];
    const resultados = await Promise.allSettled([criar(est, p1, `${marca}.corrida-a`), criar(est, p2, `${marca}.corrida-b`)]);
    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const recusa = resultados.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(recusa.reason).toBeInstanceOf(ConflictException);
    const [{ total }] = await db.query(`SELECT count(*)::int AS total FROM users WHERE username::text LIKE $1`, [
      `${marca}.corrida-%`,
    ]);
    expect(total).toBe(1);
  });

  it('login por e-mail continua; por usuário funciona; a senha temporária só libera a troca', async () => {
    const est = await estabelecimento('login', 2);
    const antiga = await login({ email: `${marca}-login-dono@example.test`, password: SENHA });
    expect(antiga.user).toMatchObject({ username: null, mustChangePassword: false });
    expect(await login({ login: `${marca}-LOGIN-dono@example.test`, password: SENHA })).toBeTruthy();

    const p = await profissional(est, 'Bia');
    const criado = await criar(est, p, `${marca}.bia`);
    await expect(login({ login: `${marca}.bia`, password: 'senha-errada-123' })).rejects.toThrow();
    const entrada = await login({ login: ` ${marca.toUpperCase()}.BIA `, password: criado.temporaryPassword! });
    expect(entrada.user).toMatchObject({ email: null, username: `${marca}.bia`, mustChangePassword: true });
    expect(entrada.contexts.map((c) => c.role)).toEqual(['PROFISSIONAL']);

    // Antes da troca: a sessão abre, as rotas operacionais não.
    await expect(guardar(entrada.token, true)).resolves.toBe(true);
    const bloqueio = await erroDe(guardar(entrada.token, false));
    expect(bloqueio).toBeInstanceOf(ForbiddenException);
    expect(bloqueio.getResponse?.()?.code).toBe('TROCA_DE_SENHA_OBRIGATORIA');

    const [sessaoAtual] = await db.query(`SELECT id FROM sessions WHERE token_hash = $1`, [hashSessionToken(entrada.token)]);
    const outraSessao = await sessao(criado.userId);
    // Senha atual errada: nada muda.
    expect(await erroDe(auth.changePassword(criado.userId, sessaoAtual.id, { currentPassword: 'nao-e-essa-123', newPassword: 'minha-senha-nova-1' }, new Date()))).toBeInstanceOf(
      UnauthorizedException,
    );
    await auth.changePassword(
      criado.userId,
      sessaoAtual.id,
      { currentPassword: criado.temporaryPassword!, newPassword: 'minha-senha-nova-1' },
      new Date(),
    );
    await expect(guardar(entrada.token, false)).resolves.toBe(true);
    const [outra] = await db.query(`SELECT revoked_at FROM sessions WHERE id = $1`, [outraSessao]);
    expect(outra.revoked_at).not.toBeNull();
    expect((await login({ login: `${marca}.bia`, password: 'minha-senha-nova-1' })).user.mustChangePassword).toBe(false);
    const [historico] = await db.query(`SELECT action::text AS action FROM audit_logs WHERE target_user_id = $1 AND action = 'PASSWORD_CHANGED'`, [
      criado.userId,
    ]);
    expect(historico.action).toBe('PASSWORD_CHANGED');
  });

  it('nova senha temporária: só para a conta do estabelecimento; encerra as sessões', async () => {
    const est = await estabelecimento('reset', 3);
    const outro = await estabelecimento('reset-outro', 3);
    const [p1, p2, p3] = [await profissional(est, 'R1'), await profissional(est, 'R2'), await profissional(est, 'R3')];
    const criado = await criar(est, p1, `${marca}.reset`);
    const sessaoAberta = await sessao(criado.userId);
    const nova = await contas.resetTemporaryPassword(est.dono.userId, est.dono.sessionId, est.tenantId, criado.membershipId);
    expect(nova.temporaryPassword).not.toBe(criado.temporaryPassword);
    const [s] = await db.query(`SELECT revoked_at FROM sessions WHERE id = $1`, [sessaoAberta]);
    expect(s.revoked_at).not.toBeNull();
    expect((await login({ login: `${marca}.reset`, password: nova.temporaryPassword })).user.mustChangePassword).toBe(true);

    // Conta com e-mail (convite antigo), com outro vínculo ou com papel de
    // plataforma: a senha não é do dono.
    const comEmail = await conta('reset-email');
    const vinculoComEmail = id();
    await db.query(`INSERT INTO memberships (id, user_id, tenant_id, role, professional_id) VALUES ($1, $2, $3, 'PROFISSIONAL', $4)`, [
      vinculoComEmail,
      comEmail.userId,
      est.tenantId,
      p2,
    ]);
    expect(await codigo(contas.resetTemporaryPassword(est.dono.userId, est.dono.sessionId, est.tenantId, vinculoComEmail))).toBe(
      'SENHA_NAO_E_DO_ESTABELECIMENTO',
    );
    const dupla = await criar(est, p3, `${marca}.dupla`);
    const pOutro = await profissional(outro, 'Fora');
    await db.query(`INSERT INTO memberships (id, user_id, tenant_id, role, professional_id) VALUES ($1, $2, $3, 'PROFISSIONAL', $4)`, [
      id(),
      dupla.userId,
      outro.tenantId,
      pOutro,
    ]);
    expect(await codigo(contas.resetTemporaryPassword(est.dono.userId, est.dono.sessionId, est.tenantId, dupla.membershipId))).toBe(
      'SENHA_NAO_E_DO_ESTABELECIMENTO',
    );
    // Outro estabelecimento não alcança o vínculo daqui.
    expect((await erroDe(contas.resetTemporaryPassword(outro.dono.userId, outro.dono.sessionId, outro.tenantId, criado.membershipId))).constructor.name).toBe(
      'NotFoundException',
    );
    // A redefinição por link da administração recusa a conta sem e-mail.
    const mestre = await conta('reset-mestre', { role: 'MASTER_OWNER' });
    expect(await codigo(resets.request(mestre.userId, criado.userId, `chave-${id()}`))).toBe('CONTA_SEM_EMAIL');
  });
});
