// Migrations dos clientes (23 ConsumerAuditActions, 24 ConsumerIdentity e 25
// ConsumerSharedPhone) com
// o runtime COMPILADO (`dist-migrations`, o mesmo do CI e do piloto), cada
// cenário num banco TEMPORÁRIO próprio, criado e apagado aqui:
// 1. atualização a partir das 22, com clientes já gravados: chaves geradas,
//    backfill das preferências (telefone e data da própria coluna), UNIQUE
//    antigo mantido, gatilhos e índices; também pelo caminho do piloto (uma
//    por vez);
// 2. regra única da chave de telefone e da chave de nome;
// 3. retorno (`down`) só sem dados novos; com dados novos, recusa;
// 4. a 25 a partir da 24 com dados: o UNIQUE de telefone sai, o mesmo
//    telefone passa a aceitar outro cadastro; o retorno recusa com telefone
//    repetido.
// Nenhum dado real: nomes e telefones fictícios.
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { Client } from 'pg';
import { DataSource } from 'typeorm';
import { CONSUMER_MERGED_SQLSTATE, INSERT_ONLY_SQLSTATE } from '../src/migrations/1794268800000-ConsumerIdentity.js';

const url = process.env.DB_E2E_DIRECT_URL;
if (url && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)) {
  throw new Error('Este teste exige PostgreSQL descartável local.');
}
const FONTE_COMPILADA = new URL('../dist-migrations/database/migrations-data-source.js', import.meta.url);
const ULTIMA_ANTES = 'StockModule1794096000000';
const ENUMS = 'ConsumerAuditActions1794182400000';
const IDENTIDADE = 'ConsumerIdentity1794268800000';
const TELEFONE_COMPARTILHADO = 'ConsumerSharedPhone1794355200000';

type Opcoes = ConstructorParameters<typeof DataSource>[0];

