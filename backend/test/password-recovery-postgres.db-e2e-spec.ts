// "Esqueci minha senha" contra PostgreSQL DESCARTÁVEL, com a migration
// SelfServicePasswordReset aplicada. Os serviços rodam de verdade e o
// adaptador Brevo aponta para uma caixa HTTP local: nenhuma mensagem sai da
// máquina. Cada caso usa marcadores próprios.
//
// Cobre: quem recebe (só e-mail confirmado; login que parece e-mail nunca),
// link pendente preservado (inclusive o da administração) e a reemissão pela
// administração, concorrência de pedidos e de conclusões, limite por conta,
// falha do provedor e reinício do processo, sessões encerradas, 2FA intacto,
// e a API anterior gravando no schema novo.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { globSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DataSource } from 'typeorm';
import type { ConfigService } from '@nestjs/config';
import { GoneException } from '@nestjs/common';
import { buildRuntimeDataSourceOptions } from '../src/database/runtime-data-source.js';
import { hashPassword, verifyPassword } from '../src/auth/password-hasher.js';
import { AccountDelivery } from '../src/accounts/account-delivery.js';
import { AccountsDirectoryService } from '../src/accounts/accounts-directory.service.js';
import { PasswordResetsService } from '../src/accounts/password-resets.service.js';
import {
  DELIVERY_LEASE_MS,
  PROCESSED_REQUEST_RETENTION_MS,
  PasswordResetRequests,
  SELF_SERVICE_HOURLY_LIMIT,
} from '../src/accounts/password-reset-requests.js';
import { SELF_SERVICE_LINK_TTL_MS } from '../src/accounts/account-token.js';

const url = process.env.DB_E2E_DIRECT_URL;
if (url && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)) {
  throw new Error('Este teste exige PostgreSQL descartável local.');
}
const id = () => randomUUID().replaceAll('-', '').slice(0, 24);
const SENHA = 'senha-de-teste-forte-1';
const MINUTO = 60_000;

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

