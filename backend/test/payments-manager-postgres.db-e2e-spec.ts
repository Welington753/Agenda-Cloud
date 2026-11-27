// Recebimentos de atendimentos pelo GERENTE, PELA API HTTP real (AppModule
// inteiro, sessão por cookie), contra PostgreSQL DESCARTÁVEL. Fecha a lacuna
// apontada na revisão do PR de recebimentos (docs/plans/permissoes-individuais.md):
// a equivalência das políticas e payments-postgres provam a regra e o
// serviço, mas nenhum teste com banco registrava ou estornava como gerente.
//
// O acesso do gerente é montado só pelo caminho que o sistema oferece: o dono
// entra, confirma a senha e cria o gerente em "Equipe e acessos"
// (`POST /tenants/:id/team/staff-accounts`), e muda as concessões pela mesma
// tela (`PUT .../members/:id/permissions`). Nenhuma permissão é gravada direto
// no banco. O servidor confere as dependências e o que o dono pode conceder.
//
// Prova: com as concessões, o gerente registra e estorna (estorno só com a
// senha confirmada há pouco) e os registros gravados ficam certos; sem a
// concessão da ação, 403 sem gravar nada; recebimentos e atendimentos de
// outro estabelecimento não são alcançados.
//
// Banco compartilhado entre os specs: no fim (mesmo com falha), o gerente é
// suspenso e perde as concessões, e depois todos os dados deste spec saem.
// Nenhum gerente ativo fica para o levantamento de pilot-team-manager-check.
import { randomUUID } from 'node:crypto';
import { globSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import cookieParser from 'cookie-parser';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { hashPassword } from '../src/auth/password-hasher.js';
import { buildRuntimeDataSourceOptions } from '../src/database/runtime-data-source.js';
import { PAYMENTS_FORBIDDEN_MESSAGE } from '../src/payments/payment-access.js';
import { comTodosOsRecursos } from './support/plano-de-teste.js';

const url = process.env.DB_E2E_DIRECT_URL;
if (url && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)) {
  throw new Error('Este teste exige PostgreSQL descartável local.');
}
const id = () => randomUUID().replaceAll('-', '').slice(0, 24);
const chave = () => `chave-${id()}`;
const SENHA = 'senha-de-teste-forte-1';
const SENHA_DO_GERENTE = 'senha-escolhida-gerente-1';
const TZ = 'America/Sao_Paulo';
const FRONT = 'http://localhost:3000';
const SEGREDO_DO_PROXY = 'segredo-do-proxy-so-para-este-teste-0123456789';
/** Data local de São Paulo, `deslocamento` dias a partir de hoje. */
const dia = (deslocamento: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(Date.now() + deslocamento * 86_400_000));
/** Instante de um horário local de São Paulo (UTC-3, sem horário de verão). */
const local = (data: string, hora: string) => new Date(`${data}T${hora}:00.000-03:00`);

const AGENDA = ['AGENDA_VISUALIZAR', 'PROFISSIONAIS_VISUALIZAR'];
const CONSULTAR = [...AGENDA, 'RECEBIMENTOS_VISUALIZAR'];
const TUDO = [...CONSULTAR, 'RECEBIMENTOS_REGISTRAR', 'RECEBIMENTOS_ESTORNAR'];

type Agente = ReturnType<typeof request.agent>;

