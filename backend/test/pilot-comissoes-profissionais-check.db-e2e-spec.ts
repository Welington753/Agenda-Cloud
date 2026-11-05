// A conferência só-leitura de ProfessionalCommissions
// (scripts/lib/comissoes-profissionais-schema.ts), a consulta do runbook
// (docs/runbooks/consultas/impacto-comissoes-profissionais-somente-leitura.sql)
// e a aplicação pelo mesmo código da fase `aplicar` (`aplicarSomenteAPendente`,
// runtime compilado) contra o PostgreSQL DESCARTÁVEL:
//
// - o banco compartilhado, com as quinze migrations, passa no "depois" e é
//   recusado no "antes"; o levantamento e a consulta dizem o mesmo;
// - num banco TEMPORÁRIO criado e apagado aqui, com as catorze migrations, o
//   "antes" passa; só a 15ª é aplicada; o "depois" passa; o catálogo, os
//   preços e as exceções ficam iguais (só a linha nova do Pro); a repetição é
//   recusada antes de qualquer comando.
//
// Dados fictícios, removidos no fim.
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { DataSource } from 'typeorm';
import { Parada } from '../scripts/entrada-oculta.mjs';
import { aplicarSomenteAPendente, fotografar, type Destino } from '../scripts/operacao-piloto.mjs';
import { MIGRATION } from '../scripts/comissoes-profissionais-piloto.mjs';
import {
  MIGRATIONS_ATE_COMISSOES,
  MIGRATIONS_ATE_NOMES_CONGELADOS,
  TOTAL_OBJETOS_COMISSOES,
  catalogoAlterado,
  descreverImpactoComissoes,
  falhasAntesDeComissoes,
  falhasDepoisDeComissoes,
  lerEfeitoDaReversao,
  lerEstadoComissoes,
  lerImpactoComissoes,
  lerSomasDoCatalogo,
  objetosComissoesPresentes,
} from '../scripts/lib/comissoes-profissionais-schema.js';
import type { PgClientLike } from '../scripts/lib/pg-client.js';

const url = process.env.DB_E2E_DIRECT_URL;
if (url && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)) {
  throw new Error('Este teste exige PostgreSQL descartável local.');
}
const CONSULTAS = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../docs/runbooks/consultas');
const PLANOS_DO_CATALOGO = ['plan_essencial', 'plan_equipe', 'plan_pro'];
const FONTE_COMPILADA =new URL('../dist-migrations/database/migrations-data-source.js', import.meta.url);

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