describe.skipIf(!url)('"Esqueci minha senha" contra PostgreSQL descartável', () => {
  let db: DataSource;
  let delivery: AccountDelivery;
  let semEmail: AccountDelivery;
  let resets: PasswordResetsService;
  let directory: AccountsDirectoryService;
  const caixa = caixaDeEmail();
  const marca = `recup-${id()}`;
  const email = (nome: string) => `${marca}-${nome}@example.test`;
  let hash: string;
  let configDe: (valores: Record<string, string>) => ConfigService;

  /** Um executor novo é um processo novo (nada em memória do anterior). */
  const executor = (envio: AccountDelivery = delivery) => new PasswordResetRequests(db, envio);

  async function conta(
    nome: string,
    opcoes: { email?: string | null; username?: string; verificado?: boolean; status?: string; semSenha?: boolean; role?: string } = {},
  ) {
    const userId = id();
    await db.query(
      `INSERT INTO users (id, name, email, username, email_verified, status, platform_role)
       VALUES ($1, $2, $3, $4, $5, $6::user_status, $7::platform_role)`,
      [
        userId,
        `Pessoa ${nome}`,
        opcoes.email === undefined ? email(nome) : opcoes.email,
        opcoes.username ?? null,
        opcoes.verificado ?? true,
        opcoes.status ?? 'ACTIVE',
        opcoes.role ?? null,
      ],
    );
    if (!opcoes.semSenha) {
      await db.query(`INSERT INTO credentials (id, user_id, password_hash, algorithm) VALUES ($1, $2, $3, 'argon2id')`, [
        id(),
        userId,
        hash,
      ]);
    }
    const sessionId = id();
    await db.query(
      `INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, now() + interval '1 day')`,
      [sessionId, userId, id() + id()],
    );
    return { userId, sessionId };
  }

  /** O que a rota pública grava (sem disparar a rodada automática). */
  const pedir = (identificador: string, quando = new Date()) =>
    db.query('INSERT INTO password_reset_requests (id, identifier, requested_at) VALUES ($1, $2, $3)', [id(), identificador, quando]);

  const mensagensPara = (destino: string) => caixa.recebidos.filter((m) => m.to === destino);
  const resetsDe = (userId: string) =>
    db.query<
      { id: string; origin: string; status: string; requested_by_user_id: string | null; delivery_status: string; delivery_attempts: number; delivery_due_at: Date | null; expires_at: Date; created_at: Date }[]
    >(
      `SELECT id, origin, status, requested_by_user_id, delivery_status, delivery_attempts, delivery_due_at, expires_at, created_at
         FROM password_resets WHERE user_id = $1 ORDER BY created_at, id`,
      [userId],
    );
  const pedidos = (desde: Date) =>
    db.query<{ identifier: string | null; outcome: string | null; processed_at: Date | null }[]>(
      `SELECT identifier, outcome, processed_at FROM password_reset_requests WHERE requested_at >= $1 ORDER BY requested_at, id`,
      [desde],
    );

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
    configDe = (valores) => ({ get: (k: string) => valores[k], getOrThrow: (k: string) => valores[k] }) as unknown as ConfigService;
    delivery = new AccountDelivery(
      db,
      configDe({
        EMAIL_PROVIDER: 'brevo',
        EMAIL_API_KEY: 'chave-local',
        EMAIL_FROM: 'nao-responda@example.test',
        EMAIL_API_BASE_URL: `http://127.0.0.1:${porta}`,
        FRONTEND_URL: 'http://localhost:3000',
      }),
    );
    semEmail = new AccountDelivery(db, configDe({ FRONTEND_URL: 'http://localhost:3000' }));
    resets = new PasswordResetsService(db, delivery);
    directory = new AccountsDirectoryService(db);
    hash = await hashPassword(SENHA);
  });

  afterAll(async () => {
    caixa.server.close();
    if (db?.isInitialized) await db.destroy();
  });

  beforeEach(() => {
    caixa.estado.falhar = false;
  });

  it('e-mail confirmado: um link de 1 hora só para users.email; nova senha encerra as sessões e mantém o 2FA', async () => {
    const pessoa = await conta('confirmada');
    await db.query(
      `INSERT INTO user_second_factors (user_id, secret_ciphertext, secret_nonce, secret_tag, key_version, confirmed_at)
       VALUES ($1, '\\x00'::bytea, decode(repeat('00', 12), 'hex'), decode(repeat('00', 16), 'hex'), 1, now())`,
      [pessoa.userId],
    );
    const inicio = new Date();
    const fila = executor();
    // A rota grava e devolve; a rodada roda sozinha logo depois. Caixa
    // diferente no pedido: citext.
    await fila.enqueue(email('confirmada').toUpperCase(), inicio);
    await fila.idle();

    const [registro] = await pedidos(inicio);
    expect(registro).toMatchObject({ identifier: null, outcome: 'ISSUED' });
    const [reset] = await resetsDe(pessoa.userId);
    expect(reset).toMatchObject({ origin: 'SELF_SERVICE', status: 'PENDING', requested_by_user_id: null, delivery_status: 'SENT', delivery_due_at: null });
    expect(new Date(reset.expires_at).getTime() - new Date(reset.created_at).getTime()).toBe(SELF_SERVICE_LINK_TTL_MS);

    const [mensagem] = mensagensPara(email('confirmada'));
    expect(mensagem.subject).toBe('Recuperação de senha no TimVix');
    expect(mensagem.text).toContain('O link vale por');
    const token = tokenDe(mensagem);
    expect(await resets.preview(token)).toMatchObject({ status: 'VALID', email: email('confirmada') });

    await resets.complete(token, 'senha-nova-pelo-esqueci');
    const [depois] = await db.query(
      `SELECT c.password_hash,
              (SELECT revoked_at FROM sessions WHERE id = $2) AS revoked,
              (SELECT count(*)::int FROM user_second_factors WHERE user_id = $1) AS segundo_fator
         FROM credentials c WHERE c.user_id = $1`,
      [pessoa.userId, pessoa.sessionId],
    );
    expect(await verifyPassword(depois.password_hash, 'senha-nova-pelo-esqueci')).toBe(true);
    expect(depois.revoked).not.toBeNull();
    expect(depois.segundo_fator).toBe(1);
    expect((await resetsDe(pessoa.userId)).map((r) => r.status)).toEqual(['USED']);
    await expect(resets.complete(token, 'outra-senha-qualquer')).rejects.toThrow(GoneException);

    // Ficha da administração: origem explícita, sem autor inventado.
    const master = await conta('confirmada-master', { role: 'MASTER_OWNER' });
    const ficha = await directory.userDetail(master.userId, pessoa.userId);
    expect(ficha.latestPasswordReset).toMatchObject({ origin: 'SELF_SERVICE', requestedBy: null, status: 'USED' });
  });

  it('ninguém recebe: login de equipe (inclusive com cara de e-mail), e-mail não confirmado, bloqueada, sem senha, inexistente', async () => {
    const equipe = await conta('equipe', { email: null, username: `${marca}-maria@salao` });
    const naoConfirmada = await conta('nao-confirmada', { verificado: false });
    const bloqueada = await conta('bloqueada', { status: 'SUSPENDED' });
    const semSenha = await conta('sem-senha', { status: 'INVITED', semSenha: true });
    const inicio = new Date();
    const fila = executor();
    for (const identificador of [
      `${marca}-maria@salao`,
      email('nao-confirmada'),
      email('bloqueada'),
      email('sem-senha'),
      email('inexistente'),
    ]) {
      await pedir(identificador, inicio);
    }
    await fila.runOnce();

    // Mesmo instante de pedido: a ordem entre eles não importa.
    const resolvidos = await pedidos(inicio);
    expect(resolvidos.every((p) => p.identifier === null && p.processed_at !== null)).toBe(true);
    expect(resolvidos.map((p) => p.outcome).sort()).toEqual(['NOT_ELIGIBLE', 'NOT_ELIGIBLE', 'NOT_ELIGIBLE', 'NOT_ELIGIBLE', 'NO_MATCH']);
    for (const c of [equipe, naoConfirmada, bloqueada, semSenha]) expect(await resetsDe(c.userId)).toEqual([]);
    for (const destino of [`${marca}-maria@salao`, email('nao-confirmada'), email('bloqueada'), email('sem-senha'), email('inexistente')]) {
      expect(mensagensPara(destino)).toEqual([]);
    }
  });

  it('link pendente válido (da administração) é preservado; a administração ainda pode reemitir', async () => {
    const master = await conta('preserva-master', { role: 'MASTER_OWNER' });
    const pessoa = await conta('preserva');
    await resets.request(master.userId, pessoa.userId, `chave-${id()}`);
    const tokenDaAdministracao = tokenDe(mensagensPara(email('preserva')).at(-1)!);

    const inicio = new Date();
    const fila = executor();
    await pedir(email('preserva'), inicio);
    await pedir(email('preserva'), inicio);
    await fila.runOnce();

    expect((await pedidos(inicio)).map((p) => p.outcome)).toEqual(['ACTIVE_LINK_KEPT', 'ACTIVE_LINK_KEPT']);
    expect(mensagensPara(email('preserva'))).toHaveLength(1);
    expect((await resets.preview(tokenDaAdministracao)).status).toBe('VALID');
    expect((await resetsDe(pessoa.userId)).map((r) => [r.origin, r.status])).toEqual([['ADMIN', 'PENDING']]);

    // Reemissão administrativa autorizada: revoga o anterior, como sempre.
    await resets.request(master.userId, pessoa.userId, `chave-${id()}`);
    expect((await resets.preview(tokenDaAdministracao)).status).toBe('REVOKED');
    expect((await resets.preview(tokenDe(mensagensPara(email('preserva')).at(-1)!))).status).toBe('VALID');
  });

  it('a administração reemite por cima de um link de autoatendimento pendente', async () => {
    const master = await conta('reemite-master', { role: 'MASTER_OWNER' });
    const pessoa = await conta('reemite');
    const fila = executor();
    await pedir(email('reemite'));
    await fila.runOnce();
    const tokenProprio = tokenDe(mensagensPara(email('reemite')).at(-1)!);
    await resets.request(master.userId, pessoa.userId, `chave-${id()}`);
    expect((await resets.preview(tokenProprio)).status).toBe('REVOKED');
    expect((await resetsDe(pessoa.userId)).map((r) => [r.origin, r.status, r.delivery_due_at])).toEqual([
      ['SELF_SERVICE', 'REVOKED', null],
      ['ADMIN', 'PENDING', null],
    ]);
  });

  it('pedidos simultâneos para a mesma conta, em executores paralelos: um link, um e-mail', async () => {
    const pessoa = await conta('simultaneo');
    const inicio = new Date();
    const fila = executor();
    await Promise.all(Array.from({ length: 6 }, () => pedir(email('simultaneo'), inicio)));
    // Três "processos" disputando a fila ao mesmo tempo.
    const executores = [executor(), executor(), executor()];
    await Promise.all(executores.map((e) => e.runOnce()));
    await fila.runOnce();

    const desfechos = (await pedidos(inicio)).map((p) => p.outcome);
    expect(desfechos).toHaveLength(6);
    expect(desfechos.filter((d) => d === 'ISSUED')).toHaveLength(1);
    expect(desfechos.filter((d) => d === 'ACTIVE_LINK_KEPT')).toHaveLength(5);
    expect(await resetsDe(pessoa.userId)).toHaveLength(1);
    expect(mensagensPara(email('simultaneo'))).toHaveLength(1);
  });

  it('conclusões simultâneas do mesmo link: só uma vence; a outra recebe 410', async () => {
    const pessoa = await conta('conclusao');
    const fila = executor();
    await pedir(email('conclusao'));
    await fila.runOnce();
    const token = tokenDe(mensagensPara(email('conclusao')).at(-1)!);

    const resultados = await Promise.allSettled([
      resets.complete(token, 'senha-da-primeira-aba'),
      resets.complete(token, 'senha-da-segunda-aba'),
    ]);
    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const recusa = resultados.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(recusa.reason).toBeInstanceOf(GoneException);
    const [{ password_hash }] = await db.query(`SELECT password_hash FROM credentials WHERE user_id = $1`, [pessoa.userId]);
    const vencedora = resultados[0].status === 'fulfilled' ? 'senha-da-primeira-aba' : 'senha-da-segunda-aba';
    expect(await verifyPassword(password_hash, vencedora)).toBe(true);
  });

  it(`limite por conta: depois de ${SELF_SERVICE_HOURLY_LIMIT} links na hora, nada é emitido (o pedido continua aceito)`, async () => {
    const pessoa = await conta('limite');
    const inicio = new Date();
    const fila = executor();
    for (let i = 0; i < SELF_SERVICE_HOURLY_LIMIT; i += 1) {
      await pedir(email('limite'));
      await fila.runOnce();
      await resets.complete(tokenDe(mensagensPara(email('limite')).at(-1)!), `senha-nova-numero-${i}-ok`);
    }
    await pedir(email('limite'));
    await fila.runOnce();
    expect((await pedidos(inicio)).map((p) => p.outcome)).toEqual(['ISSUED', 'ISSUED', 'ISSUED', 'ACCOUNT_LIMIT']);
    expect(mensagensPara(email('limite'))).toHaveLength(SELF_SERVICE_HOURLY_LIMIT);
    expect((await resetsDe(pessoa.userId)).every((r) => r.status === 'USED')).toBe(true);
  });

  it('provedor recusa: volta à fila; outro processo (reinício) entrega depois e só o último link vale', async () => {
    const pessoa = await conta('falha');
    const t0 = new Date();
    caixa.estado.falhar = true;
    const primeiro = executor();
    await pedir(email('falha'), t0);
    await primeiro.runOnce(() => t0);
    let [reset] = await resetsDe(pessoa.userId);
    expect(reset).toMatchObject({ status: 'PENDING', delivery_status: 'FAILED', delivery_attempts: 1 });
    expect(new Date(reset.delivery_due_at!).getTime()).toBe(t0.getTime() + MINUTO);

    // "Reinício": processo novo, provedor de volta, depois da espera.
    caixa.estado.falhar = false;
    const depoisDoReinicio = executor();
    expect((await depoisDoReinicio.runOnce(() => new Date(t0.getTime() + 30_000))).deliveries).toBe(0);
    expect((await depoisDoReinicio.runOnce(() => new Date(t0.getTime() + 2 * MINUTO))).deliveries).toBe(1);
    [reset] = await resetsDe(pessoa.userId);
    expect(reset).toMatchObject({ status: 'PENDING', delivery_status: 'SENT', delivery_attempts: 2, delivery_due_at: null });
    const mensagens = mensagensPara(email('falha'));
    expect(mensagens).toHaveLength(1);
    expect((await resets.preview(tokenDe(mensagens[0]))).status).toBe('VALID');
  });

  it('processo morreu entre a reserva e o envio: vencida a concessão, outro processo envia', async () => {
    const pessoa = await conta('concessao');
    const t0 = new Date();
    const fila = executor();
    await pedir(email('concessao'), t0);
    // Só resolve o pedido (o "processo" morre antes de enviar).
    expect(await fila.processNextRequest(t0)).toBe(true);
    // Reserva feita por um processo que morreu logo depois.
    await db.query(`UPDATE password_resets SET delivery_due_at = $2 WHERE user_id = $1`, [
      pessoa.userId,
      new Date(t0.getTime() + DELIVERY_LEASE_MS),
    ]);
    const outro = executor();
    expect((await outro.runOnce(() => new Date(t0.getTime() + MINUTO))).deliveries).toBe(0);
    expect(mensagensPara(email('concessao'))).toHaveLength(0);
    expect((await outro.runOnce(() => new Date(t0.getTime() + DELIVERY_LEASE_MS + 1000))).deliveries).toBe(1);
    expect(mensagensPara(email('concessao'))).toHaveLength(1);
    expect((await resets.preview(tokenDe(mensagensPara(email('concessao'))[0]))).status).toBe('VALID');
  });

  it('três recusas seguidas: o link nunca chegou e é revogado, liberando um pedido novo', async () => {
    const pessoa = await conta('desiste');
    const t0 = new Date();
    caixa.estado.falhar = true;
    const fila = executor();
    await pedir(email('desiste'), t0);
    await fila.runOnce(() => t0);
    await fila.runOnce(() => new Date(t0.getTime() + 2 * MINUTO));
    await fila.runOnce(() => new Date(t0.getTime() + 8 * MINUTO));
    expect((await resetsDe(pessoa.userId)).map((r) => [r.status, r.delivery_attempts, r.delivery_due_at])).toEqual([
      ['REVOKED', 3, null],
    ]);
    caixa.estado.falhar = false;
    await pedir(email('desiste'));
    await fila.runOnce();
    expect((await resetsDe(pessoa.userId)).map((r) => r.status)).toEqual(['REVOKED', 'PENDING']);
    expect(mensagensPara(email('desiste'))).toHaveLength(1);
  });

  it('sem provedor configurado: o link fica registrado como "não configurado" e nada é reenviado', async () => {
    const pessoa = await conta('sem-provedor');
    const fila = executor(semEmail);
    await pedir(email('sem-provedor'));
    await fila.runOnce();
    expect((await resetsDe(pessoa.userId)).map((r) => [r.status, r.delivery_status, r.delivery_due_at])).toEqual([
      ['PENDING', 'NOT_CONFIGURED', null],
    ]);
    expect(mensagensPara(email('sem-provedor'))).toEqual([]);
  });

  it('conta mudou depois do pedido (bloqueada): o link é revogado e nada sai', async () => {
    const pessoa = await conta('bloqueada-depois');
    const t0 = new Date();
    const fila = executor();
    await pedir(email('bloqueada-depois'), t0);
    expect(await fila.processNextRequest(t0)).toBe(true);
    await db.query(`UPDATE users SET status = 'SUSPENDED' WHERE id = $1`, [pessoa.userId]);
    await fila.runOnce(() => t0);
    expect((await resetsDe(pessoa.userId)).map((r) => r.status)).toEqual(['REVOKED']);
    expect(mensagensPara(email('bloqueada-depois'))).toEqual([]);
  });

  it('o pedido de uma conta nunca toca outra; link vencido não segura a vaga', async () => {
    const ana = await conta('ana');
    const bia = await conta('bia');
    const fila = executor();
    await pedir(email('ana'));
    await fila.runOnce();
    expect(await resetsDe(bia.userId)).toEqual([]);
    expect(mensagensPara(email('bia'))).toEqual([]);
    expect(mensagensPara(email('ana'))).toHaveLength(1);
    // O link de Ana venceu sem uso: um pedido novo emite outro.
    await db.query(
      `UPDATE password_resets SET created_at = created_at - interval '2 hours', expires_at = now() - interval '1 minute' WHERE user_id = $1`,
      [ana.userId],
    );
    await pedir(email('ana'));
    await fila.runOnce();
    expect((await resetsDe(ana.userId)).map((r) => r.status)).toEqual(['EXPIRED', 'PENDING']);
  });

  it('API anterior no schema novo: insere sem origem (vira ADMIN com autor); sem autor, o banco recusa', async () => {
    const master = await conta('antiga-master', { role: 'MASTER_OWNER' });
    const pessoa = await conta('antiga');
    const resetId = id();
    await db.query(
      `INSERT INTO password_resets (id, user_id, requested_by_user_id, token_hash, status, created_at, expires_at, request_key)
       VALUES ($1, $2, $3, $4, 'PENDING', now(), now() + interval '1 day', $5)`,
      [resetId, pessoa.userId, master.userId, `${id()}${id()}0123456789abcdef`, `chave-${id()}`],
    );
    expect((await resetsDe(pessoa.userId)).map((r) => [r.origin, r.requested_by_user_id])).toEqual([['ADMIN', master.userId]]);
    await expect(
      db.query(
        `INSERT INTO password_resets (id, user_id, token_hash, status, created_at, expires_at) VALUES ($1, $2, $3, 'PENDING', now(), now() + interval '1 hour')`,
        [id(), pessoa.userId, `${id()}${id()}fedcba9876543210`],
      ),
    ).rejects.toMatchObject({ constraint: 'ck_password_resets_origin_requester' });
  });

  it('pedidos resolvidos ficam sem o identificador e são apagados depois de 30 dias', async () => {
    const antigo = new Date(Date.now() - PROCESSED_REQUEST_RETENTION_MS - MINUTO);
    const pedidoId = id();
    await db.query(
      `INSERT INTO password_reset_requests (id, identifier, requested_at, processed_at, outcome)
       VALUES ($1, NULL, $2, $2, 'NO_MATCH')`,
      [pedidoId, antigo],
    );
    await expect(
      db.query(`INSERT INTO password_reset_requests (id, identifier, processed_at, outcome) VALUES ($1, 'x@example.test', now(), 'NO_MATCH')`, [id()]),
    ).rejects.toMatchObject({ constraint: 'ck_password_reset_requests_state' });
    await executor().runOnce();
    expect(await db.query(`SELECT 1 FROM password_reset_requests WHERE id = $1`, [pedidoId])).toEqual([]);
  });
});
