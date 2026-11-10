// A conferência só-leitura de ProfessionalCommissionSettings
// (scripts/lib/regra-geral-comissoes-schema.ts), as consultas do runbook e a
// aplicação pelo mesmo código da fase `aplicar` (`aplicarSomenteAPendente`,
// runtime compilado) contra o PostgreSQL DESCARTÁVEL:
//
// - o banco compartilhado, com as dezesseis migrations e dados da API nova,
//   passa no "depois" (estado permanente) e é recusado no "antes"; as
//   invariantes da transição, à parte, acusam os dados; a janela e a consulta
//   dela dizem o mesmo;
// - num banco TEMPORÁRIO criado e apagado aqui, com as quinze migrations, o
//   "antes" passa; só a 16ª é aplicada; o "depois" e as invariantes passam; a
//   repetição é recusada antes de qualquer comando.
//
// Dados fictícios, removidos no fim.
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { DataSource } from 'typeorm';
import { Parada } from '../scripts/entrada-oculta.mjs';
import { aplicarSomenteAPendente, type Destino } from '../scripts/operacao-piloto.mjs';
import { MIGRATION } from '../scripts/regra-geral-comissoes-piloto.mjs';
import {
  MIGRATIONS_ATE_COMISSOES,
  MIGRATIONS_ATE_REGRA_GERAL,
  TOTAL_OBJETOS_REGRA_GERAL,
  falhasAntesDaRegraGeral,
  falhasDaTransicao,
  falhasDepoisDaRegraGeral,
  janelaViolada,
  lerEfeitoDaReversao,
  lerEstadoRegraGeral,
  lerImpactoRegraGeral,
  lerInvariantesDaTransicao,
  lerUsoDesdeAJanela,
  objetosRegraGeralPresentes,
  type EstadoRegraGeral,
} from '../scripts/lib/regra-geral-comissoes-schema.js';
import type { PgClientLike } from '../scripts/lib/pg-client.js';

const url = process.env.DB_E2E_DIRECT_URL;
if (url && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)) {
  throw new Error('Este teste exige PostgreSQL descartável local.');
}
const CONSULTAS = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../docs/runbooks/consultas');
const PLANOS_DO_CATALOGO = ['plan_essencial', 'plan_equipe', 'plan_pro'];
const FONTE_COMPILADA = new URL('../dist-migrations/database/migrations-data-source.js', import.meta.url);
/** Migrations criadas depois deste kit. O kit as recusa de propósito (ele só
 * serve no commit dele); só os testes as conhecem, por nome, e uma nova só
 * entra aqui de propósito. */
const MIGRATIONS_POSTERIORES_AO_KIT = ['TenantTestFlag1793664000000'] as const;