describe.skipIf(!url)('conferência de ProfessionalCommissions contra PostgreSQL descartável', () => {
  const comLeitor = <T>(ler: (client: PgClientLike) => Promise<T>) => comCliente(url!, (c) => ler(c as unknown as PgClientLike));

  it('banco com as quinze migrations passa no "depois" e é recusado no "antes"', async () => {
    const lido = await comLeitor(lerEstadoComissoes);
    // Outras suítes podem ter migrations depois desta no futuro: o recorte
    // confere as quinze, na ordem.
    // Outras suítes também criam planos de teste com todos os recursos no
    // banco compartilhado; aqui contam só os três do catálogo (no piloto, e no
    // banco temporário abaixo, a conferência vale para todos os planos).
    const estado = {
      ...lido,
      migrationNames: lido.migrationNames.slice(0, 15),
      planosComComissoes: lido.planosComComissoes.filter((p) => PLANOS_DO_CATALOGO.includes(p)),
    };
    expect(estado.migrationNames).toEqual([...MIGRATIONS_ATE_COMISSOES]);
    expect(falhasDepoisDeComissoes(estado)).toEqual([]);
    expect(objetosComissoesPresentes(estado)).toBe(TOTAL_OBJETOS_COMISSOES);
    expect(falhasAntesDeComissoes(estado)).toEqual(
      expect.arrayContaining(['migration_history', 'commission_enum_values_already_exist', 'pro_plan_already_has_commissions']),
    );
    const reversao = await comLeitor(lerEfeitoDaReversao);
    expect(Object.keys(reversao).sort()).toEqual(
      [
        'apuracoesPorItem',
        'apuracoesQueBloqueiamODown',
        'concessoesQueFicamSemEfeito',
        'linhasDoCatalogoApagadas',
        'regrasQueFicam',
        'registrosDeAuditoriaQueFicam',
      ].sort(),
    );
    expect(reversao.linhasDoCatalogoApagadas).toBe(1);
  });

  it('levantamento e consulta do runbook dizem o mesmo, sem escrita; uma exceção desligada num Pro continua desligando', async () => {
    const marca = randomUUID().replaceAll('-', '').slice(0, 12);
    const tenants = { pro: `pc${marca}a`, proSemComissoes: `pc${marca}b`, basico: `pc${marca}c` };
    await comCliente(url!, async (c) => {
      for (const [id, plano] of [
        [tenants.pro, 'plan_equipe'],
        [tenants.proSemComissoes, 'plan_equipe'],
        [tenants.basico, 'plan_essencial'],
      ] as const) {
        await c.query(
          `INSERT INTO tenants (id, slug, category, timezone, plan_id, status, access_legacy_since)
           VALUES ($1, $2, 'OTHER', 'America/Sao_Paulo', $3, 'ACTIVE', now())`,
          [id, id, plano],
        );
      }
      await c.query(
        `INSERT INTO tenant_feature_overrides (id, tenant_id, feature_id, enabled) VALUES ($1, $2, 'feat_comissoes', false)`,
        [`tfo${marca}`, tenants.proSemComissoes],
      );
    });
    try {
      const impacto = await comLeitor(lerImpactoComissoes);
      // Depois da migration, o efetivo de hoje já é o do catálogo novo.
      expect(impacto.passamAApurar).toBe(0);
      const pro = impacto.porPlano.find((p) => p.planoId === 'plan_equipe')!;
      expect(pro.estabelecimentos - pro.comComissoesAgora).toBeGreaterThanOrEqual(1);
      expect(impacto.excecoesDesligadas).toBeGreaterThanOrEqual(1);
      expect(impacto.apuracoesPorItem).not.toBeNull();
      const linhas = descreverImpactoComissoes(impacto);
      expect(linhas).toContain(`PASSAM_A_APURAR_COMISSOES: 0`);

      const respostas = await comCliente(
        url!,
        async (c) => (await c.query(readFileSync(path.join(CONSULTAS, 'impacto-comissoes-profissionais-somente-leitura.sql'), 'utf8'))) as unknown as Resposta[],
      );
      soLeitura(respostas);
      const selects = respostas.filter((r) => r.command === 'SELECT');
      const [porPlano, excecoes, totais, planos] = selects.map((r) => r.rows);
      // Mesmas contagens por plano que o levantamento (pg devolve bigint como texto).
      expect(porPlano!.map((r) => [r.plano, Number(r.estabelecimentos), Number(r.com_comissoes_agora), Number(r.com_comissoes_depois)])).toEqual(
        impacto.porPlano.map((p) => [p.planoId, p.estabelecimentos, p.comComissoesAgora, p.comComissoesDepois]),
      );
      expect(excecoes).toContainEqual({ tenant_id: tenants.proSemComissoes, plan_id: 'plan_equipe', enabled: false });
      expect(Number(totais![0]!.regras)).toBe(impacto.regras);
      expect(Number(totais![0]!.apuracoes)).toBe(impacto.apuracoes);
      expect(planos!.map((r) => r.plan_id as string).filter((p) => PLANOS_DO_CATALOGO.includes(p))).toEqual(['plan_equipe', 'plan_pro']);
    } finally {
      await comCliente(url!, async (c) => {
        await c.query('DELETE FROM tenant_feature_overrides WHERE id = $1', [`tfo${marca}`]);
        await c.query('DELETE FROM tenants WHERE id = ANY($1)', [Object.values(tenants)]);
      });
    }
  });
});

