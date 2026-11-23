// Migrations do estoque (21 StockEnumValues e 22 StockModule) com o runtime
// COMPILADO (`dist-migrations`, o mesmo do CI e do piloto), cada cenário num
// banco TEMPORÁRIO próprio, criado e apagado aqui. O estado é sempre conferido
// por uma conexão NOVA depois de cada execução (o que ficou persistido, não o
// que a transação via):
// 1. banco novo: as 22 no modo `each` do DataSource de migrations;
// 2. atualização a partir das 20, com nome, descrição e preço editados no
//    catálogo: ficam idênticos; também pelo caminho do piloto (uma por vez);
// 3. falha da 22 seguida de retomada: a 21 fica confirmada, a 22 é desfeita
//    por inteiro, e a segunda execução aplica só a 22;
// 4. modo `all` com as duas pendentes: a 22 para com a mensagem clara e
//    nada fica gravado (nem os valores de enum).
// Cada cenário migra até a 22 (`ate: MODULO`): as migrations posteriores
// têm o próprio teste (consumer-migrations.db-e2e-spec.ts).
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { Client } from 'pg';
import { DataSource } from 'typeorm';

const url = process.env.DB_E2E_DIRECT_URL;
if (url && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)) {
  throw new Error('Este teste exige PostgreSQL descartável local.');
}
const FONTE_COMPILADA = new URL('../dist-migrations/database/migrations-data-source.js', import.meta.url);
const ULTIMA_ANTES = 'CatalogItemEdit1793923200000';
const ENUMS = 'StockEnumValues1794009600000';
const MODULO = 'StockModule1794096000000';

type Opcoes = ConstructorParameters<typeof DataSource>[0];

