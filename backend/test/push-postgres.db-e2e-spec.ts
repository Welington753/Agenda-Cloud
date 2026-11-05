// Web Push de novas solicitações contra PostgreSQL DESCARTÁVEL — nunca Neon,
// nunca banco existente, nunca `.env`. Só roda com `DB_E2E_DIRECT_URL`.
//
// Nenhum serviço de push real: o transporte é um serviço FALSO em memória,
// e cada "aparelho" é um par de chaves P-256 gerado aqui — o teste DECIFRA o
// que o servidor mandou, como o navegador faria. Isso prova o conteúdo e o
// destino, não a exibição num celular (ver o roteiro físico no runbook).
import { createDecipheriv, createECDH, createHmac, randomBytes } from 'node:crypto';
import { globSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BadRequestException, ForbiddenException, HttpException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppointmentsService } from '../src/appointments/appointments.service.js';
import { hashSessionToken } from '../src/auth/session-token.js';
import { AvailabilityService } from '../src/availability/availability.service.js';
import { ConsumersService } from '../src/consumers/consumers.service.js';
import { buildRuntimeDataSourceOptions } from '../src/database/runtime-data-source.js';
import { BusinessCategory } from '../src/entities/enums/business-category.enum.js';
import { EstablishmentRole } from '../src/entities/enums/establishment-role.enum.js';
import { ServiceModality } from '../src/entities/enums/service-modality.enum.js';
import { TenantStatus } from '../src/entities/enums/tenant-status.enum.js';
import { UserStatus } from '../src/entities/enums/user-status.enum.js';
import { Membership } from '../src/entities/membership.entity.js';
import { Plan } from '../src/entities/plan.entity.js';
import { Session } from '../src/entities/session.entity.js';
import { Tenant } from '../src/entities/tenant.entity.js';
import { Unit } from '../src/entities/unit.entity.js';
import { User } from '../src/entities/user.entity.js';
import { ProfessionalsService } from '../src/professionals/professionals.service.js';
import { ProfessionalWorkingHoursService } from '../src/professionals/working-hours.service.js';
import { PublicBookingService } from '../src/public-booking/public-booking.service.js';
import { registrarAlerta } from '../src/push/booking-alerts.repository.js';
import { DisparadorDePush } from '../src/push/push-dispatcher.js';
import type { RequisicaoPush, RespostaPush, TransportePush } from '../src/push/push-transport.js';
import { PushService } from '../src/push/push.service.js';
import type { ChavesVapid } from '../src/push/web-push-crypto.js';
import { ServicesService } from '../src/services/services.service.js';

const DIRECT_URL = process.env.DB_E2E_DIRECT_URL;
const testDir = path.dirname(fileURLToPath(import.meta.url));

async function carregarEntidades(): Promise<(new () => object)[]> {
  const arquivos = globSync(path.join(testDir, '../src/entities/**/*.entity.ts').replaceAll('\\', '/'));
  const classes: (new () => object)[] = [];
  for (const arquivo of arquivos) {
    const modulo = (await import(pathToFileURL(arquivo).href)) as Record<string, unknown>;
    for (const exportado of Object.values(modulo)) {
      if (typeof exportado === 'function') classes.push(exportado as new () => object);
    }
  }
  return classes;
}

const WEEKDAY = 0;
const SP = 'America/Sao_Paulo';
/** Domingo 2027-03-07, 10:00 / 11:00 / 12:00 em São Paulo. */
const DEZ = '2027-03-07T13:00:00.000Z';
const ONZE = '2027-03-07T14:00:00.000Z';
const MEIO_DIA = '2027-03-07T15:00:00.000Z';
const ANTECEDENCIA = new Date('2027-03-01T12:00:00.000Z');

const b64 = (b: Buffer) => b.toString('base64url');
const hmac = (k: Buffer, d: Buffer) => createHmac('sha256', k).update(d).digest();

interface Aparelho {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  decifrar(corpo: Buffer): unknown;
}

/** Um navegador inscrito: chaves próprias e decifra como o RFC 8291 manda. */
function novoAparelho(host = 'fcm.googleapis.com'): Aparelho {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const segredo = randomBytes(16);
  return {
    endpoint: `https://${host}/fcm/send/${b64(randomBytes(24))}`,
    keys: { p256dh: b64(ecdh.getPublicKey()), auth: b64(segredo) },
    decifrar(corpo) {
      const sal = corpo.subarray(0, 16);
      const n = corpo.readUInt8(20);
      const servidor = corpo.subarray(21, 21 + n);
      const cifrado = corpo.subarray(21 + n);
      const ikm = hmac(
        hmac(segredo, ecdh.computeSecret(servidor)),
        Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), servidor, Buffer.from([1])]),
      );
      const prk = hmac(sal, ikm);
      const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01', 'binary')).subarray(0, 16);
      const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01', 'binary')).subarray(0, 12);
      const d = createDecipheriv('aes-128-gcm', cek, nonce);
      d.setAuthTag(cifrado.subarray(cifrado.length - 16));
      const claro = Buffer.concat([d.update(cifrado.subarray(0, cifrado.length - 16)), d.final()]);
      return JSON.parse(claro.subarray(0, claro.length - 1).toString()) as unknown;
    },
  };
}

