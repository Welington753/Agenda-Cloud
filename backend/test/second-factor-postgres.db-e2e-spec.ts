// Segundo fator (TOTP) das contas de plataforma PELA API HTTP real (AppModule
// inteiro, sessão por cookie) contra PostgreSQL DESCARTÁVEL. Dados, chaves e
// e-mails fictícios; os códigos TOTP são calculados no teste a partir da
// chave manual que a própria API devolve (como o aplicativo faria).
//
// Prova, com o banco:
// - migration aplicada (tabelas e colunas novas);
// - cadastro só completa com código válido; segredo cifrado, nunca em texto;
// - fase optional: conta com fator continua exigindo o código; sessões
//   anteriores à ativação caem; verificação vale só na sessão que a fez;
// - código errado, fora da janela e REUTILIZADO recusados; consumo único em
//   requisições simultâneas (TOTP, recuperação e confirmação);
// - trava de 15 minutos só nas tentativas de segundo fator, sem prolongar;
//   `/auth/me` segue funcionando;
// - fase required e master novo (convite/promoção) exigem cadastro com
//   prova de posse do e-mail; liberação de uso único, presa ao titular,
//   enviada só ao e-mail dele; recuperação não remove o fator ativo;
// - troca de senha de conta master exige o segundo fator; conta comum não;
// - conta master com vínculo de estabelecimento: `/auth/me` sem código;
// - chaves ausentes: verificação pelo app indisponível, nunca liberada;
// - script de emergência: recusa havendo outro proprietário com fator;
// - auditoria e e-mails sem segredo, código, URI ou token.
//
// O banco é compartilhado com os outros arquivos (em série): contas com
// marca própria; nenhuma conta GERENTE é criada.
import { randomUUID } from 'node:crypto';
import { globSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import cookieParser from 'cookie-parser';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as OTPAuth from 'otpauth';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { hashPassword } from '../src/auth/password-hasher.js';
import { buildRuntimeDataSourceOptions } from '../src/database/runtime-data-source.js';
import { SecondFactorConfig } from '../src/second-factor/second-factor-config.js';
import { parseTotpKeyring, type TotpKeyring } from '../src/second-factor/second-factor-keys.js';
import { totpCodeAt } from '../src/second-factor/totp.js';
import { emitirLiberacaoDeEmergencia, RecusaDaLiberacao } from '../scripts/liberar-2fa-emergencia-lib.mjs';

const url = process.env.DB_E2E_DIRECT_URL;
if (url && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)) {
  throw new Error('Este teste exige PostgreSQL descartável local.');
}
const id = () => randomUUID().replaceAll('-', '').slice(0, 24);
const SENHA = 'senha-de-teste-forte-2fa-1';
const SEGREDO_DO_PROXY = 'segredo-do-proxy-so-para-este-teste-2fa-0123456789';
const CHAVE_FICTICIA = Buffer.alloc(32, 7).toString('base64');
const anel = parseTotpKeyring(`1:${CHAVE_FICTICIA}`, '1') as TotpKeyring;

type Agente = ReturnType<typeof request.agent>;

interface Mensagem {
  to: { email: string }[];
  subject: string;
  htmlContent: string;
  textContent: string;
}