type Resposta = { command: string; rows: Record<string, unknown>[] };
const soLeitura = (respostas: Resposta[]) => {
  const comandos = respostas.map((r) => r.command);
  expect(comandos[0]).toBe('BEGIN');
  expect(comandos.at(-1)).toBe('ROLLBACK');
  expect(comandos.filter((c) => !['BEGIN', 'SELECT', 'ROLLBACK', 'SET'].includes(c))).toEqual([]);
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

/** Outras suítes criam planos de teste com todos os recursos no banco
 * compartilhado; aqui contam só os três do catálogo (no piloto, e no banco
 * temporário abaixo, a conferência vale para todos os planos). */
const soCatalogo = (estado: EstadoRegraGeral): EstadoRegraGeral => ({
  ...estado,
  comissoes: { ...estado.comissoes, planosComComissoes: estado.comissoes.planosComComissoes.filter((p) => PLANOS_DO_CATALOGO.includes(p)) },
});

describe.skipIf(!url)('conferência de ProfessionalCommissionSettings contra PostgreSQL descartável', () => {
  const comLeitor = <T>(ler: (client: PgClientLike) => Promise<T>) => comCliente(url!, (c) => ler(c as unknown as PgClientLike));

  it('banco em uso com as dezesseis migrations: "depois" permanente, "antes" recusado; a transição acusa os dados à parte; janela e consulta concordam', async () => {
    const marca = randomUUID().replaceAll('-', '').slice(0, 12);
    const tenant = `rg${marca}t`;
    const anterior = `rg${marca}a`;
    const nova = `rg${marca}n`;
    const servico = `rg${marca}s`;
    const reserva = `rg${marca}r`;
    const item = `rg${marca}i`;
    const unidade = `rg${marca}u`;
    const cliente = `rg${marca}c`;
    const desde = await comCliente(url!, async (c) => {
      const [{ agora }] = (
        await c.query<{ agora: string }>(`SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS agora`)
      ).rows;
      await c.query(
        `INSERT INTO tenants (id, slug, category, timezone, plan_id, status, access_legacy_since)
         VALUES ($1, $2, 'OTHER', 'America/Sao_Paulo', 'plan_pro', 'ACTIVE', now())`,
        [tenant, tenant],
      );
      await c.query(
        `INSERT INTO units (id, tenant_id, name, address, timezone, is_primary) VALUES ($1, $2, 'Unidade', '', 'America/Sao_Paulo', true)`,
        [unidade, tenant],
      );
      await c.query(
        `INSERT INTO consumers (id, tenant_id, name, whatsapp, whatsapp_normalized) VALUES ($1, $2, 'Cliente fictício', '11999990000', $3)`,
        [cliente, tenant, `55${Math.floor(Math.random() * 1e11)}`],
      );
      // "API anterior": profissional sem configuração e apuração com regra sem escopo.
      for (const id of [anterior, nova]) {
        await c.query(
          `INSERT INTO professionals (id, tenant_id, name, avatar_initials, avatar_color) VALUES ($1, $2, 'Fictício', 'FI', '#000000')`,
          [id, tenant],
        );
      }
      // "API nova": configuração desligada gravada no cadastro.
      await c.query(`INSERT INTO professional_commission_settings (tenant_id, professional_id, receives_commission) VALUES ($1, $2, false)`, [tenant, nova]);
      await c.query(
        `INSERT INTO services (id, tenant_id, name, short_description, duration_minutes, price_cents) VALUES ($1, $2, 'Serviço fictício', '', 30, 2500)`,
        [servico, tenant],
      );
      await c.query(
        `INSERT INTO appointments (id, tenant_id, unit_id, consumer_id, consumer_name_snapshot, consumer_whatsapp_snapshot,
            professional_id, start_at, end_at, status)
         VALUES ($1, $2, $3, $4, 'Cliente fictício', '11999990000', $5, now() - interval '2 hours', now() - interval '90 minutes', 'COMPLETED')`,
        [reserva, tenant, unidade, cliente, anterior],
      );
      await c.query(
        `INSERT INTO appointment_items (id, tenant_id, appointment_id, service_id, duration_minutes_snapshot, price_cents_snapshot)
         VALUES ($1, $2, $3, $4, 30, 2500)`,
        [item, tenant, reserva, servico],
      );
      await c.query(
        `INSERT INTO commission_entries (id, tenant_id, appointment_id, appointment_item_id, professional_id, service_id, price_cents_snapshot,
            applied_type, applied_value, professional_cents, establishment_cents, service_date, calculated_at, status)
         VALUES ($1, $2, $3, $4, $5, $6, 2500, 'FIXED', 1500, 1500, 1000, now() - interval '2 hours', now(), 'CONFIRMED')`,
        [`rg${marca}e`, tenant, reserva, item, anterior, servico],
      );
      return agora;
    });
    try {
      const lido = await comLeitor(lerEstadoRegraGeral);
      // O banco de testes já tem as migrations criadas depois desta; o recorte
      // confere as dezesseis, na ordem.
      expect(lido.migrationNames).toEqual([...MIGRATIONS_ATE_REGRA_GERAL, ...MIGRATIONS_POSTERIORES_AO_KIT]);
      const estado = soCatalogo({ ...lido, migrationNames: lido.migrationNames.slice(0, MIGRATIONS_ATE_REGRA_GERAL.length) });
      expect(falhasDepoisDaRegraGeral(estado)).toEqual([]);
      expect(objetosRegraGeralPresentes(estado)).toBe(TOTAL_OBJETOS_REGRA_GERAL);
      expect(falhasAntesDaRegraGeral(estado)).toEqual(
        expect.arrayContaining(['migration_history', 'settings_table_already_exists', 'rule_scope_column_already_exists']),
      );
      // Dados da API nova não invalidam o "depois", mas são falha logo depois de aplicar.
      const invariantes = await comLeitor(lerInvariantesDaTransicao);
      expect(invariantes.configuracoes).toBeGreaterThanOrEqual(1);
      expect(falhasDaTransicao(invariantes)).toContain('settings_rows_right_after_migration');

      const uso = await comLeitor((c) => lerUsoDesdeAJanela(c, desde));
      expect(uso.profissionaisSemConfiguracao).toBeGreaterThanOrEqual(1);
      expect(uso.profissionaisDesligados).toBeGreaterThanOrEqual(1);
      expect(uso.apuracoesDaApiAnterior).toBeGreaterThanOrEqual(1);
      expect(janelaViolada(uso)).toBe(true);
      const futuro = await comLeitor((c) => lerUsoDesdeAJanela(c, '2999-01-01T00:00:00.000000Z'));
      expect(janelaViolada(futuro)).toBe(false);

      const janela = readFileSync(path.join(CONSULTAS, 'janela-regra-geral-comissoes-somente-leitura.sql'), 'utf8').replace('<JANELA_DESDE>', desde);
      const respostas = await comCliente(url!, async (c) => (await c.query(janela)) as unknown as Resposta[]);
      soLeitura(respostas);
      const [profissionais, apuracoes] = respostas.filter((r) => r.command === 'SELECT').map((r) => r.rows);
      expect(profissionais).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ tenant_id: tenant, professional_id: anterior, origem: 'API_ANTERIOR', receives_commission: null }),
          expect.objectContaining({ tenant_id: tenant, professional_id: nova, origem: 'API_NOVA', receives_commission: false }),
        ]),
      );
      expect(profissionais!.filter((p) => p.origem === 'API_ANTERIOR')).toHaveLength(uso.profissionaisSemConfiguracao);
      expect(apuracoes).toContainEqual(expect.objectContaining({ tenant_id: tenant, appointment_id: reserva, professional_id: anterior }));
      expect(apuracoes).toHaveLength(uso.apuracoesDaApiAnterior);

      const impacto = await comLeitor(lerImpactoRegraGeral);
      const respostasImpacto = await comCliente(
        url!,
        async (c) => (await c.query(readFileSync(path.join(CONSULTAS, 'impacto-regra-geral-comissoes-somente-leitura.sql'), 'utf8'))) as unknown as Resposta[],
      );
      soLeitura(respostasImpacto);
      const [totais, ativos] = respostasImpacto.filter((r) => r.command === 'SELECT').map((r) => r.rows);
      expect(Number(totais![0]!.profissionais)).toBe(impacto.profissionais);
      expect(Number(totais![0]!.com_comissoes)).toBe(impacto.estabelecimentosComComissoes);
      expect(Number(totais![0]!.apuracoes)).toBe(impacto.apuracoes);
      expect(ativos).toContainEqual(expect.objectContaining({ tenant_id: tenant, plan_id: 'plan_pro', com_comissoes: true }));

      const reversao = await comLeitor(lerEfeitoDaReversao);
      expect(reversao.configuracoesQueBloqueiamODown).toBeGreaterThanOrEqual(1);
      expect(reversao.profissionaisSemConfiguracao).toBeGreaterThanOrEqual(1);
    } finally {
      await comCliente(url!, async (c) => {
        await c.query('DELETE FROM commission_entries WHERE tenant_id = $1', [tenant]);
        await c.query('DELETE FROM appointment_items WHERE tenant_id = $1', [tenant]);
        await c.query('DELETE FROM appointments WHERE tenant_id = $1', [tenant]);
        await c.query('DELETE FROM consumers WHERE tenant_id = $1', [tenant]);
        await c.query('DELETE FROM services WHERE tenant_id = $1', [tenant]);
        await c.query('DELETE FROM professionals WHERE tenant_id = $1', [tenant]);
        await c.query('DELETE FROM units WHERE tenant_id = $1', [tenant]);
        await c.query('DELETE FROM tenants WHERE id = $1', [tenant]);
      });
    }
  });
});

