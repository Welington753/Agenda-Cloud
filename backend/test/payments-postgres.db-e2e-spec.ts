// Recebimentos manuais contra PostgreSQL DESCARTÁVEL (com a migration
// AppointmentPayments): valor exato e histórico preservado, idempotência,
// quitação dupla impedida (inclusive simultânea), estorno com motivo sem
// apagar o original, cálculos do resumo (recebido, estornado, líquido e
// ticket médio) e isolamento entre estabelecimentos.
import { randomUUID } from 'node:crypto';
import { globSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DataSource } from 'typeorm';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { buildRuntimeDataSourceOptions } from '../src/database/runtime-data-source.js';
import { PAYMENTS_FORBIDDEN_MESSAGE } from '../src/payments/payment-access.js';
import { PaymentsService } from '../src/payments/payments.service.js';
import { DashboardService } from '../src/dashboard/dashboard.service.js';

const url = process.env.DB_E2E_DIRECT_URL;
if (url && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)) {
  throw new Error('Este teste exige PostgreSQL descartável local.');
}
const id = () => randomUUID().replaceAll('-', '').slice(0, 24);
const chave = () => `chave-${id()}`;

const erroDe = async (promessa: Promise<unknown>) => {
  try {
    await promessa;
  } catch (error) {
    return error as Error & { getResponse?: () => { code?: string } };
  }
  throw new Error('era esperado um erro');
};
const codigo = async (promessa: Promise<unknown>) => (await erroDe(promessa)).getResponse?.()?.code;