describe.skipIf(!url)('migrations dos clientes contra PostgreSQL descartável (bancos temporários)', () => {
  const criados: string[] = [];
  let construirOpcoes: (u: string) => Opcoes;

  const urlDe = (banco: string) => {
    const u = new URL(url!);
    u.pathname = `/${banco}`;
    return u.toString();
  };

  async function comCliente<T>(alvo: string, fn: (client: Client) => Promise<T>): Promise<T> {
    const client = new Client({ connectionString: alvo, ssl: { rejectUnauthorized: true } });
    await client.connect();
    try {
      return await fn(client);
    } finally {
      await client.end();
    }
  }

  async function novoBanco(): Promise<string> {
    const banco = `clientes_mig_${randomUUID().replaceAll('-', '').slice(0, 14)}`;
    await comCliente(url!, (c) => c.query(`CREATE DATABASE "${banco}"`));
    criados.push(banco);
    return banco;
  }

  async function comDataSource<T>(banco: string, fn: (ds: DataSource) => Promise<T>): Promise<T> {
    const ds = new DataSource({ ...construirOpcoes(urlDe(banco)), logging: false } as Opcoes);
    await ds.initialize();
    try {
      return await fn(ds);
    } finally {
      await ds.destroy();
    }
  }

  /** Roda as migrations compiladas (todas, ou até `ate`, inclusive). */
  function migrar(banco: string, ate?: string) {
    return comDataSource(banco, async (ds) => {
      if (ate) {
        const nomes = ds.migrations.map((m) => m.name ?? m.constructor.name);
        ds.migrations.splice(nomes.indexOf(ate) + 1);
      }
      return ds.runMigrations({ transaction: 'each' });
    });
  }

  const q = <T>(banco: string, sql: string, params: unknown[] = []) =>
    comCliente(urlDe(banco), async (c) => (await c.query(sql, params)).rows as T[]);

  async function erroDe(banco: string, sql: string, params: unknown[] = []): Promise<{ code?: string; detail?: string }> {
    try {
      await q(banco, sql, params);
    } catch (e) {
      return e as { code?: string; detail?: string };
    }
    throw new Error('era esperado erro');
  }

  /** Estabelecimento com unidade, profissional e dono, por SQL (schema 22). */
  async function semear(banco: string) {
    const [plano] = await q<{ id: string }>(banco, `SELECT id FROM plans ORDER BY id LIMIT 1`);
    await q(banco, `INSERT INTO tenants (id, slug, category, timezone, plan_id) VALUES ('t1', 'mig-clientes', 'OTHER', 'America/Sao_Paulo', $1)`, [
      plano.id,
    ]);
    await q(banco, `INSERT INTO units (id, tenant_id, name, address, timezone) VALUES ('u1', 't1', 'Unidade', '', 'America/Sao_Paulo')`);
    await q(
      banco,
      `INSERT INTO professionals (id, tenant_id, name, avatar_initials, avatar_color) VALUES ('p1', 't1', 'Ana', 'AN', '#000')`,
    );
    await q(banco, `INSERT INTO users (id, name, email) VALUES ('us1', 'Dono', 'dono-mig@example.test')`);
    const clientes: [string, string, string, string | null, string | null, string | null][] = [
      // id, nome, telefone normalizado, opt-in, origem, opt-out
      ['c1', 'João  da Silva', '+5511987654321', '2026-01-10T10:00:00Z', 'BALCAO', null],
      ['c2', 'JOAO DA SILVA', '+551187654321', null, null, '2026-02-01T10:00:00Z'],
      ['c3', 'Maria', '+55011987650000', '2026-01-01T10:00:00Z', null, '2026-03-01T10:00:00Z'],
      ['c4', 'Pedro', '+5511933334444', null, null, null],
      ['c5', 'Paula', '+551133334444', null, null, null],
      ['c6', 'Inválido', '+5511123', null, null, null],
    ];
    for (const [id, nome, telefone, optIn, origem, optOut] of clientes) {
      await q(
        banco,
        `INSERT INTO consumers (id, tenant_id, name, whatsapp, whatsapp_normalized, whatsapp_opt_in_at, whatsapp_opt_in_source, whatsapp_opt_out_at)
         VALUES ($1, 't1', $2, $3, $3, $4, $5, $6)`,
        [id, nome, telefone, optIn, origem, optOut],
      );
    }
  }

  beforeAll(async () => {
    if (!existsSync(FONTE_COMPILADA)) throw new Error('Rode `npm run build:migrations-runtime` antes deste teste.');
    ({ buildMigrationsDataSourceOptions: construirOpcoes } = (await import(FONTE_COMPILADA.href)) as {
      buildMigrationsDataSourceOptions: (u: string) => Opcoes;
    });
  });

  afterAll(async () => {
    for (const banco of criados) {
      await comCliente(url!, (c) => c.query(`DROP DATABASE IF EXISTS "${banco}" WITH (FORCE)`));
    }
  });

  it('1. das 22 com clientes gravados: chaves, preferências por telefone, UNIQUE antigo, gatilhos e índices', async () => {
    const banco = await novoBanco();
    await migrar(banco, ULTIMA_ANTES);
    await semear(banco);
    const aplicadas = await migrar(banco, IDENTIDADE);
    expect(aplicadas.map((m) => m.name)).toEqual([ENUMS, IDENTIDADE]);

    const enums = await q<{ v: string }>(banco, `SELECT unnest(enum_range(NULL::audit_action))::text AS v`);
    expect(enums.map((e) => e.v)).toEqual(expect.arrayContaining(['CONSUMER_UPDATED', 'CONSUMER_MERGED']));

    const chaves = await q<{ id: string; name_key: string; phone_match_key: string | null; updated_at: Date }>(
      banco,
      `SELECT id, name_key, phone_match_key, updated_at FROM consumers ORDER BY id`,
    );
    expect(chaves.map(({ id, name_key, phone_match_key }) => [id, name_key, phone_match_key])).toEqual([
      ['c1', 'joao da silva', '+551187654321'],
      ['c2', 'joao da silva', '+551187654321'],
      ['c3', 'maria', '+551187650000'],
      ['c4', 'pedro', '+5511933334444'],
      ['c5', 'paula', '+551133334444'],
      ['c6', 'invalido', null],
    ]);
    expect(chaves.every((c) => c.updated_at instanceof Date)).toBe(true);

    // Cada coluna antiga preenchida virou UM evento, com o telefone da linha e
    // a data da própria coluna (nunca updated_at).
    const eventos = await q<{ whatsapp_normalized: string; kind: string; source: string; occurred_at: Date; consumer_id: string }>(
      banco,
      `SELECT whatsapp_normalized, kind, source, occurred_at, consumer_id FROM whatsapp_consent_events ORDER BY consumer_id, occurred_at`,
    );
    expect(eventos.map((e) => [e.consumer_id, e.whatsapp_normalized, e.kind, e.source, e.occurred_at.toISOString()])).toEqual([
      ['c1', '+5511987654321', 'OPT_IN', 'BALCAO', '2026-01-10T10:00:00.000Z'],
      ['c2', '+551187654321', 'OPT_OUT', 'LEGADO', '2026-02-01T10:00:00.000Z'],
      ['c3', '+55011987650000', 'OPT_IN', 'LEGADO', '2026-01-01T10:00:00.000Z'],
      ['c3', '+55011987650000', 'OPT_OUT', 'LEGADO', '2026-03-01T10:00:00.000Z'],
    ]);
    const atual = await q<{ c1: string | null; c3: string | null; c4: string | null }>(
      banco,
      `SELECT whatsapp_consent_current('t1', '+5511987654321') AS c1,
              whatsapp_consent_current('t1', '+55011987650000') AS c3,
              whatsapp_consent_current('t1', '+5511933334444') AS c4`,
    );
    expect(atual[0]).toEqual({ c1: 'OPT_IN', c3: 'OPT_OUT', c4: null });

    // O UNIQUE antigo continua: a API anterior segue com o mesmo contrato.
    const repetido = await erroDe(
      banco,
      `INSERT INTO consumers (id, tenant_id, name, whatsapp, whatsapp_normalized) VALUES ('c9', 't1', 'Outro', 'x', '+5511987654321')`,
    );
    expect(repetido.code).toBe('23505');

    // Tabelas só de inserção.
    expect((await erroDe(banco, `UPDATE whatsapp_consent_events SET source = 'X'`)).code).toBe(INSERT_ONLY_SQLSTATE);
    await q(
      banco,
      `INSERT INTO consumer_create_requests (tenant_id, request_key, request_fingerprint, consumer_id) VALUES ('t1', 'k1', $1, 'c1')`,
      ['a'.repeat(64)],
    );
    expect((await erroDe(banco, `UPDATE consumer_create_requests SET consumer_id = 'c2'`)).code).toBe(INSERT_ONLY_SQLSTATE);

    // Lápide: nenhum agendamento novo nem troca de cliente para ela, por
    // qualquer caminho (inclusive SQL direto, como o código antigo faria).
    await q(banco, `UPDATE consumers SET merged_into_consumer_id = 'c1', merged_at = now(), merged_by_user_id = 'us1' WHERE id = 'c2'`);
    const novoAgendamento = (id: string, cliente: string) =>
      erroDe(
        banco,
        `INSERT INTO appointments (id, tenant_id, unit_id, consumer_id, consumer_name_snapshot, consumer_whatsapp_snapshot, professional_id, start_at, end_at)
         VALUES ($1, 't1', 'u1', $2, 'Nome', 'x', 'p1', '2027-01-01T10:00:00Z', '2027-01-01T10:30:00Z')`,
        [id, cliente],
      );
    const recusa = await novoAgendamento('a1', 'c2');
    expect(recusa).toMatchObject({ code: CONSUMER_MERGED_SQLSTATE, detail: 'c1' });
    await q(
      banco,
      `INSERT INTO appointments (id, tenant_id, unit_id, consumer_id, consumer_name_snapshot, consumer_whatsapp_snapshot, professional_id, start_at, end_at)
       VALUES ('a2', 't1', 'u1', 'c1', 'Nome', 'x', 'p1', '2027-01-02T10:00:00Z', '2027-01-02T10:30:00Z')`,
    );
    expect((await erroDe(banco, `UPDATE appointments SET consumer_id = 'c2' WHERE id = 'a2'`)).code).toBe(CONSUMER_MERGED_SQLSTATE);
    // Atualizar outra coluna de um agendamento já existente não é barrado.
    await q(banco, `UPDATE appointments SET notes = 'ok' WHERE id = 'a2'`);

    // Integridade da lápide.
    expect((await erroDe(banco, `UPDATE consumers SET merged_into_consumer_id = id, merged_at = now(), merged_by_user_id = 'us1' WHERE id = 'c4'`)).code).toBe('23514');
    expect((await erroDe(banco, `UPDATE consumers SET merged_into_consumer_id = 'c1' WHERE id = 'c5'`)).code).toBe('23514');

    const indices = await q<{ indexname: string }>(
      banco,
      `SELECT indexname FROM pg_indexes WHERE indexname IN ('idx_consumers_tenant_phone_match_active', 'idx_consumers_tenant_whatsapp_name_active',
         'idx_consumers_tenant_name_key_active', 'idx_appointments_tenant_consumer_start', 'idx_whatsapp_consent_events_phone') ORDER BY 1`,
    );
    expect(indices).toHaveLength(5);
  }, 120_000);

  it('2. regra única da chave de telefone e da chave de nome', async () => {
    const banco = await novoBanco();
    await migrar(banco);
    const casos: [string, string | null][] = [
      ['+5511987654321', '+551187654321'], // celular com 9 (2º dígito 6-9): sem o 9
      ['+551187654321', '+551187654321'], // forma antiga de 8 dígitos: a mesma chave
      ['+5511933334444', '+5511933334444'], // 9 seguido de 0-5: o próprio número
      ['+551133334444', '+551133334444'], // fixo: não colide com o celular acima
      ['+55011987654321', '+551187654321'], // DDD com zero: tira o zero
      ['+5521987654321', '+552187654321'], // outro DDD: outra chave
      ['+5511123', null], // curto
      ['+55119876543210', null], // longo
      ['+5510987654321', null], // DDD com 0
      ['+551112345678', null], // 8 dígitos começando com 1
      ['+14155550100', '+14155550100'], // fora do Brasil
    ];
    const linhas = await q<{ t: string; k: string | null }>(
      banco,
      `SELECT t, consumer_phone_match_key(t) AS k FROM unnest($1::text[]) AS t`,
      [casos.map(([t]) => t)],
    );
    expect(linhas.map((l) => [l.t, l.k])).toEqual(casos);

    const nomes = await q<{ a: string; b: string; c: string }>(
      banco,
      `SELECT consumer_name_key($1) AS a, consumer_name_key($2) AS b, consumer_name_key($3) AS c`,
      ['  JOÃO   da  Silva  ', 'Ângela Muñoz Çé Ýá', 'Ana\tMaria'],
    );
    expect(nomes[0]).toEqual({ a: 'joao da silva', b: 'angela munoz ce ya', c: 'ana maria' });
  }, 120_000);

  it('3. retorno: sem dados novos, a 24 desfaz; com pedido de cadastro gravado, recusa', async () => {
    const banco = await novoBanco();
    await migrar(banco, IDENTIDADE);
    await comDataSource(banco, (ds) => ds.undoLastMigration({ transaction: 'each' }));
    const colunas = await q<{ column_name: string }>(
      banco,
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'consumers' AND column_name IN ('name_key', 'merged_into_consumer_id')`,
    );
    expect(colunas).toEqual([]);

    await migrar(banco, IDENTIDADE);
    await semear(banco);
    await q(
      banco,
      `INSERT INTO consumer_create_requests (tenant_id, request_key, request_fingerprint, consumer_id) VALUES ('t1', 'k1', $1, 'c1')`,
      ['b'.repeat(64)],
    );
    await expect(comDataSource(banco, (ds) => ds.undoLastMigration({ transaction: 'each' }))).rejects.toThrow(/só para frente/);
    const [ainda] = await q<{ n: number }>(banco, `SELECT count(*)::int AS n FROM consumer_create_requests`);
    expect(ainda.n).toBe(1);
  }, 120_000);

  it('4. a 25 a partir da 24 com dados: sai o UNIQUE de telefone; o retorno recusa com telefone repetido', async () => {
    const banco = await novoBanco();
    await migrar(banco, IDENTIDADE);
    await semear(banco);
    expect((await migrar(banco, TELEFONE_COMPARTILHADO)).map((m) => m.name)).toEqual([TELEFONE_COMPARTILHADO]);
    const restricoes = async () =>
      (await q<{ conname: string }>(banco, `SELECT conname FROM pg_constraint WHERE conname IN ('uq_consumers_tenant_whatsapp', 'uq_consumers_tenant_id') ORDER BY 1`)).map(
        (r) => r.conname,
      );
    expect(await restricoes()).toEqual(['uq_consumers_tenant_id']);
    // Outra pessoa no mesmo telefone: aceito pelo banco (a aplicação decide).
    await q(banco, `INSERT INTO consumers (id, tenant_id, name, whatsapp, whatsapp_normalized) VALUES ('c9', 't1', 'Filho', 'x', '+5511987654321')`);
    const [chave] = await q<{ phone_match_key: string }>(banco, `SELECT phone_match_key FROM consumers WHERE id = 'c9'`);
    expect(chave.phone_match_key).toBe('+551187654321');

    await expect(comDataSource(banco, (ds) => ds.undoLastMigration({ transaction: 'each' }))).rejects.toThrow(/só para frente/);
    expect(await restricoes()).toEqual(['uq_consumers_tenant_id']);
    await q(banco, `DELETE FROM consumers WHERE id = 'c9'`);
    await comDataSource(banco, (ds) => ds.undoLastMigration({ transaction: 'each' }));
    expect(await restricoes()).toEqual(['uq_consumers_tenant_id', 'uq_consumers_tenant_whatsapp']);
    expect((await migrar(banco, TELEFONE_COMPARTILHADO)).map((m) => m.name)).toEqual([TELEFONE_COMPARTILHADO]);
  }, 120_000);
});
