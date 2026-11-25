// Migrations de vendas (27 SalesEnumValues e 28 SalesModule) com o runtime
// COMPILADO (`dist-migrations`, o mesmo do CI e do piloto), cada cenário num
// banco TEMPORÁRIO próprio, criado e apagado aqui. O estado é sempre
// conferido por uma conexão NOVA depois de cada execução (o que ficou
// persistido, não o que a transação via):
// 1. banco novo: as 28 no modo `each` do DataSource de migrations;
// 2. atualização a partir das 26 com dados de estoque: pelo modo `each` e
//    pelo caminho do piloto (uma por vez, cada uma confirmada antes da
//    próxima, como `aplicarSomenteAPendente`). Saldos, movimentos, o
//    adicional ESTOQUE e o preço dele ficam idênticos;
// 3. falha da 28 seguida de retomada: a 27 fica confirmada, a 28 é desfeita
//    por inteiro, e a segunda execução aplica só a 28;
// 4. modo `all` com as duas pendentes: a 28 para com a mensagem clara e nada
//    fica gravado (nem os valores de enum);
// 5. down da 28 sem uso desfaz tudo e a 28 volta a aplicar.
// Validação em banco descartável com dados fictícios: prova o código, não
// o piloto. O ensaio numa cópia restaurada do piloto é outra etapa
// (docs/plans/vendas-v1.md, seção 5.7).
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { Client } from 'pg';
import { DataSource } from 'typeorm';

const url = process.env.DB_E2E_DIRECT_URL;
if (url && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)) {
  throw new Error('Este teste exige PostgreSQL descartável local.');
}
const FONTE_COMPILADA = new URL('../dist-migrations/database/migrations-data-source.js', import.meta.url);
const ULTIMA_ANTES = 'SelfServicePasswordReset1794441600000';
const ENUMS = 'SalesEnumValues1794528000000';
const MODULO = 'SalesModule1794614400000';

type Opcoes = ConstructorParameters<typeof DataSource>[0];

