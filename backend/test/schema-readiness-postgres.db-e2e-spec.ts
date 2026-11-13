// Conferência de inicialização (src/database/schema-readiness.ts) contra
// PostgreSQL DESCARTÁVEL real, com o manifesto real do código.
//
// ISOLAMENTO: o banco é compartilhado por todos os `*.db-e2e-spec.ts`, e a
// tabela `typeorm_migrations` verdadeira é lida por outros testes. Aqui ela
// nunca é tocada: cada cenário usa uma tabela de controle própria num schema
// temporário, e o DataSource do teste enxerga só esse schema (`search_path`).
// O schema é apagado no fim.
//
// Cenários: todas presentes; última ausente; anterior ausente com a última
// registrada; tabela de controle ausente; banco indisponível; migration a
// mais. E a prova de que a conferência não escreve nada.
import { randomUUID } from 'node:crypto';
import net from 'node:net';
import { Client } from 'pg';
import { DataSource } from 'typeorm';
import { REQUIRED_MIGRATIONS } from '../src/database/required-migrations.js';
import { buildRuntimeDataSourceOptions } from '../src/database/runtime-data-source.js';
import { SchemaNotReadyError, checkRequiredMigrations } from '../src/database/schema-readiness.js';

const url = process.env.DB_E2E_DIRECT_URL;
if (url && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)) {
  throw new Error('Este teste exige PostgreSQL descartável local.');
}

const schema = `schema_check_${randomUUID().replaceAll('-', '').slice(0, 12)}`;

/** DataSource com as opções REAIS do runtime, restrito ao schema do teste. */
function dataSourceDoTeste(connectionUrl: string): DataSource {
  return new DataSource({
    ...buildRuntimeDataSourceOptions(connectionUrl),
    entities: [],
    extra: { options: `-c search_path=${schema}`, max: 2 },
  });
}

async function problemaDe(promessa: Promise<unknown>) {
  const erro = await promessa.then(
    () => null,
    (e: unknown) => e,
  );
  expect(erro).toBeInstanceOf(SchemaNotReadyError);
  return erro as SchemaNotReadyError;
}