/** Serviço de push falso: guarda o que recebeu e responde o que o teste mandar. */
class ServicoDePushFalso implements TransportePush {
  recebidas: RequisicaoPush[] = [];
  respostas: (RespostaPush | ((r: RequisicaoPush) => RespostaPush))[] = [];
  padrao: RespostaPush = { tipo: 'http', status: 201 };
  async enviar(r: RequisicaoPush): Promise<RespostaPush> {
    this.recebidas.push(r);
    const proxima = this.respostas.shift() ?? this.padrao;
    return typeof proxima === 'function' ? proxima(r) : proxima;
  }
  para(aparelho: Aparelho) {
    return this.recebidas.filter((r) => r.url.href === aparelho.endpoint);
  }
}

interface Cenario {
  tenantId: string;
  slug: string;
  dono: { userId: string; sessionId: string };
  professionalId: string;
  serviceId: string;
}

describe.skipIf(!DIRECT_URL)('Web Push de novas solicitações contra PostgreSQL descartável', () => {
  let dataSource: DataSource;
  let agendamentos: AppointmentsService;
  let profissionais: ProfessionalsService;
  let servicos: ServicesService;
  let horarios: ProfessionalWorkingHoursService;
  let disponibilidade: AvailabilityService;
  let planId: string;
  let relogio = ANTECEDENCIA;
  const agora = () => relogio;
  const sufixo = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  let contador = 0;
  let telefones = 0;
  let chaves = 0;
  const vapid: ChavesVapid = (() => {
    const e = createECDH('prime256v1');
    e.generateKeys();
    return { publicKey: b64(e.getPublicKey()), privateKey: b64(e.getPrivateKey()), subject: 'mailto:teste@example.test' };
  })();

  function telefone(): string {
    telefones += 1;
    const n = String(10_000_000 + ((Number(sufixo.slice(-6)) * 11 + telefones) % 89_999_999));
    return `(11) 9${n}`;
  }
  const chave = () => `push-${sufixo}-${(chaves += 1)}`.padEnd(16, 'x');

  /** Executores criados no teste: drenados no fim para nenhum disparo em
   * segundo plano invadir o teste seguinte (todos usam o mesmo banco). */
  const executores: DisparadorDePush[] = [];

  function montar(servico: ServicoDePushFalso | null, opcoes: { executor?: string; semChaves?: boolean } = {}) {
    const disparador = new DisparadorDePush(dataSource, undefined, {
      chaves: opcoes.semChaves ? null : vapid,
      transporte: servico ?? new ServicoDePushFalso(),
      agora,
      executor: opcoes.executor ?? 'teste',
    });
    executores.push(disparador);
    const publico = new PublicBookingService(dataSource, disponibilidade, agendamentos, agora, disparador);
    const push = new PushService(dataSource, disparador, agora);
    return { disparador, publico, push };
  }

  /** Pedido público SEM disparo imediato: o teste controla quando o
   * executor roda (o disparo de verdade correria em paralelo). */
  const semDisparo = () => new PublicBookingService(dataSource, disponibilidade, agendamentos, agora);

  async function novaSessao(userId: string): Promise<string> {
    const s = await dataSource.manager.save(
      dataSource.manager.create(Session, {
        userId,
        tokenHash: hashSessionToken(b64(randomBytes(32))),
        // Vale no relógio CONTROLADO do teste (2027), não no de hoje.
        expiresAt: new Date('2028-01-01T00:00:00.000Z'),
      }),
    );
    return s.id;
  }

  async function novoUsuario(nome: string, tenantId: string, role = EstablishmentRole.DONO) {
    const m = dataSource.manager;
    const user = await m.save(
      m.create(User, {
        name: nome,
        email: `${nome.toLowerCase().replace(/\W/g, '')}-${sufixo}-${(contador += 1)}@example.test`,
        phone: '+5511900000000',
        status: UserStatus.ACTIVE,
      }),
    );
    const membership = await m.save(m.create(Membership, { userId: user.id, tenantId, role }));
    return { userId: user.id, membershipId: membership.id, sessionId: await novaSessao(user.id) };
  }

  async function criarCenario(publico: PublicBookingService): Promise<Cenario> {
    contador += 1;
    const m = dataSource.manager;
    const slug = `e2e-push-${contador}-${sufixo}`;
    const tenant = await m.save(
      m.create(Tenant, { slug, category: BusinessCategory.OTHER, timezone: SP, planId, status: TenantStatus.ACTIVE }),
    );
    // Anterior ao controle de validade: opera sem período (commercial/).
    await m.query('UPDATE tenants SET access_legacy_since = now() WHERE id = $1', [tenant.id]);
    await m.save(m.create(Unit, { tenantId: tenant.id, name: `Clínica ${contador}`, address: 'Rua X', timezone: SP, isPrimary: true }));
    const dono = await novoUsuario(`Dono ${contador}`, tenant.id);
    const servico = await servicos.create(dono.userId, tenant.id, {
      name: 'Sessão',
      shortDescription: 'Avaliação',
      priceCents: 10000,
      priceVisible: true,
      durationMinutes: 60,
      bufferAfterMinutes: 0,
      modality: ServiceModality.IN_PERSON,
      activeInPublicBooking: true,
      requiresManualConfirmation: false,
    });
    const profissional = await profissionais.create(dono.userId, tenant.id, { name: `Profissional ${contador}`, serviceIds: [servico.id] });
    await horarios.replace(dono.userId, tenant.id, profissional.id, {
      days: [{ weekday: WEEKDAY, intervals: [{ start: '09:00', end: '18:00' }] }],
    });
    await publico.updateSettings(dono.userId, tenant.id, true);
    return { tenantId: tenant.id, slug, dono, professionalId: profissional.id, serviceId: servico.id };
  }

  function pedir(publico: PublicBookingService, c: Cenario, startAt: string, idempotencyKey = chave(), whatsapp = telefone()) {
    return publico.request(c.slug, {
      serviceId: c.serviceId,
      professionalId: c.professionalId,
      startAt,
      name: 'Joana Pública',
      whatsapp,
      idempotencyKey,
    });
  }

  async function alertas(tenantId: string) {
    return (await dataSource.query(
      `SELECT id, appointment_id, status, attempts, outcome_reason, not_after FROM booking_request_alerts
        WHERE tenant_id = $1 ORDER BY created_at, id`,
      [tenantId],
    )) as { id: string; appointment_id: string; status: string; attempts: number; outcome_reason: string | null }[];
  }

  async function entregas(alertId: string) {
    return (await dataSource.query(
      `SELECT d.status, d.http_status, d.outcome_reason, d.attempts, s.endpoint_hash
         FROM push_deliveries d JOIN push_subscriptions s ON s.id = d.subscription_id
        WHERE d.alert_id = $1 ORDER BY d.created_at, d.id`,
      [alertId],
    )) as { status: string; http_status: number | null; outcome_reason: string | null; attempts: number }[];
  }

  async function inscricao(endpoint: string, tenantId: string) {
    const [linha] = (await dataSource.query(
      `SELECT user_id, status, revoked_reason, failure_count FROM push_subscriptions
        WHERE endpoint = $1 AND tenant_id = $2`,
      [endpoint, tenantId],
    )) as { user_id: string; status: string; revoked_reason: string | null; failure_count: number }[];
    return linha ?? null;
  }

  /** Todas as linhas deste endpoint, em qualquer estabelecimento, com tudo o
   * que uma gravação poderia mudar. */
  async function linhasDoEndpoint(endpoint: string) {
    return (await dataSource.query(
      `SELECT id, tenant_id, user_id, session_id, status, revoked_reason, p256dh, auth, failure_count, updated_at
         FROM push_subscriptions WHERE endpoint = $1 ORDER BY tenant_id, id`,
      [endpoint],
    )) as { tenant_id: string; user_id: string; status: string; p256dh: string; auth: string }[];
  }

  async function erroDe(promessa: Promise<unknown>): Promise<HttpException> {
    try {
      await promessa;
    } catch (erro) {
      if (erro instanceof HttpException) return erro;
      throw erro;
    }
    throw new Error('esperava falha HTTP');
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      ...buildRuntimeDataSourceOptions(DIRECT_URL as string),
      entities: await carregarEntidades(),
      logging: ['error'],
    });
    await dataSource.initialize();
    disponibilidade = new AvailabilityService(dataSource, agora);
    agendamentos = new AppointmentsService(dataSource, disponibilidade, new ConsumersService(dataSource), agora);
    profissionais = new ProfessionalsService(dataSource);
    servicos = new ServicesService(dataSource);
    horarios = new ProfessionalWorkingHoursService(dataSource);
    const plan = await dataSource.manager.findOne(Plan, { where: { code: 'equipe' } });
    if (!plan) throw new Error('Catálogo de planos ausente — migrations não foram aplicadas.');
    planId = plan.id;
  }, 30_000);

  beforeEach(() => {
    relogio = ANTECEDENCIA;
  });

  afterEach(async () => {
    await new Promise((pronto) => setImmediate(pronto));
    for (const executor of executores.splice(0)) await executor.executar();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  // ----------------------------------------------------------- o evento

  it('pedido novo grava UM evento na transação; repetir a chave não cria outro; recusado não cria nenhum', async () => {
    const { publico, disparador } = montar(null, { semChaves: true });
    const c = await criarCenario(publico);
    const k = chave();
    const fone = telefone();
    const primeiro = await pedir(publico, c, DEZ, k, fone);
    const repetido = await pedir(publico, c, DEZ, k, fone);
    expect(repetido.replayed).toBe(true);
    expect(primeiro.replayed).toBe(false);
    // Ocupado (409): nada gravado, nem evento.
    await expect(pedir(publico, c, DEZ)).rejects.toThrow();
    const lista = await alertas(c.tenantId);
    expect(lista).toHaveLength(1);
    expect(lista[0].status).toBe('PENDING');
    // Push desligado: o executor não envia nada (só expiraria vencidos).
    expect((await disparador.processarLote()).desativado).toBe(true);
    expect((await alertas(c.tenantId))[0].status).toBe('PENDING');
  });

  it('rollback: evento registrado numa transação que falha não sobra', async () => {
    const { publico } = montar(null);
    const c = await criarCenario(publico);
    await pedir(publico, c, DEZ);
    const [{ appointment_id }] = await alertas(c.tenantId);
    await dataSource.query(`DELETE FROM booking_request_alerts WHERE tenant_id = $1`, [c.tenantId]);
    await expect(
      dataSource.transaction(async (tx) => {
        await registrarAlerta(tx, { tenantId: c.tenantId, appointmentId: appointment_id, inicio: new Date(DEZ) }, agora());
        throw new Error('falha depois do evento');
      }),
    ).rejects.toThrow('falha depois do evento');
    expect(await alertas(c.tenantId)).toEqual([]);
  });

  // ----------------------------------------------------------- o envio

  it('envia só ids cifrados para o aparelho do dono; aceitação registrada sem afirmar exibição', async () => {
    const servico = new ServicoDePushFalso();
    const { publico, push, disparador } = montar(servico);
    const c = await criarCenario(publico);
    const celular = novoAparelho();
    await push.ativar(c.dono, c.tenantId, { endpoint: celular.endpoint, keys: celular.keys });
    expect((await push.estado(c.dono, c.tenantId, celular.endpoint)).active).toBe(true);

    await pedir(publico, c, DEZ);
    await disparador.executar();

    const recebidas = servico.para(celular);
    expect(recebidas).toHaveLength(1);
    const [req] = recebidas;
    const [alerta] = await alertas(c.tenantId);
    expect(celular.decifrar(req.body)).toEqual({
      v: 1,
      tipo: 'nova-solicitacao',
      estabelecimento: c.tenantId,
      solicitacao: alerta.appointment_id,
    });
    expect(req.body.toString('latin1')).not.toContain('Joana');
    expect(req.headers['Content-Encoding']).toBe('aes128gcm');
    expect(req.headers.Urgency).toBe('high');
    expect(Number(req.headers.TTL)).toBeGreaterThan(0);
    expect(Number(req.headers.TTL)).toBeLessThanOrEqual(86_400);
    expect(req.headers.Authorization).toMatch(new RegExp(`^vapid t=[^,]+, k=${vapid.publicKey}$`));
    expect(JSON.stringify(req.headers)).not.toContain(vapid.privateKey);

    expect(alerta.status).toBe('DONE');
    expect(alerta.outcome_reason).toBe('ACEITO_PELO_SERVICO');
    const [entrega] = await entregas(alerta.id);
    expect(entrega).toMatchObject({ status: 'ACCEPTED', http_status: 201, outcome_reason: 'ACEITO_PELO_SERVICO' });

    // Rodar de novo não reenvia o mesmo evento.
    await disparador.executar();
    expect(servico.para(celular)).toHaveLength(1);
  });

  it('falha do provedor: pedido continua gravado e PENDING; tenta de novo depois; 410 expira a inscrição', async () => {
    const servico = new ServicoDePushFalso();
    const { publico, push, disparador } = montar(servico);
    const c = await criarCenario(publico);
    const celular = novoAparelho();
    await push.ativar(c.dono, c.tenantId, { endpoint: celular.endpoint, keys: celular.keys });

    servico.respostas.push({ tipo: 'http', status: 503 });
    const recibo = await pedir(publico, c, DEZ);
    expect(recibo.status).toBe('PENDING');
    await disparador.executar();
    let [alerta] = await alertas(c.tenantId);
    expect(alerta.status).toBe('PENDING');
    expect(alerta.outcome_reason).toBe('NOVA_TENTATIVA');
    expect((await entregas(alerta.id))[0]).toMatchObject({ status: 'RETRY', http_status: 503 });
    expect((await agendamentos.get(c.dono.userId, c.tenantId, alerta.appointment_id)).status).toBe('PENDING');

    // Antes da espera: nada sai.
    await disparador.executar();
    expect(servico.para(celular)).toHaveLength(1);
    // Depois da espera: sem resposta (rede) e de novo.
    relogio = new Date(ANTECEDENCIA.getTime() + 31_000);
    servico.respostas.push({ tipo: 'rede' });
    await disparador.executar();
    expect(servico.para(celular)).toHaveLength(2);
    // Mais tarde: o serviço diz que a inscrição não existe mais.
    relogio = new Date(ANTECEDENCIA.getTime() + 10 * 60_000);
    servico.respostas.push({ tipo: 'http', status: 410 });
    await disparador.executar();
    [alerta] = await alertas(c.tenantId);
    expect(alerta.status).toBe('DONE');
    expect(alerta.attempts).toBe(3);
    expect((await entregas(alerta.id))[0]).toMatchObject({ status: 'GONE', http_status: 410, attempts: 3 });
    expect(await inscricao(celular.endpoint, c.tenantId)).toMatchObject({ status: 'EXPIRED', revoked_reason: 'SERVICO_DE_PUSH' });
    expect((await agendamentos.get(c.dono.userId, c.tenantId, alerta.appointment_id)).status).toBe('PENDING');

    // Transporte que LANÇA: o pedido do cliente nunca vira erro.
    const quebrado = montar({
      recebidas: [],
      enviar: () => Promise.reject(new Error('boom')),
    } as unknown as ServicoDePushFalso);
    const outro = await criarCenario(quebrado.publico);
    const tablet = novoAparelho();
    await quebrado.push.ativar(outro.dono, outro.tenantId, { endpoint: tablet.endpoint, keys: tablet.keys });
    expect((await pedir(quebrado.publico, outro, ONZE)).status).toBe('PENDING');
    await quebrado.disparador.executar();
    const [alertaQuebrado] = await alertas(outro.tenantId);
    expect((await entregas(alertaQuebrado.id))[0]).toMatchObject({ status: 'FAILED', outcome_reason: 'ERRO_INTERNO' });
  });

  it('solicitação respondida antes do envio, ou evento vencido: nada é enviado', async () => {
    const servico = new ServicoDePushFalso();
    const { publico, push, disparador } = montar(servico);
    const c = await criarCenario(publico);
    const celular = novoAparelho();
    await push.ativar(c.dono, c.tenantId, { endpoint: celular.endpoint, keys: celular.keys });

    await pedir(semDisparo(), c, DEZ);
    const [primeiro] = await alertas(c.tenantId);
    await agendamentos.cancel(c.dono.userId, c.tenantId, primeiro.appointment_id, { expectedStartAt: DEZ });
    await disparador.executar();
    expect((await alertas(c.tenantId))[0]).toMatchObject({ status: 'DONE', outcome_reason: 'SOLICITACAO_RESPONDIDA' });

    await pedir(semDisparo(), c, ONZE);
    relogio = new Date(new Date(ONZE).getTime() + 1); // o atendimento já começou
    await disparador.executar();
    const segundo = (await alertas(c.tenantId)).find((a) => a.id !== primeiro.id);
    expect(segundo).toMatchObject({ status: 'EXPIRED', outcome_reason: 'PRAZO_ESGOTADO' });
    expect(servico.para(celular)).toHaveLength(0);
  });

  // ----------------------------------------------------------- quem recebe

  it('isolamento: o aparelho de outro estabelecimento nunca recebe', async () => {
    const servico = new ServicoDePushFalso();
    const { publico, push, disparador } = montar(servico);
    const a = await criarCenario(publico);
    const b = await criarCenario(publico);
    const deA = novoAparelho();
    const deB = novoAparelho();
    await push.ativar(a.dono, a.tenantId, { endpoint: deA.endpoint, keys: deA.keys });
    await push.ativar(b.dono, b.tenantId, { endpoint: deB.endpoint, keys: deB.keys });
    // O dono de A não consegue inscrever-se em B, nem consultar B.
    expect(await erroDe(push.ativar(a.dono, b.tenantId, { endpoint: deA.endpoint, keys: deA.keys }))).toBeInstanceOf(
      NotFoundException,
    );
    expect(await erroDe(push.estado(a.dono, b.tenantId, deB.endpoint))).toBeInstanceOf(NotFoundException);

    await pedir(publico, a, DEZ);
    await disparador.executar();
    expect(servico.para(deA)).toHaveLength(1);
    expect(servico.para(deB)).toHaveLength(0);
  });

  it('autorização revalidada no envio: permissão negada, vínculo removido, sessão encerrada', async () => {
    const servico = new ServicoDePushFalso();
    const { publico, push, disparador } = montar(servico);
    const c = await criarCenario(publico);
    // Só DONO vê a agenda hoje (appointment-access.ts): os três são sócios.
    const gerente = await novoUsuario('Socio', c.tenantId);
    const recepcao = await novoUsuario('ExSocio', c.tenantId);
    const doDono = novoAparelho();
    const doGerente = novoAparelho();
    const daRecepcao = novoAparelho();
    await push.ativar(c.dono, c.tenantId, { endpoint: doDono.endpoint, keys: doDono.keys });
    await push.ativar(gerente, c.tenantId, { endpoint: doGerente.endpoint, keys: doGerente.keys });
    await push.ativar(recepcao, c.tenantId, { endpoint: daRecepcao.endpoint, keys: daRecepcao.keys });

    // Depois de ativar: um sócio perde a permissão de ver a agenda, o outro
    // perde o vínculo e o dono sai da conta (sessão revogada).
    await dataSource.query(
      `INSERT INTO membership_permission_overrides (id, tenant_id, membership_id, permission, mode)
       VALUES ($1, $2, $3, 'AGENDA_VISUALIZAR', 'DENIED')`,
      [`e2eo${sufixo}`.slice(0, 30), c.tenantId, gerente.membershipId],
    );
    await dataSource.query(`DELETE FROM memberships WHERE id = $1`, [recepcao.membershipId]);
    await dataSource.query(`UPDATE sessions SET revoked_at = now() WHERE id = $1`, [c.dono.sessionId]);
    expect(await inscricao(daRecepcao.endpoint, c.tenantId)).toBeNull();

    await pedir(publico, c, DEZ);
    await disparador.executar();
    for (const aparelho of [doDono, doGerente, daRecepcao]) expect(servico.para(aparelho)).toHaveLength(0);
    const [alerta] = await alertas(c.tenantId);
    expect(alerta.outcome_reason).toBe('SEM_DESTINATARIOS');
    expect(await entregas(alerta.id)).toEqual([expect.objectContaining({ status: 'SKIPPED', outcome_reason: 'SEM_PERMISSAO' })]);
    // E a própria rota recusa quem está sem permissão.
    expect(await erroDe(push.ativar(gerente, c.tenantId, { endpoint: doGerente.endpoint, keys: doGerente.keys }))).toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('mesmo aparelho, outro usuário: o anterior deixa de receber; desativar e entrar de novo exigem ativar', async () => {
    const servico = new ServicoDePushFalso();
    const { publico, push, disparador } = montar(servico);
    const c = await criarCenario(publico);
    const colega = await novoUsuario('Colega', c.tenantId);
    const compartilhado = novoAparelho();
    await push.ativar(c.dono, c.tenantId, { endpoint: compartilhado.endpoint, keys: compartilhado.keys });
    await push.ativar(colega, c.tenantId, { endpoint: compartilhado.endpoint, keys: compartilhado.keys });
    expect((await inscricao(compartilhado.endpoint, c.tenantId))?.user_id).toBe(colega.userId);
    expect((await push.estado(c.dono, c.tenantId, compartilhado.endpoint)).active).toBe(false);

    // Nova sessão do mesmo usuário (entrou de novo): não herda a ativação.
    const novaSessaoDoColega = { ...colega, sessionId: await novaSessao(colega.userId) };
    expect((await push.estado(novaSessaoDoColega, c.tenantId, compartilhado.endpoint)).active).toBe(false);

    await push.desativar(colega, c.tenantId, compartilhado.endpoint);
    expect(await inscricao(compartilhado.endpoint, c.tenantId)).toMatchObject({
      status: 'REVOKED',
      revoked_reason: 'DESATIVADO_PELO_USUARIO',
    });
    await pedir(publico, c, DEZ);
    await disparador.executar();
    expect(servico.para(compartilhado)).toHaveLength(0);
  });

  // ----------------------------------------------------------- transferência entre usuários

  it('mesmo endpoint com outras chaves: recusa genérica, sem tocar nas linhas alheias (mesmo e outro estabelecimento)', async () => {
    const servico = new ServicoDePushFalso();
    const { publico, push, disparador } = montar(servico);
    const a = await criarCenario(publico);
    const b = await criarCenario(publico);
    const colega = await novoUsuario('Colega', a.tenantId);
    const celular = novoAparelho();
    await push.ativar(a.dono, a.tenantId, { endpoint: celular.endpoint, keys: celular.keys });
    const antes = await linhasDoEndpoint(celular.endpoint);
    expect(antes).toHaveLength(1);

    // Quem conhece só o endpoint usa chaves próprias (outro "navegador").
    const intruso = novoAparelho();
    for (const [quem, tenantId] of [
      [colega, a.tenantId],
      [b.dono, b.tenantId],
    ] as const) {
      const erro = await erroDe(push.ativar(quem, tenantId, { endpoint: celular.endpoint, keys: intruso.keys }));
      expect(erro).toBeInstanceOf(BadRequestException);
      // A mesma resposta das chaves inválidas: não revela que o aparelho existe.
      const invalidas = await erroDe(push.ativar(quem, tenantId, { endpoint: celular.endpoint, keys: { p256dh: 'x', auth: 'y' } }));
      expect(erro.getResponse()).toEqual(invalidas.getResponse());
    }
    // Só a chave pública trocada, ou só o segredo trocado: também recusa.
    const meioIgual = novoAparelho();
    for (const keys of [
      { p256dh: meioIgual.keys.p256dh, auth: celular.keys.auth },
      { p256dh: celular.keys.p256dh, auth: meioIgual.keys.auth },
    ]) {
      expect(await erroDe(push.ativar(b.dono, b.tenantId, { endpoint: celular.endpoint, keys }))).toBeInstanceOf(BadRequestException);
    }
    expect(await linhasDoEndpoint(celular.endpoint)).toEqual(antes);
    expect((await push.estado(a.dono, a.tenantId, celular.endpoint)).active).toBe(true);

    // O aviso continua indo para o dono, cifrado com as chaves dele.
    await pedir(publico, a, DEZ);
    await disparador.executar();
    const [req] = servico.para(celular);
    expect(celular.decifrar(req.body)).toMatchObject({ estabelecimento: a.tenantId });
  });

  it('recusa atômica: a linha alheia com outras chaves impede também a revogação das que conferem', async () => {
    const { publico, push } = montar(null);
    const t1 = await criarCenario(publico);
    const t2 = await criarCenario(publico);
    const antigo = await novoUsuario('Antigo', t1.tenantId);
    const novo = await novoUsuario('Novo', t1.tenantId);
    const endpoint = novoAparelho().endpoint;
    const chavesAntigas = novoAparelho().keys;
    const chavesAtuais = novoAparelho().keys;
    // Linha desativada de um usuário de T1 (chaves antigas) e linha ativa do
    // dono de T2 (chaves atuais), no mesmo endpoint.
    await push.ativar(antigo, t1.tenantId, { endpoint, keys: chavesAntigas });
    await push.desativar(antigo, t1.tenantId, endpoint);
    await push.ativar(t2.dono, t2.tenantId, { endpoint, keys: chavesAtuais });
    const antes = await linhasDoEndpoint(endpoint);
    expect(antes.map((l) => l.status).sort()).toEqual(['ACTIVE', 'REVOKED']);

    // As chaves conferem com a ativa de T2, mas não com a de T1 que seria
    // reaproveitada: nada muda, nem a revogação da ativa de T2.
    expect(await erroDe(push.ativar(novo, t1.tenantId, { endpoint, keys: chavesAtuais }))).toBeInstanceOf(BadRequestException);
    expect(await linhasDoEndpoint(endpoint)).toEqual(antes);
  });

  it('transferência com as mesmas chaves continua valendo, inclusive de outro estabelecimento', async () => {
    const servico = new ServicoDePushFalso();
    const { publico, push, disparador } = montar(servico);
    const a = await criarCenario(publico);
    const b = await criarCenario(publico);
    const celular = novoAparelho();
    await push.ativar(a.dono, a.tenantId, { endpoint: celular.endpoint, keys: celular.keys });
    await push.ativar(b.dono, b.tenantId, { endpoint: celular.endpoint, keys: celular.keys });
    const linhas = await linhasDoEndpoint(celular.endpoint);
    expect(linhas.find((l) => l.tenant_id === a.tenantId)).toMatchObject({ user_id: a.dono.userId, status: 'REVOKED' });
    expect(linhas.find((l) => l.tenant_id === b.tenantId)).toMatchObject({ user_id: b.dono.userId, status: 'ACTIVE' });
    expect(await inscricao(celular.endpoint, a.tenantId)).toMatchObject({ revoked_reason: 'OUTRO_USUARIO' });

    // Destinatários: o aparelho deixa de receber os avisos de A e passa a
    // receber os de B.
    await pedir(publico, a, DEZ);
    await disparador.executar();
    expect(servico.para(celular)).toHaveLength(0);
    await pedir(publico, b, DEZ);
    await disparador.executar();
    const recebidas = servico.para(celular);
    expect(recebidas).toHaveLength(1);
    expect(celular.decifrar(recebidas[0].body)).toMatchObject({ estabelecimento: b.tenantId });
  });

  it('atualização da própria inscrição aceita chaves novas sem tocar nas linhas de terceiros', async () => {
    const servico = new ServicoDePushFalso();
    const { publico, push, disparador } = montar(servico);
    const a = await criarCenario(publico);
    const b = await criarCenario(publico);
    const celular = novoAparelho();
    // Terceiro (dono de B) usou o aparelho antes e desativou: linha dele fica.
    await push.ativar(b.dono, b.tenantId, { endpoint: celular.endpoint, keys: celular.keys });
    await push.desativar(b.dono, b.tenantId, celular.endpoint);
    const deTerceiro = (await linhasDoEndpoint(celular.endpoint)).find((l) => l.tenant_id === b.tenantId);

    await push.ativar(a.dono, a.tenantId, { endpoint: celular.endpoint, keys: celular.keys });
    const renovado = novoAparelho();
    await push.ativar(a.dono, a.tenantId, { endpoint: celular.endpoint, keys: renovado.keys });
    const linhas = await linhasDoEndpoint(celular.endpoint);
    expect(linhas.find((l) => l.tenant_id === a.tenantId)).toMatchObject({
      user_id: a.dono.userId,
      status: 'ACTIVE',
      p256dh: renovado.keys.p256dh,
      auth: renovado.keys.auth,
    });
    expect(linhas.find((l) => l.tenant_id === b.tenantId)).toEqual(deTerceiro);
    expect(linhas).toHaveLength(2);

    // Destinatário: o aviso de A vai cifrado com as chaves novas (as antigas
    // não decifram mais); a linha desativada do terceiro não recebe o de B.
    await pedir(publico, a, DEZ);
    await pedir(publico, b, DEZ);
    await disparador.executar();
    const recebidas = servico.para(celular);
    expect(recebidas).toHaveLength(1);
    expect(renovado.decifrar(recebidas[0].body)).toMatchObject({ estabelecimento: a.tenantId });
    expect(() => celular.decifrar(recebidas[0].body)).toThrow();
  });

  it('concorrência: dois usuários, chaves diferentes, mesmo endpoint novo: um grava, o outro é recusado', async () => {
    const { publico, push } = montar(null);
    const a = await criarCenario(publico);
    const b = await criarCenario(publico);
    const colega = await novoUsuario('Colega', a.tenantId);
    for (let rodada = 0; rodada < 5; rodada += 1) {
      const endpoint = novoAparelho().endpoint;
      const chavesA = novoAparelho().keys;
      const chavesB = novoAparelho().keys;
      const chavesColega = novoAparelho().keys;
      const resultados = await Promise.allSettled([
        push.ativar(a.dono, a.tenantId, { endpoint, keys: chavesA }),
        push.ativar(b.dono, b.tenantId, { endpoint, keys: chavesB }),
        push.ativar(colega, a.tenantId, { endpoint, keys: chavesColega }),
      ]);
      const aceitos = resultados.filter((r) => r.status === 'fulfilled');
      const recusados = resultados.filter((r) => r.status === 'rejected');
      expect(aceitos).toHaveLength(1);
      for (const r of recusados) expect((r as PromiseRejectedResult).reason).toBeInstanceOf(BadRequestException);
      const linhas = await linhasDoEndpoint(endpoint);
      expect(linhas).toHaveLength(1);
      expect(linhas[0].status).toBe('ACTIVE');
      const vencedor = resultados.findIndex((r) => r.status === 'fulfilled');
      expect(linhas[0].p256dh).toBe([chavesA, chavesB, chavesColega][vencedor].p256dh);
    }

    // Mesmas chaves ao mesmo tempo (mesmo navegador, duas contas): os dois
    // gravam, e no fim o aparelho avisa uma pessoa só.
    const compartilhado = novoAparelho();
    await Promise.all([
      push.ativar(a.dono, a.tenantId, { endpoint: compartilhado.endpoint, keys: compartilhado.keys }),
      push.ativar(b.dono, b.tenantId, { endpoint: compartilhado.endpoint, keys: compartilhado.keys }),
    ]);
    expect((await linhasDoEndpoint(compartilhado.endpoint)).filter((l) => l.status === 'ACTIVE')).toHaveLength(1);
  });

  // ----------------------------------------------------------- acesso comercial vencido

  it('acesso vencido: desativar continua possível e só alcança a própria linha; o resto segue bloqueado', async () => {
    const { publico, push } = montar(null);
    const a = await criarCenario(publico);
    const b = await criarCenario(publico);
    const colega = await novoUsuario('Colega', a.tenantId);
    const doDono = novoAparelho();
    const doColega = novoAparelho();
    const deB = novoAparelho();
    await push.ativar(a.dono, a.tenantId, { endpoint: doDono.endpoint, keys: doDono.keys });
    await push.ativar(colega, a.tenantId, { endpoint: doColega.endpoint, keys: doColega.keys });
    await push.ativar(b.dono, b.tenantId, { endpoint: deB.endpoint, keys: deB.keys });
    // Sem período e sem a marca de anterior ao controle: vencido (commercial/).
    await dataSource.query('UPDATE tenants SET access_legacy_since = NULL WHERE id = $1', [a.tenantId]);

    const vencido = await erroDe(push.estado(a.dono, a.tenantId, doDono.endpoint));
    expect(vencido).toBeInstanceOf(ForbiddenException);
    expect(vencido.getResponse()).toMatchObject({ code: 'ACESSO_VENCIDO' });
    const novo = novoAparelho();
    expect((await erroDe(push.ativar(a.dono, a.tenantId, { endpoint: novo.endpoint, keys: novo.keys }))).getResponse()).toMatchObject({
      code: 'ACESSO_VENCIDO',
    });
    expect(await linhasDoEndpoint(novo.endpoint)).toEqual([]);

    // O endpoint do colega na mão do dono: o filtro por user_id não deixa
    // desativar a linha alheia.
    const doColegaAntes = await linhasDoEndpoint(doColega.endpoint);
    expect(await push.desativar(a.dono, a.tenantId, doColega.endpoint)).toEqual({ active: false });
    expect(await linhasDoEndpoint(doColega.endpoint)).toEqual(doColegaAntes);

    // Quem não tem vínculo com A: 404, nada muda.
    const doDonoAntes = await linhasDoEndpoint(doDono.endpoint);
    expect(await erroDe(push.desativar(b.dono, a.tenantId, doDono.endpoint))).toBeInstanceOf(NotFoundException);
    expect(await linhasDoEndpoint(doDono.endpoint)).toEqual(doDonoAntes);

    await push.desativar(a.dono, a.tenantId, doDono.endpoint);
    expect(await inscricao(doDono.endpoint, a.tenantId)).toMatchObject({ status: 'REVOKED', revoked_reason: 'DESATIVADO_PELO_USUARIO' });
    await push.desativar(colega, a.tenantId, doColega.endpoint);
    expect(await inscricao(doColega.endpoint, a.tenantId)).toMatchObject({ status: 'REVOKED' });
    // O outro estabelecimento não é afetado.
    expect(await inscricao(deB.endpoint, b.tenantId)).toMatchObject({ status: 'ACTIVE' });
  });

  it('cadastro recusa destino fora dos serviços de push e chaves inválidas; push desligado responde 503', async () => {
    const { publico, push } = montar(null);
    const c = await criarCenario(publico);
    const valido = novoAparelho();
    for (const endpoint of ['https://169.254.169.254/latest', 'http://fcm.googleapis.com/x', 'https://interno.exemplo/push']) {
      expect(await erroDe(push.ativar(c.dono, c.tenantId, { endpoint, keys: valido.keys }))).toBeInstanceOf(BadRequestException);
    }
    expect(
      await erroDe(push.ativar(c.dono, c.tenantId, { endpoint: valido.endpoint, keys: { p256dh: 'x', auth: 'y' } })),
    ).toBeInstanceOf(BadRequestException);
    const [{ total }] = (await dataSource.query(`SELECT count(*)::int AS total FROM push_subscriptions WHERE tenant_id = $1`, [
      c.tenantId,
    ])) as { total: number }[];
    expect(total).toBe(0);

    const desligado = montar(null, { semChaves: true });
    expect((await erroDe(desligado.push.ativar(c.dono, c.tenantId, { endpoint: valido.endpoint, keys: valido.keys }))).getStatus()).toBe(
      503,
    );
    expect(desligado.push.configuracao()).toEqual({ enabled: false, publicKey: null });
    expect(push.configuracao()).toEqual({ enabled: true, publicKey: vapid.publicKey });
  });

  it('destino gravado fora da lista (dado adulterado) é pulado no envio, sem chamada externa', async () => {
    const servico = new ServicoDePushFalso();
    const { publico, push, disparador } = montar(servico);
    const c = await criarCenario(publico);
    const celular = novoAparelho();
    await push.ativar(c.dono, c.tenantId, { endpoint: celular.endpoint, keys: celular.keys });
    await dataSource.query(`UPDATE push_subscriptions SET endpoint = 'https://169.254.169.254/x' WHERE tenant_id = $1`, [
      c.tenantId,
    ]);
    await pedir(publico, c, DEZ);
    await disparador.executar();
    expect(servico.recebidas.some((r) => r.url.hostname === '169.254.169.254')).toBe(false);
    const [alerta] = await alertas(c.tenantId);
    expect(await entregas(alerta.id)).toEqual([expect.objectContaining({ status: 'SKIPPED', outcome_reason: 'DESTINO_RECUSADO' })]);
  });

  // ----------------------------------------------------------- processo que morre

  it('retomada: evento largado por um executor morto volta; dois executores juntos enviam uma vez só', async () => {
    const servico = new ServicoDePushFalso();
    const { publico, push } = montar(servico);
    const c = await criarCenario(publico);
    const celular = novoAparelho();
    await push.ativar(c.dono, c.tenantId, { endpoint: celular.endpoint, keys: celular.keys });
    await pedir(semDisparo(), c, DEZ);
    // Um executor reservou e morreu antes de enviar.
    await dataSource.query(
      `UPDATE booking_request_alerts SET status = 'PROCESSING', locked_by = 'morto', locked_until = $2, attempts = 1
        WHERE tenant_id = $1`,
      [c.tenantId, new Date(ANTECEDENCIA.getTime() + 2 * 60_000)],
    );
    const um = montar(servico, { executor: 'um' }).disparador;
    const dois = montar(servico, { executor: 'dois' }).disparador;
    await Promise.all([um.processarLote(), dois.processarLote()]);
    expect(servico.para(celular)).toHaveLength(0); // concessão ainda vale

    relogio = new Date(ANTECEDENCIA.getTime() + 3 * 60_000);
    await Promise.all([um.processarLote(), dois.processarLote(), um.processarLote()]);
    expect(servico.para(celular)).toHaveLength(1);
    expect((await alertas(c.tenantId))[0]).toMatchObject({ status: 'DONE', attempts: 2 });

    // Vários pedidos e dois executores ao mesmo tempo: cada um sai uma vez.
    await pedir(semDisparo(), c, ONZE);
    await pedir(semDisparo(), c, MEIO_DIA);
    await Promise.all([um.processarLote(), dois.processarLote()]);
    expect(servico.para(celular)).toHaveLength(3);
  });
});
