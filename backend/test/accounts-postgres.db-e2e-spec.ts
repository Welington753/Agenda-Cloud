// Gestão de contas contra PostgreSQL DESCARTÁVEL (com a migration
// AccountsAdministration aplicada). Os serviços rodam de verdade, com o
// adaptador de e-mail Brevo apontado para uma caixa HTTP local: nenhuma
// mensagem sai da máquina. Cada caso usa marcadores próprios e não apaga
// dados de outros testes.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { globSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DataSource } from 'typeorm';
import type { ConfigService } from '@nestjs/config';
import { ConflictException, ForbiddenException, GoneException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { buildRuntimeDataSourceOptions } from '../src/database/runtime-data-source.js';
import { hashPassword, verifyPassword } from '../src/auth/password-hasher.js';
import { AccountDelivery } from '../src/accounts/account-delivery.js';
import { AccountsAdminService } from '../src/accounts/accounts-admin.service.js';
import { AccountsDirectoryService } from '../src/accounts/accounts-directory.service.js';
import { InvitesService } from '../src/accounts/invites.service.js';
import { PasswordResetsService } from '../src/accounts/password-resets.service.js';
import { createEstablishmentSchema } from '../src/accounts/accounts.dto.js';

const url = process.env.DB_E2E_DIRECT_URL;
if (url && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)) {
  throw new Error('Este teste exige PostgreSQL descartável local.');
}
const id = () => randomUUID().replaceAll('-', '').slice(0, 24);
const SENHA = 'senha-de-teste-forte-1';
const now = () => new Date();

interface Recebido {
  to: string;
  subject: string;
  text: string;
}

/** Caixa local no formato da API do Brevo. `falhar` devolve 500. */
function caixaDeEmail() {
  const recebidos: Recebido[] = [];
  const estado = { falhar: false };
  const server: Server = createServer((req, res) => {
    let corpo = '';
    req.on('data', (parte) => (corpo += parte));
    req.on('end', () => {
      if (req.url !== '/v3/smtp/email' || req.headers['api-key'] !== 'chave-local') {
        res.statusCode = 401;
        return res.end();
      }
      if (estado.falhar) {
        res.statusCode = 500;
        return res.end();
      }
      const json = JSON.parse(corpo) as { to: { email: string }[]; subject: string; textContent: string };
      recebidos.push({ to: json.to[0].email, subject: json.subject, text: json.textContent });
      res.statusCode = 201;
      res.end(JSON.stringify({ messageId: id() }));
    });
  });
  return { server, recebidos, estado };
}

const tokenDe = (mensagem: Recebido) => /#t=([0-9a-f]{64})/.exec(mensagem.text)![1];