describe.skipIf(!url)('conferência das migrations exigidas contra PostgreSQL descartável', () => {
  let admin: Client;
  let db: DataSource;

  async function registrar(nomes: readonly string[]): Promise<void> {
    await admin.query(`DROP TABLE IF EXISTS ${schema}.typeorm_migrations`);
    // Mesma forma da tabela que o TypeORM cria.
    await admin.query(
      `CREATE TABLE ${schema}.typeorm_migrations (id SERIAL PRIMARY KEY, "timestamp" bigint NOT NULL, name varchar NOT NULL)`,
    );
    for (const nome of nomes) {
      await admin.query(`INSERT INTO ${schema}.typeorm_migrations ("timestamp", name) VALUES ($1, $2)`, [
        nome.slice(-13),
        nome,
      ]);
    }
  }

  async function nomesRegistrados(): Promise<string[]> {
    const { rows } = await admin.query<{ name: string }>(`SELECT name FROM ${schema}.typeorm_migrations ORDER BY id`);
    return rows.map((linha) => linha.name);
  }

  beforeAll(async () => {
    admin = new Client({ connectionString: url!, ssl: { rejectUnauthorized: true } });
    await admin.connect();
    await admin.query(`CREATE SCHEMA ${schema}`);
    db = dataSourceDoTeste(url!);
    await db.initialize();
  });

  afterAll(async () => {
    if (db?.isInitialized) await db.destroy();
    await admin?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin?.end();
  });

  it('o manifesto real tem as migrations que a conferência vai exigir', () => {
    expect(REQUIRED_MIGRATIONS.length).toBeGreaterThanOrEqual(18);
  });

  it('1. todas as exigidas presentes: aprova', async () => {
    await registrar(REQUIRED_MIGRATIONS);

    await expect(checkRequiredMigrations(db)).resolves.toEqual({
      required: REQUIRED_MIGRATIONS.length,
      applied: REQUIRED_MIGRATIONS.length,
      extra: [],
    });
  });

  it('2. última ausente: recusa e nomeia a ausente', async () => {
    await registrar(REQUIRED_MIGRATIONS.slice(0, -1));

    const erro = await problemaDe(checkRequiredMigrations(db));
    expect(erro.problem).toEqual({
      reason: 'missing-migrations',
      table: 'typeorm_migrations',
      missing: [REQUIRED_MIGRATIONS.at(-1)],
      required: REQUIRED_MIGRATIONS.length,
    });
    expect(erro.message).toContain(REQUIRED_MIGRATIONS.at(-1));
  });

  it('3. anterior ausente, com a última registrada: recusa', async () => {
    const ausente = REQUIRED_MIGRATIONS.at(-3)!;
    await registrar(REQUIRED_MIGRATIONS.filter((nome) => nome !== ausente));

    const erro = await problemaDe(checkRequiredMigrations(db));
    expect(erro.problem).toMatchObject({ reason: 'missing-migrations', missing: [ausente] });
    expect(await nomesRegistrados()).toContain(REQUIRED_MIGRATIONS.at(-1));
  });

  it('3b. mesma quantidade, com uma exigida trocada por uma desconhecida: recusa', async () => {
    const ausente = REQUIRED_MIGRATIONS[1];
    await registrar([...REQUIRED_MIGRATIONS.filter((nome) => nome !== ausente), 'Desconhecida1900000000000']);
    expect(await nomesRegistrados()).toHaveLength(REQUIRED_MIGRATIONS.length);

    const erro = await problemaDe(checkRequiredMigrations(db));
    expect(erro.problem).toMatchObject({ reason: 'missing-migrations', missing: [ausente] });
  });

  it('4. tabela de controle ausente: recusa e NÃO cria a tabela', async () => {
    await admin.query(`DROP TABLE IF EXISTS ${schema}.typeorm_migrations`);

    const erro = await problemaDe(checkRequiredMigrations(db));
    expect(erro.problem).toEqual({ reason: 'control-table-missing', table: 'typeorm_migrations' });
    const { rows } = await admin.query<{ tabela: string | null }>('SELECT to_regclass($1)::text AS tabela', [
      `${schema}.typeorm_migrations`,
    ]);
    expect(rows[0].tabela).toBeNull();
  });

  it('6. migration a mais no banco: aprova e informa qual é', async () => {
    await registrar([...REQUIRED_MIGRATIONS, 'MigrationFutura1900000000000']);

    await expect(checkRequiredMigrations(db)).resolves.toEqual({
      required: REQUIRED_MIGRATIONS.length,
      applied: REQUIRED_MIGRATIONS.length + 1,
      extra: ['MigrationFutura1900000000000'],
    });
  });

  it('só leitura: a tabela de controle fica idêntica e a transação recusa escrita', async () => {
    await registrar(REQUIRED_MIGRATIONS.slice(0, 5));
    const antes = await nomesRegistrados();

    await problemaDe(checkRequiredMigrations(db));
    expect(await nomesRegistrados()).toEqual(antes);

    // A mesma abertura de transação usada pela conferência recusa um INSERT.
    const runner = db.createQueryRunner();
    try {
      await runner.query('BEGIN TRANSACTION READ ONLY');
      await expect(
        runner.query(`INSERT INTO typeorm_migrations ("timestamp", name) VALUES (1, 'x')`),
      ).rejects.toMatchObject({ driverError: { code: '25006' } });
    } finally {
      await runner.query('ROLLBACK');
      await runner.release();
    }
  });

  it('5. banco indisponível na hora da conferência: recusa só com o código, sem dado de conexão', async () => {
    // Um repasse TCP local até o PostgreSQL: a conexão abre normalmente e,
    // derrubado o repasse, o banco fica inalcançável para este DataSource.
    const destino = new URL(url!);
    const sockets = new Set<net.Socket>();
    const repasse = net.createServer((entrada) => {
      const saida = net.connect(Number(destino.port || 5432), destino.hostname);
      for (const s of [entrada, saida]) {
        sockets.add(s);
        s.on('error', () => undefined);
        s.on('close', () => sockets.delete(s));
      }
      entrada.pipe(saida);
      saida.pipe(entrada);
    });
    await new Promise<void>((resolve) => repasse.listen(0, '127.0.0.1', resolve));
    const viaRepasse = new URL(url!);
    viaRepasse.port = String((repasse.address() as net.AddressInfo).port);

    await registrar(REQUIRED_MIGRATIONS);
    const instavel = dataSourceDoTeste(viaRepasse.toString());
    await instavel.initialize();
    try {
      await expect(checkRequiredMigrations(instavel)).resolves.toMatchObject({ extra: [] });

      for (const s of sockets) s.destroy();
      await new Promise<void>((resolve) => repasse.close(() => resolve()));

      const erro = await problemaDe(checkRequiredMigrations(instavel, { totalTimeoutMs: 8_000 }));
      expect(erro.problem.reason).toBe('database-unavailable');
      expect(erro.message).toContain('não foi possível ler a tabela de controle');
      expect(erro.message).not.toContain(viaRepasse.password);
      expect(erro.message).not.toContain(viaRepasse.username);
      expect(erro.message).not.toMatch(/postgres(ql)?:\/\//);
    } finally {
      await instavel.destroy().catch(() => undefined);
      if (repasse.listening) repasse.close();
    }
  });
});