describe.skipIf(!url)('aplicarSomenteAPendente de ProfessionalCommissions (banco temporário)', () => {
  const banco = `comissoes_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  const urlDoBanco = () => {
    const u = new URL(url!);
    u.pathname = `/${banco}`;
    return u.toString();
  };
  const historico = () =>
    comCliente(urlDoBanco(), async (c) => (await c.query<{ name: string }>('SELECT name FROM typeorm_migrations ORDER BY id')).rows.map((r) => r.name));
  const estado = () => comCliente(urlDoBanco(), (c) => lerEstadoComissoes(c as unknown as PgClientLike));
  const catalogo = () => comCliente(urlDoBanco(), (c) => lerSomasDoCatalogo(c as unknown as PgClientLike));
  const destino = (): Destino => {
    const u = new URL(url!);
    return {
      url: urlDoBanco(),
      host: u.hostname,
      // O certificado descartável é emitido para localhost (CN/SAN).
      servidorTls: 'localhost',
      port: Number(u.port || 5432),
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: banco,
      channelBinding: false,
    };
  };

  let posteriores: string[] = [];
  async function aplicar(esperadasAntes: readonly string[]) {
    const linhas: string[] = [];
    let iniciou = false;
    try {
      const aplicadas = await aplicarSomenteAPendente(destino(), {
        esperadasAntes: [...esperadasAntes],
        pendente: MIGRATION,
        // Migrations criadas depois desta no futuro: o kit as recusaria de
        // propósito; aqui ficam de fora para provar a aplicação desta.
        ...(posteriores.length ? { posteriores } : {}),
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
      expect(compiladas.slice(0, MIGRATIONS_ATE_COMISSOES.length)).toEqual([...MIGRATIONS_ATE_COMISSOES]);
      posteriores = compiladas.slice(MIGRATIONS_ATE_COMISSOES.length);
      ds.migrations.splice(MIGRATIONS_ATE_NOMES_CONGELADOS.length);
      await ds.runMigrations({ transaction: 'all' });
    } finally {
      await ds.destroy();
    }
  }, 180_000);

  afterAll(async () => {
    await comCliente(url!, (c) => c.query(`DROP DATABASE IF EXISTS "${banco}" WITH (FORCE)`));
  });

  it('14 → 15: só ProfessionalCommissions, objetos exatos, catálogo preservado além da linha nova; repetição recusada', async () => {
    expect(await historico()).toEqual([...MIGRATIONS_ATE_NOMES_CONGELADOS]);
    expect(falhasAntesDeComissoes(await estado())).toEqual([]);
    const fotoAntes = await comCliente(urlDoBanco(), async (c) => {
      await c.query('BEGIN TRANSACTION READ ONLY');
      try {
        return await fotografar(c);
      } finally {
        await c.query('ROLLBACK');
      }
    });
    const catalogoAntes = await catalogo();
    // No "antes", a soma do catálogo é a mesma da fotografia do backup.
    expect(catalogoAlterado(fotoAntes.somas, catalogoAntes)).toEqual([]);

    // Pendente errada ou histórico errado: para antes de qualquer comando.
    const errado = await aplicar(MIGRATIONS_ATE_COMISSOES);
    expect(errado).toMatchObject({ codigo: 'ERR_HISTORICO_DE_MIGRATIONS_INESPERADO', iniciou: false });

    const r = await aplicar(MIGRATIONS_ATE_NOMES_CONGELADOS);
    expect(r).toMatchObject({ codigo: null, iniciou: true, aplicadas: [MIGRATION] });
    expect(r.linhas).toEqual(
      expect.arrayContaining(['MIGRATIONS_NO_HISTORICO: 14', `PENDENTE: ${MIGRATION}`, `APLICADAS: ${MIGRATION}`, 'SESSAO_DA_MIGRATION: mesma=true lock_timeout=10s']),
    );
    expect(await historico()).toEqual([...MIGRATIONS_ATE_COMISSOES]);
    expect(falhasDepoisDeComissoes(await estado())).toEqual([]);
    expect(catalogoAlterado(fotoAntes.somas, await catalogo())).toEqual([]);

    const deNovo = await aplicar(MIGRATIONS_ATE_NOMES_CONGELADOS);
    expect(deNovo).toMatchObject({ codigo: 'ERR_HISTORICO_DE_MIGRATIONS_INESPERADO', iniciou: false });
    expect(await historico()).toEqual([...MIGRATIONS_ATE_COMISSOES]);
  });
});
