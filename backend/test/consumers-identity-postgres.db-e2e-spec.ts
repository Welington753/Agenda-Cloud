// Identidade dos clientes, ficha, lista agrupada, edição, chave de pedido,
// agendamento público e preferências por telefone (docs/plans/
// clientes-ficha-e-duplicados.md) contra PostgreSQL DESCARTÁVEL.
//
// Dois schemas:
// - "24": o banco do DB_E2E_DIRECT_URL (migrations até ConsumerIdentity),
//   com o UNIQUE antigo de telefone;
// - "25": um banco TEMPORÁRIO, com as mesmas migrations e o UNIQUE removido
//   como fará a ConsumerSharedPhone. A API desta versão precisa funcionar
//   nos dois.
// Sem GERENTE (ver a nota sobre o banco compartilhado no CI); a regra de
// preço por papel é coberta em src/consumers/consumer-profile.spec.ts.
// Nomes e telefones fictícios.
import { randomUUID } from 'node:crypto';
import { existsSync, globSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from 'pg';
import { DataSource } from 'typeorm';
import type { HttpException } from '@nestjs/common';
import { ConsumersService } from '../src/consumers/consumers.service.js';
import { ConsumerProfileService } from '../src/consumers/consumer-profile.service.js';
import { buildRuntimeDataSourceOptions } from '../src/database/runtime-data-source.js';
import { clienteDoTelefone, travarTelefone } from '../src/public-booking/public-booking.repository.js';
import { generateId } from '../src/entities/common/generate-id.js';
import { buscaAceita, cadastroAceito, falhaDoWebAnterior, paginaAceita } from './support/contrato-web-anterior-clientes.js';

const DIRECT_URL = process.env.DB_E2E_DIRECT_URL;
const testDir = path.dirname(fileURLToPath(import.meta.url));
const FONTE_COMPILADA = new URL('../dist-migrations/database/migrations-data-source.js', import.meta.url);

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

interface Ambiente {
  ds: DataSource;
  clientes: ConsumersService;
  fichas: ConsumerProfileService;
}

interface Est {
  tenantId: string;
  userId: string;
  unitId: string;
  professionalId: string;
  serviceId: string;
}

/** Corpo da recusa HTTP (status e code). */
async function recusa(promessa: Promise<unknown>): Promise<{ status: number; code?: string; principalId?: string | null }> {
  try {
    await promessa;
  } catch (e) {
    const http = e as HttpException;
    if (typeof http.getStatus !== 'function') throw e;
    const corpo = http.getResponse() as { code?: string; principalId?: string | null };
    return { status: http.getStatus(), code: corpo.code, principalId: corpo.principalId };
  }
  throw new Error('era esperada uma recusa');
}

describe.skipIf(!DIRECT_URL)('clientes: identidade, ficha e duplicados contra PostgreSQL descartável', () => {
  let s24: Ambiente;
  let s25: Ambiente;
  let banco25: string;
  const sufixo = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  let contador = 0;
  let planId: string;
  let numero = 10_000_000 + Math.floor(Math.random() * 80_000_000);

  /** Celular fictício novo (11 9XXXX-XXXX com 2º dígito 8). */
  const celular = () => `119${8}${String((numero += 1)).slice(-7).padStart(7, '0')}`;
  const normalizado = (digitos: string) => `+55${digitos}`;

  function urlDe(banco: string) {
    const u = new URL(DIRECT_URL!);
    u.pathname = `/${banco}`;
    return u.toString();
  }

  async function comCliente<T>(alvo: string, fn: (client: Client) => Promise<T>): Promise<T> {
    const client = new Client({ connectionString: alvo, ssl: { rejectUnauthorized: true } });
    await client.connect();
    try {
      return await fn(client);
    } finally {
      await client.end();
    }
  }

  async function ambiente(url: string, entidades: (new () => object)[]): Promise<Ambiente> {
    const ds = new DataSource({ ...buildRuntimeDataSourceOptions(url), entities: entidades, logging: ['error'] });
    await ds.initialize();
    return { ds, clientes: new ConsumersService(ds), fichas: new ConsumerProfileService(ds) };
  }

  async function estabelecimento(amb: Ambiente): Promise<Est> {
    contador += 1;
    const q = (sql: string, p: unknown[]) => amb.ds.query(sql, p);
    const tenantId = generateId();
    const userId = generateId();
    const unitId = generateId();
    const professionalId = generateId();
    const serviceId = generateId();
    await q(
      `INSERT INTO tenants (id, slug, category, timezone, plan_id, status, access_legacy_since)
       VALUES ($1, $2, 'OTHER', 'America/Sao_Paulo', $3, 'ACTIVE', now())`,
      [tenantId, `e2e-clientes-${contador}-${sufixo}`, planId],
    );
    await q(`INSERT INTO units (id, tenant_id, name, address, timezone, is_primary) VALUES ($1, $2, 'Unidade', '', 'America/Sao_Paulo', true)`, [
      unitId,
      tenantId,
    ]);
    await q(`INSERT INTO users (id, name, email, status) VALUES ($1, 'Dono Clientes', $2, 'ACTIVE')`, [
      userId,
      `dono-clientes-${contador}-${sufixo}@example.test`,
    ]);
    await q(`INSERT INTO memberships (id, user_id, tenant_id, role) VALUES ($1, $2, $3, 'DONO')`, [generateId(), userId, tenantId]);
    await q(`INSERT INTO professionals (id, tenant_id, name, avatar_initials, avatar_color) VALUES ($1, $2, 'Ana Lima', 'AL', '#123456')`, [
      professionalId,
      tenantId,
    ]);
    await q(
      `INSERT INTO services (id, tenant_id, name, short_description, price_cents, duration_minutes) VALUES ($1, $2, 'Corte', '', 5000, 30)`,
      [serviceId, tenantId],
    );
    return { tenantId, userId, unitId, professionalId, serviceId };
  }

  /** Agendamento direto (o caminho da agenda é provado nas suítes da agenda). */
  async function agendamento(
    amb: Ambiente,
    est: Est,
    consumerId: string,
    opcoes: { inicio: Date; status: string; nome?: string; preco?: number | null },
  ): Promise<string> {
    const id = generateId();
    await amb.ds.query(
      `INSERT INTO appointments (id, tenant_id, unit_id, consumer_id, consumer_name_snapshot, consumer_whatsapp_snapshot,
                                 professional_id, start_at, end_at, status)
       VALUES ($1, $2, $3, $4, $5, 'x', $6, $7, $8, $9)`,
      [id, est.tenantId, est.unitId, consumerId, opcoes.nome ?? 'Cliente', est.professionalId, opcoes.inicio, new Date(opcoes.inicio.getTime() + 30 * 60_000), opcoes.status],
    );
    await amb.ds.query(
      `INSERT INTO appointment_items (id, tenant_id, appointment_id, service_id, price_cents_snapshot, duration_minutes_snapshot, service_name_snapshot)
       VALUES ($1, $2, $3, $4, $5, 30, 'Corte')`,
      [generateId(), est.tenantId, id, est.serviceId, opcoes.preco === undefined ? 5000 : opcoes.preco],
    );
    return id;
  }

  /** Lápide por SQL (a unificação pela API só existe com a migration 25). */
  async function unificar(amb: Ambiente, est: Est, secundario: string, principal: string) {
    await amb.ds.query(
      `UPDATE consumers SET merged_into_consumer_id = $3, merged_at = now(), merged_by_user_id = $4 WHERE tenant_id = $1 AND id = $2`,
      [est.tenantId, secundario, principal, est.userId],
    );
  }

  /** Pedido público, como o serviço faz: transação, trava do telefone e
   * resolução do cliente. */
  function clientePublico(amb: Ambiente, est: Est, nome: string, digitos: string) {
    return amb.ds.transaction(async (tx) => {
      await travarTelefone(tx, est.tenantId, normalizado(digitos));
      return clienteDoTelefone(tx, est.tenantId, { nome, whatsapp: digitos, telefone: normalizado(digitos) });
    });
  }

  const contar = async (amb: Ambiente, est: Est) =>
    Number((await amb.ds.query(`SELECT count(*)::int AS n FROM consumers WHERE tenant_id = $1`, [est.tenantId]))[0].n);
  const versao = async (amb: Ambiente, est: Est, id: string) =>
    (await amb.fichas.profile(est.userId, est.tenantId, id)).consumer.updatedAt;
  const chave = () => `k_${randomUUID().replaceAll('-', '')}`;

  beforeAll(async () => {
    const entidades = await carregarEntidades();
    s24 = await ambiente(DIRECT_URL!, entidades);
    const [plano] = (await s24.ds.query(`SELECT id FROM plans WHERE code = 'equipe'`)) as { id: string }[];
    if (!plano) throw new Error('Catálogo de planos ausente — migrations não foram aplicadas.');
    planId = plano.id;

    if (!existsSync(FONTE_COMPILADA)) throw new Error('Rode `npm run build:migrations-runtime` antes deste teste.');
    const { buildMigrationsDataSourceOptions } = (await import(FONTE_COMPILADA.href)) as {
      buildMigrationsDataSourceOptions: (u: string) => ConstructorParameters<typeof DataSource>[0];
    };
    banco25 = `clientes_s25_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    await comCliente(DIRECT_URL!, (c) => c.query(`CREATE DATABASE "${banco25}"`));
    const mig = new DataSource({ ...buildMigrationsDataSourceOptions(urlDe(banco25)), logging: false } as ConstructorParameters<typeof DataSource>[0]);
    await mig.initialize();
    await mig.runMigrations({ transaction: 'each' });
    // O que a ConsumerSharedPhone fará.
    await mig.query(`ALTER TABLE consumers DROP CONSTRAINT uq_consumers_tenant_whatsapp`);
    await mig.destroy();
    s25 = await ambiente(urlDe(banco25), entidades);
  }, 120_000);

  afterAll(async () => {
    await s24?.ds.destroy();
    await s25?.ds.destroy();
    if (banco25) await comCliente(DIRECT_URL!, (c) => c.query(`DROP DATABASE IF EXISTS "${banco25}" WITH (FORCE)`));
  });

  describe('cadastro com chave de pedido', () => {
    it('reenvio com os mesmos dados devolve o original, inclusive depois de editar o cliente; dados diferentes: 409', async () => {
      const est = await estabelecimento(s24);
      const k = chave();
      const digitos = celular();
      const primeiro = await s24.clientes.register(est.userId, est.tenantId, { name: 'Bia  Souza', whatsapp: digitos, requestKey: k });
      expect(primeiro.repeated).toBe(false);

      const repetido = await s24.clientes.register(est.userId, est.tenantId, { name: 'Bia Souza', whatsapp: digitos, requestKey: k });
      expect(repetido).toMatchObject({ repeated: true, consumer: { id: primeiro.consumer.id } });

      // Editado depois: o reenvio é comparado com a impressão gravada, nunca
      // com o cadastro atual.
      const novoTelefone = celular();
      await s24.clientes.update(est.userId, est.tenantId, primeiro.consumer.id, {
        name: 'Beatriz Souza',
        whatsapp: novoTelefone,
        expectedUpdatedAt: await versao(s24, est, primeiro.consumer.id),
      });
      const depoisDeEditar = await s24.clientes.register(est.userId, est.tenantId, { name: 'Bia Souza', whatsapp: digitos, requestKey: k });
      expect(depoisDeEditar).toMatchObject({ repeated: true, consumer: { id: primeiro.consumer.id, name: 'Beatriz Souza' } });
      expect(await contar(s24, est)).toBe(1);

      expect(await recusa(s24.clientes.register(est.userId, est.tenantId, { name: 'Outra', whatsapp: digitos, requestKey: k }))).toMatchObject({
        status: 409,
        code: 'CHAVE_REUTILIZADA',
      });

      // A tabela de pedidos nunca é alterada: a linha é a original.
      const pedidos = (await s24.ds.query(`SELECT consumer_id FROM consumer_create_requests WHERE tenant_id = $1`, [est.tenantId])) as {
        consumer_id: string;
      }[];
      expect(pedidos).toEqual([{ consumer_id: primeiro.consumer.id }]);
    });

    it('duas chamadas simultâneas com a mesma chave: um cadastro e duas respostas com o mesmo cliente', async () => {
      const est = await estabelecimento(s24);
      const k = chave();
      const dados = { name: 'Caio Prado', whatsapp: celular(), requestKey: k };
      const [a, b] = await Promise.all([
        s24.clientes.register(est.userId, est.tenantId, dados),
        s24.clientes.register(est.userId, est.tenantId, dados),
      ]);
      expect(a.consumer.id).toBe(b.consumer.id);
      expect([a.repeated, b.repeated].sort()).toEqual([false, true]);
      expect(await contar(s24, est)).toBe(1);
    });

    it('mesma chave com telefones diferentes ao mesmo tempo: um cadastro e um 409 de chave', async () => {
      const est = await estabelecimento(s24);
      const k = chave();
      const resultados = await Promise.allSettled([
        s24.clientes.register(est.userId, est.tenantId, { name: 'Davi', whatsapp: celular(), requestKey: k }),
        s24.clientes.register(est.userId, est.tenantId, { name: 'Davi', whatsapp: celular(), requestKey: k }),
      ]);
      expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const falha = resultados.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(await recusa(Promise.reject(falha.reason))).toMatchObject({ status: 409, code: 'CHAVE_REUTILIZADA' });
      expect(await contar(s24, est)).toBe(1);
    });

    it('mesmo telefone ao mesmo tempo, sem a mesma chave: um cadastro e um 409 TELEFONE_EM_USO (nos dois schemas)', async () => {
      for (const amb of [s24, s25]) {
        const est = await estabelecimento(amb);
        const digitos = celular();
        const resultados = await Promise.allSettled([
          amb.clientes.register(est.userId, est.tenantId, { name: 'Eva', whatsapp: digitos, requestKey: chave() }),
          amb.clientes.register(est.userId, est.tenantId, { name: 'Eva', whatsapp: digitos }),
        ]);
        expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        const falha = resultados.find((r) => r.status === 'rejected') as PromiseRejectedResult;
        expect(await recusa(Promise.reject(falha.reason))).toMatchObject({ status: 409, code: 'TELEFONE_EM_USO' });
        expect(await contar(amb, est)).toBe(1);
      }
    });

    it('reenvio depois de unificar devolve o original (lápide) e o principal atual, sem criar nada', async () => {
      const est = await estabelecimento(s25);
      const k = chave();
      const dados = { name: 'Fábio', whatsapp: celular(), requestKey: k };
      const original = await s25.clientes.register(est.userId, est.tenantId, dados);
      const principal = await s25.clientes.register(est.userId, est.tenantId, { name: 'Fábio Ramos', whatsapp: celular() });
      await unificar(s25, est, original.consumer.id, principal.consumer.id);

      const repetido = await s25.clientes.register(est.userId, est.tenantId, dados);
      expect(repetido).toMatchObject({ repeated: true, consumer: { id: original.consumer.id }, principal: { id: principal.consumer.id } });
      expect(await contar(s25, est)).toBe(2);
    });
  });

  describe('edição', () => {
    it('troca de telefone mantém id e histórico; versão antiga: CLIENTE_ALTERADO; telefone de outro: TELEFONE_EM_USO; auditoria só com os campos', async () => {
      const est = await estabelecimento(s24);
      const cliente = await s24.clientes.create(est.userId, est.tenantId, { name: 'Gil', whatsapp: celular() });
      const outro = await s24.clientes.create(est.userId, est.tenantId, { name: 'Hugo', whatsapp: celular() });
      const passado = await agendamento(s24, est, cliente.id, { inicio: new Date('2026-01-05T13:00:00Z'), status: 'COMPLETED', nome: 'Gil' });

      const lida = await versao(s24, est, cliente.id);
      const novo = celular();
      const editado = await s24.clientes.update(est.userId, est.tenantId, cliente.id, { whatsapp: novo, expectedUpdatedAt: lida });
      expect(editado).toMatchObject({ id: cliente.id, whatsapp: novo });
      const [ag] = (await s24.ds.query(`SELECT consumer_id, consumer_name_snapshot FROM appointments WHERE id = $1`, [passado])) as {
        consumer_id: string;
        consumer_name_snapshot: string;
      }[];
      expect(ag).toEqual({ consumer_id: cliente.id, consumer_name_snapshot: 'Gil' });

      expect(await recusa(s24.clientes.update(est.userId, est.tenantId, cliente.id, { name: 'Gilberto', expectedUpdatedAt: lida }))).toMatchObject({
        status: 409,
        code: 'CLIENTE_ALTERADO',
      });
      expect(
        await recusa(
          s24.clientes.update(est.userId, est.tenantId, cliente.id, { whatsapp: outro.whatsapp, expectedUpdatedAt: editado.updatedAt }),
        ),
      ).toMatchObject({ status: 409, code: 'TELEFONE_EM_USO' });

      const auditoria = (await s24.ds.query(
        `SELECT new_data FROM audit_logs WHERE tenant_id = $1 AND action = 'CONSUMER_UPDATED'`,
        [est.tenantId],
      )) as { new_data: { consumerId: string; campos: string[] } }[];
      expect(auditoria).toEqual([{ new_data: { consumerId: cliente.id, campos: ['whatsapp'] } }]);
    });

    it('lápide não é editada (CLIENTE_UNIFICADO com o principal); outro estabelecimento: 404', async () => {
      const est = await estabelecimento(s25);
      const a = await s25.clientes.create(est.userId, est.tenantId, { name: 'Iara', whatsapp: celular() });
      const b = await s25.clientes.create(est.userId, est.tenantId, { name: 'Iara', whatsapp: celular() });
      const lida = await versao(s25, est, a.id);
      await unificar(s25, est, a.id, b.id);
      expect(await recusa(s25.clientes.update(est.userId, est.tenantId, a.id, { name: 'X', expectedUpdatedAt: lida }))).toMatchObject({
        status: 409,
        code: 'CLIENTE_UNIFICADO',
        principalId: b.id,
      });

      const alheio = await estabelecimento(s25);
      expect(await recusa(s25.clientes.update(alheio.userId, alheio.tenantId, b.id, { name: 'X', expectedUpdatedAt: lida }))).toMatchObject({
        status: 404,
      });
      expect(await recusa(s25.fichas.profile(alheio.userId, alheio.tenantId, b.id))).toMatchObject({ status: 404 });
      expect(await recusa(s25.fichas.history(alheio.userId, alheio.tenantId, b.id, { limit: 20 }))).toMatchObject({ status: 404 });
      expect(await recusa(s25.fichas.profile(alheio.userId, est.tenantId, b.id))).toMatchObject({ status: 404 });
    });
  });

  describe('ficha e histórico', () => {
    it('contagens "neste cadastro", último concluído, próximo, nomes usados e sugestões', async () => {
      const est = await estabelecimento(s24);
      const cliente = await s24.clientes.create(est.userId, est.tenantId, { name: 'João da Silva', whatsapp: '11987650001' });
      // Forma antiga do mesmo número (sem o 9) e mesmo nome com outro número.
      const parecido = await s24.clientes.create(est.userId, est.tenantId, { name: 'Jonas', whatsapp: '1187650001' });
      const xara = await s24.clientes.create(est.userId, est.tenantId, { name: 'JOAO  DA SILVA', whatsapp: celular() });
      const lapide = await s24.clientes.create(est.userId, est.tenantId, { name: 'João da Silva', whatsapp: celular() });
      await unificar(s24, est, lapide.id, xara.id);

      await agendamento(s24, est, cliente.id, { inicio: new Date('2026-01-05T13:00:00Z'), status: 'COMPLETED', nome: 'João da Silva' });
      const ultimo = await agendamento(s24, est, cliente.id, { inicio: new Date('2026-02-05T13:00:00Z'), status: 'COMPLETED', nome: 'Maria' });
      await agendamento(s24, est, cliente.id, { inicio: new Date('2026-03-05T13:00:00Z'), status: 'CANCELED', nome: 'joão  da silva' });
      await agendamento(s24, est, cliente.id, { inicio: new Date('2026-04-05T13:00:00Z'), status: 'NO_SHOW' });
      const proximo = await agendamento(s24, est, cliente.id, { inicio: new Date('2099-01-05T13:00:00Z'), status: 'CONFIRMED' });

      const ficha = await s24.fichas.profile(est.userId, est.tenantId, cliente.id);
      expect(ficha.resumo).toMatchObject({ total: 5, concluidos: 2, cancelados: 1, faltas: 1 });
      expect(ficha.resumo.ultimoConcluido).toMatchObject({ id: ultimo, professionalName: 'Ana Lima', services: ['Corte'] });
      expect(ficha.resumo.proximo).toMatchObject({ id: proximo });
      // Um por nome normalizado, na grafia mais recente.
      expect(ficha.nomesUsados).toEqual(['Cliente', 'joão  da silva', 'Maria']);
      expect(ficha.historicoPossivelmenteCompartilhado).toBe(true);
      expect(ficha.consumer.telefoneAgrupavel).toBe(true);
      const sugestoes = Object.fromEntries(ficha.outrosCadastros.map((o) => [o.id, o.relacoes]));
      expect(sugestoes).toEqual({ [parecido.id]: ['NUMERO_PARECIDO'], [xara.id]: ['MESMO_NOME'] });

      expect(await recusa(s24.fichas.profile(est.userId, est.tenantId, lapide.id))).toMatchObject({
        status: 409,
        code: 'CLIENTE_UNIFICADO',
        principalId: xara.id,
      });
    });

    it('histórico paginado do mais recente; recebimento só com o recurso contratado; centavos inteiros', async () => {
      const est = await estabelecimento(s24);
      const cliente = await s24.clientes.create(est.userId, est.tenantId, { name: 'Lia', whatsapp: celular() });
      const ids: string[] = [];
      for (let i = 0; i < 5; i += 1) {
        ids.push(await agendamento(s24, est, cliente.id, { inicio: new Date(Date.UTC(2026, 0, 10 + i, 13)), status: 'COMPLETED', preco: i === 4 ? null : 5000 }));
      }
      await s24.ds.query(
        `INSERT INTO appointment_payments (id, tenant_id, appointment_id, amount_cents, method, received_on, recorded_by_user_id, request_key)
         VALUES ($1, $2, $3, 4500, 'PIX', '2026-01-13', $4, $5)`,
        [generateId(), est.tenantId, ids[3], est.userId, chave()],
      );

      const vistos: string[] = [];
      let cursor: string | undefined;
      let primeiraPagina: Awaited<ReturnType<ConsumerProfileService['history']>> | undefined;
      do {
        const pagina = await s24.fichas.history(est.userId, est.tenantId, cliente.id, { limit: 2, cursor });
        primeiraPagina ??= pagina;
        vistos.push(...pagina.appointments.map((a) => a.id));
        cursor = pagina.nextCursor ?? undefined;
      } while (cursor);
      expect(vistos).toEqual([...ids].reverse());
      // Item sob consulta: total sob consulta. Recebimento da reserva 4.
      expect(primeiraPagina!.appointments[0]).toMatchObject({ id: ids[4], priceCents: null, payment: null, hidden: [] });
      expect(primeiraPagina!.appointments[1]).toMatchObject({
        id: ids[3],
        priceCents: 5000,
        payment: { amountCents: 4500, method: 'PIX', receivedOn: '2026-01-13', refunded: false },
      });

      // Sem o recurso de pagamentos: recebimento oculto, preço continua.
      await s24.ds.query(
        `INSERT INTO tenant_feature_overrides (id, tenant_id, feature_id, enabled)
         SELECT $1, $2, id, false FROM features WHERE key = 'PAGAMENTOS'`,
        [generateId(), est.tenantId],
      );
      const semRecurso = await s24.fichas.history(est.userId, est.tenantId, cliente.id, { limit: 2 });
      expect(semRecurso.appointments[1]).toMatchObject({ id: ids[3], priceCents: 5000, hidden: ['payment'] });
      expect(semRecurso.appointments[1]).not.toHaveProperty('payment');
    });
  });

  describe('lista agrupada', () => {
    it('relações, telefone inválido sozinho, lápide fora, "mesmo nome" e paginação com desempate', async () => {
      const est = await estabelecimento(s25);
      const ana1 = await s25.clientes.create(est.userId, est.tenantId, { name: 'Ana', whatsapp: '11987650002' });
      // Mesmo WhatsApp (schema 25, outra pessoa) e número parecido.
      await s25.ds.query(
        `INSERT INTO consumers (id, tenant_id, name, whatsapp, whatsapp_normalized) VALUES ($1, $2, 'Ana Filha', '11987650002', '+5511987650002')`,
        [generateId(), est.tenantId],
      );
      await s25.clientes.create(est.userId, est.tenantId, { name: 'Ana Antiga', whatsapp: '1187650002' });
      // Outro grupo com o MESMO menor nome ("ana"): desempate pela chave.
      const ana2 = await s25.clientes.create(est.userId, est.tenantId, { name: 'ana', whatsapp: celular() });
      // Telefone que o normalizador aceita mas não agrupa (DDD inválido).
      const invalido = await s25.clientes.create(est.userId, est.tenantId, { name: 'Bruno', whatsapp: '1012345678' });
      const lapide = { id: generateId() };
      await s25.ds.query(
        `INSERT INTO consumers (id, tenant_id, name, whatsapp, whatsapp_normalized) VALUES ($1, $2, 'Ana', '11987650002', '+5511987650002')`,
        [lapide.id, est.tenantId],
      );
      await unificar(s25, est, lapide.id, ana1.id);

      const grupos: Awaited<ReturnType<ConsumerProfileService['groups']>>['groups'] = [];
      let cursor: string | undefined;
      let total = 0;
      do {
        const pagina = await s25.fichas.groups(est.userId, est.tenantId, { limit: 1, cursor });
        grupos.push(...pagina.groups);
        total = pagina.total;
        cursor = pagina.nextCursor ?? undefined;
      } while (cursor);
      expect(total).toBe(3);
      expect(grupos).toHaveLength(3);
      expect(new Set(grupos.map((g) => g.chave)).size).toBe(3);

      const doTelefone = grupos.find((g) => g.membros.some((m) => m.id === ana1.id))!;
      expect(doTelefone.membros.map((m) => [m.name, m.relacoes])).toEqual([
        ['Ana', ['MESMO_TELEFONE', 'NUMERO_PARECIDO']],
        ['Ana Antiga', ['NUMERO_PARECIDO']],
        ['Ana Filha', ['MESMO_TELEFONE', 'NUMERO_PARECIDO']],
      ]);
      expect(doTelefone.membros.find((m) => m.id === ana1.id)!.mesmoNome).toBe(1); // "ana" do outro grupo
      expect(doTelefone.membros.some((m) => m.id === lapide.id)).toBe(false);
      const sozinho = grupos.find((g) => g.membros.some((m) => m.id === invalido.id))!;
      expect(sozinho.membros).toHaveLength(1);
      expect(grupos.find((g) => g.membros.some((m) => m.id === ana2.id))!.membros).toHaveLength(1);

      // A busca casa um membro e devolve o grupo inteiro.
      const busca = await s25.fichas.groups(est.userId, est.tenantId, { limit: 20, q: 'Antiga' });
      expect(busca.groups).toHaveLength(1);
      expect(busca.groups[0].membros).toHaveLength(3);
    });

    it('nome igual em outro estabelecimento nunca aparece', async () => {
      const a = await estabelecimento(s24);
      const b = await estabelecimento(s24);
      await s24.clientes.create(a.userId, a.tenantId, { name: 'Zé Único', whatsapp: celular() });
      const deB = await s24.clientes.create(b.userId, b.tenantId, { name: 'Zé Único', whatsapp: celular() });
      const lista = await s24.fichas.groups(b.userId, b.tenantId, { limit: 20 });
      expect(lista.groups.flatMap((g) => g.membros.map((m) => [m.id, m.mesmoNome]))).toEqual([[deB.id, 0]]);
      expect((await s24.fichas.profile(b.userId, b.tenantId, deB.id)).outrosCadastros).toEqual([]);
    });
  });

  describe('agendamento público', () => {
    it('schema 24: correspondência única reaproveita; outro nome fica no cadastro do telefone, sem mudar o nome', async () => {
      const est = await estabelecimento(s24);
      const digitos = celular();
      const cliente = await s24.clientes.create(est.userId, est.tenantId, { name: 'Marta Dias', whatsapp: digitos });
      expect(await clientePublico(s24, est, '  marta   DIAS ', digitos)).toBe(cliente.id);
      expect(await clientePublico(s24, est, 'Pedro Dias', digitos)).toBe(cliente.id);
      const [linha] = (await s24.ds.query(`SELECT name FROM consumers WHERE id = $1`, [cliente.id])) as { name: string }[];
      expect(linha.name).toBe('Marta Dias');
      expect(await contar(s24, est)).toBe(1);
      const novo = await clientePublico(s24, est, 'Pedro Dias', celular());
      expect(novo).not.toBe(cliente.id);
    });

    it('schema 25: outro nome cria; 9º dígito cria; ambiguidade cria um terceiro sem escolher; lápide nunca é escolhida', async () => {
      const est = await estabelecimento(s25);
      const cliente = await s25.clientes.create(est.userId, est.tenantId, { name: 'Nina', whatsapp: '11987650003' });
      const outroNome = await clientePublico(s25, est, 'Otávio', '11987650003');
      expect(outroNome).not.toBe(cliente.id);
      const semNove = await clientePublico(s25, est, 'Nina', '1187650003');
      expect(semNove).not.toBe(cliente.id);

      // Dois "Nina" no mesmo telefone: ambíguo.
      const segunda = generateId();
      await s25.ds.query(
        `INSERT INTO consumers (id, tenant_id, name, whatsapp, whatsapp_normalized) VALUES ($1, $2, 'NINA', '11987650003', '+5511987650003')`,
        [segunda, est.tenantId],
      );
      const terceira = await clientePublico(s25, est, 'Nina', '11987650003');
      expect([cliente.id, segunda]).not.toContain(terceira);

      // Unificadas duas das três, sobra uma correspondência única.
      await unificar(s25, est, segunda, cliente.id);
      await unificar(s25, est, terceira, cliente.id);
      expect(await clientePublico(s25, est, 'nina', '11987650003')).toBe(cliente.id);
    });

    it('vínculo pela agenda com cadastro unificado: 409 CLIENTE_UNIFICADO com o principal', async () => {
      const est = await estabelecimento(s25);
      const a = await s25.clientes.create(est.userId, est.tenantId, { name: 'Olga', whatsapp: celular() });
      const b = await s25.clientes.create(est.userId, est.tenantId, { name: 'Olga', whatsapp: celular() });
      await unificar(s25, est, a.id, b.id);
      expect(await recusa(s25.ds.transaction((tx) => s25.clientes.findForLink(tx, est.tenantId, a.id)))).toMatchObject({
        status: 409,
        code: 'CLIENTE_UNIFICADO',
        principalId: b.id,
      });
      expect(await s25.ds.transaction((tx) => s25.clientes.findForLink(tx, est.tenantId, b.id))).toMatchObject({ id: b.id });
    });
  });

  describe('preferências de mensagem por telefone', () => {
    async function evento(amb: Ambiente, est: Est, telefone: string, kind: 'OPT_IN' | 'OPT_OUT', quando: string, consumerId?: string) {
      await amb.ds.query(
        `INSERT INTO whatsapp_consent_events (tenant_id, whatsapp_normalized, kind, source, occurred_at, consumer_id)
         VALUES ($1, $2, $3, 'TESTE', $4, $5)`,
        [est.tenantId, telefone, kind, quando, consumerId ?? null],
      );
    }
    const atual = async (amb: Ambiente, est: Est, telefone: string) =>
      ((await amb.ds.query(`SELECT whatsapp_consent_current($1, $2) AS k`, [est.tenantId, telefone])) as { k: string | null }[])[0].k;

    it('trocar o telefone não leva a autorização; o opt-out do número antigo continua valendo para quem passar a usá-lo', async () => {
      const est = await estabelecimento(s24);
      const antigo = celular();
      const cliente = await s24.clientes.create(est.userId, est.tenantId, { name: 'Pia', whatsapp: antigo });
      await evento(s24, est, normalizado(antigo), 'OPT_IN', '2026-01-01T10:00:00Z', cliente.id);
      await evento(s24, est, normalizado(antigo), 'OPT_OUT', '2026-02-01T10:00:00Z', cliente.id);

      const novo = celular();
      await s24.clientes.update(est.userId, est.tenantId, cliente.id, { whatsapp: novo, expectedUpdatedAt: await versao(s24, est, cliente.id) });
      expect(await atual(s24, est, normalizado(novo))).toBeNull();

      const outro = await s24.clientes.create(est.userId, est.tenantId, { name: 'Quim', whatsapp: antigo });
      expect(outro.id).not.toBe(cliente.id);
      expect(await atual(s24, est, normalizado(antigo))).toBe('OPT_OUT');
    });

    it('telefone compartilhado: o opt-out registrado por um vale para o número; empate de horário: opt-out vence; lápide continua bloqueando', async () => {
      const est = await estabelecimento(s25);
      const digitos = celular();
      const tel = normalizado(digitos);
      const a = await s25.clientes.create(est.userId, est.tenantId, { name: 'Rui', whatsapp: digitos });
      const b = generateId();
      await s25.ds.query(`INSERT INTO consumers (id, tenant_id, name, whatsapp, whatsapp_normalized) VALUES ($1, $2, 'Rita', $3, $4)`, [
        b,
        est.tenantId,
        digitos,
        tel,
      ]);
      await evento(s25, est, tel, 'OPT_IN', '2026-01-01T10:00:00Z', a.id);
      expect(await atual(s25, est, tel)).toBe('OPT_IN');
      await evento(s25, est, tel, 'OPT_OUT', '2026-01-02T10:00:00Z', b);
      expect(await atual(s25, est, tel)).toBe('OPT_OUT');

      await evento(s25, est, tel, 'OPT_IN', '2026-01-03T10:00:00Z', a.id);
      await evento(s25, est, tel, 'OPT_OUT', '2026-01-03T10:00:00Z', b);
      expect(await atual(s25, est, tel)).toBe('OPT_OUT');

      // Unificar não mexe nos eventos: o número da lápide segue bloqueado.
      await unificar(s25, est, b, a.id);
      expect(await atual(s25, est, tel)).toBe('OPT_OUT');

      // Isolamento: outro estabelecimento não vê o evento.
      const alheio = await estabelecimento(s25);
      expect(await atual(s25, alheio, tel)).toBeNull();
    });
  });

  describe('contrato do web publicado (0d8f479) nos schemas 24 e 25', () => {
    it('busca, listagem, cadastro e o 409 de telefone em uso continuam na forma que o web publicado aceita; lápide some da lista', async () => {
      for (const amb of [s24, s25]) {
        const est = await estabelecimento(amb);
        const digitos = celular();
        // O web publicado não manda requestKey: o controller devolve o
        // resultado do serviço como corpo.
        const cadastro = await amb.clientes.register(est.userId, est.tenantId, { name: 'Sara Web', whatsapp: digitos });
        expect(cadastroAceito(cadastro)).toBe(true);
        const segundo = await amb.clientes.register(est.userId, est.tenantId, { name: 'Sara Web', whatsapp: celular() });

        const busca = { consumers: await amb.clientes.search(est.userId, est.tenantId, 'Sara') };
        expect(buscaAceita(busca)).toBe(true);
        const pagina = await amb.clientes.listPage(est.userId, est.tenantId, { limit: 20 });
        expect(paginaAceita(pagina)).toBe(true);
        expect(pagina.total).toBe(2);

        let corpo: unknown;
        let status = 0;
        try {
          await amb.clientes.register(est.userId, est.tenantId, { name: 'Outra', whatsapp: digitos });
        } catch (e) {
          status = (e as HttpException).getStatus();
          corpo = (e as HttpException).getResponse();
        }
        expect(falhaDoWebAnterior(status, corpo)).toEqual({
          tipo: 'duplicado',
          mensagem: 'Já existe um cliente com este WhatsApp neste estabelecimento. Busque por ele em vez de cadastrar de novo.',
        });

        await unificar(amb, est, segundo.consumer.id, cadastro.consumer.id);
        const depois = await amb.clientes.listPage(est.userId, est.tenantId, { limit: 20 });
        expect(depois.consumers.map((c) => c.id)).toEqual([cadastro.consumer.id]);
        expect((await amb.clientes.search(est.userId, est.tenantId, 'Sara')).map((c) => c.id)).toEqual([cadastro.consumer.id]);
      }
    });
  });
});