describe.skipIf(!url)('gestão de contas contra PostgreSQL descartável', () => {
  let db: DataSource;
  let invites: InvitesService;
  let resets: PasswordResetsService;
  let admin: AccountsAdminService;
  let directory: AccountsDirectoryService;
  let delivery: AccountDelivery;
  let semEmail: InvitesService;
  const caixa = caixaDeEmail();
  const marca = `contas-${id()}`;
  const email = (nome: string) => `${marca}-${nome}@example.test`;
  let planId: string;
  let hash: string;

  /** Conta pronta (com senha), sessão e, se pedido, papel de plataforma. */
  async function conta(
    nome: string,
    opcoes: { role?: string; permissions?: string[]; status?: string; semSenha?: boolean } = {},
  ) {
    const userId = id();
    await db.query(
      `INSERT INTO users (id, name, email, status, platform_role, platform_permissions)
       VALUES ($1, $2, $3, $4::user_status, $5::platform_role, $6::platform_permission[])`,
      [userId, `Pessoa ${nome}`, email(nome), opcoes.status ?? 'ACTIVE', opcoes.role ?? null, opcoes.permissions ?? null],
    );
    if (!opcoes.semSenha) {
      await db.query(
        `INSERT INTO credentials (id, user_id, password_hash, algorithm) VALUES ($1, $2, $3, 'argon2id')`,
        [id(), userId, hash],
      );
    }
    const sessionId = id();
    await db.query(
      `INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, now() + interval '1 day')`,
      [sessionId, userId, id() + id()],
    );
    return { userId, sessionId };
  }

  async function tenant(nome: string) {
    const tenantId = id();
    await db.query(
      `INSERT INTO tenants (id, slug, category, timezone, plan_id, status) VALUES ($1, $2, 'OTHER', 'America/Sao_Paulo', $3, 'ACTIVE')`,
      [tenantId, `${marca}-${nome}`, planId],
    );
    await db.query(
      `INSERT INTO units (id, tenant_id, name, address, timezone, is_primary) VALUES ($1, $2, $3, '', 'America/Sao_Paulo', true)`,
      [id(), tenantId, `${marca} ${nome}`],
    );
    return tenantId;
  }

  const requestKey = () => `chave-${id()}`;
  const updatedAt = async (userId: string) =>
    ((await db.query('SELECT updated_at FROM users WHERE id = $1', [userId])) as { updated_at: Date }[])[0].updated_at.toISOString();
  const reauth = (userId: string, sessionId: string) => admin.reauthenticate(userId, sessionId, SENHA);

  beforeAll(async () => {
    await new Promise<void>((resolve) => caixa.server.listen(0, '127.0.0.1', resolve));
    const porta = (caixa.server.address() as AddressInfo).port;
    const directoryPath = path.dirname(fileURLToPath(import.meta.url));
    const entities: (new () => object)[] = [];
    for (const file of globSync(path.join(directoryPath, '../src/entities/**/*.entity.ts'))) {
      const exports = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
      for (const value of Object.values(exports)) if (typeof value === 'function') entities.push(value as new () => object);
    }
    db = new DataSource({ ...buildRuntimeDataSourceOptions(url!), entities });
    await db.initialize();
    const config = (valores: Record<string, string>) =>
      ({ get: (k: string) => valores[k], getOrThrow: (k: string) => valores[k] }) as unknown as ConfigService;
    delivery = new AccountDelivery(
      db,
      config({
        EMAIL_PROVIDER: 'brevo',
        EMAIL_API_KEY: 'chave-local',
        EMAIL_FROM: 'nao-responda@example.test',
        EMAIL_API_BASE_URL: `http://127.0.0.1:${porta}`,
        FRONTEND_URL: 'http://localhost:3000',
      }),
    );
    invites = new InvitesService(db, delivery);
    resets = new PasswordResetsService(db, delivery);
    admin = new AccountsAdminService(db);
    directory = new AccountsDirectoryService(db);
    semEmail = new InvitesService(db, new AccountDelivery(db, config({ FRONTEND_URL: 'http://localhost:3000' })));
    hash = await hashPassword(SENHA);
    planId = ((await db.query(`SELECT id FROM plans WHERE code = 'equipe'`)) as { id: string }[])[0].id;
  });

  afterAll(async () => {
    caixa.server.close();
    if (db?.isInitialized) await db.destroy();
  });

  const ultimaMensagemPara = (destino: string) => [...caixa.recebidos].reverse().find((m) => m.to === destino)!;

  it('lista contas antigas, sem empresa e administradores, com contadores do conjunto filtrado e várias páginas', async () => {
    const dono = await conta('lista-dono');
    await conta('lista-sem-empresa');
    await conta('lista-admin', { role: 'MASTER_ADMIN', permissions: ['ESTABLISHMENTS_MANAGE'] });
    await conta('lista-convidada', { status: 'INVITED', semSenha: true });
    const master = await conta('lista-master', { role: 'MASTER_OWNER' });
    const t = await tenant('lista');
    await db.query(`INSERT INTO memberships (id, user_id, tenant_id, role) VALUES ($1, $2, $3, 'DONO')`, [id(), dono.userId, t]);

    const pagina1 = await directory.listUsers(master.userId, { q: marca, page: 1, pageSize: 2 });
    const pagina3 = await directory.listUsers(master.userId, { q: marca, page: 3, pageSize: 2 });
    expect(pagina1.total).toBeGreaterThanOrEqual(5);
    expect(pagina1.items).toHaveLength(2);
    expect(pagina3.items.length).toBeGreaterThanOrEqual(1);
    expect(pagina1.summary.total).toBe(pagina1.total);
    const semEmpresa = await directory.listUsers(master.userId, { q: `${marca}-lista-sem`, page: 1, pageSize: 20 });
    expect(semEmpresa.items.map((u: { email: string }) => u.email)).toEqual([email('lista-sem-empresa')]);
    expect(semEmpresa.summary.withoutEstablishment).toBe(1);
    const convidadas = await directory.listUsers(master.userId, { q: marca, status: 'INVITED' as never, page: 1, pageSize: 20 });
    expect(convidadas.items.every((u: { status: string }) => u.status === 'INVITED')).toBe(true);
    // Contadores por situação continuam do conjunto inteiro da busca.
    expect(convidadas.summary.total).toBe(pagina1.total);
    const doTenant = await directory.listUsers(master.userId, { tenantId: t, page: 1, pageSize: 20 });
    expect(doTenant.items.map((u: { id: string }) => u.id)).toEqual([dono.userId]);
    const json = JSON.stringify(pagina1);
    expect(json).not.toMatch(/argon2|password_hash|token/i);
    await expect(directory.listUsers(dono.userId, { page: 1, pageSize: 20 })).rejects.toThrow(ForbiddenException);
  });

  it('nova empresa com responsável: conta pendente, e-mail aceito pelo provedor, ativação e entrada', async () => {
    const master = await conta('fluxo-master', { role: 'MASTER_OWNER' });
    const dto = createEstablishmentSchema.parse({
      requestKey: requestKey(),
      businessName: `${marca} Barbearia Nova`,
      category: 'BARBERSHOP',
      planId,
      owner: { name: 'Dona Nova', email: email('Fluxo-Dona').toUpperCase() },
    });
    const criado = await invites.createEstablishment(master.userId, dto);
    expect(criado.created).toBe(true);
    expect(criado.delivery).toEqual({ status: 'SENT' });
    expect(criado.invite.status).toBe('PENDING');
    expect(criado.invite.delivery.status).toBe('SENT');
    expect(JSON.stringify(criado)).not.toMatch(/[0-9a-f]{64}/);
    const [pendente] = await db.query(`SELECT status, email_verified FROM users WHERE email = $1`, [email('fluxo-dona')]);
    expect(pendente).toEqual({ status: 'INVITED', email_verified: false });
    expect(await db.query(`SELECT 1 FROM credentials c JOIN users u ON u.id = c.user_id WHERE u.email = $1`, [email('fluxo-dona')])).toEqual([]);

    // Mesma chave de formulário (resposta perdida): nada novo.
    const repetido = await invites.createEstablishment(master.userId, dto);
    expect(repetido.created).toBe(false);
    expect(repetido.invite.id).toBe(criado.invite.id);
    const [{ total }] = await db.query(`SELECT count(*)::int AS total FROM units WHERE name = $1`, [dto.businessName]);
    expect(total).toBe(1);

    const token = tokenDe(ultimaMensagemPara(email('fluxo-dona')));
    // Abrir o link não consome nada.
    expect((await invites.preview(token)).status).toBe('VALID');
    expect((await invites.preview(token)).status).toBe('VALID');
    const aceito = await invites.accept(token, 'senha-da-dona-nova', { now: now() });
    expect(aceito.destination).toBe('/conta/visao-geral');
    const [ativa] = await db.query(
      `SELECT u.status, u.email_verified, c.password_hash FROM users u JOIN credentials c ON c.user_id = u.id WHERE u.email = $1`,
      [email('fluxo-dona')],
    );
    expect(ativa.status).toBe('ACTIVE');
    expect(ativa.email_verified).toBe(true);
    expect(await verifyPassword(ativa.password_hash, 'senha-da-dona-nova')).toBe(true);
    const [vinculo] = await db.query(
      `SELECT m.role FROM memberships m JOIN users u ON u.id = m.user_id WHERE u.email = $1 AND m.tenant_id = $2`,
      [email('fluxo-dona'), criado.tenant!.id],
    );
    expect(vinculo.role).toBe('DONO');
    // Reutilizar o link.
    await expect(invites.accept(token, 'senha-da-dona-nova', { now: now() })).rejects.toThrow(GoneException);
    // Histórico com ator, alvo e estabelecimento.
    const historico = await db.query(
      `SELECT action::text, actor_user_id, target_user_id, tenant_id FROM audit_logs WHERE tenant_id = $1 ORDER BY occurred_at`,
      [criado.tenant!.id],
    );
    expect(historico.map((h: { action: string }) => h.action)).toEqual(['TENANT_CREATED', 'USER_INVITED', 'INVITE_ACCEPTED']);
    expect(JSON.stringify(historico)).not.toContain(token);
  });

  it('e-mail existente (outra caixa) vira convite de vínculo; aceite exige a senha atual e não a altera', async () => {
    const master = await conta('existente-master', { role: 'MASTER_OWNER' });
    const pessoa = await conta('existente-pessoa');
    const t = await tenant('existente');
    const [antes] = await db.query(`SELECT name, password_hash FROM users u JOIN credentials c ON c.user_id = u.id WHERE u.id = $1`, [pessoa.userId]);
    const r = await invites.inviteMember(master.userId, t, {
      requestKey: requestKey(),
      name: 'Nome Diferente',
      email: email('EXISTENTE-pessoa'),
      role: 'DONO',
    });
    expect(r.invite.targetUser?.id).toBe(pessoa.userId);
    expect(r.invite.targetUser?.hasCredential).toBe(true);
    const [{ total }] = await db.query(`SELECT count(*)::int AS total FROM users WHERE email = $1`, [email('existente-pessoa')]);
    expect(total).toBe(1);
    const token = tokenDe(ultimaMensagemPara(email('existente-pessoa')));
    await expect(invites.accept(token, 'senha-errada-qualquer', { now: now() })).rejects.toThrow(UnauthorizedException);
    expect(await db.query(`SELECT 1 FROM memberships WHERE user_id = $1 AND tenant_id = $2`, [pessoa.userId, t])).toEqual([]);
    await invites.accept(token, SENHA, { now: now() });
    const [depois] = await db.query(`SELECT name, password_hash FROM users u JOIN credentials c ON c.user_id = u.id WHERE u.id = $1`, [pessoa.userId]);
    expect(depois).toEqual(antes);
    expect(await db.query(`SELECT role FROM memberships WHERE user_id = $1 AND tenant_id = $2`, [pessoa.userId, t])).toEqual([{ role: 'DONO' }]);
    // Já vinculada: novo convite recusado.
    await expect(
      invites.inviteMember(master.userId, t, { requestKey: requestKey(), name: 'X', email: email('existente-pessoa'), role: 'DONO' }),
    ).rejects.toThrow(ConflictException);
  });

  it('convite inválido, expirado, revogado, reenviado e aceito em paralelo', async () => {
    const master = await conta('estados-master', { role: 'MASTER_OWNER' });
    const t = await tenant('estados');
    await expect(invites.accept('f'.repeat(64), SENHA, { now: now() })).rejects.toThrow(NotFoundException);
    expect((await invites.preview('nao-e-token')).status).toBe('INVALID');

    const exp = await invites.inviteMember(master.userId, t, { requestKey: requestKey(), name: 'Expira', email: email('expira'), role: 'DONO' });
    const tokenExp = tokenDe(ultimaMensagemPara(email('expira')));
    await db.query(`UPDATE invites SET created_at = now() - interval '2 days', expires_at = now() - interval '1 second' WHERE id = $1`, [exp.invite.id]);
    expect((await invites.preview(tokenExp)).status).toBe('EXPIRED');
    await expect(invites.accept(tokenExp, SENHA, { now: now() })).rejects.toThrow(GoneException);

    const rev = await invites.inviteMember(master.userId, t, { requestKey: requestKey(), name: 'Revoga', email: email('revoga'), role: 'DONO' });
    const tokenRev = tokenDe(ultimaMensagemPara(email('revoga')));
    expect((await invites.revoke(master.userId, rev.invite.id)).status).toBe('REVOKED');
    await expect(invites.accept(tokenRev, SENHA, { now: now() })).rejects.toThrow(GoneException);

    const re = await invites.inviteMember(master.userId, t, { requestKey: requestKey(), name: 'Reenvia', email: email('reenvia'), role: 'DONO' });
    const primeiro = tokenDe(ultimaMensagemPara(email('reenvia')));
    await invites.resend(master.userId, re.invite.id);
    const segundo = tokenDe(ultimaMensagemPara(email('reenvia')));
    expect(segundo).not.toBe(primeiro);
    expect((await invites.preview(primeiro)).status).toBe('INVALID');
    for (let n = 0; n < 3; n++) await invites.resend(master.userId, re.invite.id);
    await expect(invites.resend(master.userId, re.invite.id)).rejects.toThrow(ConflictException);

    const atual = tokenDe(ultimaMensagemPara(email('reenvia')));
    expect((await invites.preview(segundo)).status).toBe('INVALID');
    // Dois envios simultâneos do mesmo link: exatamente um aceite.
    const paralelo = await Promise.allSettled([
      invites.accept(atual, 'senha-paralela-1', { now: now() }),
      invites.accept(atual, 'senha-paralela-2', { now: now() }),
    ]);
    expect(paralelo.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(paralelo.find((r) => r.status === 'rejected')).toMatchObject({ reason: expect.any(GoneException) });
    const [{ total }] = await db.query(
      `SELECT count(*)::int AS total FROM memberships m JOIN users u ON u.id = m.user_id WHERE u.email = $1`,
      [email('reenvia')],
    );
    expect(total).toBe(1);
    expect(await db.query(`SELECT count(*)::int AS total FROM credentials c JOIN users u ON u.id = c.user_id WHERE u.email = $1`, [email('reenvia')])).toEqual([{ total: 1 }]);
  });

  it('falha do provedor e provedor ausente ficam registrados, sem fingir envio', async () => {
    const master = await conta('envio-master', { role: 'MASTER_OWNER' });
    const t = await tenant('envio');
    caixa.estado.falhar = true;
    try {
      const falhou = await invites.inviteMember(master.userId, t, { requestKey: requestKey(), name: 'Falha', email: email('falha'), role: 'DONO' });
      expect(falhou.delivery).toEqual({ status: 'FAILED', failure: 'HTTP_5XX' });
      expect(falhou.invite.delivery).toMatchObject({ status: 'FAILED', failure: 'HTTP_5XX', attempts: 1 });
      expect(falhou.invite.status).toBe('PENDING');
    } finally {
      caixa.estado.falhar = false;
    }
    const semProvedor = await semEmail.inviteMember(master.userId, t, {
      requestKey: requestKey(),
      name: 'Sem Provedor',
      email: email('sem-provedor'),
      role: 'DONO',
    });
    expect(semProvedor.delivery).toEqual({ status: 'NOT_CONFIGURED' });
    expect(semProvedor.invite.delivery).toMatchObject({ status: 'NOT_CONFIGURED', attempts: 0 });
    const [conta_] = await db.query(`SELECT status FROM users WHERE email = $1`, [email('sem-provedor')]);
    expect(conta_.status).toBe('INVITED');
  });

  it('usuário comum, suporte e administrador delegado são barrados no que não podem', async () => {
    const comum = await conta('perm-comum');
    const suporte = await conta('perm-suporte', { role: 'MASTER_SUPPORT', permissions: ['ESTABLISHMENTS_MANAGE'] });
    const delegado = await conta('perm-delegado', { role: 'MASTER_ADMIN', permissions: ['ESTABLISHMENTS_MANAGE'] });
    const outroAdmin = await conta('perm-outro-admin', { role: 'MASTER_ADMIN', permissions: ['ESTABLISHMENTS_MANAGE'] });
    const t = await tenant('perm');
    const convite = (actor: string) =>
      invites.inviteMember(actor, t, { requestKey: requestKey(), name: 'Alvo', email: email(`perm-alvo-${id()}`), role: 'DONO' });

    await expect(convite(comum.userId)).rejects.toThrow(ForbiddenException);
    await expect(convite(suporte.userId)).rejects.toThrow(ForbiddenException);
    expect((await directory.listUsers(suporte.userId, { q: marca, page: 1, pageSize: 5 })).total).toBeGreaterThan(0);
    await expect(convite(delegado.userId)).resolves.toMatchObject({ created: true });

    for (const sessao of [delegado]) await reauth(sessao.userId, sessao.sessionId);
    // Delegado não mexe em papel de plataforma, nem no próprio, nem em outro admin.
    await expect(
      admin.setPlatformAccess(delegado.userId, delegado.sessionId, delegado.userId, {
        expectedUpdatedAt: await updatedAt(delegado.userId),
        role: 'MASTER_OWNER' as never,
        permissions: [],
      }),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      admin.block(delegado.userId, delegado.sessionId, outroAdmin.userId, { expectedUpdatedAt: await updatedAt(outroAdmin.userId) }),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      admin.updateUser(delegado.userId, delegado.userId, { expectedUpdatedAt: await updatedAt(delegado.userId), name: 'Eu mesmo' }),
    ).rejects.toThrow(ForbiddenException);
    // Nem convidar a si próprio para uma empresa (aumentaria os próprios poderes).
    await expect(
      invites.inviteMember(delegado.userId, t, { requestKey: requestKey(), name: 'Eu', email: email('perm-delegado'), role: 'DONO' }),
    ).rejects.toThrow(ForbiddenException);
    // Convite de plataforma é só do MASTER_OWNER.
    await expect(
      invites.invitePlatform(delegado.userId, {
        requestKey: requestKey(),
        name: 'Novo admin',
        email: email('perm-novo-admin'),
        platformRole: 'MASTER_ADMIN' as never,
        permissions: ['ESTABLISHMENTS_MANAGE'],
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('mudança sensível exige senha reconfirmada; MASTER_OWNER não altera a própria autorização', async () => {
    const master = await conta('reauth-master', { role: 'MASTER_OWNER' });
    const alvo = await conta('reauth-alvo');
    const bloquear = async () =>
      admin.block(master.userId, master.sessionId, alvo.userId, { expectedUpdatedAt: await updatedAt(alvo.userId) });
    await expect(bloquear()).rejects.toThrow(ForbiddenException);
    await expect(admin.reauthenticate(master.userId, master.sessionId, 'senha-errada-123')).rejects.toThrow(UnauthorizedException);
    await expect(bloquear()).rejects.toThrow(ForbiddenException);
    await reauth(master.userId, master.sessionId);
    await expect(
      admin.setPlatformAccess(master.userId, master.sessionId, master.userId, {
        expectedUpdatedAt: await updatedAt(master.userId),
        role: null,
        permissions: [],
      }),
    ).rejects.toThrow(ForbiddenException);
    await expect(bloquear()).resolves.toMatchObject({ status: 'SUSPENDED' });
  });

  it('dois MASTER_OWNER se rebaixando ao mesmo tempo: sobra exatamente um', async () => {
    const a = await conta('dono-a', { role: 'MASTER_OWNER' });
    const b = await conta('dono-b', { role: 'MASTER_OWNER' });
    await reauth(a.userId, a.sessionId);
    await reauth(b.userId, b.sessionId);
    const rebaixar = async (quem: typeof a, alvo: typeof a) =>
      admin.setPlatformAccess(quem.userId, quem.sessionId, alvo.userId, {
        expectedUpdatedAt: await updatedAt(alvo.userId),
        role: 'MASTER_ADMIN' as never,
        permissions: ['ESTABLISHMENTS_MANAGE'],
      });
    const [ua, ub] = [await updatedAt(a.userId), await updatedAt(b.userId)];
    expect(ua && ub).toBeTruthy();
    const resultados = await Promise.allSettled([rebaixar(a, b), rebaixar(b, a)]);
    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const donos = await db.query(
      `SELECT id FROM users WHERE id = ANY($1) AND platform_role = 'MASTER_OWNER' AND status = 'ACTIVE'`,
      [[a.userId, b.userId]],
    );
    expect(donos).toHaveLength(1);
  });

  it('com um só MASTER_OWNER ativo, ninguém consegue tirá-lo (nem ele mesmo)', async () => {
    // Isolado numa transação desfeita no fim: todos os MASTER_OWNER do banco
    // viram MASTER_ADMIN, e sobra um único dono ativo.
    const runner = db.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const unico = id();
      const delegado = id();
      const [sessaoUnico, sessaoDelegado] = [id(), id()];
      await runner.query(`UPDATE users SET platform_role = 'MASTER_ADMIN' WHERE platform_role = 'MASTER_OWNER'`);
      await runner.query(
        `INSERT INTO users (id, name, email, status, platform_role, platform_permissions) VALUES
         ($1, 'Único', $2, 'ACTIVE', 'MASTER_OWNER', NULL),
         ($3, 'Delegado', $4, 'ACTIVE', 'MASTER_ADMIN', '{ESTABLISHMENTS_MANAGE}')`,
        [unico, email('ultimo-unico'), delegado, email('ultimo-delegado')],
      );
      await runner.query(
        `INSERT INTO sessions (id, user_id, token_hash, expires_at, reauthenticated_at) VALUES
         ($1, $2, $3, now() + interval '1 day', now()), ($4, $5, $6, now() + interval '1 day', now())`,
        [sessaoUnico, unico, id() + id(), sessaoDelegado, delegado, id() + id()],
      );
      const servico = new AccountsAdminService({
        transaction: (fn: (m: unknown) => unknown) => fn(runner.manager),
      } as unknown as DataSource);
      const [{ updated_at }] = await runner.query(`SELECT updated_at FROM users WHERE id = $1`, [unico]);
      const esperado = { expectedUpdatedAt: updated_at.toISOString() };
      await expect(servico.block(delegado, sessaoDelegado, unico, esperado)).rejects.toThrow(ForbiddenException);
      await expect(
        servico.setPlatformAccess(delegado, sessaoDelegado, unico, { ...esperado, role: null, permissions: [] }),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        servico.setPlatformAccess(unico, sessaoUnico, unico, { ...esperado, role: null, permissions: [] }),
      ).rejects.toThrow(ForbiddenException);
      await expect(servico.block(unico, sessaoUnico, unico, esperado)).rejects.toThrow(ForbiddenException);
      const [{ total }] = await runner.query(
        `SELECT count(*)::int AS total FROM users WHERE platform_role = 'MASTER_OWNER' AND status = 'ACTIVE'`,
      );
      expect(total).toBe(1);
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  });

  it('bloqueio encerra sessões abertas; desvínculo tira só aquela empresa', async () => {
    const master = await conta('bloq-master', { role: 'MASTER_OWNER' });
    const pessoa = await conta('bloq-pessoa');
    const [t1, t2] = [await tenant('bloq-1'), await tenant('bloq-2')];
    const m1 = id();
    await db.query(`INSERT INTO memberships (id, user_id, tenant_id, role) VALUES ($1, $2, $3, 'DONO'), ($4, $2, $5, 'DONO')`, [m1, pessoa.userId, t1, id(), t2]);
    await reauth(master.userId, master.sessionId);
    await admin.removeMembership(master.userId, master.sessionId, m1);
    expect((await db.query(`SELECT tenant_id FROM memberships WHERE user_id = $1`, [pessoa.userId])).map((r: { tenant_id: string }) => r.tenant_id)).toEqual([t2]);
    await expect(admin.removeMembership(master.userId, master.sessionId, m1)).rejects.toThrow(NotFoundException);

    await admin.block(master.userId, master.sessionId, pessoa.userId, { expectedUpdatedAt: await updatedAt(pessoa.userId) });
    const [sessao] = await db.query(`SELECT revoked_at FROM sessions WHERE id = $1`, [pessoa.sessionId]);
    expect(sessao.revoked_at).not.toBeNull();
    const [user] = await db.query(`SELECT status FROM users WHERE id = $1`, [pessoa.userId]);
    expect(user.status).toBe('SUSPENDED');
    // Conta bloqueada não aceita convite nem recebe outro.
    await expect(
      invites.inviteMember(master.userId, t1, { requestKey: requestKey(), name: 'B', email: email('bloq-pessoa'), role: 'DONO' }),
    ).rejects.toThrow(ConflictException);
    const reativada = await admin.reactivate(master.userId, master.sessionId, pessoa.userId, {
      expectedUpdatedAt: await updatedAt(pessoa.userId),
    });
    expect(reativada.status).toBe('ACTIVE');
  });

  it('bloquear depois de emitir o convite impede a aceitação', async () => {
    const master = await conta('bloq2-master', { role: 'MASTER_OWNER' });
    const t = await tenant('bloq2');
    const r = await invites.inviteMember(master.userId, t, { requestKey: requestKey(), name: 'Nova', email: email('bloq2-nova'), role: 'DONO' });
    const token = tokenDe(ultimaMensagemPara(email('bloq2-nova')));
    await reauth(master.userId, master.sessionId);
    await admin.block(master.userId, master.sessionId, r.invite.targetUser!.id, {
      expectedUpdatedAt: await updatedAt(r.invite.targetUser!.id),
    });
    expect((await invites.preview(token)).status).toBe('UNAVAILABLE');
    await expect(invites.accept(token, SENHA, { now: now() })).rejects.toThrow(GoneException);
  });

  it('conflito entre duas telas e rollback sem alteração parcial nem histórico', async () => {
    const master = await conta('conf-master', { role: 'MASTER_OWNER' });
    const alvo = await conta('conf-alvo');
    const lido = await updatedAt(alvo.userId);
    await admin.updateUser(master.userId, alvo.userId, { expectedUpdatedAt: lido, name: 'Primeira tela' });
    await expect(admin.updateUser(master.userId, alvo.userId, { expectedUpdatedAt: lido, name: 'Segunda tela' })).rejects.toThrow(
      ConflictException,
    );
    const [user] = await db.query(`SELECT name FROM users WHERE id = $1`, [alvo.userId]);
    expect(user.name).toBe('Primeira tela');
    expect(
      await db.query(`SELECT count(*)::int AS total FROM audit_logs WHERE target_user_id = $1 AND action = 'USER_UPDATED'`, [alvo.userId]),
    ).toEqual([{ total: 1 }]);

    // Falha DEPOIS de criar o estabelecimento (responsável bloqueado): nada fica.
    const bloqueada = await conta('conf-bloqueada', { status: 'SUSPENDED' });
    const nome = `${marca} Rollback`;
    await expect(
      invites.createEstablishment(
        master.userId,
        createEstablishmentSchema.parse({
          requestKey: requestKey(),
          businessName: nome,
          category: 'OTHER',
          planId,
          owner: { name: 'Bloqueada', email: email('conf-bloqueada') },
        }),
      ),
    ).rejects.toThrow(ConflictException);
    expect(bloqueada.userId).toBeTruthy();
    expect(await db.query(`SELECT 1 FROM units WHERE name = $1`, [nome])).toEqual([]);
    expect(await db.query(`SELECT 1 FROM audit_logs WHERE summary LIKE $1`, [`%${nome}%`])).toEqual([]);
  });

  it('restrição de permissão tem efeito no acesso efetivo e conflita com outra tela', async () => {
    const master = await conta('rest-master', { role: 'MASTER_OWNER' });
    const pessoa = await conta('rest-pessoa');
    const t = await tenant('rest');
    const m = id();
    await db.query(`INSERT INTO memberships (id, user_id, tenant_id, role) VALUES ($1, $2, $3, 'DONO')`, [m, pessoa.userId, t]);
    await reauth(master.userId, master.sessionId);
    await admin.setDeniedPermissions(master.userId, master.sessionId, m, { expectedDenied: [], denied: ['CONSUMIDORES_VISUALIZAR'] });
    const ficha = await directory.userDetail(master.userId, pessoa.userId);
    const areas = ficha.memberships[0].effectiveAccess.filter((a: { allowed: boolean }) => !a.allowed).map((a: { key: string }) => a.key);
    expect(areas).toEqual(expect.arrayContaining(['CLIENTES_VER', 'CLIENTES_GERENCIAR', 'AGENDA_CRIAR']));
    await expect(
      admin.setDeniedPermissions(master.userId, master.sessionId, m, { expectedDenied: [], denied: [] }),
    ).rejects.toThrow(ConflictException);
  });

  it('redefinição de senha: link único, senha nova, sessões encerradas', async () => {
    const master = await conta('reset-master', { role: 'MASTER_OWNER' });
    const pessoa = await conta('reset-pessoa');
    const pedido = await resets.request(master.userId, pessoa.userId, requestKey());
    expect(pedido.delivery).toEqual({ status: 'SENT' });
    const token = /#t=([0-9a-f]{64})/.exec(ultimaMensagemPara(email('reset-pessoa')).text)![1];
    expect((await resets.preview(token)).status).toBe('VALID');
    await resets.complete(token, 'senha-nova-depois-do-link');
    const [linha] = await db.query(
      `SELECT c.password_hash, (SELECT revoked_at FROM sessions WHERE id = $2) AS revoked FROM credentials c WHERE c.user_id = $1`,
      [pessoa.userId, pessoa.sessionId],
    );
    expect(await verifyPassword(linha.password_hash, 'senha-nova-depois-do-link')).toBe(true);
    expect(await verifyPassword(linha.password_hash, SENHA)).toBe(false);
    expect(linha.revoked).not.toBeNull();
    await expect(resets.complete(token, 'outra-senha-qualquer')).rejects.toThrow(GoneException);
    expect(JSON.stringify(pedido)).not.toContain(token);
  });

  it('convite de plataforma: só para e-mail novo, aplica o papel no aceite', async () => {
    const master = await conta('plat-master', { role: 'MASTER_OWNER' });
    const r = await invites.invitePlatform(master.userId, {
      requestKey: requestKey(),
      name: 'Nova Admin',
      email: email('plat-nova'),
      platformRole: 'MASTER_ADMIN' as never,
      permissions: ['ESTABLISHMENTS_MANAGE'],
    });
    const token = tokenDe(ultimaMensagemPara(email('plat-nova')));
    const aceito = await invites.accept(token, 'senha-da-nova-admin', { now: now() });
    expect(aceito.destination).toBe('/conta/administracao');
    const [user] = await db.query(`SELECT platform_role, platform_permissions::text[] AS platform_permissions FROM users WHERE id = $1`, [r.invite.targetUser!.id]);
    expect(user).toEqual({ platform_role: 'MASTER_ADMIN', platform_permissions: ['ESTABLISHMENTS_MANAGE'] });
    await expect(
      invites.invitePlatform(master.userId, {
        requestKey: requestKey(),
        name: 'Já existe',
        email: email('plat-nova'),
        platformRole: 'MASTER_SUPPORT' as never,
        permissions: [],
      }),
    ).rejects.toThrow(ConflictException);
  });
});
