// Telefone compartilhado, prévia e unificação de cadastros (docs/plans/
// clientes-ficha-e-duplicados.md, PR 2) contra PostgreSQL DESCARTÁVEL no
// schema 25 (sem `uq_consumers_tenant_whatsapp`).
//
// Concorrência com duas conexões: uma conexão segura a linha do dono
// (`users ... FOR UPDATE`); a unificação para quando grava o autor da lápide
// (a FK pede `FOR KEY SHARE` nessa linha), já com cadastros e agendamentos
// travados. Assim a outra operação começa com a unificação no meio, e o
// teste solta a trava quando as duas estão esperando.
//
// O GERENTE deste arquivo fica num estabelecimento com `created_at` no fim
// dos tempos: a conferência do piloto com teto (pilot-team-manager-check)
// lista os primeiros por `created_at` e não pode ser empurrada por ele.
// Nomes e telefones fictícios.
import { randomUUID } from 'node:crypto';
import { globSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from 'pg';
import { DataSource } from 'typeorm';
import type { HttpException } from '@nestjs/common';
import { ConsumersService } from '../src/consumers/consumers.service.js';
import { ConsumerProfileService } from '../src/consumers/consumer-profile.service.js';
import { ConsumerMergeService } from '../src/consumers/consumer-merge.service.js';
import { buildRuntimeDataSourceOptions } from '../src/database/runtime-data-source.js';
import { clienteDoTelefone, travarTelefone } from '../src/public-booking/public-booking.repository.js';
import { generateId } from '../src/entities/common/generate-id.js';

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

interface Est {
  tenantId: string;
  userId: string;
  unitId: string;
  professionalId: string;
  serviceId: string;
}

interface Recusa {
  status: number;
  code?: string;
  principalId?: string | null;
  consumers?: { id: string }[];
  previa?: { versaoDaPrevia: string; transferir: Record<string, number> };
}

async function recusa(promessa: Promise<unknown>): Promise<Recusa> {
  try {
    await promessa;
  } catch (e) {
    const http = e as HttpException;
    if (typeof http.getStatus !== 'function') throw e;
    return { status: http.getStatus(), ...(http.getResponse() as Omit<Recusa, 'status'>) };
  }
  throw new Error('era esperada uma recusa');
}

describe.skipIf(!DIRECT_URL)('clientes: telefone compartilhado e unificação contra PostgreSQL descartável (schema 25)', () => {
  let ds: DataSource;
  let clientes: ConsumersService;
  let fichas: ConsumerProfileService;
  let unificacao: ConsumerMergeService;
  let planId: string;
  const sufixo = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  let contador = 0;
  let numero = 10_000_000 + Math.floor(Math.random() * 80_000_000);
  const celular = () => `119${8}${String((numero += 1)).slice(-7).padStart(7, '0')}`;
  const chave = () => `k_${randomUUID().replaceAll('-', '')}`;
  const q = <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => ds.query(sql, p) as Promise<T[]>;

  async function estabelecimento(criadoEm?: string): Promise<Est> {
    contador += 1;
    const est = {
      tenantId: generateId(),
      userId: generateId(),
      unitId: generateId(),
      professionalId: generateId(),
      serviceId: generateId(),
    };
    await q(
      `INSERT INTO tenants (id, slug, category, timezone, plan_id, status, access_legacy_since, created_at)
       VALUES ($1, $2, 'OTHER', 'America/Sao_Paulo', $3, 'ACTIVE', now(), coalesce($4::timestamptz, now()))`,
      [est.tenantId, `e2e-unificar-${contador}-${sufixo}`, planId, criadoEm ?? null],
    );
    await q(`INSERT INTO units (id, tenant_id, name, address, timezone, is_primary) VALUES ($1, $2, 'Unidade', '', 'America/Sao_Paulo', true)`, [
      est.unitId,
      est.tenantId,
    ]);
    await q(`INSERT INTO users (id, name, email, status) VALUES ($1, 'Dono Unificação', $2, 'ACTIVE')`, [
      est.userId,
      `dono-unificar-${contador}-${sufixo}@example.test`,
    ]);
    await q(`INSERT INTO memberships (id, user_id, tenant_id, role) VALUES ($1, $2, $3, 'DONO')`, [generateId(), est.userId, est.tenantId]);
    await q(`INSERT INTO professionals (id, tenant_id, name, avatar_initials, avatar_color) VALUES ($1, $2, 'Ana Lima', 'AL', '#123456')`, [
      est.professionalId,
      est.tenantId,
    ]);
    await q(`INSERT INTO services (id, tenant_id, name, short_description, price_cents, duration_minutes) VALUES ($1, $2, 'Corte', '', 5000, 30)`, [
      est.serviceId,
      est.tenantId,
    ]);
    return est;
  }

  let minuto = 0;
  /** Agendamento direto, cada um num horário próprio (a exclusão de horário
   * vale por profissional). */
  async function agendamento(est: Est, consumerId: string, status = 'COMPLETED', nome = 'Cliente') {
    const id = generateId();
    const itemId = generateId();
    minuto += 60;
    const inicio = new Date(Date.UTC(2026, 0, 1) + minuto * 60_000);
    await q(
      `INSERT INTO appointments (id, tenant_id, unit_id, consumer_id, consumer_name_snapshot, consumer_whatsapp_snapshot,
                                 professional_id, start_at, end_at, status)
       VALUES ($1, $2, $3, $4, $5, 'x', $6, $7, $8, $9)`,
      [id, est.tenantId, est.unitId, consumerId, nome, est.professionalId, inicio, new Date(inicio.getTime() + 30 * 60_000), status],
    );
    await q(
      `INSERT INTO appointment_items (id, tenant_id, appointment_id, service_id, price_cents_snapshot, duration_minutes_snapshot, service_name_snapshot)
       VALUES ($1, $2, $3, $4, 5000, 30, 'Corte')`,
      [itemId, est.tenantId, id, est.serviceId],
    );
    return { id, itemId };
  }

  const recebimento = (est: Est, appointmentId: string, executor: { query: DataSource['query'] } = ds) =>
    executor.query(
      `INSERT INTO appointment_payments (id, tenant_id, appointment_id, amount_cents, method, received_on, recorded_by_user_id, request_key)
       VALUES ($1, $2, $3, 5000, 'PIX', '2026-01-02', $4, $5) RETURNING id`,
      [generateId(), est.tenantId, appointmentId, est.userId, chave()],
    ) as Promise<{ id: string }[]>;

  const comissao = (est: Est, ag: { id: string; itemId: string }) =>
    q(
      `INSERT INTO commission_entries (id, tenant_id, appointment_id, appointment_item_id, professional_id, service_id,
         price_cents_snapshot, applied_type, applied_value, applied_rule_scope, professional_cents, establishment_cents, service_date)
       VALUES ($1, $2, $3, $4, $5, $6, 5000, 'PERCENTAGE', 4000, 'SERVICE', 2000, 3000, now()) RETURNING id`,
      [generateId(), est.tenantId, ag.id, ag.itemId, est.professionalId, est.serviceId],
    );

  const cadastrar = (est: Est, name: string, whatsapp = celular()) => clientes.create(est.userId, est.tenantId, { name, whatsapp });
  const previa = (est: Est, secundario: string, principal: string) => unificacao.preview(est.userId, est.tenantId, secundario, principal);
  const unir = (est: Est, secundario: string, principal: string, versaoDaPrevia: string) =>
    unificacao.merge(est.userId, est.tenantId, secundario, { principalId: principal, versaoDaPrevia });
  const donoDe = async (est: Est, appointmentId: string) =>
    (await q<{ consumer_id: string }>(`SELECT consumer_id FROM appointments WHERE tenant_id = $1 AND id = $2`, [est.tenantId, appointmentId]))[0]
      .consumer_id;
  const contar = async (est: Est) =>
    Number((await q<{ n: number }>(`SELECT count(*)::int AS n FROM consumers WHERE tenant_id = $1`, [est.tenantId]))[0].n);

  /** Segura a linha do dono numa conexão à parte; a unificação para ao gravar
   * o autor da lápide. */
  async function segurarDono(est: Est): Promise<{ soltar: () => Promise<void> }> {
    const client = new Client({ connectionString: DIRECT_URL, ssl: { rejectUnauthorized: true } });
    await client.connect();
    await client.query('BEGIN');
    await client.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [est.userId]);
    return {
      soltar: async () => {
        await client.query('COMMIT');
        await client.end();
      },
    };
  }

  /** Espera até `quantas` conexões estarem paradas em trava com o texto da
   * instrução contendo `trecho`. */
  async function esperarTrava(trecho: string, quantas = 1) {
    for (let i = 0; i < 200; i += 1) {
      const [linha] = await q<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE $1`,
        [`%${trecho}%`],
      );
      if (Number(linha.n) >= quantas) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`nenhuma conexão esperando em: ${trecho}`);
  }

  beforeAll(async () => {
    ds = new DataSource({ ...buildRuntimeDataSourceOptions(DIRECT_URL!), entities: await carregarEntidades(), logging: ['error'] });
    await ds.initialize();
    clientes = new ConsumersService(ds);
    fichas = new ConsumerProfileService(ds);
    unificacao = new ConsumerMergeService(ds);
    const [plano] = await q<{ id: string }>(`SELECT id FROM plans WHERE code = 'equipe'`);
    if (!plano) throw new Error('Catálogo de planos ausente — migrations não foram aplicadas.');
    planId = plano.id;
    const [unique] = await q(`SELECT 1 FROM pg_constraint WHERE conname = 'uq_consumers_tenant_whatsapp'`);
    if (unique) throw new Error('Este arquivo exige o schema 25 (ConsumerSharedPhone aplicada).');
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  describe('telefone compartilhado', () => {
    it('sem outraPessoa: 409 TELEFONE_EM_USO com os cadastros do telefone; com ela, outro cadastro, mesmo com nome igual; reenvio não cria terceiro', async () => {
      const est = await estabelecimento();
      const digitos = celular();
      const mae = await cadastrar(est, 'Rita Souza', digitos);
      const emUso = await recusa(clientes.register(est.userId, est.tenantId, { name: 'Rita Souza', whatsapp: digitos }));
      expect(emUso).toMatchObject({ status: 409, code: 'TELEFONE_EM_USO', consumers: [{ id: mae.id }] });

      const k = chave();
      const outra = await clientes.register(est.userId, est.tenantId, { name: 'Rita Souza', whatsapp: digitos, requestKey: k, outraPessoa: true });
      expect(outra).toMatchObject({ repeated: false });
      expect(outra.consumer.id).not.toBe(mae.id);
      const repetida = await clientes.register(est.userId, est.tenantId, { name: 'Rita Souza', whatsapp: digitos, requestKey: k, outraPessoa: true });
      expect(repetida).toMatchObject({ repeated: true, consumer: { id: outra.consumer.id } });
      // A mesma chave sem outraPessoa é outro pedido.
      expect(await recusa(clientes.register(est.userId, est.tenantId, { name: 'Rita Souza', whatsapp: digitos, requestKey: k }))).toMatchObject({
        status: 409,
        code: 'CHAVE_REUTILIZADA',
      });
      expect(await contar(est)).toBe(2);

      // Os dois aparecem no mesmo grupo, como "Mesmo WhatsApp".
      const { groups } = await fichas.groups(est.userId, est.tenantId, { limit: 20 });
      expect(groups).toHaveLength(1);
      expect(groups[0].membros.map((m) => m.relacoes)).toEqual([['MESMO_TELEFONE'], ['MESMO_TELEFONE']]);
    });

    it('simultâneos no mesmo telefone sem outraPessoa: um cadastro e um 409; edição para telefone de outro só com outraPessoa', async () => {
      const est = await estabelecimento();
      const digitos = celular();
      const resultados = await Promise.allSettled([
        clientes.register(est.userId, est.tenantId, { name: 'Téo', whatsapp: digitos, requestKey: chave() }),
        clientes.register(est.userId, est.tenantId, { name: 'Téo', whatsapp: digitos }),
      ]);
      expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await recusa(Promise.reject((resultados.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason))).toMatchObject({
        status: 409,
        code: 'TELEFONE_EM_USO',
      });
      expect(await contar(est)).toBe(1);

      const outro = await cadastrar(est, 'Ugo');
      const versao = (await fichas.profile(est.userId, est.tenantId, outro.id)).consumer.updatedAt;
      expect(await recusa(clientes.update(est.userId, est.tenantId, outro.id, { whatsapp: digitos, expectedUpdatedAt: versao }))).toMatchObject({
        status: 409,
        code: 'TELEFONE_EM_USO',
      });
      const editado = await clientes.update(est.userId, est.tenantId, outro.id, { whatsapp: digitos, expectedUpdatedAt: versao, outraPessoa: true });
      expect(editado.whatsapp).toBe(digitos);
    });

    it('agenda (cliente novo) com outraPessoa cria outro cadastro no mesmo telefone', async () => {
      const est = await estabelecimento();
      const digitos = celular();
      const primeiro = await cadastrar(est, 'Vera', digitos);
      const segundo = await ds.transaction((tx) => clientes.createWith(tx, est.tenantId, { name: 'Vítor', whatsapp: digitos, outraPessoa: true }));
      expect(segundo.id).not.toBe(primeiro.id);
      expect(await recusa(ds.transaction((tx) => clientes.createWith(tx, est.tenantId, { name: 'Vilma', whatsapp: digitos })))).toMatchObject({
        status: 409,
        code: 'TELEFONE_EM_USO',
      });
    });

    it('agendamento público no schema 25: outro nome cria cadastro; 9º dígito cria cadastro; ambiguidade cria um terceiro; nome nunca muda', async () => {
      const est = await estabelecimento();
      const publico = (nome: string, digitos: string) =>
        ds.transaction(async (tx) => {
          await travarTelefone(tx, est.tenantId, `+55${digitos}`);
          return clienteDoTelefone(tx, est.tenantId, { nome, whatsapp: digitos, telefone: `+55${digitos}` });
        });
      const digitos = '11987650099';
      const ana = await publico('Ana Reis', digitos);
      expect(await publico('ana  reis', digitos)).toBe(ana);
      const bruno = await publico('Bruno Reis', digitos);
      expect(bruno).not.toBe(ana);
      const semNove = await publico('Ana Reis', '1187650099');
      expect([ana, bruno]).not.toContain(semNove);

      // Dois cadastros com o mesmo telefone e nome (pela tela, outra pessoa):
      // o público não escolhe nenhum.
      await clientes.register(est.userId, est.tenantId, { name: 'Ana Reis', whatsapp: digitos, requestKey: chave(), outraPessoa: true });
      const terceiro = await publico('Ana Reis', digitos);
      expect(terceiro).not.toBe(ana);
      const nomes = await q<{ name: string }>(`SELECT name FROM consumers WHERE tenant_id = $1 AND id = $2`, [est.tenantId, ana]);
      expect(nomes).toEqual([{ name: 'Ana Reis' }]);
    });
  });

  describe('prévia e unificação', () => {
    it('move agendamentos com snapshots; recebimentos, comissões e pedidos seguem; lápide, autor e auditoria gravados; reenvio devolve 200', async () => {
      const est = await estabelecimento();
      const digitos = celular();
      const principal = await cadastrar(est, 'Caio Lima', digitos);
      const secundario = (
        await clientes.register(est.userId, est.tenantId, { name: 'Caio Lima', whatsapp: digitos, requestKey: chave(), outraPessoa: true })
      ).consumer;
      const antiga = await cadastrar(est, 'Caio Lima');
      // Lápide antiga do secundário: passa a apontar para o principal.
      await q(
        `UPDATE consumers SET merged_into_consumer_id = $3, merged_at = now(), merged_by_user_id = $4 WHERE tenant_id = $1 AND id = $2`,
        [est.tenantId, antiga.id, secundario.id, est.userId],
      );
      const concluido = await agendamento(est, secundario.id, 'COMPLETED', 'Caio L.');
      const cancelado = await agendamento(est, secundario.id, 'CANCELED');
      const [pagamento] = await recebimento(est, concluido.id);
      const [entrada] = await comissao(est, concluido);
      const pedidoId = generateId();
      await q(
        `INSERT INTO public_booking_requests (id, tenant_id, appointment_id, phone_normalized, idempotency_key, payload_hash)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [pedidoId, est.tenantId, cancelado.id, `+55${digitos}`, chave(), 'a'.repeat(64)],
      );
      const doPrincipal = await agendamento(est, principal.id);

      const p = await previa(est, secundario.id, principal.id);
      expect(p).toMatchObject({
        principal: { id: principal.id },
        secundario: { id: secundario.id },
        relacoes: ['MESMO_TELEFONE', 'MESMO_NOME'],
        transferir: { agendamentos: 2, concluidos: 1, cancelados: 1, faltas: 0, outros: 0, recebimentos: 1, comissoes: 1, pedidosPublicos: 1 },
      });
      // Prévia não grava nada.
      expect(await donoDe(est, concluido.id)).toBe(secundario.id);

      const feito = await unir(est, secundario.id, principal.id, p.versaoDaPrevia);
      expect(feito).toMatchObject({ repeated: false, principal: { id: principal.id }, transferido: p.transferir });
      for (const ag of [concluido, cancelado, doPrincipal]) expect(await donoDe(est, ag.id)).toBe(principal.id);
      const [snap] = await q(`SELECT consumer_name_snapshot FROM appointments WHERE id = $1`, [concluido.id]);
      expect(snap).toEqual({ consumer_name_snapshot: 'Caio L.' });
      const alcancaveis = await q<{ pagamento: string; entrada: string; pedido: string }>(
        `SELECT pg.id AS pagamento, ce.id AS entrada, pr.id AS pedido
           FROM appointments a
           LEFT JOIN appointment_payments pg ON pg.appointment_id = a.id
           LEFT JOIN commission_entries ce ON ce.appointment_id = a.id
           LEFT JOIN public_booking_requests pr ON pr.appointment_id = a.id
          WHERE a.tenant_id = $1 AND a.consumer_id = $2 AND (pg.id IS NOT NULL OR ce.id IS NOT NULL OR pr.id IS NOT NULL)
          ORDER BY 1, 2, 3`,
        [est.tenantId, principal.id],
      );
      expect(alcancaveis).toEqual(
        expect.arrayContaining([
          { pagamento: pagamento.id, entrada: entrada.id, pedido: null },
          { pagamento: null, entrada: null, pedido: pedidoId },
        ]),
      );

      const cadastros = await q<{ id: string; merged_into_consumer_id: string | null; merged_by_user_id: string | null }>(
        `SELECT id, merged_into_consumer_id, merged_by_user_id FROM consumers WHERE tenant_id = $1 ORDER BY id`,
        [est.tenantId],
      );
      expect(cadastros.find((c) => c.id === secundario.id)).toMatchObject({ merged_into_consumer_id: principal.id, merged_by_user_id: est.userId });
      expect(cadastros.find((c) => c.id === antiga.id)).toMatchObject({ merged_into_consumer_id: principal.id });
      expect(cadastros.find((c) => c.id === principal.id)).toMatchObject({ merged_into_consumer_id: null });

      const [auditoria] = await q<{ actor_user_id: string; actor_name: string; new_data: Record<string, unknown> }>(
        `SELECT actor_user_id, actor_name, new_data FROM audit_logs WHERE tenant_id = $1 AND action = 'CONSUMER_MERGED'`,
        [est.tenantId],
      );
      expect(auditoria).toMatchObject({
        actor_user_id: est.userId,
        actor_name: 'Dono Unificação',
        new_data: { secundarioId: secundario.id, principalId: principal.id, versaoDaPrevia: p.versaoDaPrevia, lapidesRedirecionadas: 1 },
      });

      // Reenvio: 200 com o resultado gravado, antes da checagem de lápide.
      const repetido = await unir(est, secundario.id, principal.id, p.versaoDaPrevia);
      expect(repetido).toMatchObject({ repeated: true, principal: { id: principal.id }, transferido: p.transferir });
      expect(await q(`SELECT 1 FROM audit_logs WHERE tenant_id = $1 AND action = 'CONSUMER_MERGED'`, [est.tenantId])).toHaveLength(1);

      // A lápide some da lista e da busca, e não recebe agendamento.
      expect((await clientes.search(est.userId, est.tenantId, 'Caio')).map((c) => c.id)).toEqual([principal.id]);
      await expect(agendamento(est, secundario.id)).rejects.toMatchObject({ driverError: { code: 'AC001', detail: principal.id } });
      expect(await recusa(clientes.findForLink(ds.manager, est.tenantId, secundario.id))).toMatchObject({
        status: 409,
        code: 'CLIENTE_UNIFICADO',
        principalId: principal.id,
      });
    });

    it.each([
      ['agendamento novo no secundário', async (est: Est, sec: string) => void (await agendamento(est, sec, 'PENDING'))],
      ['recebimento registrado', async (est: Est, _sec: string, _ag: unknown, _p: string, livre: { id: string }) => void (await recebimento(est, livre.id))],
      [
        'estorno',
        async (est: Est) =>
          void (await q(`UPDATE appointment_payments SET refunded_at = now(), refunded_on = '2026-01-03', refund_reason = 'teste', refunded_by_user_id = $2 WHERE tenant_id = $1`, [
            est.tenantId,
            est.userId,
          ])),
      ],
      ['comissão apurada', async (est: Est, _sec: string, _ag: unknown, _p: string, livre: { id: string; itemId: string }) => void (await comissao(est, livre))],
      [
        'comissão revertida',
        async (est: Est) => void (await q(`UPDATE commission_entries SET status = 'REVERSED', reversed_at = now() WHERE tenant_id = $1`, [est.tenantId])),
      ],
      ['mudança de situação', async (est: Est, _sec: string, ag: { id: string }) => void (await q(`UPDATE appointments SET status = 'NO_SHOW' WHERE id = $1`, [ag.id]))],
      ['e-mail do principal', async (_est: Est, _sec: string, _ag: unknown, principal: string) => void (await q(`UPDATE consumers SET email = 'novo@example.test' WHERE id = $1`, [principal]))],
    ])('alteração entre a prévia e a confirmação (%s): PREVIA_DESATUALIZADA, nada transferido', async (_rotulo, alterar) => {
      const est = await estabelecimento();
      const principal = await cadastrar(est, 'Duda Alves');
      const secundario = await cadastrar(est, 'Duda Alves');
      const ag = await agendamento(est, secundario.id, 'CONFIRMED');
      await recebimento(est, ag.id);
      await comissao(est, ag);
      // Sem recebimento nem comissão ainda (um ativo por agendamento e um por item).
      const livre = await agendamento(est, secundario.id, 'COMPLETED');
      const p = await previa(est, secundario.id, principal.id);

      await alterar(est, secundario.id, ag, principal.id, livre);
      const r = await recusa(unir(est, secundario.id, principal.id, p.versaoDaPrevia));
      expect(r).toMatchObject({ status: 409, code: 'PREVIA_DESATUALIZADA' });
      expect(r.previa?.versaoDaPrevia).not.toBe(p.versaoDaPrevia);
      expect(await donoDe(est, ag.id)).toBe(secundario.id);
      const [lapide] = await q(`SELECT merged_into_consumer_id FROM consumers WHERE id = $1`, [secundario.id]);
      expect(lapide).toEqual({ merged_into_consumer_id: null });

      // Com a prévia nova, conclui.
      await unir(est, secundario.id, principal.id, r.previa!.versaoDaPrevia);
      expect(await donoDe(est, ag.id)).toBe(principal.id);
    });

    it('gravação que trava o agendamento antes: a unificação espera, recalcula e recusa; nada transferido', async () => {
      const est = await estabelecimento();
      const principal = await cadastrar(est, 'Eli Santos');
      const secundario = await cadastrar(est, 'Eli Santos');
      const ag = await agendamento(est, secundario.id);
      const p = await previa(est, secundario.id, principal.id);

      const escritor = new Client({ connectionString: DIRECT_URL, ssl: { rejectUnauthorized: true } });
      await escritor.connect();
      try {
        await escritor.query('BEGIN');
        await escritor.query('SELECT id FROM appointments WHERE tenant_id = $1 AND id = $2 FOR UPDATE', [est.tenantId, ag.id]);
        await escritor.query(
          `INSERT INTO appointment_payments (id, tenant_id, appointment_id, amount_cents, method, received_on, recorded_by_user_id, request_key)
           VALUES ($1, $2, $3, 5000, 'PIX', '2026-01-02', $4, $5)`,
          [generateId(), est.tenantId, ag.id, est.userId, chave()],
        );
        const pendente = recusa(unir(est, secundario.id, principal.id, p.versaoDaPrevia));
        await esperarTrava('FROM appointments WHERE tenant_id = $1 AND consumer_id = $2 ORDER BY id FOR UPDATE');
        await escritor.query('COMMIT');
        expect(await pendente).toMatchObject({ status: 409, code: 'PREVIA_DESATUALIZADA', previa: { transferir: { recebimentos: 1 } } });
      } finally {
        await escritor.end();
      }
      expect(await donoDe(est, ag.id)).toBe(secundario.id);
    });

    it('unificação que trava antes: a gravação espera e segue no principal; nenhum estado intermediário', async () => {
      const est = await estabelecimento();
      const principal = await cadastrar(est, 'Fê Rocha');
      const secundario = await cadastrar(est, 'Fê Rocha');
      const ag = await agendamento(est, secundario.id);
      const p = await previa(est, secundario.id, principal.id);

      const dono = await segurarDono(est);
      const unindo = unir(est, secundario.id, principal.id, p.versaoDaPrevia);
      await esperarTrava('merged_by_user_id');
      const escritor = new Client({ connectionString: DIRECT_URL, ssl: { rejectUnauthorized: true } });
      await escritor.connect();
      try {
        await escritor.query('BEGIN');
        const travar = escritor.query('SELECT consumer_id FROM appointments WHERE tenant_id = $1 AND id = $2 FOR UPDATE', [est.tenantId, ag.id]);
        await esperarTrava('SELECT consumer_id FROM appointments WHERE tenant_id = $1 AND id = $2 FOR UPDATE');
        await dono.soltar();
        expect(await unindo).toMatchObject({ repeated: false });
        // Depois da espera, a linha relida já está no principal.
        expect((await travar).rows).toEqual([{ consumer_id: principal.id }]);
        await escritor.query(
          `INSERT INTO appointment_payments (id, tenant_id, appointment_id, amount_cents, method, received_on, recorded_by_user_id, request_key)
           VALUES ($1, $2, $3, 5000, 'PIX', '2026-01-02', $4, $5)`,
          [generateId(), est.tenantId, ag.id, est.userId, chave()],
        );
        await escritor.query('COMMIT');
      } finally {
        await escritor.end();
      }
      const [linha] = await q<{ n: number }>(
        `SELECT count(*)::int AS n FROM appointment_payments pg JOIN appointments a ON a.id = pg.appointment_id
          WHERE a.tenant_id = $1 AND a.consumer_id = $2`,
        [est.tenantId, principal.id],
      );
      expect(linha.n).toBe(1);
    });

    it.each([
      [
        'agendamento público do secundário (mesmo telefone e nome)',
        async (est: Est, sec: { id: string; whatsapp: string }) => {
          const telefone = `+55${sec.whatsapp}`;
          const id = await ds.transaction(async (tx) => {
            await travarTelefone(tx, est.tenantId, telefone);
            return clienteDoTelefone(tx, est.tenantId, { nome: 'Gabi Nunes', whatsapp: sec.whatsapp, telefone });
          });
          return { ok: id !== sec.id };
        },
      ],
      [
        'agendamento interno com o secundário',
        async (est: Est, sec: { id: string }) => {
          const r = await recusa(ds.transaction((tx) => clientes.findForLink(tx, est.tenantId, sec.id)));
          return { ok: r.code === 'CLIENTE_UNIFICADO' };
        },
      ],
      [
        'INSERT direto de agendamento no secundário',
        async (est: Est, sec: { id: string }) => {
          const erro = await agendamento(est, sec.id).then(
            () => null,
            (e: { driverError?: { code?: string } }) => e,
          );
          return { ok: erro?.driverError?.code === 'AC001' };
        },
      ],
      [
        'edição do secundário',
        async (est: Est, sec: { id: string; updatedAt: string }) => {
          const r = await recusa(clientes.update(est.userId, est.tenantId, sec.id, { name: 'Gabi N.', expectedUpdatedAt: sec.updatedAt }));
          return { ok: r.code === 'CLIENTE_UNIFICADO' };
        },
      ],
      [
        'outra unificação do mesmo secundário',
        async (est: Est, sec: { id: string; outro: string }) => {
          const r = await recusa(unir(est, sec.id, sec.outro, 'b'.repeat(64)));
          return { ok: r.code === 'CLIENTE_UNIFICADO' };
        },
      ],
      [
        'a mesma unificação repetida',
        async (est: Est, sec: { id: string; principal: string; versao: string }) => {
          const r = await unir(est, sec.id, sec.principal, sec.versao);
          return { ok: r.repeated };
        },
      ],
    ])('concorrência com a unificação: %s', async (_rotulo, operacao) => {
      const est = await estabelecimento();
      const digitos = celular();
      const principal = await cadastrar(est, 'Gabi Nunes', digitos);
      const sec = (
        await clientes.register(est.userId, est.tenantId, { name: 'Gabi Nunes', whatsapp: digitos, requestKey: chave(), outraPessoa: true })
      ).consumer;
      const outro = await cadastrar(est, 'Gabi Nunes');
      const updatedAt = (await fichas.profile(est.userId, est.tenantId, sec.id)).consumer.updatedAt;
      const p = await previa(est, sec.id, principal.id);

      const dono = await segurarDono(est);
      const unindo = unir(est, sec.id, principal.id, p.versaoDaPrevia);
      await esperarTrava('merged_by_user_id');
      const concorrente = operacao(est, { ...sec, updatedAt, outro: outro.id, principal: principal.id, versao: p.versaoDaPrevia });
      await esperarTrava('', 2);
      await dono.soltar();
      expect(await unindo).toMatchObject({ repeated: false });
      expect(await concorrente).toEqual({ ok: true });
      const [ligados] = await q<{ n: number }>(
        `SELECT count(*)::int AS n FROM appointments a JOIN consumers c ON c.tenant_id = a.tenant_id AND c.id = a.consumer_id
          WHERE a.tenant_id = $1 AND c.merged_into_consumer_id IS NOT NULL`,
        [est.tenantId],
      );
      expect(ligados.n).toBe(0);
    });

    it('preferências por telefone não mudam: opt-out da lápide segue bloqueando o número dela; nenhuma autorização ampliada', async () => {
      const est = await estabelecimento();
      const principal = await cadastrar(est, 'Hana Lopes');
      const secundario = await cadastrar(est, 'Hana Lopes');
      const evento = (c: { id: string; whatsapp: string }, kind: string) =>
        q(
          `INSERT INTO whatsapp_consent_events (tenant_id, whatsapp_normalized, kind, source, occurred_at, consumer_id)
           VALUES ($1, $2, $3, 'TESTE', now(), $4)`,
          [est.tenantId, `+55${c.whatsapp}`, kind, c.id],
        );
      await evento(principal, 'OPT_IN');
      await evento(secundario, 'OPT_OUT');
      const atual = async (c: { whatsapp: string }) =>
        (await q<{ k: string | null }>(`SELECT whatsapp_consent_current($1, $2) AS k`, [est.tenantId, `+55${c.whatsapp}`]))[0].k;
      const p = await previa(est, secundario.id, principal.id);
      await unir(est, secundario.id, principal.id, p.versaoDaPrevia);
      expect(await atual(principal)).toBe('OPT_IN');
      expect(await atual(secundario)).toBe('OPT_OUT');
      expect(await q(`SELECT 1 FROM whatsapp_consent_events WHERE tenant_id = $1`, [est.tenantId])).toHaveLength(2);
    });

    it('recusas: mesmo cadastro, par não sugerido, lápide, outro estabelecimento e gerente', async () => {
      const est = await estabelecimento();
      const a = await cadastrar(est, 'Ivo Reis');
      const b = await cadastrar(est, 'Ivo Reis');
      const estranho = await cadastrar(est, 'Zeca Prado');
      expect(await recusa(previa(est, a.id, a.id))).toMatchObject({ status: 400, code: 'MESMO_CADASTRO' });
      expect(await recusa(previa(est, a.id, estranho.id))).toMatchObject({ status: 409, code: 'NAO_SUGERIDO' });
      expect(await recusa(unir(est, a.id, estranho.id, 'c'.repeat(64)))).toMatchObject({ status: 409, code: 'NAO_SUGERIDO' });

      const alheio = await estabelecimento();
      expect(await recusa(previa(alheio, a.id, b.id))).toMatchObject({ status: 404 });
      expect(await recusa(unificacao.preview(alheio.userId, est.tenantId, a.id, b.id))).toMatchObject({ status: 404 });
      const deFora = await cadastrar(alheio, 'Ivo Reis');
      expect(await recusa(previa(est, a.id, deFora.id))).toMatchObject({ status: 404 });

      const p = await previa(est, a.id, b.id);
      await unir(est, a.id, b.id, p.versaoDaPrevia);
      expect(await recusa(previa(est, a.id, b.id))).toMatchObject({ status: 409, code: 'CLIENTE_UNIFICADO', principalId: b.id });
      expect(await recusa(previa(est, b.id, a.id))).toMatchObject({ status: 409, code: 'CLIENTE_UNIFICADO', principalId: b.id });

      // Gerente com todas as permissões de clientes concedidas: 403.
      const outroEst = await estabelecimento('2999-01-01T00:00:00Z');
      const gerenteId = generateId();
      const membershipId = generateId();
      await q(`INSERT INTO users (id, name, email, status) VALUES ($1, 'Gerente', $2, 'ACTIVE')`, [gerenteId, `gerente-unificar-${sufixo}@example.test`]);
      await q(`INSERT INTO memberships (id, user_id, tenant_id, role, permissions_confirmed_at) VALUES ($1, $2, $3, 'GERENTE', now())`, [
        membershipId,
        gerenteId,
        outroEst.tenantId,
      ]);
      for (const permission of ['CONSUMIDORES_VISUALIZAR', 'CONSUMIDORES_GERENCIAR']) {
        await q(
          `INSERT INTO membership_permission_overrides (id, tenant_id, membership_id, permission, mode) VALUES ($1, $2, $3, $4::permission, 'GRANTED')`,
          [generateId(), outroEst.tenantId, membershipId, permission],
        );
      }
      const c = await cadastrar(outroEst, 'Jade');
      const d = await cadastrar(outroEst, 'Jade');
      expect(await recusa(unificacao.preview(gerenteId, outroEst.tenantId, c.id, d.id))).toMatchObject({ status: 403 });
      expect(await recusa(unificacao.merge(gerenteId, outroEst.tenantId, c.id, { principalId: d.id, versaoDaPrevia: 'd'.repeat(64) }))).toMatchObject({
        status: 403,
      });
      // O gerente continua vendo a ficha (a permissão de clientes vale).
      expect((await fichas.profile(gerenteId, outroEst.tenantId, c.id)).consumer.id).toBe(c.id);
    });
  });
});