describe.skipIf(!url)('segundo fator das contas de plataforma pela API contra PostgreSQL descartável', () => {
  let app: INestApplication;
  let db: DataSource;
  let hash: string;
  let caixa: Server;
  const mensagens: Mensagem[] = [];
  const marca = `sf${id().slice(0, 8)}`;
  const config = { enforcement: 'optional' as 'optional' | 'required', keyring: anel as TotpKeyring | null };
  const segredosVistos: string[] = [];
  const codigosVistos: string[] = [];
  const tokensVistos: string[] = [];

  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query(sql, params)) as T[];

  async function conta(nome: string, platformRole: string | null = 'MASTER_OWNER') {
    const userId = id();
    const email = `${marca}-${nome}@example.test`;
    await q(
      `INSERT INTO users (id, name, email, status, email_verified, platform_role) VALUES ($1, $2, $3, 'ACTIVE', true, $4::platform_role)`,
      [userId, `Pessoa ${nome}`, email, platformRole],
    );
    await q(`INSERT INTO credentials (id, user_id, password_hash, algorithm) VALUES ($1, $2, $3, 'argon2id')`, [id(), userId, hash]);
    return { userId, email };
  }

  let ip = 0;
  /** Agente com IP próprio (o limite por IP é por processo): login e todas
   * as chamadas seguintes vêm do mesmo endereço fictício. */
  async function entrar(email: string): Promise<Agente> {
    ip += 1;
    const agente = request.agent(app.getHttpServer());
    agente.set('x-agenda-proxy-secret', SEGREDO_DO_PROXY).set('x-agenda-client-ip', `10.72.${Math.floor(ip / 250)}.${ip % 250}`);
    await agente.post('/auth/login').send({ login: email, password: SENHA }).expect(200);
    return agente;
  }

  const reauth = (a: Agente) => a.post('/platform/reauth').send({ password: SENHA }).expect(204);

  /** Cadastro completo pela API; devolve o segredo (da chave manual) e os
   * códigos de recuperação. */
  async function cadastrar(a: Agente, corpo: Record<string, unknown> = {}) {
    await reauth(a);
    const inicio = await a.post('/auth/second-factor/enrollment').send(corpo).expect(200);
    const chave = String(inicio.body.manualKey).replace(/ /g, '');
    segredosVistos.push(chave, String(inicio.body.otpauthUri));
    expect(inicio.body.qrSvg).toMatch(/^<svg/);
    const segredo = Buffer.from(OTPAuth.Secret.fromBase32(chave).bytes);
    const fim = await a
      .post('/auth/second-factor/enrollment/confirm')
      .send({ code: totpCodeAt(segredo, Date.now()) })
      .expect(200);
    const codigos = fim.body.recoveryCodes as string[];
    codigosVistos.push(...codigos);
    return { segredo, codigos };
  }

  const codigoDe = (segredo: Buffer, deslocamentoMs = 0) => totpCodeAt(segredo, Date.now() + deslocamentoMs);

  beforeAll(async () => {
    caixa = createServer((req, res) => {
      let corpo = '';
      req.on('data', (p) => (corpo += p));
      req.on('end', () => {
        if (req.url === '/v3/smtp/email') mensagens.push(JSON.parse(corpo) as Mensagem);
        res.writeHead(201, { 'content-type': 'application/json' });
        res.end('{"messageId":"ficticio"}');
      });
    });
    await new Promise<void>((resolve) => caixa.listen(0, '127.0.0.1', resolve));

    process.env.NODE_ENV = 'test';
    process.env.IGNORE_DOTENV_FILE = 'true';
    process.env.DATABASE_URL = url!;
    process.env.DIRECT_URL = url!;
    process.env.FRONTEND_URL ??= 'http://localhost:3000';
    process.env.API_PROXY_SECRET = SEGREDO_DO_PROXY;
    process.env.EMAIL_PROVIDER = 'brevo';
    process.env.EMAIL_API_KEY = 'chave-local-de-teste';
    process.env.EMAIL_FROM = 'nao-responda@agenda.test';
    process.env.EMAIL_API_BASE_URL = `http://127.0.0.1:${(caixa.address() as AddressInfo).port}`;
    const pasta = path.dirname(fileURLToPath(import.meta.url));
    const entities: (new () => object)[] = [];
    for (const file of globSync(path.join(pasta, '../src/entities/**/*.entity.ts'))) {
      const exports = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
      for (const value of Object.values(exports)) if (typeof value === 'function') entities.push(value as new () => object);
    }
    db = new DataSource({ ...buildRuntimeDataSourceOptions(url!), entities, logging: ['error'] });
    await db.initialize();
    const { AppModule } = await import('../src/app.module.js');
    const modulo = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(db)
      .overrideProvider(SecondFactorConfig)
      .useValue(config)
      .compile();
    app = modulo.createNestApplication();
    app.use(cookieParser());
    await app.init();
    hash = await hashPassword(SENHA);
  }, 60_000);

  afterAll(async () => {
    delete process.env.EMAIL_PROVIDER;
    delete process.env.EMAIL_API_KEY;
    delete process.env.EMAIL_FROM;
    delete process.env.EMAIL_API_BASE_URL;
    await app?.close();
    if (db?.isInitialized) await db.destroy();
    await new Promise<void>((resolve) => caixa?.close(() => resolve()));
  });

  beforeEach(() => {
    config.enforcement = 'optional';
    config.keyring = anel;
  });

  it('a migration criou as tabelas e colunas do segundo fator', async () => {
    const tabelas = await q<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE '%second_factor%' ORDER BY 1`,
    );
    expect(tabelas.map((t) => t.table_name)).toEqual([
      'second_factor_attempts',
      'second_factor_enrollments',
      'second_factor_grants',
      'second_factor_recovery_codes',
      'user_second_factors',
    ]);
    const colunas = await q<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name LIKE 'second_factor_%' AND table_name IN ('sessions', 'users') ORDER BY 1, 2`,
    );
    expect(colunas.map((c) => `${c.table_name}.${c.column_name}`)).toEqual([
      'sessions.second_factor_enrollment_allowed_until',
      'sessions.second_factor_method',
      'sessions.second_factor_verified_at',
      'users.second_factor_enrollment_required',
    ]);
  });

  it('fase optional: master sem fator usa o portal; cadastro só completa com código válido; com fator, o código passa a ser exigido', async () => {
    const a = await conta('cadastro');
    const antiga = await entrar(a.email);
    const s1 = await entrar(a.email);
    await s1.get('/platform/overview').expect(200);
    expect((await s1.get('/platform/access').expect(200)).body.secondFactor).toMatchObject({ state: 'ENROLLMENT_OPTIONAL' });

    // Sem senha recente: recusa.
    const semSenha = await s1.post('/auth/second-factor/enrollment').send({}).expect(403);
    expect(semSenha.body.code).toBe('REAUTENTICACAO_NECESSARIA');
    await reauth(s1);
    const inicio = await s1.post('/auth/second-factor/enrollment').send({}).expect(200);
    const chave = String(inicio.body.manualKey).replace(/ /g, '');
    segredosVistos.push(chave, inicio.body.otpauthUri);
    const segredo = Buffer.from(OTPAuth.Secret.fromBase32(chave).bytes);
    // Pendente não protege nem libera nada: sem fator ainda.
    expect(await q(`SELECT 1 FROM user_second_factors WHERE user_id = $1`, [a.userId])).toHaveLength(0);
    await s1.get('/platform/overview').expect(200);

    const errado = await s1.post('/auth/second-factor/enrollment/confirm').send({ code: '000000' }).expect(400);
    expect(errado.body.code).toBe('CODIGO_INVALIDO');
    expect(await q(`SELECT 1 FROM user_second_factors WHERE user_id = $1`, [a.userId])).toHaveLength(0);

    const codigoDoCadastro = codigoDe(segredo);
    const fim = await s1.post('/auth/second-factor/enrollment/confirm').send({ code: codigoDoCadastro }).expect(200);
    expect(fim.headers['cache-control']).toBe('private, no-store');
    expect(fim.body.recoveryCodes).toHaveLength(10);
    codigosVistos.push(...fim.body.recoveryCodes);

    // Segredo cifrado: nem a chave nem os bytes aparecem no banco.
    const [fator] = await q<{ secret_ciphertext: Buffer; key_version: number }>(
      `SELECT secret_ciphertext, key_version FROM user_second_factors WHERE user_id = $1`,
      [a.userId],
    );
    expect(fator.key_version).toBe(1);
    expect(fator.secret_ciphertext.equals(segredo)).toBe(false);
    expect(fator.secret_ciphertext.toString('latin1')).not.toContain(chave);

    // A sessão que cadastrou fica verificada; a anterior foi encerrada.
    await s1.get('/platform/overview').expect(200);
    await antiga.get('/auth/me').expect(401);

    // Sessão nova (fase optional!): o código é exigido.
    const s2 = await entrar(a.email);
    const recusa = await s2.get('/platform/overview').expect(403);
    expect(recusa.body.code).toBe('SEGUNDO_FATOR_NECESSARIO');
    const acesso = (await s2.get('/platform/access').expect(200)).body;
    expect(acesso).toMatchObject({ canViewEstablishments: false, secondFactor: { state: 'VERIFICATION_REQUIRED' } });
    expect(Object.values(acesso.capabilities)).not.toContain(true);

    // Reutilizar o código do cadastro: recusado.
    expect((await s2.post('/auth/second-factor/verify').send({ code: codigoDoCadastro }).expect(400)).body.code).toBe('CODIGO_INVALIDO');
    // Código fora da janela: recusado.
    await s2.post('/auth/second-factor/verify').send({ code: codigoDe(segredo, -120_000) }).expect(400);
    // Código do período seguinte (colado com espaço): aceito.
    const proximo = codigoDe(segredo, 30_000);
    await s2.post('/auth/second-factor/verify').send({ code: `${proximo.slice(0, 3)} ${proximo.slice(3)}` }).expect(200);
    await s2.get('/platform/overview').expect(200);
    // O mesmo código de novo, em outra sessão: recusado (reutilização).
    const s3 = await entrar(a.email);
    await s3.post('/auth/second-factor/verify').send({ code: proximo }).expect(400);
    await s3.get('/platform/overview').expect(403);
  });

  it('consumo único em requisições simultâneas: TOTP, código de recuperação e confirmação', async () => {
    const a = await conta('concorrencia');
    const s1 = await entrar(a.email);
    const { segredo, codigos } = await cadastrar(s1);

    const [x, y] = await Promise.all([entrar(a.email), entrar(a.email)]);
    const codigo = codigoDe(segredo, 30_000);
    const totp = await Promise.all([
      x.post('/auth/second-factor/verify').send({ code: codigo }),
      y.post('/auth/second-factor/verify').send({ code: codigo }),
    ]);
    expect(totp.map((r) => r.status).sort()).toEqual([200, 400]);

    const [p, r] = await Promise.all([entrar(a.email), entrar(a.email)]);
    const rec = await Promise.all([
      p.post('/auth/second-factor/recovery').send({ code: codigos[0] }),
      r.post('/auth/second-factor/recovery').send({ code: codigos[0].toLowerCase() }),
    ]);
    expect(rec.map((x2) => x2.status).sort()).toEqual([200, 400]);
    expect(await q(`SELECT 1 FROM second_factor_recovery_codes WHERE user_id = $1 AND used_at IS NOT NULL`, [a.userId])).toHaveLength(1);

    // Confirmação simultânea do mesmo cadastro (troca): uma só vira fator.
    const b = await conta('concorrencia-cadastro');
    const sb = await entrar(b.email);
    await reauth(sb);
    const inicio = await sb.post('/auth/second-factor/enrollment').send({}).expect(200);
    segredosVistos.push(String(inicio.body.manualKey).replace(/ /g, ''));
    const sec = Buffer.from(OTPAuth.Secret.fromBase32(String(inicio.body.manualKey).replace(/ /g, '')).bytes);
    const c = codigoDe(sec);
    const conf = await Promise.all([
      sb.post('/auth/second-factor/enrollment/confirm').send({ code: c }),
      sb.post('/auth/second-factor/enrollment/confirm').send({ code: c }),
    ]);
    expect(conf.map((x2) => x2.status).sort()).toEqual([200, 409]);
    codigosVistos.push(...(conf.find((x2) => x2.status === 200)!.body.recoveryCodes as string[]));
    expect(await q(`SELECT 1 FROM second_factor_recovery_codes WHERE user_id = $1`, [b.userId])).toHaveLength(10);
  });

  it('trava: cinco falhas bloqueiam 15 minutos só o segundo fator, sem prolongar; destrava no horário', async () => {
    const a = await conta('trava');
    const s1 = await entrar(a.email);
    const { segredo, codigos } = await cadastrar(s1);
    const s2 = await entrar(a.email);
    for (let i = 0; i < 4; i += 1) await s2.post('/auth/second-factor/verify').send({ code: '111111' }).expect(400);
    await s2.post('/auth/second-factor/recovery').send({ code: 'AAAA-AAAA-AAAA-AAAA' }).expect(400);
    const [travada] = await q<{ locked_until: Date }>(`SELECT locked_until FROM second_factor_attempts WHERE user_id = $1`, [a.userId]);
    expect(travada.locked_until).not.toBeNull();

    // Durante a trava: até o código certo e o de recuperação são recusados, e a trava não muda.
    const certo = await s2.post('/auth/second-factor/verify').send({ code: codigoDe(segredo, 30_000) }).expect(429);
    expect(certo.body).toMatchObject({ code: 'SEGUNDO_FATOR_BLOQUEADO' });
    expect(certo.body.retryAfterSeconds).toBeGreaterThan(0);
    await s2.post('/auth/second-factor/recovery').send({ code: codigos[1] }).expect(429);
    const [depois] = await q<{ locked_until: Date }>(`SELECT locked_until FROM second_factor_attempts WHERE user_id = $1`, [a.userId]);
    expect(depois.locked_until.getTime()).toBe(travada.locked_until.getTime());
    expect(await q(`SELECT 1 FROM second_factor_recovery_codes WHERE user_id = $1 AND used_at IS NOT NULL`, [a.userId])).toHaveLength(0);
    // A identidade e o uso comum continuam (só o segundo fator travou).
    await s2.get('/auth/me').expect(200);
    expect(
      await q(`SELECT 1 FROM audit_logs WHERE target_user_id = $1 AND action = 'SECOND_FACTOR_LOCKED'`, [a.userId]),
    ).toHaveLength(1);
    expect(mensagens.some((m) => m.to[0].email === a.email && /bloqueadas/i.test(m.subject))).toBe(true);

    // Fim da trava (horário passado): o código de recuperação vale.
    await q(`UPDATE second_factor_attempts SET locked_until = now() - interval '1 second' WHERE user_id = $1`, [a.userId]);
    await s2.post('/auth/second-factor/recovery').send({ code: codigos[1] }).expect(200);
    await s2.get('/platform/overview').expect(200);
  });

  it('código de recuperação: vale uma vez, só na própria conta, e avisa o titular', async () => {
    const a = await conta('recuperacao');
    const b = await conta('recuperacao-outra');
    const { codigos } = await cadastrar(await entrar(a.email));
    await cadastrar(await entrar(b.email));
    const sb = await entrar(b.email);
    await sb.post('/auth/second-factor/recovery').send({ code: codigos[2] }).expect(400);
    const sa = await entrar(a.email);
    const ok = await sa.post('/auth/second-factor/recovery').send({ code: codigos[2] }).expect(200);
    expect(ok.body).toMatchObject({ state: 'VERIFIED', factor: { remainingRecoveryCodes: 9 } });
    await sa.get('/platform/overview').expect(200);
    const sa2 = await entrar(a.email);
    await sa2.post('/auth/second-factor/recovery').send({ code: codigos[2] }).expect(400);
    expect(await q(`SELECT 1 FROM audit_logs WHERE target_user_id = $1 AND action = 'RECOVERY_CODE_USED'`, [a.userId])).toHaveLength(1);
    expect(mensagens.some((m) => m.to[0].email === a.email && /recuperação usado/i.test(m.subject))).toBe(true);
  });

  it('fase required: master sem fator só cadastra com prova de posse do e-mail', async () => {
    config.enforcement = 'required';
    const a = await conta('required');
    const s = await entrar(a.email);
    expect((await s.get('/platform/overview').expect(403)).body.code).toBe('SEGUNDO_FATOR_CADASTRO_NECESSARIO');
    await reauth(s);
    expect((await s.post('/auth/second-factor/enrollment').send({}).expect(403)).body.code).toBe('SEGUNDO_FATOR_LIBERACAO_NECESSARIA');
    // Sessões anteriores (colunas nulas) não abrem o portal.
    expect((await s.get('/platform/users').expect(403)).body.code).toBe('SEGUNDO_FATOR_CADASTRO_NECESSARIO');
  });

  it('promoção e recuperação por outro proprietário: liberação de uso único, no e-mail do titular, sem remover o fator', async () => {
    const dona = await conta('emissora');
    const sDona = await entrar(dona.email);
    const fatorDaDona = await cadastrar(sDona);

    // Promoção de uma conta comum: sessões encerradas, cadastro obrigatório.
    const novo = await conta('promovido', null);
    const sAntes = await entrar(novo.email);
    const [alvo] = await q<{ updated_at: Date }>(`SELECT updated_at FROM users WHERE id = $1`, [novo.userId]);
    await reauth(sDona);
    await sDona
      .put(`/platform/users/${novo.userId}/platform-access`)
      .send({ expectedUpdatedAt: new Date(alvo.updated_at).toISOString(), role: 'MASTER_OWNER', permissions: [] })
      .expect(200);
    await sAntes.get('/auth/me').expect(401);
    const sNovo = await entrar(novo.email);
    expect((await sNovo.get('/platform/overview').expect(403)).body.code).toBe('SEGUNDO_FATOR_CADASTRO_NECESSARIO');
    await reauth(sNovo);
    // A senha sozinha não basta para cadastrar (fase optional, master novo).
    expect((await sNovo.post('/auth/second-factor/enrollment').send({}).expect(403)).body.code).toBe('SEGUNDO_FATOR_LIBERACAO_NECESSARIA');

    // Emitir a liberação exige o segundo fator confirmado HÁ POUCO.
    await q(`UPDATE sessions SET second_factor_verified_at = now() - interval '20 minutes' WHERE user_id = $1 AND revoked_at IS NULL`, [dona.userId]);
    const chave = () => `chave-${id()}`;
    const semRecente = await sDona
      .post(`/platform/users/${novo.userId}/second-factor/grants`)
      .send({ reason: 'Primeiro cadastro do master promovido', requestKey: chave() })
      .expect(403);
    expect(semRecente.body.code).toBe('SEGUNDO_FATOR_RECENTE_NECESSARIO');
    await sDona.post('/auth/second-factor/recovery').send({ code: fatorDaDona.codigos[0] }).expect(200);
    const requestKey = chave();
    const emitida = await sDona
      .post(`/platform/users/${novo.userId}/second-factor/grants`)
      .send({ reason: 'Primeiro cadastro do master promovido', requestKey })
      .expect(200);
    expect(emitida.body).toMatchObject({ created: true, delivery: { status: 'SENT' } });
    expect(JSON.stringify(emitida.body)).not.toMatch(/[0-9a-f]{64}|liberacao-2fa/);
    // Repetir com a mesma chave: mesma liberação, sem outro e-mail.
    const antes = mensagens.length;
    const repetida = await sDona
      .post(`/platform/users/${novo.userId}/second-factor/grants`)
      .send({ reason: 'Primeiro cadastro do master promovido', requestKey })
      .expect(200);
    expect(repetida.body).toMatchObject({ created: false, grantId: emitida.body.grantId });
    expect(mensagens.length).toBe(antes);

    const email = mensagens.filter((m) => m.to[0].email === novo.email).at(-1)!;
    const token = /#t=([0-9a-f]{64})/.exec(email.textContent)![1];
    tokensVistos.push(token);
    // A liberação encerrou as sessões do titular.
    await sNovo.get('/auth/me').expect(401);
    const sNovo2 = await entrar(novo.email);
    // Outra conta não usa a liberação.
    const outra = await conta('intrusa');
    const sOutra = await entrar(outra.email);
    expect((await sOutra.post('/auth/second-factor/grant').send({ token }).expect(410)).body.code).toBe('LIBERACAO_INVALIDA');
    await sNovo2.post('/auth/second-factor/grant').send({ token }).expect(200);
    await sNovo2.post('/auth/second-factor/grant').send({ token }).expect(410);
    // A liberação não abre o portal: só permite cadastrar.
    await sNovo2.get('/platform/overview').expect(403);
    const fatorNovo = await cadastrar(sNovo2);
    await sNovo2.get('/platform/overview').expect(200);
    expect((await q<{ r: boolean }>(`SELECT second_factor_enrollment_required AS r FROM users WHERE id = $1`, [novo.userId]))[0].r).toBe(false);

    // Recuperação da dona (perdeu o celular) emitida pelo novo master.
    await q(`UPDATE sessions SET second_factor_verified_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [novo.userId]);
    await reauth(sNovo2);
    await sNovo2
      .post(`/platform/users/${dona.userId}/second-factor/grants`)
      .send({ reason: 'Proprietária perdeu o celular e os códigos', requestKey: chave() })
      .expect(200);
    const tokenDona = /#t=([0-9a-f]{64})/.exec(mensagens.filter((m) => m.to[0].email === dona.email).at(-1)!.textContent)![1];
    tokensVistos.push(tokenDona);
    await sDona.get('/auth/me').expect(401);
    // O fator ativo continua: a conta NÃO ficou liberada só pela senha.
    expect(await q(`SELECT 1 FROM user_second_factors WHERE user_id = $1`, [dona.userId])).toHaveLength(1);
    const sDona2 = await entrar(dona.email);
    expect((await sDona2.get('/platform/overview').expect(403)).body.code).toBe('SEGUNDO_FATOR_NECESSARIO');
    expect((await sDona2.get('/auth/second-factor').expect(200)).body).toMatchObject({ recoveryPending: true });
    await sDona2.post('/auth/second-factor/grant').send({ token: tokenDona }).expect(200);
    await sDona2.get('/platform/overview').expect(403);
    const trocado = await cadastrar(sDona2);
    await sDona2.get('/platform/overview').expect(200);
    // Códigos antigos não valem mais; o fator foi trocado.
    const sDona3 = await entrar(dona.email);
    await sDona3.post('/auth/second-factor/recovery').send({ code: fatorDaDona.codigos[5] }).expect(400);
    expect(trocado.codigos).not.toContain(fatorDaDona.codigos[5]);
    expect(
      await q(`SELECT 1 FROM audit_logs WHERE target_user_id = $1 AND action = 'SECOND_FACTOR_REPLACED'`, [dona.userId]),
    ).toHaveLength(1);
    expect(fatorNovo.codigos).toHaveLength(10);
  });

  it('liberação recusada sem e-mail verificado e para a própria conta', async () => {
    const emissora = await conta('emissora-recusas');
    const s = await entrar(emissora.email);
    await cadastrar(s);
    await reauth(s);
    const semVerificar = await conta('sem-email-verificado');
    await q(`UPDATE users SET email_verified = false WHERE id = $1`, [semVerificar.userId]);
    const r1 = await s
      .post(`/platform/users/${semVerificar.userId}/second-factor/grants`)
      .send({ reason: 'Teste de recusa', requestKey: `chave-${id()}` })
      .expect(409);
    expect(r1.body.code).toBe('LIBERACAO_SEM_EMAIL_VERIFICADO');
    await s
      .post(`/platform/users/${emissora.userId}/second-factor/grants`)
      .send({ reason: 'Para mim mesma', requestKey: `chave-${id()}` })
      .expect(403);
    expect(await q(`SELECT 1 FROM second_factor_grants WHERE user_id IN ($1, $2)`, [semVerificar.userId, emissora.userId])).toHaveLength(0);
  });

  it('troca de senha: conta master exige o segundo fator; conta comum não muda', async () => {
    const a = await conta('senha-master');
    const sa = await entrar(a.email);
    const { segredo } = await cadastrar(sa);
    const sb = await entrar(a.email);
    const recusa = await sb
      .post('/auth/password')
      .send({ currentPassword: SENHA, newPassword: 'outra-senha-forte-123' })
      .expect(403);
    expect(recusa.body.code).toBe('SEGUNDO_FATOR_NECESSARIO');
    await sb.post('/auth/second-factor/verify').send({ code: codigoDe(segredo, 30_000) }).expect(200);
    await sb.post('/auth/password').send({ currentPassword: SENHA, newPassword: 'outra-senha-forte-123' }).expect(204);
    // A senha mudou, o fator continua.
    expect(await q(`SELECT 1 FROM user_second_factors WHERE user_id = $1`, [a.userId])).toHaveLength(1);

    const comum = await conta('senha-comum', null);
    const sc = await entrar(comum.email);
    await sc.post('/auth/password').send({ currentPassword: SENHA, newPassword: 'outra-senha-forte-456' }).expect(204);
  });

  it('master com vínculo de estabelecimento: uso comum sem código; portal com código', async () => {
    const a = await conta('dupla');
    const { segredo } = await cadastrar(await entrar(a.email));
    const [plano] = await q<{ id: string }>(`SELECT id FROM plans ORDER BY id LIMIT 1`);
    const tenantId = id();
    await q(
      `INSERT INTO tenants (id, slug, category, timezone, plan_id, status, created_at) VALUES ($1, $2, 'OTHER', 'America/Sao_Paulo', $3, 'ACTIVE', now())`,
      [tenantId, `${marca}-dupla`, plano.id],
    );
    await q(`INSERT INTO units (id, tenant_id, name, address, timezone, is_primary) VALUES ($1, $2, 'Unidade fictícia', '', 'America/Sao_Paulo', true)`, [
      id(),
      tenantId,
    ]);
    await q(`INSERT INTO memberships (id, user_id, tenant_id, role) VALUES ($1, $2, $3, 'DONO')`, [id(), a.userId, tenantId]);
    const s = await entrar(a.email);
    const me = await s.get('/auth/me').expect(200);
    expect(me.body.contexts.map((c: { tenantId: string }) => c.tenantId)).toContain(tenantId);
    await s.get('/platform/overview').expect(403);
    await s.post('/auth/second-factor/verify').send({ code: codigoDe(segredo, 30_000) }).expect(200);
    await s.get('/platform/overview').expect(200);
    await q(`DELETE FROM memberships WHERE tenant_id = $1`, [tenantId]);
    await q(`DELETE FROM units WHERE tenant_id = $1`, [tenantId]);
    await q(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  });

  it('chaves ausentes ou trocadas: verificação pelo app indisponível e nunca liberada; recuperação continua', async () => {
    const a = await conta('sem-chave');
    const { segredo, codigos } = await cadastrar(await entrar(a.email));
    const s = await entrar(a.email);
    config.keyring = null;
    const r = await s.post('/auth/second-factor/verify').send({ code: codigoDe(segredo, 30_000) }).expect(503);
    expect(r.body.code).toBe('SEGUNDO_FATOR_INDISPONIVEL');
    await s.get('/platform/overview').expect(403);
    await reauth(s);
    await s.post('/auth/second-factor/enrollment').send({}).expect(503);
    config.keyring = parseTotpKeyring(`1:${Buffer.alloc(32, 9).toString('base64')}`, '1') as TotpKeyring;
    await s.post('/auth/second-factor/verify').send({ code: codigoDe(segredo, 30_000) }).expect(503);
    await s.get('/platform/overview').expect(403);
    await s.post('/auth/second-factor/recovery').send({ code: codigos[3] }).expect(200);
    await s.get('/platform/overview').expect(200);
  });

  it('script de emergência: recusa havendo outro proprietário com fator; emite liberação sem remover o fator', async () => {
    const a = await conta('emergencia');
    await cadastrar(await entrar(a.email));
    // O cliente do script usa BEGIN/COMMIT próprios: precisa de uma conexão só.
    const runner = db.createQueryRunner();
    await runner.connect();
    const conexao = { query: async (sql: string, params?: unknown[]) => ({ rows: linhasDe(await runner.query(sql, params)) }) };
    try {
      await expect(emitirLiberacaoDeEmergencia(conexao, { email: a.email, motivo: 'Perdeu celular e códigos' })).rejects.toBeInstanceOf(
        RecusaDaLiberacao,
      );
      // Simula o único proprietário com fator: os outros desta suíte saem do caminho.
      const outros = await q<{ id: string }>(
        `UPDATE users SET status = 'SUSPENDED' WHERE platform_role = 'MASTER_OWNER' AND status = 'ACTIVE' AND id <> $1
            AND EXISTS (SELECT 1 FROM user_second_factors f WHERE f.user_id = users.id) RETURNING id`,
        [a.userId],
      );
      const r = await emitirLiberacaoDeEmergencia(conexao, { email: a.email, motivo: 'Perdeu celular e códigos' });
      tokensVistos.push(r.token);
      await q(`UPDATE users SET status = 'ACTIVE' WHERE id = ANY($1::varchar[])`, [linhasDe<{ id: string }>(outros).map((o) => o.id)]);
      expect(await q(`SELECT 1 FROM user_second_factors WHERE user_id = $1`, [a.userId])).toHaveLength(1);
      const [g] = await q<{ via: string; token_hash: string }>(`SELECT via, token_hash FROM second_factor_grants WHERE id = $1`, [r.grantId]);
      expect(g.via).toBe('SCRIPT');
      expect(g.token_hash).not.toBe(r.token);
      const s = await entrar(a.email);
      await s.post('/auth/second-factor/grant').send({ token: r.token }).expect(200);
      await s.get('/platform/overview').expect(403);
    } finally {
      await runner.release();
    }
  });

  it('auditoria e e-mails nunca levam segredo, URI, código de recuperação nem token', async () => {
    const auditoria = JSON.stringify(
      await q(`SELECT summary, previous_data, new_data FROM audit_logs a JOIN users u ON u.id = a.target_user_id WHERE u.email::text LIKE $1`, [
        `${marca}-%`,
      ]),
    );
    const emails = JSON.stringify(mensagens);
    expect(segredosVistos.length).toBeGreaterThan(0);
    expect(codigosVistos.length).toBeGreaterThan(0);
    for (const valor of [...segredosVistos, ...codigosVistos]) {
      expect(auditoria).not.toContain(valor);
      expect(emails).not.toContain(valor);
    }
    for (const token of tokensVistos) expect(auditoria).not.toContain(token);
  });
});

function linhasDe<T>(resultado: unknown): T[] {
  if (Array.isArray(resultado) && resultado.length === 2 && Array.isArray(resultado[0]) && typeof resultado[1] === 'number') {
    return resultado[0] as T[];
  }
  return (Array.isArray(resultado) ? resultado : []) as T[];
}
