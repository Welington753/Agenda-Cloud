// A conferência só-leitura de CommercialAccess (scripts/lib/acesso-comercial-schema.ts)
// e a consulta de impacto do runbook (docs/runbooks/consultas/impacto-comercial-somente-leitura.sql)
// rodadas contra o PostgreSQL DESCARTÁVEL já migrado: as consultas são
// válidas, o banco migrado passa no "depois" e é recusado no "antes", e o
// levantamento segue a regra do recurso da aplicação (commercial-gate.ts).
// Dados fictícios num estabelecimento próprio, removidos no fim.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import {
  MIGRATIONS_ATE_GERENTE,
  MIGRATION_COMERCIAL,
  TOTAL_OBJETOS_COMERCIAL,
  descreverImpactoComercial,
  falhasAntesDeComercial,
  falhasDepoisDeComercial,
  lerEfeitoDaReversao,
  lerEstadoComercial,
  lerImpactoComercial,
  objetosComercialPresentes,
} from '../scripts/lib/acesso-comercial-schema.js';
import type { PgClientLike } from '../scripts/lib/pg-client.js';

const url = process.env.DB_E2E_DIRECT_URL;
if (url && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)) {
  throw new Error('Este teste exige PostgreSQL descartável local.');
}
const CONSULTAS = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../docs/runbooks/consultas');
const CONSULTA = path.join(CONSULTAS, 'impacto-comercial-somente-leitura.sql');
const CONSULTA_DEPOIS = path.join(CONSULTAS, 'validade-depois-somente-leitura.sql');

type Resposta = { command: string; rows: Record<string, unknown>[] };
const soLeitura = (respostas: Resposta[]) => {
  const comandos = respostas.map((r) => r.command);
  expect(comandos[0]).toBe('BEGIN');
  expect(comandos.at(-1)).toBe('ROLLBACK');
  expect(comandos.filter((c) => !['BEGIN', 'SELECT', 'ROLLBACK', 'SET'].includes(c))).toEqual([]);
};

