// A conferência só-leitura de PlatformPortal e AppointmentServiceSnapshots
// (scripts/lib/portal-multisservicos-schema.ts) e as consultas do runbook
// (docs/runbooks/consultas/*-portal-multisservicos*.sql e
// contas-com-papel-global-somente-leitura.sql) rodadas contra o PostgreSQL
// DESCARTÁVEL já migrado: as consultas são válidas, o banco com as catorze
// migrations passa no estado final e é recusado nos outros dois, e o
// levantamento mostra só ids. Dados fictícios, removidos no fim.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import {
  MIGRATIONS_ATE_NOMES_CONGELADOS,
  TOTAL_OBJETOS_PORTAL_MULTISSERVICOS,
  descreverImpactoPortalMultisservicos,
  falhasAntesDoPortal,
  falhasDepoisDoPortal,
  falhasDepoisDosNomesCongelados,
  lerEfeitoDaReversao,
  lerEstadoPortalMultisservicos,
  lerImpactoPortalMultisservicos,
  objetosPortalMultisservicosPresentes,
} from '../scripts/lib/portal-multisservicos-schema.js';
import type { PgClientLike } from '../scripts/lib/pg-client.js';

const url = process.env.DB_E2E_DIRECT_URL;
if (url && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)) {
  throw new Error('Este teste exige PostgreSQL descartável local.');
}
const CONSULTAS = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../docs/runbooks/consultas');

type Resposta = { command: string; rows: Record<string, unknown>[] };
const soLeitura = (respostas: Resposta[]) => {
  const comandos = respostas.map((r) => r.command);
  expect(comandos[0]).toBe('BEGIN');
  expect(comandos.at(-1)).toBe('ROLLBACK');
  expect(comandos.filter((c) => !['BEGIN', 'SELECT', 'ROLLBACK', 'SET'].includes(c))).toEqual([]);
};

describe.skipIf(!url)('conferência de PlatformPortal e AppointmentServiceSnapshots contra PostgreSQL descartável', () => {
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

  it('banco com as catorze migrations passa no estado final e é recusado no antes e no intermediário', async () => {
    const lido = await comLeitor(lerEstadoPortalMultisservicos);
    // Outras suítes podem ter migrations depois destas no futuro: o recorte
    // confere as catorze, na ordem.
    const estado = { ...lido, migrationNames: lido.migrationNames.slice(0, 14) };
    expect(estado.migrationNames).toEqual([...MIGRATIONS_ATE_NOMES_CONGELADOS]);
    expect(falhasDepoisDosNomesCongelados(estado)).toEqual([]);
    expect(objetosPortalMultisservicosPresentes(estado)).toBe(TOTAL_OBJETOS_PORTAL_MULTISSERVICOS);
    expect(falhasDepoisDoPortal(estado)).toEqual(['migration_history', 'service_name_snapshot_column_already_exists']);
    expect(falhasAntesDoPortal(estado)).toEqual([
      'migration_history',
      'portal_enum_values_already_exist',
      'portal_tables_already_exist',
      'portal_objects_already_exist',
      'amount_source_column_already_exists',
      'service_name_snapshot_column_already_exists',
    ]);
    const reversao = await comLeitor(lerEfeitoDaReversao);
    expect(Object.keys(reversao).sort()).toEqual(
      [
        'nomesCongeladosApagados',
        'origensDoValorApagadas',
        'precosContratadosApagados',
        'precosDoCatalogoApagados',
        'reservasComVariosItensQueFicam',
        'semVencimentoApagados',
        'semVencimentoEmVigorApagados',
      ].sort(),
    );
  });

  it('levantamento e consultas: contas só por id, nenhuma escrita; a consulta com identificação mostra nome só ali', async () => {
    const id = () => randomUUID().replaceAll('-', '').slice(0, 25);
    const delegado = id();
    const nome = `Pessoa fictícia ${delegado.slice(0, 6)}`;
    const email = `${delegado}@example.test`;
    await comCliente((c) =>
      c.query(
        `INSERT INTO users (id, name, email, status, email_verified, platform_role, platform_permissions)
         VALUES ($1, $2, $3, 'ACTIVE', true, 'MASTER_SUPPORT', '{ESTABLISHMENTS_MANAGE}')`,
        [delegado, nome, email],
      ),
    );
    try {
      const impacto = await comLeitor(lerImpactoPortalMultisservicos);
      expect(impacto.delegadosAtivos).toBeGreaterThanOrEqual(1);
      expect(impacto.contas).toContainEqual(expect.objectContaining({ id: delegado, papel: 'MASTER_SUPPORT', situacao: 'ACTIVE' }));
      for (const campo of ['precosDoCatalogo', 'precosContratados', 'semVencimento', 'pagosSemOrigem', 'itensSemNomeCongelado'] as const) {
        expect(impacto[campo]).not.toBeNull();
      }
      const linhas = descreverImpactoPortalMultisservicos(impacto);
      expect(linhas).toContainEqual(expect.stringMatching(new RegExp(`^CONTA_COM_PAPEL_GLOBAL: id=${delegado} papel=MASTER_SUPPORT situacao=ACTIVE `)));
      expect(linhas).toContainEqual(expect.stringMatching(/^DELEGADOS_ATIVOS_QUE_PERDEM_O_PORTAL: [1-9]\d*$/));
      expect(linhas.join('\n')).not.toContain(nome);
      expect(linhas.join('\n')).not.toContain(email);

      const impactoSql = await comCliente(
        async (c) => (await c.query(readFileSync(path.join(CONSULTAS, 'impacto-portal-multisservicos-somente-leitura.sql'), 'utf8'))) as unknown as Resposta[],
      );
      soLeitura(impactoSql);
      const linhasSql = impactoSql.flatMap((r) => r.rows);
      expect(linhasSql).toContainEqual(expect.objectContaining({ id: delegado, papel: 'MASTER_SUPPORT' }));
      expect(JSON.stringify(linhasSql)).not.toContain(email);

      const identificadas = await comCliente(
        async (c) => (await c.query(readFileSync(path.join(CONSULTAS, 'contas-com-papel-global-somente-leitura.sql'), 'utf8'))) as unknown as Resposta[],
      );
      soLeitura(identificadas);
      expect(identificadas.flatMap((r) => r.rows)).toContainEqual(expect.objectContaining({ id: delegado, nome, email }));
    } finally {
      await comCliente((c) => c.query('DELETE FROM users WHERE id = $1', [delegado]));
    }
  });
});