describe.skipIf(!url)('recebimentos manuais contra PostgreSQL descartável', () => {
  let db: DataSource;
  let pagamentos: PaymentsService;
  let painel: DashboardService;
  const marca = `pagamentos-${id()}`;
  let planoId: string;

  async function conta(nome: string) {
    const userId = id();
    await db.query(`INSERT INTO users (id, name, email, status, email_verified) VALUES ($1, $2, $3, 'ACTIVE', true)`, [
      userId,
      `Pessoa ${nome}`,
      `${marca}-${nome}@example.test`,
    ]);
    const sessionId = id();
    await db.query(
      `INSERT INTO sessions (id, user_id, token_hash, expires_at, reauthenticated_at) VALUES ($1, $2, $3, now() + interval '1 day', now())`,
      [sessionId, userId, id() + id()],
    );
    return { userId, sessionId };
  }

  async function estabelecimento(nome: string) {
    const tenantId = id();
    const unitId = id();
    await db.query(
      `INSERT INTO tenants (id, slug, category, timezone, plan_id, status) VALUES ($1, $2, 'OTHER', 'America/Sao_Paulo', $3, 'ACTIVE')`,
      [tenantId, `${marca}-${nome}`, planoId],
    );
    await db.query(
      `INSERT INTO units (id, tenant_id, name, address, timezone, is_primary) VALUES ($1, $2, $3, '', 'America/Sao_Paulo', true)`,
      [unitId, tenantId, nome],
    );
    const dono = await conta(`${nome}-dono`);
    await db.query(`INSERT INTO memberships (id, user_id, tenant_id, role) VALUES ($1, $2, $3, 'DONO')`, [id(), dono.userId, tenantId]);
    const serviceId = id();
    await db.query(
      `INSERT INTO services (id, tenant_id, name, short_description, duration_minutes, price_cents) VALUES ($1, $2, 'Corte', '', 30, 5000)`,
      [serviceId, tenantId],
    );
    const professionalId = id();
    await db.query(
      `INSERT INTO professionals (id, tenant_id, name, avatar_initials, avatar_color) VALUES ($1, $2, 'Ana', 'AN', '#000000')`,
      [professionalId, tenantId],
    );
    return { tenantId, unitId, dono, serviceId, professionalId };
  }
  type Est = Awaited<ReturnType<typeof estabelecimento>>;

  async function atendimento(est: Est, inicio: string, status = 'COMPLETED', nome = 'Cliente') {
    const consumerId = id();
    await db.query(
      `INSERT INTO consumers (id, tenant_id, name, whatsapp, whatsapp_normalized) VALUES ($1, $2, $3, '11999990000', $4)`,
      [consumerId, est.tenantId, nome, `55${Math.floor(Math.random() * 1e11)}`],
    );
    const appointmentId = id();
    const comeco = new Date(inicio);
    await db.query(
      `INSERT INTO appointments (id, tenant_id, unit_id, consumer_id, consumer_name_snapshot, consumer_whatsapp_snapshot,
          professional_id, start_at, end_at, status)
       VALUES ($1, $2, $3, $4, $5, '11999990000', $6, $7, $8, $9::appointment_status)`,
      [appointmentId, est.tenantId, est.unitId, consumerId, nome, est.professionalId, comeco, new Date(comeco.getTime() + 1_800_000), status],
    );
    await db.query(
      `INSERT INTO appointment_items (id, tenant_id, appointment_id, service_id, duration_minutes_snapshot, price_cents_snapshot)
       VALUES ($1, $2, $3, $4, 30, 5000)`,
      [id(), est.tenantId, appointmentId, est.serviceId],
    );
    return appointmentId;
  }

  const registrar = (est: Est, appointmentId: string, amountCents: number, receivedOn: string, requestKey = chave()) =>
    pagamentos.record(
      est.dono.userId,
      est.tenantId,
      { requestKey, appointmentId, amountCents, method: 'PIX', receivedOn },
      new Date('2025-09-30T15:00:00.000Z'),
    );
  /** Estorno no instante simulado `agora`, com a senha confirmada nesse mesmo
   * instante (a reconfirmação vale 10 minutos a partir dele). */
  const estornar = async (est: Est, paymentId: string, agora: string, reconfirmar = true) => {
    if (reconfirmar) await db.query(`UPDATE sessions SET reauthenticated_at = $2 WHERE id = $1`, [est.dono.sessionId, new Date(agora)]);
    return pagamentos.refund(est.dono.userId, est.dono.sessionId, est.tenantId, paymentId, { reason: 'Cobrança em duplicidade' }, new Date(agora));
  };

  beforeAll(async () => {
    const directoryPath = path.dirname(fileURLToPath(import.meta.url));
    const entities: (new () => object)[] = [];
    for (const file of globSync(path.join(directoryPath, '../src/entities/**/*.entity.ts'))) {
      const exports = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
      for (const value of Object.values(exports)) if (typeof value === 'function') entities.push(value as new () => object);
    }
    db = new DataSource({ ...buildRuntimeDataSourceOptions(url!), entities, logging: ['error'] });
    await db.initialize();
    pagamentos = new PaymentsService(db);
    painel = new DashboardService(db);
    planoId = id();
    await db.query(
      `INSERT INTO plans (id, code, name, short_description, max_professionals, max_units) VALUES ($1, $2, 'Plano', '', 3, 1)`,
      [planoId, marca],
    );
  });

  afterAll(async () => {
    if (db?.isInitialized) await db.destroy();
  });

  it('registra o valor pago, a forma, a data e quem registrou; o mesmo formulário não duplica', async () => {
    const est = await estabelecimento('registra');
    const a = await atendimento(est, '2025-09-10T13:00:00.000Z');
    const key = chave();
    const r = await registrar(est, a, 4250, '2025-09-10', key);
    expect(r.created).toBe(true);
    expect(r.payment).toMatchObject({
      appointmentId: a,
      amountCents: 4250,
      method: 'PIX',
      receivedOn: '2025-09-10',
      recordedBy: { id: est.dono.userId },
      refund: null,
      appointment: { localDate: '2025-09-10', localStart: '10:00', status: 'COMPLETED' },
    });
    const repetido = await registrar(est, a, 4250, '2025-09-10', key);
    expect(repetido).toEqual({ created: false, payment: r.payment });
    // Mudar o preço do serviço não mexe no que foi recebido.
    await db.query(`UPDATE services SET price_cents = 9900 WHERE id = $1`, [est.serviceId]);
    const lista = await pagamentos.list(est.dono.userId, est.tenantId, { from: '2025-09-01', to: '2025-09-30' });
    expect(lista.payments.map((p) => p.amountCents)).toEqual([4250]);
    // Histórico com o registro.
    const [hist] = await db.query(`SELECT count(*)::int AS total FROM audit_logs WHERE tenant_id = $1 AND action = 'PAYMENT_RECORDED'`, [
      est.tenantId,
    ]);
    expect(hist.total).toBe(1);
  });

  it('não quita duas vezes: nem em sequência nem em paralelo', async () => {
    const est = await estabelecimento('dupla');
    const a = await atendimento(est, '2025-09-11T13:00:00.000Z');
    await registrar(est, a, 5000, '2025-09-11');
    expect(await codigo(registrar(est, a, 5000, '2025-09-11'))).toBe('JA_QUITADO');

    const b = await atendimento(est, '2025-09-12T13:00:00.000Z');
    const resultados = await Promise.allSettled([registrar(est, b, 5000, '2025-09-12'), registrar(est, b, 5000, '2025-09-12')]);
    expect(resultados.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const [{ total }] = await db.query(`SELECT count(*)::int AS total FROM appointment_payments WHERE appointment_id = $1`, [b]);
    expect(total).toBe(1);
  });

  it('recusa atendimento aguardando, cancelado, data futura, funcionário e outro estabelecimento', async () => {
    const est = await estabelecimento('recusas');
    const outro = await estabelecimento('recusas-outro');
    expect(await codigo(registrar(est, await atendimento(est, '2025-09-13T13:00:00.000Z', 'PENDING'), 100, '2025-09-13'))).toBe(
      'ATENDIMENTO_NAO_QUITAVEL',
    );
    expect(await codigo(registrar(est, await atendimento(est, '2025-09-13T14:00:00.000Z', 'CANCELED'), 100, '2025-09-13'))).toBe(
      'ATENDIMENTO_NAO_QUITAVEL',
    );
    const a = await atendimento(est, '2025-09-13T15:00:00.000Z');
    expect(await codigo(registrar(est, a, 100, '2025-10-01'))).toBe('DATA_NO_FUTURO');
    await expect(registrar(outro, a, 100, '2025-09-13')).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      pagamentos.list(outro.dono.userId, est.tenantId, { from: '2025-09-01', to: '2025-09-30' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    const staff = await conta('recusas-staff');
    await db.query(
      `INSERT INTO memberships (id, user_id, tenant_id, role, professional_id) VALUES ($1, $2, $3, 'PROFISSIONAL', $4)`,
      [id(), staff.userId, est.tenantId, est.professionalId],
    );
    await expect(
      pagamentos.record(staff.userId, est.tenantId, { requestKey: chave(), appointmentId: a, amountCents: 100, method: 'PIX', receivedOn: '2025-09-13' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(painel.summary(staff.userId, est.tenantId, {})).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      pagamentos.list(staff.userId, est.tenantId, { from: '2025-09-01', to: '2025-09-30' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const { payment } = await registrar(est, a, 100, '2025-09-13');
    // Senha confirmada no mesmo instante passado ao serviço (o relógio do
    // banco pode estar à frente do processo; reautenticação "no futuro" não
    // vale): a recusa vem da permissão, não da falta de reconfirmação.
    const agora = new Date();
    await db.query(`UPDATE sessions SET reauthenticated_at = $2 WHERE id = $1`, [staff.sessionId, agora]);
    const recusaDoFuncionario = await erroDe(
      pagamentos.refund(staff.userId, staff.sessionId, est.tenantId, payment.id, { reason: 'Tentativa do funcionário' }, agora),
    );
    expect(recusaDoFuncionario).toBeInstanceOf(ForbiddenException);
    expect(recusaDoFuncionario.message).toBe(PAYMENTS_FORBIDDEN_MESSAGE);
    // Outro estabelecimento não estorna nem enxerga o recebimento daqui.
    await db.query(`UPDATE sessions SET reauthenticated_at = $2 WHERE id = $1`, [outro.dono.sessionId, agora]);
    await expect(
      pagamentos.refund(outro.dono.userId, outro.dono.sessionId, outro.tenantId, payment.id, { reason: 'Outro estabelecimento' }, agora),
    ).rejects.toBeInstanceOf(NotFoundException);
    const [{ refunded_at }] = await db.query(`SELECT refunded_at FROM appointment_payments WHERE id = $1`, [payment.id]);
    expect(refunded_at).toBeNull();

    // A chave do formulário de um estabelecimento não devolve nada noutro do
    // mesmo dono: recusa sem criar registro.
    const segundo = await estabelecimento('recusas-segundo');
    await db.query(`INSERT INTO memberships (id, user_id, tenant_id, role) VALUES ($1, $2, $3, 'DONO')`, [
      id(),
      est.dono.userId,
      segundo.tenantId,
    ]);
    const daqui = await atendimento(segundo, '2025-09-13T16:00:00.000Z');
    const chaveUsada = chave();
    await registrar(est, await atendimento(est, '2025-09-13T17:00:00.000Z'), 100, '2025-09-13', chaveUsada);
    expect(
      await codigo(
        pagamentos.record(
          est.dono.userId,
          segundo.tenantId,
          { requestKey: chaveUsada, appointmentId: daqui, amountCents: 100, method: 'PIX', receivedOn: '2025-09-13' },
          new Date('2025-09-30T15:00:00.000Z'),
        ),
      ),
    ).toBe('CHAVE_EM_USO');
    const [{ total }] = await db.query(`SELECT count(*)::int AS total FROM appointment_payments WHERE tenant_id = $1`, [segundo.tenantId]);
    expect(total).toBe(0);

    // Estabelecimento suspenso não registra nem lista.
    await db.query(`UPDATE tenants SET status = 'SUSPENDED' WHERE id = $1`, [segundo.tenantId]);
    await expect(
      pagamentos.list(est.dono.userId, segundo.tenantId, { from: '2025-09-01', to: '2025-09-30' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      pagamentos.record(est.dono.userId, segundo.tenantId, {
        requestKey: chave(),
        appointmentId: daqui,
        amountCents: 100,
        method: 'PIX',
        receivedOn: '2025-09-13',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    // Dono com a agenda restringida pela administração (DENIED): sem
    // recebimentos nem Início, como na agenda. Nada é gravado.
    const [{ id: vinculoDoDono }] = await db.query(`SELECT id FROM memberships WHERE tenant_id = $1 AND user_id = $2`, [
      est.tenantId,
      est.dono.userId,
    ]);
    await db.query(
      `INSERT INTO membership_permission_overrides (id, tenant_id, membership_id, permission, mode)
       VALUES ($1, $2, $3, 'AGENDA_VISUALIZAR', 'DENIED')`,
      [id(), est.tenantId, vinculoDoDono],
    );
    const restrito = await atendimento(est, '2025-09-13T18:00:00.000Z');
    for (const recusa of [
      pagamentos.list(est.dono.userId, est.tenantId, { from: '2025-09-01', to: '2025-09-30' }),
      registrar(est, restrito, 100, '2025-09-13'),
      estornar(est, payment.id, '2025-09-20T15:00:00.000Z'),
      painel.summary(est.dono.userId, est.tenantId, {}),
    ]) {
      const erro = await erroDe(recusa);
      expect(erro).toBeInstanceOf(ForbiddenException);
    }
    const [{ total: lancados }] = await db.query(
      `SELECT count(*)::int AS total FROM appointment_payments WHERE appointment_id = $1 OR (id = $2 AND refunded_at IS NOT NULL)`,
      [restrito, payment.id],
    );
    expect(lancados).toBe(0);
  });

  it('estorno integral com motivo: o original fica; não estorna duas vezes; dá para quitar de novo', async () => {
    const est = await estabelecimento('estorno');
    const a = await atendimento(est, '2025-09-14T13:00:00.000Z');
    const { payment } = await registrar(est, a, 6000, '2025-09-14');
    // Sem senha confirmada há pouco, não estorna.
    await db.query(`UPDATE sessions SET reauthenticated_at = now() - interval '1 hour' WHERE id = $1`, [est.dono.sessionId]);
    expect(await codigo(estornar(est, payment.id, '2025-09-20T15:00:00.000Z', false))).toBe('REAUTENTICACAO_NECESSARIA');
    const estornado = await estornar(est, payment.id, '2025-09-20T15:00:00.000Z');
    expect(estornado).toMatchObject({
      amountCents: 6000,
      receivedOn: '2025-09-14',
      refund: { refundedOn: '2025-09-20', reason: 'Cobrança em duplicidade', refundedBy: { id: est.dono.userId } },
    });
    expect(await codigo(estornar(est, payment.id, '2025-09-21T15:00:00.000Z'))).toBe('JA_ESTORNADO');
    const nova = await registrar(est, a, 5500, '2025-09-21');
    expect(nova.created).toBe(true);
    const [{ total }] = await db.query(`SELECT count(*)::int AS total FROM appointment_payments WHERE appointment_id = $1`, [a]);
    expect(total).toBe(2);
    // Cancelar o atendimento depois não estorna nada sozinho.
    await db.query(`UPDATE appointments SET status = 'CANCELED' WHERE id = $1`, [a]);
    const [ativo] = await db.query(`SELECT refunded_at FROM appointment_payments WHERE id = $1`, [nova.payment.id]);
    expect(ativo.refunded_at).toBeNull();
  });

  it('resumo: recebido, estornado, líquido e ticket médio sem distorção por estorno antigo', async () => {
    const est = await estabelecimento('resumo');
    // Agosto: dois atendimentos pagos (40,00 e 60,00).
    const ago1 = await atendimento(est, '2025-08-05T13:00:00.000Z');
    const ago2 = await atendimento(est, '2025-08-06T13:00:00.000Z');
    const pAgo1 = (await registrar(est, ago1, 4000, '2025-08-05')).payment;
    await registrar(est, ago2, 6000, '2025-08-06');
    // Setembro: três atendimentos pagos (30,00, 50,00 e 70,00), um concluído sem pagamento.
    const set = [await atendimento(est, '2025-09-02T13:00:00.000Z'), await atendimento(est, '2025-09-03T13:00:00.000Z'), await atendimento(est, '2025-09-04T13:00:00.000Z')];
    const pSet = [];
    for (const [i, valor] of [3000, 5000, 7000].entries()) pSet.push((await registrar(est, set[i], valor, `2025-09-0${i + 2}`)).payment);
    const semPagamento = await atendimento(est, '2025-09-05T13:00:00.000Z', 'COMPLETED', 'Sem Pagamento');
    // Em setembro: estorno do recebimento ANTIGO (agosto) e de um de setembro.
    await estornar(est, pAgo1.id, '2025-09-10T15:00:00.000Z');
    await estornar(est, pSet[2].id, '2025-09-11T15:00:00.000Z');

    const setembro = await pagamentos.list(est.dono.userId, est.tenantId, { from: '2025-09-01', to: '2025-09-30' });
    // Recebido em setembro: 30 + 50 + 70 = 150,00. Estornado em setembro: 40 + 70 = 110,00.
    expect(setembro.summary).toEqual({
      receivedCents: 15000,
      refundedCents: 11000,
      netCents: 4000,
      // Ticket: só os de setembro não estornados (30 e 50) → 40,00. O
      // estorno de agosto não entra na média de setembro.
      paidAppointments: 2,
      paidTotalCents: 8000,
      averageTicketCents: 4000,
    });
    // Sem recebimento: o que nunca teve e o que foi estornado (volta a aguardar).
    expect(setembro.awaitingPayment.map((a) => a.id)).toEqual([semPagamento, set[2]]);
    expect(setembro.awaitingPayment[0]).toMatchObject({ bookedPriceCents: 5000, consumerName: 'Sem Pagamento' });
    // O estorno de agosto aparece na lista de setembro (saiu dinheiro em setembro).
    expect(setembro.payments.map((p) => p.id)).toContain(pAgo1.id);

    const agosto = await pagamentos.list(est.dono.userId, est.tenantId, { from: '2025-08-01', to: '2025-08-31' });
    // Agosto continua com o que entrou em agosto; a média de agosto fica só
    // com o atendimento não estornado (60,00).
    expect(agosto.summary).toMatchObject({ receivedCents: 10000, refundedCents: 0, paidAppointments: 1, averageTicketCents: 6000 });

    // Sem período: o mês corrente no fuso do estabelecimento. 02:00 UTC de
    // 1º de outubro ainda é 30 de setembro em São Paulo.
    const padrao = await pagamentos.list(est.dono.userId, est.tenantId, {}, new Date('2025-10-01T02:00:00.000Z'));
    expect(padrao.period).toEqual({ from: '2025-09-01', to: '2025-09-30' });
    expect(padrao.summary).toEqual(setembro.summary);

    // O Início mostra o mesmo cálculo do período.
    const visao = await painel.summary(est.dono.userId, est.tenantId, { from: '2025-09-01', to: '2025-09-30' });
    expect(visao.finance).toEqual(setembro.summary);
    // Período sem recebimento: ticket nulo, nunca zero inventado.
    const vazio = await painel.summary(est.dono.userId, est.tenantId, { from: '2025-01-01', to: '2025-01-31' });
    expect(vazio.finance).toMatchObject({ receivedCents: 0, paidAppointments: 0, averageTicketCents: null });
  });
});