describe.skipIf(!url)('recebimentos do gerente pela API contra PostgreSQL descartável', () => {
  let app: INestApplication;
  let db: DataSource;
  let hash: string;
  const marca = `rger${id().slice(0, 8)}`;
  const planoId = `${marca}pl`;
  const tenants: string[] = [];
  const usuarios: string[] = [];

  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query(sql, params)) as T[];
  const contar = async (sql: string, params: unknown[]) => Number((await q<{ n: number }>(sql, params))[0].n);

  let ip = 0;
  const comProxy = <T extends request.Test>(chamada: T) => {
    ip += 1;
    return chamada
      .set('Origin', FRONT)
      .set('x-agenda-proxy-secret', SEGREDO_DO_PROXY)
      .set('x-agenda-client-ip', `10.71.${Math.floor(ip / 250)}.${ip % 250}`);
  };

  async function entrar(login: string, senha = SENHA): Promise<Agente> {
    const agente = request.agent(app.getHttpServer());
    await comProxy(agente.post('/auth/login')).send({ login, password: senha }).expect(200);
    return agente;
  }
  const reautenticar = (agente: Agente, senha: string) =>
    comProxy(agente.post('/platform/reauth')).send({ password: senha }).expect(204);

  async function estabelecimento(nome: string) {
    const tenantId = id();
    tenants.push(tenantId);
    const unitId = id();
    await q(
      `INSERT INTO tenants (id, slug, category, timezone, plan_id, status, access_legacy_since) VALUES ($1, $2, 'OTHER', $3, $4, 'ACTIVE', now())`,
      [tenantId, `${marca}-${nome}`, TZ, planoId],
    );
    await q(`INSERT INTO units (id, tenant_id, name, address, timezone, is_primary) VALUES ($1, $2, $3, '', $4, true)`, [
      unitId,
      tenantId,
      `${marca} ${nome}`,
      TZ,
    ]);
    const donoId = id();
    usuarios.push(donoId);
    const email = `${marca}-${nome}-dono@example.test`;
    await q(`INSERT INTO users (id, name, email, status, email_verified) VALUES ($1, $2, $3, 'ACTIVE', true)`, [donoId, `Dono ${nome}`, email]);
    await q(`INSERT INTO credentials (id, user_id, password_hash, algorithm) VALUES ($1, $2, $3, 'argon2id')`, [id(), donoId, hash]);
    await q(`INSERT INTO memberships (id, user_id, tenant_id, role) VALUES ($1, $2, $3, 'DONO')`, [id(), donoId, tenantId]);
    const serviceId = id();
    await q(
      `INSERT INTO services (id, tenant_id, name, short_description, duration_minutes, price_cents) VALUES ($1, $2, 'Corte', '', 30, 5000)`,
      [serviceId, tenantId],
    );
    const professionalId = id();
    await q(`INSERT INTO professionals (id, tenant_id, name, avatar_initials, avatar_color) VALUES ($1, $2, 'Ana', 'AN', '#000000')`, [
      professionalId,
      tenantId,
    ]);
    const consumerId = id();
    await q(`INSERT INTO consumers (id, tenant_id, name, whatsapp, whatsapp_normalized) VALUES ($1, $2, 'Cliente Fictício', '11999990000', $3)`, [
      consumerId,
      tenantId,
      `55${Math.floor(Math.random() * 1e11)}`,
    ]);
    const dono = await entrar(email);
    return { tenantId, unitId, donoId, dono, serviceId, professionalId, consumerId };
  }
  type Est = Awaited<ReturnType<typeof estabelecimento>>;

  /** Atendimento concluído há dois dias, às `hora` locais. */
  async function concluido(est: Est, hora: string) {
    const appointmentId = id();
    const inicio = local(dia(-2), hora);
    await q(
      `INSERT INTO appointments (id, tenant_id, unit_id, consumer_id, consumer_name_snapshot, consumer_whatsapp_snapshot,
          professional_id, start_at, end_at, status)
       VALUES ($1, $2, $3, $4, 'Cliente Fictício', '11999990000', $5, $6, $7, 'COMPLETED')`,
      [appointmentId, est.tenantId, est.unitId, est.consumerId, est.professionalId, inicio, new Date(inicio.getTime() + 1_800_000)],
    );
    await q(
      `INSERT INTO appointment_items (id, tenant_id, appointment_id, service_id, duration_minutes_snapshot, price_cents_snapshot)
       VALUES ($1, $2, $3, $4, 30, 5000)`,
      [id(), est.tenantId, appointmentId, est.serviceId],
    );
    return appointmentId;
  }

  const registrar = (agente: Agente, tenantId: string, appointmentId: string, amountCents: number, requestKey = chave()) =>
    comProxy(agente.post(`/tenants/${tenantId}/payments`)).send({ requestKey, appointmentId, amountCents, method: 'PIX', receivedOn: dia(-2) });
  const estornar = (agente: Agente, tenantId: string, paymentId: string, reason = 'Cobrança em duplicidade') =>
    comProxy(agente.post(`/tenants/${tenantId}/payments/${paymentId}/refund`)).send({ reason });
  const listar = (agente: Agente, tenantId: string) =>
    comProxy(agente.get(`/tenants/${tenantId}/payments`)).query({ from: dia(-5), to: dia(0) });

  /** Gerente criado pelo dono na tela de equipe, com a senha escolhida pelo
   * dono (como a tela atual envia); entra e fica com a sessão aberta. */
  async function gerente(est: Est, nome: string, permissions: string[]) {
    const username = `${nome}@${marca}`;
    const criado = await comProxy(est.dono.post(`/tenants/${est.tenantId}/team/staff-accounts`))
      .send({ requestKey: chave(), role: 'GERENTE', professionalId: null, name: `Gerente ${nome}`, username, permissions, password: SENHA_DO_GERENTE })
      .expect(200);
    const corpo = criado.body as { userId: string; membershipId: string; temporaryPassword: string | null; role: string };
    usuarios.push(corpo.userId);
    expect(corpo).toMatchObject({ created: true, role: 'GERENTE', temporaryPassword: null });
    const agente = await entrar(username, SENHA_DO_GERENTE);
    return { ...corpo, agente };
  }

  /** O dono troca as concessões pela tela, a partir do que ela mostra. */
  async function conceder(est: Est, membershipId: string, granted: string[]) {
    const visao = await comProxy(est.dono.get(`/tenants/${est.tenantId}/team`)).expect(200);
    const atual = (visao.body.accesses as { membershipId: string; grantedPermissions: string[] }[]).find((a) => a.membershipId === membershipId)!;
    return comProxy(est.dono.put(`/tenants/${est.tenantId}/team/members/${membershipId}/permissions`)).send({
      expectedGranted: atual.grantedPermissions,
      granted,
    });
  }

  const concedidasNoBanco = async (membershipId: string) =>
    (
      await q<{ p: string }>(
        `SELECT permission::text AS p FROM membership_permission_overrides WHERE membership_id = $1 AND mode = 'GRANTED' ORDER BY 1`,
        [membershipId],
      )
    ).map((r) => r.p);

  /** Linha gravada do recebimento, sem os campos de horário do servidor. */
  const linha = async (paymentId: string) =>
    (
      await q(
        `SELECT tenant_id, appointment_id, amount_cents::int AS amount_cents, method::text AS method,
                to_char(received_on, 'YYYY-MM-DD') AS received_on, recorded_by_user_id,
                refunded_at IS NOT NULL AS estornado, refund_reason, refunded_by_user_id
           FROM appointment_payments WHERE id = $1`,
        [paymentId],
      )
    )[0];

  const auditoria = (tenantId: string, action: string) =>
    q<{ actor_user_id: string; payment_id: string }>(
      `SELECT actor_user_id, new_data->>'paymentId' AS payment_id FROM audit_logs WHERE tenant_id = $1 AND action = $2 ORDER BY occurred_at`,
      [tenantId, action],
    );

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.IGNORE_DOTENV_FILE = 'true';
    process.env.DATABASE_URL = url!;
    process.env.DIRECT_URL = url!;
    process.env.FRONTEND_URL = FRONT;
    process.env.API_PROXY_SECRET = SEGREDO_DO_PROXY;
    // Nenhuma mensagem sai deste teste: sem provedor de e-mail.
    delete process.env.EMAIL_PROVIDER;
    delete process.env.EMAIL_API_KEY;
    const pasta = path.dirname(fileURLToPath(import.meta.url));
    const entities: (new () => object)[] = [];
    for (const file of globSync(path.join(pasta, '../src/entities/**/*.entity.ts'))) {
      const exports = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
      for (const value of Object.values(exports)) if (typeof value === 'function') entities.push(value as new () => object);
    }
    db = new DataSource({ ...buildRuntimeDataSourceOptions(url!), entities, logging: ['error'] });
    await db.initialize();
    const { AppModule } = await import('../src/app.module.js');
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(DataSource).useValue(db).compile();
    app = modulo.createNestApplication();
    app.use(cookieParser());
    await app.init();
    hash = await hashPassword(SENHA);
    await q(
      comTodosOsRecursos(`INSERT INTO plans (id, code, name, short_description, max_professionals, max_units) VALUES ($1, $1, 'Plano fictício', '', 5, 1)`),
      [planoId],
    );
  });

  afterAll(async () => {
    try {
      if (db?.isInitialized && tenants.length) {
        // Primeiro, e sozinho: nenhum gerente deste spec fica ativo nem com
        // concessão, mesmo que a remoção abaixo falhe.
        await q(`UPDATE memberships SET status = 'SUSPENDED' WHERE tenant_id = ANY($1::varchar[]) AND role = 'GERENTE'`, [tenants]);
        await q(`DELETE FROM membership_permission_overrides WHERE tenant_id = ANY($1::varchar[])`, [tenants]);
        // Depois, todos os dados deste spec, numa transação.
        await db.transaction(async (m) => {
          const por = (sql: string, params: unknown[]) => m.query(sql, params);
          await por(`DELETE FROM appointment_payments WHERE tenant_id = ANY($1::varchar[])`, [tenants]);
          await por(
            `DELETE FROM audit_logs WHERE tenant_id = ANY($1::varchar[]) OR actor_user_id = ANY($2::varchar[]) OR target_user_id = ANY($2::varchar[])`,
            [tenants, usuarios],
          );
          await por(`DELETE FROM appointments WHERE tenant_id = ANY($1::varchar[])`, [tenants]);
          for (const tabela of ['memberships', 'consumers', 'services', 'professionals', 'units']) {
            await por(`DELETE FROM ${tabela} WHERE tenant_id = ANY($1::varchar[])`, [tenants]);
          }
          await por(`DELETE FROM tenants WHERE id = ANY($1::varchar[])`, [tenants]);
          await por(`DELETE FROM users WHERE id = ANY($1::varchar[])`, [usuarios]);
          await por(`DELETE FROM plans WHERE id = $1`, [planoId]);
        });
        const sobras = await contar(
          `SELECT (SELECT count(*) FROM tenants WHERE id = ANY($1::varchar[])) + (SELECT count(*) FROM users WHERE id = ANY($2::varchar[])) AS n`,
          [tenants, usuarios],
        );
        expect(sobras).toBe(0);
      }
    } finally {
      await app?.close();
      if (db?.isInitialized) await db.destroy();
    }
  });

  it('gerente com as concessões, criado pelo dono na tela de equipe, registra e estorna pelas rotas; estorno só com a senha confirmada há pouco', async () => {
    const est = await estabelecimento('registra');
    await reautenticar(est.dono, SENHA);
    // A tela não deixa conceder registrar sem consultar (dependência).
    const incompleto = await comProxy(est.dono.post(`/tenants/${est.tenantId}/team/staff-accounts`))
      .send({ requestKey: chave(), role: 'GERENTE', professionalId: null, name: 'Gerente incompleto', username: `incompleto@${marca}`, permissions: [...AGENDA, 'RECEBIMENTOS_REGISTRAR'] })
      .expect(409);
    expect(incompleto.body.code).toBe('PERMISSOES_INCOMPLETAS');

    const g = await gerente(est, 'tudo', TUDO);
    // O acesso é o que o sistema grava: as cinco concessões, confirmadas.
    expect(await concedidasNoBanco(g.membershipId)).toEqual([...TUDO].sort());
    const [vinculo] = await q(`SELECT role::text AS role, status, permissions_confirmed_at IS NOT NULL AS confirmado FROM memberships WHERE id = $1`, [
      g.membershipId,
    ]);
    expect(vinculo).toEqual({ role: 'GERENTE', status: 'ACTIVE', confirmado: true });

    // Registrar.
    const atendimento = await concluido(est, '10:00');
    const key = chave();
    const r = await registrar(g.agente, est.tenantId, atendimento, 4250, key).expect(200);
    expect(r.body.created).toBe(true);
    const payment = r.body.payment as { id: string };
    expect(r.body.payment).toMatchObject({
      appointmentId: atendimento,
      amountCents: 4250,
      method: 'PIX',
      receivedOn: dia(-2),
      recordedBy: { id: g.userId },
      refund: null,
    });
    expect(await linha(payment.id)).toEqual({
      tenant_id: est.tenantId,
      appointment_id: atendimento,
      amount_cents: 4250,
      method: 'PIX',
      received_on: dia(-2),
      recorded_by_user_id: g.userId,
      estornado: false,
      refund_reason: null,
      refunded_by_user_id: null,
    });
    expect(await auditoria(est.tenantId, 'PAYMENT_RECORDED')).toEqual([{ actor_user_id: g.userId, payment_id: payment.id }]);
    // O mesmo formulário de novo não duplica.
    const repetido = await registrar(g.agente, est.tenantId, atendimento, 4250, key).expect(200);
    expect(repetido.body).toEqual({ created: false, payment: r.body.payment });
    expect(await contar(`SELECT count(*)::int AS n FROM appointment_payments WHERE appointment_id = $1`, [atendimento])).toBe(1);
    // A consulta do gerente mostra o registro.
    const lista = await listar(g.agente, est.tenantId).expect(200);
    expect((lista.body.payments as { id: string }[]).map((p) => p.id)).toEqual([payment.id]);

    // Estornar: sem a senha confirmada nesta sessão, recusa sem gravar.
    const semSenha = await estornar(g.agente, est.tenantId, payment.id).expect(403);
    expect(semSenha.body.code).toBe('REAUTENTICACAO_NECESSARIA');
    expect(await linha(payment.id)).toMatchObject({ estornado: false, refund_reason: null, refunded_by_user_id: null });
    await reautenticar(g.agente, SENHA_DO_GERENTE);
    const estornado = await estornar(g.agente, est.tenantId, payment.id).expect(200);
    expect(estornado.body).toMatchObject({
      id: payment.id,
      amountCents: 4250,
      recordedBy: { id: g.userId },
      refund: { reason: 'Cobrança em duplicidade', refundedBy: { id: g.userId } },
    });
    expect(await linha(payment.id)).toMatchObject({
      amount_cents: 4250,
      recorded_by_user_id: g.userId,
      estornado: true,
      refund_reason: 'Cobrança em duplicidade',
      refunded_by_user_id: g.userId,
    });
    expect(await auditoria(est.tenantId, 'PAYMENT_REFUNDED')).toEqual([{ actor_user_id: g.userId, payment_id: payment.id }]);
    expect((await estornar(g.agente, est.tenantId, payment.id).expect(409)).body.code).toBe('JA_ESTORNADO');
  });

  it('sem a concessão da ação, 403 sem gravar: consultar sozinho, registrar sem estornar, e nada depois de retirar a consulta', async () => {
    const est = await estabelecimento('recusa');
    await reautenticar(est.dono, SENHA);
    const g = await gerente(est, 'consulta', CONSULTAR);
    await reautenticar(g.agente, SENHA_DO_GERENTE);
    const doDono = (await registrar(est.dono, est.tenantId, await concluido(est, '09:00'), 5000).expect(200)).body.payment as { id: string };
    const livre = await concluido(est, '11:00');
    const pagamentosAntes = await contar(`SELECT count(*)::int AS n FROM appointment_payments WHERE tenant_id = $1`, [est.tenantId]);
    const auditoriaAntes = await contar(`SELECT count(*)::int AS n FROM audit_logs WHERE tenant_id = $1 AND action IN ('PAYMENT_RECORDED', 'PAYMENT_REFUNDED')`, [
      est.tenantId,
    ]);
    const nadaGravado = async () => {
      expect(await contar(`SELECT count(*)::int AS n FROM appointment_payments WHERE tenant_id = $1`, [est.tenantId])).toBe(pagamentosAntes);
      expect(await contar(`SELECT count(*)::int AS n FROM appointment_payments WHERE appointment_id = $1`, [livre])).toBe(0);
      expect(await linha(doDono.id)).toMatchObject({ estornado: false, refund_reason: null, refunded_by_user_id: null });
      expect(
        await contar(`SELECT count(*)::int AS n FROM audit_logs WHERE tenant_id = $1 AND action IN ('PAYMENT_RECORDED', 'PAYMENT_REFUNDED')`, [est.tenantId]),
      ).toBe(auditoriaAntes);
    };
    const proibido = (resposta: request.Response) => expect({ status: resposta.status, message: resposta.body.message }).toEqual({ status: 403, message: PAYMENTS_FORBIDDEN_MESSAGE });

    // Só consultar: vê o recebimento do dono, não registra nem estorna.
    expect(((await listar(g.agente, est.tenantId).expect(200)).body.payments as { id: string }[]).map((p) => p.id)).toEqual([doDono.id]);
    proibido(await registrar(g.agente, est.tenantId, livre, 5000));
    proibido(await estornar(g.agente, est.tenantId, doDono.id));
    await nadaGravado();

    // Registrar sem estornar.
    expect((await conceder(est, g.membershipId, [...CONSULTAR, 'RECEBIMENTOS_REGISTRAR'])).status).toBe(200);
    expect(await concedidasNoBanco(g.membershipId)).toEqual([...CONSULTAR, 'RECEBIMENTOS_REGISTRAR'].sort());
    await reautenticar(g.agente, SENHA_DO_GERENTE);
    proibido(await estornar(g.agente, est.tenantId, doDono.id));
    await nadaGravado();
    const proprio = (await registrar(g.agente, est.tenantId, livre, 3000).expect(200)).body.payment as { id: string };
    proibido(await estornar(g.agente, est.tenantId, proprio.id));
    expect(await linha(proprio.id)).toMatchObject({ recorded_by_user_id: g.userId, estornado: false, refunded_by_user_id: null });

    // Só a agenda: nem consulta. Vale na requisição seguinte, com a sessão aberta.
    expect((await conceder(est, g.membershipId, AGENDA)).status).toBe(200);
    const outro = await concluido(est, '13:00');
    await reautenticar(g.agente, SENHA_DO_GERENTE);
    proibido(await listar(g.agente, est.tenantId));
    proibido(await registrar(g.agente, est.tenantId, outro, 5000));
    proibido(await estornar(g.agente, est.tenantId, proprio.id));
    expect(await contar(`SELECT count(*)::int AS n FROM appointment_payments WHERE appointment_id = $1`, [outro])).toBe(0);
    expect(await linha(proprio.id)).toMatchObject({ estornado: false, refunded_by_user_id: null });
  });

  it('isolamento: o gerente com tudo de um estabelecimento não alcança recebimento nem atendimento de outro, nem por id', async () => {
    const a = await estabelecimento('iso-a');
    const b = await estabelecimento('iso-b');
    await reautenticar(a.dono, SENHA);
    const g = await gerente(a, 'iso', TUDO);
    await reautenticar(g.agente, SENHA_DO_GERENTE);
    const atendimentoB = await concluido(b, '10:00');
    const pagamentoB = (await registrar(b.dono, b.tenantId, atendimentoB, 7000).expect(200)).body.payment as { id: string };
    const livreB = await concluido(b, '12:00');
    const daquiA = await concluido(a, '10:00');
    const pagamentoA = (await registrar(g.agente, a.tenantId, daquiA, 2000).expect(200)).body.payment as { id: string };

    // Pelo caminho de B: sem vínculo, 404 (nunca 403).
    for (const resposta of [
      await listar(g.agente, b.tenantId),
      await registrar(g.agente, b.tenantId, livreB, 7000),
      await estornar(g.agente, b.tenantId, pagamentoB.id),
    ]) {
      expect(resposta.status).toBe(404);
      expect(JSON.stringify(resposta.body)).not.toContain(pagamentoB.id);
    }
    // Pelo caminho de A, com ids de B: não acha.
    expect((await estornar(g.agente, a.tenantId, pagamentoB.id)).status).toBe(404);
    expect((await registrar(g.agente, a.tenantId, livreB, 7000)).status).toBe(404);
    const listaA = (await listar(g.agente, a.tenantId).expect(200)).body as { payments: { id: string }[]; awaitingPayment: { id: string }[] };
    expect(listaA.payments.map((p) => p.id)).toEqual([pagamentoA.id]);
    expect(listaA.awaitingPayment.map((p) => p.id)).not.toContain(livreB);

    // Nada mudou em B.
    expect(await linha(pagamentoB.id)).toMatchObject({ tenant_id: b.tenantId, recorded_by_user_id: b.donoId, estornado: false, refunded_by_user_id: null });
    expect(await contar(`SELECT count(*)::int AS n FROM appointment_payments WHERE appointment_id = $1`, [livreB])).toBe(0);
    expect(await contar(`SELECT count(*)::int AS n FROM appointment_payments WHERE tenant_id = $1`, [b.tenantId])).toBe(1);
    expect(await contar(`SELECT count(*)::int AS n FROM audit_logs WHERE tenant_id = $1 AND actor_user_id = $2`, [b.tenantId, g.userId])).toBe(0);
  });
});