describe.skipIf(!url)('conferência de CommercialAccess contra PostgreSQL descartável', () => {
  async function comCliente<T>(fn: (client: Client) => Promise<T>): Promise<T> {
    const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: true } });
    await client.connect();
    try {
      return await fn(client);
    } finally {
      await client.end();
    }
  }
  const comLeitor = <T>(ler: (client: PgClientLike) => Promise<T>) => comCliente((c) => ler(c as unknown as PgClientLike));

  it('banco com as doze migrations passa no "depois" e é recusado no "antes"', async () => {
    const lido = await comLeitor(lerEstadoComercial);
    const estado = { ...lido, migrationNames: lido.migrationNames.slice(0, 12), excecoesDesligadas: 0 };
    expect(estado.migrationNames).toEqual([...MIGRATIONS_ATE_GERENTE, MIGRATION_COMERCIAL]);
    expect(falhasDepoisDeComercial(estado)).toEqual([]);
    expect(objetosComercialPresentes(estado)).toBe(TOTAL_OBJETOS_COMERCIAL);
    expect(falhasAntesDeComercial(estado)).toEqual([
      'migration_history',
      'new_enum_values_already_exist',
      'new_types_already_exist',
      'access_periods_table_already_exists',
      'access_periods_objects_already_exist',
      'legacy_column_already_exists',
      'plan_names_or_codes_unexpected',
      'catalog_rows_already_exist',
    ]);
    const reversao = await comLeitor(lerEfeitoDaReversao);
    expect(Object.keys(reversao).sort()).toEqual(
      [
        'anulacoesApagadas',
        'cortesiasApagadas',
        'estabelecimentosSemMarca',
        'excecoesApagadas',
        'linhasDoCatalogoApagadas',
        'marcasDeAnteriorApagadas',
        'pagamentosApagados',
        'periodosApagados',
        'registrosDeAuditoriaQueFicam',
        'testesApagados',
      ].sort(),
    );
    expect(reversao.linhasDoCatalogoApagadas).toBe(4);
  });

  it('exceção desligada aparece (só ids), conta como recurso negado e a consulta do runbook não escreve', async () => {
    const id = () => randomUUID().replaceAll('-', '').slice(0, 25);
    const tenant = id();
    const plano = id();
    const marca = `comercial-${tenant.slice(0, 8)}`;
    const excecao = id();
    await comCliente(async (c) => {
      await c.query(
        `INSERT INTO plans (id, code, name, short_description, max_professionals, max_units) VALUES ($1, $2, 'Plano sem recursos', '', 2, 1)`,
        [plano, marca],
      );
      await c.query(
        `INSERT INTO tenants (id, slug, category, timezone, plan_id, status, access_legacy_since) VALUES ($1, $2, 'OTHER', 'America/Sao_Paulo', $3, 'ACTIVE', now())`,
        [tenant, marca, plano],
      );
      await c.query(`INSERT INTO tenant_feature_overrides (id, tenant_id, feature_id, enabled) VALUES ($1, $2, 'feat_agenda', false)`, [
        excecao,
        tenant,
      ]);
    });
    try {
      const impacto = await comLeitor(lerImpactoComercial);
      expect(impacto.desligadas).toContainEqual({ tenantId: tenant, featureId: 'feat_agenda' });
      expect(impacto.excecoesDesligadas).toBeGreaterThanOrEqual(1);
      // Agenda desligada à mão + os outros cinco recursos sem catálogo nem exceção.
      expect(impacto.recursosNegados).toBeGreaterThanOrEqual(6);
      expect(impacto.porPlano.find((p) => p.planoId === plano)).toEqual({ planoId: plano, codigo: marca, estabelecimentos: 1 });
      const linhas = descreverImpactoComercial(impacto);
      expect(linhas).toContain(`EXCECAO_DESLIGADA: tenant=${tenant} recurso=feat_agenda`);
      expect(linhas.join('\n')).not.toContain('Plano sem recursos');

      const sql = readFileSync(CONSULTA, 'utf8');
      const resultado = await comCliente(async (c) => (await c.query(sql)) as unknown as Resposta[]);
      soLeitura(resultado);
      const linhasDoEstabelecimento = resultado.flatMap((r) => r.rows).filter((l) => l.tenant_id === tenant);
      expect(linhasDoEstabelecimento).toContainEqual(expect.objectContaining({ feature_id: 'feat_agenda', efeito: 'NEGADO' }));
      expect(linhasDoEstabelecimento).toContainEqual(expect.objectContaining({ feature_id: 'feat_equipe', efeito: 'excecao_da_migration' }));

      // Depois da migration: um estabelecimento sem a marca e sem período
      // (como os criados pela API anterior num retorno) aparece bloqueado.
      await comCliente((c) => c.query('UPDATE tenants SET access_legacy_since = NULL WHERE id = $1', [tenant]));
      const depois = await comCliente(async (c) => (await c.query(readFileSync(CONSULTA_DEPOIS, 'utf8'))) as unknown as Resposta[]);
      soLeitura(depois);
      // O levantamento da fase conferir conta o mesmo caso (janela violada).
      const comBloqueado = await comLeitor(lerImpactoComercial);
      expect(comBloqueado.semMarcaESemPeriodo).toBeGreaterThanOrEqual(1);
      expect(descreverImpactoComercial(comBloqueado)).toContainEqual(expect.stringMatching(/^CONTAS_QUE_CRIAM_ESTABELECIMENTO: \d+$/));
      expect(depois.flatMap((r) => r.rows).find((l) => l.tenant_id === tenant)).toMatchObject({
        marcado_como_anterior: false,
        validade: 'sem_validade',
      });
    } finally {
      await comCliente(async (c) => {
        await c.query('DELETE FROM tenant_feature_overrides WHERE id = $1', [excecao]);
        await c.query('DELETE FROM tenants WHERE id = $1', [tenant]);
        await c.query('DELETE FROM plans WHERE id = $1', [plano]);
      });
    }
  });
});