describe.skipIf(!url)('aplicarSomenteAPendente de ProfessionalCommissionSettings (banco temporário)', () => {
  const banco = `regra_geral_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  const urlDoBanco = () => {
    const u = new URL(url!);
    u.pathname = `/${banco}`;
    return u.toString();
  };
  const historico = () =>
    comCliente(urlDoBanco(), async (c) => (await c.query<{ name: string }>('SELECT name FROM typeorm_migrations ORDER BY id')).rows.map((r) => r.name));
  const estado = () => comCliente(urlDoBanco(), (c) => lerEstadoRegraGeral(c as unknown as PgClientLike));
  const destino = (): Destino => {
    const u = new URL(url!);
    return {
      url: urlDoBanco(),
      host: u.hostname,
      servidorTls: 'localhost',
      port: Number(u.port || 5432),
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: banco,
      channelBinding: false,
    };
  };

  let posteriores: string[] = [];
  async function aplicar(esperadasAntes: readonly string[], comoOKit = false) {
    const linhas: string[] = [];
    let iniciou = false;
    try {
      const aplicadas = await aplicarSomenteAPendente(destino(), {
        esperadasAntes: [...esperadasAntes],
        pendente: MIGRATION,
        // Migrations criadas depois desta: o kit as recusaria de propósito
        // (`comoOKit`, a mesma chamada de aplicar-regra-geral-comissoes-
        // piloto.mjs); aqui ficam de fora para provar a aplicação desta.
        ...(posteriores.length && !comoOKit ? { posteriores } : {}),
        aplicacao: 'agenda-cloud-migration-teste',
        log: (l) => linhas.push(l),
        aoIniciar: () => {
          iniciou = true;
        },
      });
      return { aplicadas, codigo: null, iniciou, linhas };
    } catch (erro) {
      if (!(erro instanceof Parada)) throw erro;
      return { aplicadas: null, codigo: erro.message, iniciou, linhas };
    }
  }

  beforeAll(async () => {
    if (!existsSync(FONTE_COMPILADA)) throw new Error('Rode `npm run build:migrations-runtime` antes deste teste.');
    await comCliente(url!, (c) => c.query(`CREATE DATABASE "${banco}"`));
    const { buildMigrationsDataSourceOptions } = (await import(FONTE_COMPILADA.href)) as {
      buildMigrationsDataSourceOptions: (u: string) => ConstructorParameters<typeof DataSource>[0];
    };
    const ds = new DataSource({ ...buildMigrationsDataSourceOptions(urlDoBanco()), logging: false });
    await ds.initialize();
    try {
      const compiladas = ds.migrations.map((m) => m.name ?? m.constructor.name);
      expect(compiladas.slice(0, MIGRATIONS_ATE_REGRA_GERAL.length)).toEqual([...MIGRATIONS_ATE_REGRA_GERAL]);
      posteriores = compiladas.slice(MIGRATIONS_ATE_REGRA_GERAL.length);
      expect(posteriores).toEqual([...MIGRATIONS_POSTERIORES_AO_KIT]);
      ds.migrations.splice(MIGRATIONS_ATE_COMISSOES.length);
      await ds.runMigrations({ transaction: 'all' });
    } finally {
      await ds.destroy();
    }
  }, 180_000);

  afterAll(async () => {
    await comCliente(url!, (c) => c.query(`DROP DATABASE IF EXISTS "${banco}" WITH (FORCE)`));
  });

  it('15 → 16: só ProfessionalCommissionSettings, objetos exatos, transição limpa; repetição recusada', async () => {
    expect(await historico()).toEqual([...MIGRATIONS_ATE_COMISSOES]);
    expect(falhasAntesDaRegraGeral(await estado())).toEqual([]);

    // Histórico errado: para antes de qualquer comando.
    const errado = await aplicar(MIGRATIONS_ATE_REGRA_GERAL);
    expect(errado).toMatchObject({ codigo: 'ERR_HISTORICO_DE_MIGRATIONS_INESPERADO', iniciou: false });
    // O kit como está, num runtime com migrations posteriores compiladas:
    // recusa antes de qualquer comando. Ele só serve no commit dele.
    const comPosteriores = await aplicar(MIGRATIONS_ATE_COMISSOES, true);
    expect(comPosteriores).toMatchObject({ codigo: 'ERR_MIGRATIONS_COMPILADAS_INESPERADAS', iniciou: false });
    expect(await historico()).toEqual([...MIGRATIONS_ATE_COMISSOES]);

    const r = await aplicar(MIGRATIONS_ATE_COMISSOES);
    expect(r).toMatchObject({ codigo: null, iniciou: true, aplicadas: [MIGRATION] });
    expect(r.linhas).toEqual(
      expect.arrayContaining(['MIGRATIONS_NO_HISTORICO: 15', `PENDENTE: ${MIGRATION}`, `APLICADAS: ${MIGRATION}`, 'SESSAO_DA_MIGRATION: mesma=true lock_timeout=10s']),
    );
    expect(await historico()).toEqual([...MIGRATIONS_ATE_REGRA_GERAL]);
    expect(falhasDepoisDaRegraGeral(await estado())).toEqual([]);
    const invariantes = await comCliente(urlDoBanco(), (c) => lerInvariantesDaTransicao(c as unknown as PgClientLike));
    expect(falhasDaTransicao(invariantes)).toEqual([]);

    const deNovo = await aplicar(MIGRATIONS_ATE_COMISSOES);
    expect(deNovo).toMatchObject({ codigo: 'ERR_HISTORICO_DE_MIGRATIONS_INESPERADO', iniciou: false });
    expect(await historico()).toEqual([...MIGRATIONS_ATE_REGRA_GERAL]);
  });
});