describe.skipIf(!url)('migrations de vendas contra PostgreSQL descartável (bancos temporários)', () => {
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
    const banco = `vendas_mig_${randomUUID().replaceAll('-', '').slice(0, 14)}`;
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
      return opcoes.viaDataSource
        ? await ds.runMigrations()
        : await ds.runMigrations({ transaction: opcoes.transaction ?? 'each' });
    } finally {
      await ds.destroy();
    }
  }

  async function desfazerUltima(banco: string) {
    const ds = new DataSource({ ...construirOpcoes(urlDe(banco)), logging: false } as Opcoes);
    await ds.initialize();
    try {
      await ds.undoLastMigration({ transaction: 'each' });
    } finally {
      await ds.destroy();
    }
  }

  interface Estado {
    migrations: string[];
    enums: string[];
    tabelas: string[];
    colunas: string[];
    gatilhos: string[];
    feature: number;
    vendas: { name: string; feature_key: string | null; availability: string } | undefined;
    precosVendas: number;
    estoque: { name: string; feature_key: string | null; availability: string };
    precosEstoque: number;
    overrides: number;
    planFeatures: number;
    estoqueDados: string;
  }

  const NOVOS_VALORES = [
    'VENDAS',
    'VENDAS_REGISTRAR',
    'VENDAS_RECEBER',
    'VENDAS_ALTERAR_PRECO',
    'VENDAS_VISUALIZAR',
    'VENDAS_CANCELAR',
    'VENDAS_ESTORNAR_RECEBIMENTO',
    'SALE_RECORDED',
    'SALE_CANCELLED',
    'SALE_PAYMENT_RECORDED',
    'SALE_PAYMENT_REFUNDED',
  ];

  /** Estado persistido, lido por conexão nova. */
  const estado = (banco: string): Promise<Estado> =>
    comCliente(urlDe(banco), async (c) => {
      const um = async <T>(sql: string) => (await c.query(sql)).rows[0] as T;
      const lista = async (sql: string) => (await c.query<{ v: string }>(sql)).rows.map((r) => r.v);
      return {
        migrations: await lista('SELECT name AS v FROM typeorm_migrations ORDER BY id'),
        enums: await lista(
          `SELECT t.typname || '.' || e.enumlabel AS v FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
            WHERE e.enumlabel IN (${NOVOS_VALORES.map((v) => `'${v}'`).join(', ')}) ORDER BY 1`,
        ),
        tabelas: await lista(`SELECT tablename AS v FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'sale%' ORDER BY 1`),
        colunas: await lista(
          `SELECT table_name || '.' || column_name AS v FROM information_schema.columns
            WHERE table_schema = 'public' AND column_name IN ('sale_id', 'sale_price_cents')
              AND table_name IN ('stock_movements', 'stock_products') ORDER BY 1`,
        ),
        gatilhos: await lista(
          `SELECT tgname AS v FROM pg_trigger WHERE NOT tgisinternal
              AND tgname IN ('trg_stock_movements_sale_link', 'trg_consumers_move_sales', 'trg_sales_consistency', 'trg_sale_items_consistency',
                             'trg_stock_movements_sale_consistency', 'trg_sales_guard_update', 'trg_sale_payments_guard', 'trg_sales_consumer_active')
            ORDER BY 1`,
        ),
        feature: (await um<{ n: number }>(`SELECT count(*)::int AS n FROM features WHERE id = 'feat_vendas'`)).n,
        vendas: await um(`SELECT name, feature_key, availability FROM addon_modules WHERE code = 'VENDAS'`),
        precosVendas: (await um<{ n: number }>(`SELECT count(*)::int AS n FROM addon_module_prices WHERE module_code = 'VENDAS'`)).n,
        estoque: await um(`SELECT name, feature_key, availability FROM addon_modules WHERE code = 'ESTOQUE'`),
        precosEstoque: (await um<{ n: number }>(`SELECT count(*)::int AS n FROM addon_module_prices WHERE module_code = 'ESTOQUE'`)).n,
        overrides: (await um<{ n: number }>(`SELECT count(*)::int AS n FROM tenant_feature_overrides WHERE feature_id = 'feat_vendas'`)).n,
        planFeatures: (await um<{ n: number }>(`SELECT count(*)::int AS n FROM plan_features WHERE feature_id = 'feat_vendas'`)).n,
        estoqueDados: (
          await um<{ h: string }>(
            `SELECT md5(COALESCE((SELECT string_agg(id || ':' || balance_milli || ':' || balance_version, ',' ORDER BY id) FROM stock_products), '')
              || '|' || COALESCE((SELECT string_agg(id || ':' || delta_milli || ':' || kind, ',' ORDER BY id) FROM stock_movements), '')) AS h`,
          )
        ).h,
      };
    });

  const TODOS_OS_ENUMS = [
    'audit_action.SALE_CANCELLED',
    'audit_action.SALE_PAYMENT_RECORDED',
    'audit_action.SALE_PAYMENT_REFUNDED',
    'audit_action.SALE_RECORDED',
    'feature_key.VENDAS',
    'permission.VENDAS_ALTERAR_PRECO',
    'permission.VENDAS_CANCELAR',
    'permission.VENDAS_ESTORNAR_RECEBIMENTO',
    'permission.VENDAS_RECEBER',
    'permission.VENDAS_REGISTRAR',
    'permission.VENDAS_VISUALIZAR',
  ];
  const TODAS_AS_TABELAS = ['sale_items', 'sale_payments', 'sales'];
  const TODAS_AS_COLUNAS = ['stock_movements.sale_id', 'stock_products.sale_price_cents'];

  /** Dados de estoque e o adicional ESTOQUE contratável com preço, como no
   * piloto em 26. */
  async function semearEstoque(banco: string) {
    await comCliente(urlDe(banco), async (c) => {
      const id = () => randomUUID().replaceAll('-', '').slice(0, 24);
      const usuario = id();
      const tenant = id();
      const plano = id();
      const categoria = id();
      const produto = id();
      await c.query(`INSERT INTO users (id, name, email, status, email_verified) VALUES ($1, 'Operador', $2, 'ACTIVE', true)`, [
        usuario,
        `${usuario}@example.test`,
      ]);
      await c.query(`INSERT INTO plans (id, code, name, short_description, max_professionals, max_units) VALUES ($1, $1, 'Plano', '', 5, 1)`, [plano]);
      await c.query(
        `INSERT INTO tenants (id, slug, category, timezone, plan_id, status, access_legacy_since) VALUES ($1, $2, 'OTHER', 'America/Sao_Paulo', $3, 'ACTIVE', now())`,
        [tenant, `mig-vendas-${tenant.slice(0, 8)}`, plano],
      );
      await c.query(`INSERT INTO tenant_feature_overrides (id, tenant_id, feature_id, enabled) VALUES ($1, $2, 'feat_estoque', true)`, [id(), tenant]);
      await c.query(
        `INSERT INTO addon_module_prices (id, module_code, amount_cents, recorded_by_user_id, request_key) VALUES ($1, 'ESTOQUE', 1990, $2, 'preco-estoque')`,
        [id(), usuario],
      );
      await c.query(`INSERT INTO stock_categories (id, tenant_id, name) VALUES ($1, $2, 'Revenda')`, [categoria, tenant]);
      await c.query(
        `INSERT INTO stock_products (id, tenant_id, category_id, name, purpose, unit, balance_milli, balance_version, created_by_user_id, request_key, request_fingerprint)
         VALUES ($1, $2, $3, 'Pomada', 'VENDA', 'UN', 4000, 2, $4, 'k1', $5)`,
        [produto, tenant, categoria, usuario, 'a'.repeat(64)],
      );
      const inicial = id();
      await c.query(
        `INSERT INTO stock_movements (id, tenant_id, product_id, kind, quantity_milli, delta_milli, balance_before_milli, balance_after_milli, unit, recorded_by_user_id)
         VALUES ($1, $2, $3, 'SALDO_INICIAL', 5000, 5000, 0, 5000, 'UN', $4)`,
        [inicial, tenant, produto, usuario],
      );
      await c.query(
        `INSERT INTO stock_movements (id, tenant_id, product_id, kind, quantity_milli, delta_milli, balance_before_milli, balance_after_milli, unit, recorded_by_user_id)
         VALUES ($1, $2, $3, 'SAIDA_VENDA', 1000, -1000, 5000, 4000, 'UN', $4)`,
        [id(), tenant, produto, usuario],
      );
    });
  }

  function conferirAplicada(e: Estado, quantas: number) {
    expect(e.migrations).toHaveLength(quantas);
    expect(e.migrations.slice(-2)).toEqual([ENUMS, MODULO]);
    expect(e.enums).toEqual(TODOS_OS_ENUMS);
    expect(e.tabelas).toEqual(TODAS_AS_TABELAS);
    expect(e.colunas).toEqual(TODAS_AS_COLUNAS);
    expect(e.gatilhos).toHaveLength(8);
    expect(e.feature).toBe(1);
    expect(e.vendas).toEqual({ name: 'Vendas', feature_key: 'VENDAS', availability: 'AVAILABLE' });
    // Sem preço: a contratação recusa (PRECO_PENDENTE). Nada ligado.
    expect([e.precosVendas, e.overrides, e.planFeatures]).toEqual([0, 0, 0]);
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

  it('1. banco novo: as 28 no modo do DataSource (each); enums, tabelas, gatilhos e adicional sem preço', async () => {
    const banco = await novoBanco();
    const aplicadas = await migrar(banco, { ate: MODULO, viaDataSource: true });
    expect(aplicadas.map((m) => m.name).slice(-2)).toEqual([ENUMS, MODULO]);
    conferirAplicada(await estado(banco), 28);
  }, 180_000);

  it('2. a partir das 26 com dados de estoque: modo each e uma por vez (piloto); estoque e ESTOQUE idênticos', async () => {
    for (const umaPorVez of [false, true]) {
      const banco = await novoBanco();
      await migrar(banco, { ate: ULTIMA_ANTES });
      await semearEstoque(banco);
      const antes = await estado(banco);
      expect(antes.migrations).toHaveLength(26);
      expect(antes.vendas).toBeUndefined();
      if (umaPorVez) {
        // Execução 1: só a 27, confirmada ao sair (a 28 fora do DataSource).
        expect((await migrar(banco, { ate: ENUMS, transaction: 'all' })).map((m) => m.name)).toEqual([ENUMS]);
        const meio = await estado(banco);
        expect(meio.migrations.at(-1)).toBe(ENUMS);
        expect(meio.enums).toEqual(TODOS_OS_ENUMS);
        expect(meio.tabelas).toEqual([]);
        // Execução 2, conexão nova: só a 28.
        expect((await migrar(banco, { ate: MODULO, transaction: 'all' })).map((m) => m.name)).toEqual([MODULO]);
      } else {
        expect((await migrar(banco, { ate: MODULO })).map((m) => m.name)).toEqual([ENUMS, MODULO]);
      }
      const depois = await estado(banco);
      conferirAplicada(depois, 28);
      expect(depois.estoqueDados).toBe(antes.estoqueDados);
      expect(depois.estoque).toEqual(antes.estoque);
      expect(depois.precosEstoque).toBe(1);
      // Movimentos antigos ficam sem venda.
      const [semVenda] = await comCliente(urlDe(banco), async (c) => (await c.query(`SELECT count(*)::int AS n FROM stock_movements WHERE sale_id IS NOT NULL`)).rows);
      expect(semVenda.n).toBe(0);
    }
  }, 300_000);

  it('3. a 28 falha: a 27 fica confirmada, a 28 não deixa nada; a retomada aplica só a 28', async () => {
    const banco = await novoBanco();
    await migrar(banco, { ate: ULTIMA_ANTES });
    // Obstáculo: uma tabela com o nome que a 28 cria.
    await comCliente(urlDe(banco), (c) => c.query(`CREATE TABLE sales (obstaculo int)`));
    await expect(migrar(banco, { ate: MODULO })).rejects.toThrow(/sales/);
    const falhou = await estado(banco);
    expect(falhou.migrations).toHaveLength(27);
    expect(falhou.migrations.at(-1)).toBe(ENUMS);
    expect(falhou.enums).toEqual(TODOS_OS_ENUMS);
    expect(falhou.tabelas).toEqual(['sales']);
    expect(falhou.colunas).toEqual([]);
    expect(falhou.feature).toBe(0);
    expect(falhou.vendas).toBeUndefined();

    await comCliente(urlDe(banco), (c) => c.query(`DROP TABLE sales`));
    expect((await migrar(banco, { ate: MODULO })).map((m) => m.name)).toEqual([MODULO]);
    conferirAplicada(await estado(banco), 28);
  }, 240_000);

  it("4. modo 'all' com 27 e 28 pendentes: para com a mensagem clara e nada fica gravado", async () => {
    const banco = await novoBanco();
    await migrar(banco, { ate: ULTIMA_ANTES });
    await expect(migrar(banco, { ate: MODULO, transaction: 'all' })).rejects.toThrow(/precisa estar confirmada antes desta/);
    const depois = await estado(banco);
    expect(depois.migrations).toHaveLength(26);
    expect(depois.enums).toEqual([]);
    expect(depois.tabelas).toEqual([]);
    expect(depois.vendas).toBeUndefined();
  }, 240_000);

  it('5. down da 28 sem uso desfaz tabelas, colunas, gatilhos e catálogo; a 28 volta a aplicar', async () => {
    const banco = await novoBanco();
    await migrar(banco, { ate: MODULO });
    await desfazerUltima(banco);
    const desfeito = await estado(banco);
    expect(desfeito.migrations.at(-1)).toBe(ENUMS);
    expect(desfeito.tabelas).toEqual([]);
    expect(desfeito.colunas).toEqual([]);
    expect(desfeito.gatilhos).toEqual([]);
    expect(desfeito.vendas).toBeUndefined();
    expect(desfeito.feature).toBe(0);
    expect((await migrar(banco, { ate: MODULO })).map((m) => m.name)).toEqual([MODULO]);
    conferirAplicada(await estado(banco), 28);
  }, 240_000);
});