describe.skipIf(!url)('migrations do estoque contra PostgreSQL descartável (bancos temporários)', () => {
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
    const banco = `estoque_mig_${randomUUID().replaceAll('-', '').slice(0, 14)}`;
    await comCliente(url!, (c) => c.query(`CREATE DATABASE "${banco}"`));
    criados.push(banco);
    return banco;
  }

  /** Roda as migrations compiladas (todas, ou até `ate`, inclusive). */
  async function migrar(banco: string, opcoes: { ate?: string; transaction?: 'all' | 'each'; viaDataSource?: boolean } = {}) {
    const ds = new DataSource({ ...construirOpcoes(urlDe(banco)), logging: false } as Opcoes);
    await ds.initialize();
    try {
      if (opcoes.ate) {
        const nomes = ds.migrations.map((m) => m.name ?? m.constructor.name);
        ds.migrations.splice(nomes.indexOf(opcoes.ate) + 1);
      }
      // Sem `transaction`, vale o `migrationsTransactionMode` do DataSource
      // (o que o CLI usa); o TypeORM 1.x lê a opção quando não há override.
      return opcoes.viaDataSource
        ? await ds.runMigrations()
        : await ds.runMigrations({ transaction: opcoes.transaction ?? 'each' });
    } finally {
      await ds.destroy();
    }
  }

  interface Estado {
    migrations: string[];
    enums: string[];
    tabelas: string[];
    feature: number;
    estoque: { name: string; description: string; feature_key: string | null; availability: string };
    precos: number;
    overrides: number;
    planFeatures: number;
  }

  /** Estado persistido, lido por conexão nova. */
  const estado = (banco: string): Promise<Estado> =>
    comCliente(urlDe(banco), async (c) => {
      const um = async <T>(sql: string) => (await c.query(sql)).rows[0] as T;
      const migrations = (await c.query<{ name: string }>('SELECT name FROM typeorm_migrations ORDER BY id')).rows.map((r) => r.name);
      const enums = (
        await c.query<{ valor: string }>(
          `SELECT t.typname || '.' || e.enumlabel AS valor FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
            WHERE e.enumlabel IN ('ESTOQUE', 'ESTOQUE_VISUALIZAR', 'ESTOQUE_GERENCIAR', 'STOCK_CATEGORY_CHANGED', 'STOCK_PRODUCT_CHANGED')
            ORDER BY 1`,
        )
      ).rows.map((r) => r.valor);
      const tabelas = (
        await c.query<{ t: string }>(`SELECT tablename AS t FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'stock_%' ORDER BY 1`)
      ).rows.map((r) => r.t);
      return {
        migrations,
        enums,
        tabelas,
        feature: (await um<{ n: number }>(`SELECT count(*)::int AS n FROM features WHERE id = 'feat_estoque'`)).n,
        estoque: await um(`SELECT name, description, feature_key, availability FROM addon_modules WHERE code = 'ESTOQUE'`),
        precos: (await um<{ n: number }>(`SELECT count(*)::int AS n FROM addon_module_prices WHERE module_code = 'ESTOQUE'`)).n,
        overrides: (await um<{ n: number }>(`SELECT count(*)::int AS n FROM tenant_feature_overrides WHERE feature_id = 'feat_estoque'`)).n,
        planFeatures: (await um<{ n: number }>(`SELECT count(*)::int AS n FROM plan_features WHERE feature_id = 'feat_estoque'`)).n,
      };
    });

  const TODOS_OS_ENUMS = [
    'audit_action.STOCK_CATEGORY_CHANGED',
    'audit_action.STOCK_PRODUCT_CHANGED',
    'feature_key.ESTOQUE',
    'permission.ESTOQUE_GERENCIAR',
    'permission.ESTOQUE_VISUALIZAR',
  ];
  const TODAS_AS_TABELAS = ['stock_categories', 'stock_count_items', 'stock_counts', 'stock_movements', 'stock_products', 'stock_subcategories'];

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

  it('1. banco novo: as 22 no modo do DataSource (each); enums, tabelas e adicional disponível, sem ligar ninguém', async () => {
    const banco = await novoBanco();
    const aplicadas = await migrar(banco, { ate: MODULO, viaDataSource: true });
    expect(aplicadas.map((m) => m.name).slice(-2)).toEqual([ENUMS, MODULO]);
    const e = await estado(banco);
    expect(e.migrations).toHaveLength(22);
    expect(e.enums).toEqual(TODOS_OS_ENUMS);
    expect(e.tabelas).toEqual(TODAS_AS_TABELAS);
    expect(e.feature).toBe(1);
    expect(e.estoque).toMatchObject({ feature_key: 'ESTOQUE', availability: 'AVAILABLE', name: 'Controle de estoque' });
    expect([e.overrides, e.planFeatures, e.precos]).toEqual([0, 0, 0]);
  }, 180_000);

  it('2. atualização a partir das 20: nome, descrição e preço editados ficam idênticos (também uma por vez)', async () => {
    for (const umaPorVez of [false, true]) {
      const banco = await novoBanco();
      await migrar(banco, { ate: ULTIMA_ANTES });
      await comCliente(urlDe(banco), async (c) => {
        const usuario = randomUUID().replaceAll('-', '').slice(0, 24);
        await c.query(`INSERT INTO users (id, name, email, status, email_verified) VALUES ($1, 'Operador', $2, 'ACTIVE', true)`, [
          usuario,
          `${usuario}@example.test`,
        ]);
        await c.query(`UPDATE addon_modules SET name = 'Estoque do salão', description = 'Texto editado no portal.' WHERE code = 'ESTOQUE'`);
        await c.query(
          `INSERT INTO addon_module_prices (id, module_code, amount_cents, recorded_by_user_id, request_key) VALUES ($1, 'ESTOQUE', 1990, $2, 'preco-estoque')`,
          [randomUUID().replaceAll('-', '').slice(0, 24), usuario],
        );
      });
      const antes = await estado(banco);
      expect(antes.migrations).toHaveLength(20);
      expect(antes.estoque).toMatchObject({ feature_key: null, availability: 'PLANNED' });
      if (umaPorVez) {
        expect((await migrar(banco, { ate: ENUMS, transaction: 'all' })).map((m) => m.name)).toEqual([ENUMS]);
        const meio = await estado(banco);
        expect(meio.migrations.at(-1)).toBe(ENUMS);
        expect(meio.enums).toEqual(TODOS_OS_ENUMS);
        expect(meio.tabelas).toEqual([]);
        expect((await migrar(banco, { ate: MODULO, transaction: 'all' })).map((m) => m.name)).toEqual([MODULO]);
      } else {
        expect((await migrar(banco, { ate: MODULO })).map((m) => m.name)).toEqual([ENUMS, MODULO]);
      }
      const depois = await estado(banco);
      expect(depois.migrations).toHaveLength(22);
      expect(depois.estoque).toEqual({
        name: 'Estoque do salão',
        description: 'Texto editado no portal.',
        feature_key: 'ESTOQUE',
        availability: 'AVAILABLE',
      });
      expect(depois.precos).toBe(1);
      expect([depois.overrides, depois.planFeatures]).toEqual([0, 0]);
    }
  }, 240_000);

  it('3. a 22 falha: a 21 fica confirmada, a 22 não deixa nada; a retomada aplica só a 22', async () => {
    const banco = await novoBanco();
    await migrar(banco, { ate: ULTIMA_ANTES });
    // Obstáculo: uma tabela com o nome que a 22 cria.
    await comCliente(urlDe(banco), (c) => c.query(`CREATE TABLE stock_categories (obstaculo int)`));
    await expect(migrar(banco, { ate: MODULO })).rejects.toThrow(/stock_categories/);
    const falhou = await estado(banco);
    expect(falhou.migrations).toHaveLength(21);
    expect(falhou.migrations.at(-1)).toBe(ENUMS);
    expect(falhou.enums).toEqual(TODOS_OS_ENUMS);
    expect(falhou.tabelas).toEqual(['stock_categories']);
    expect(falhou.feature).toBe(0);
    expect(falhou.estoque).toMatchObject({ feature_key: null, availability: 'PLANNED' });

    await comCliente(urlDe(banco), (c) => c.query(`DROP TABLE stock_categories`));
    expect((await migrar(banco, { ate: MODULO })).map((m) => m.name)).toEqual([MODULO]);
    const retomado = await estado(banco);
    expect(retomado.migrations).toHaveLength(22);
    expect(retomado.tabelas).toEqual(TODAS_AS_TABELAS);
    expect(retomado.feature).toBe(1);
    expect(retomado.estoque).toMatchObject({ feature_key: 'ESTOQUE', availability: 'AVAILABLE' });
    expect([retomado.overrides, retomado.planFeatures]).toEqual([0, 0]);
  }, 240_000);

  it("4. modo 'all' com 21 e 22 pendentes: para com a mensagem clara e nada fica gravado", async () => {
    const banco = await novoBanco();
    await migrar(banco, { ate: ULTIMA_ANTES });
    await expect(migrar(banco, { ate: MODULO, transaction: 'all' })).rejects.toThrow(/precisa estar confirmada antes desta/);
    const depois = await estado(banco);
    expect(depois.migrations).toHaveLength(20);
    expect(depois.enums).toEqual([]);
    expect(depois.tabelas).toEqual([]);
    expect(depois.estoque).toMatchObject({ feature_key: null, availability: 'PLANNED' });
  }, 240_000);
});
