// A conferência só-leitura de TeamManagerAccess (scripts/lib/gerente-acessos-schema.ts)
// e a consulta de impacto do runbook (docs/runbooks/consultas/impacto-gerente-somente-leitura.sql)
// rodadas contra o PostgreSQL DESCARTÁVEL já migrado: as consultas são
// válidas, o banco migrado passa no "depois" e é recusado no "antes", e o
// levantamento das vagas segue a regra da aplicação (team/seats.ts). Dados
// fictícios num estabelecimento próprio.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import {
  MIGRATIONS_ATE_PAGAMENTOS,
  MIGRATION_GERENTE,
  TOTAL_OBJETOS_GERENTE,
  descreverImpactoDoGerente,
  falhasAntesDeGerente,
  falhasDepoisDeGerente,
  lerEfeitoDaReversao,
  lerEstadoGerente,
  lerImpactoDoGerente,
  objetosGerentePresentes,
} from '../scripts/lib/gerente-acessos-schema.js';
import type { PgClientLike } from '../scripts/lib/pg-client.js';

const url = process.env.DB_E2E_DIRECT_URL;
if (url && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)) {
  throw new Error('Este teste exige PostgreSQL descartável local.');
}
const CONSULTA = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../docs/runbooks/consultas/impacto-gerente-somente-leitura.sql',
);

describe.skipIf(!url)('conferência de TeamManagerAccess contra PostgreSQL descartável', () => {
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

  it('banco com as onze migrations passa no "depois" e é recusado no "antes"', async () => {
    const lido = await comLeitor(lerEstadoGerente);
    const estado = { ...lido, migrationNames: lido.migrationNames.slice(0, 11) };
    expect(estado.migrationNames).toEqual([...MIGRATIONS_ATE_PAGAMENTOS, MIGRATION_GERENTE]);
    expect(falhasDepoisDeGerente(estado)).toEqual([]);
    expect(objetosGerentePresentes(estado)).toBe(TOTAL_OBJETOS_GERENTE);
    expect(falhasAntesDeGerente(estado)).toEqual([
      'migration_history',
      'new_columns_already_exist',
      'new_enum_values_already_exist',
      'login_guard_function_already_exists',
      'login_guard_trigger_already_exists',
      'username_format_novo',
    ]);
    const reversao = await comLeitor(lerEfeitoDaReversao);
    expect(Object.keys(reversao).sort()).toEqual(
      ['ajustesComValoresNovos', 'gerentesAtivos', 'loginsForaDoFormatoAnterior', 'vinculosConfirmados'].sort(),
    );
  });

  it('levantamento das vagas: gerentes ativos passam a contar, o dono e os suspensos não; nada é escrito', async () => {
    const id = () => randomUUID().replaceAll('-', '').slice(0, 25);
    const tenant = id();
    const plano = id();
    const pessoas = [id(), id(), id(), id()];
    const marca = `impacto-${tenant.slice(0, 8)}`;
    await comCliente(async (c) => {
      await c.query(
        `INSERT INTO plans (id, code, name, short_description, max_professionals, max_units) VALUES ($1, $2, 'Plano 2', '', 2, 1)`,
        [plano, marca],
      );
      await c.query(
        `INSERT INTO tenants (id, slug, category, timezone, plan_id, status) VALUES ($1, $2, 'OTHER', 'America/Sao_Paulo', $3, 'ACTIVE')`,
        [tenant, marca, plano],
      );
      for (const [i, pessoa] of pessoas.entries()) {
        await c.query(`INSERT INTO users (id, name, email, status) VALUES ($1, 'Pessoa', $2, 'ACTIVE')`, [
          pessoa,
          `${marca}-${i}@example.test`,
        ]);
      }
      // Dono (fora), um PROFISSIONAL sem profissional ligado (vínculo antigo),
      // dois gerentes ativos (um com GRANTED antigo) e um gerente suspenso.
      const vinculos = [
        [pessoas[0], 'DONO', 'ACTIVE'],
        [pessoas[1], 'GERENTE', 'ACTIVE'],
        [pessoas[2], 'GERENTE', 'ACTIVE'],
        [pessoas[3], 'GERENTE', 'SUSPENDED'],
      ];
      for (const [pessoa, papel, situacao] of vinculos) {
        await c.query(
          `INSERT INTO memberships (id, user_id, tenant_id, role, status) VALUES ($1, $2, $3, $4::establishment_role, $5)`,
          [id(), pessoa, tenant, papel, situacao],
        );
      }
      const [{ id: gerente }] = (
        await c.query(`SELECT id FROM memberships WHERE tenant_id = $1 AND user_id = $2`, [tenant, pessoas[1]])
      ).rows as { id: string }[];
      await c.query(
        `INSERT INTO membership_permission_overrides (id, tenant_id, membership_id, permission, mode) VALUES ($1, $2, $3, 'AGENDA_VISUALIZAR', 'GRANTED')`,
        [id(), tenant, gerente],
      );
    });

    const impacto = await comLeitor(lerImpactoDoGerente);
    const meu = impacto.detalhes.find((d) => d.tenantId === tenant);
    expect(meu).toMatchObject({ limite: 2, acessosDeProfissional: 0, gerentesAtivos: 2, convitesPendentes: 0, vagasAntes: 0, vagasDepois: 2 });
    expect(impacto.passamAoLimite).toBeGreaterThanOrEqual(1);
    expect(impacto.gerentesComAjustesConcedidos).toBeGreaterThanOrEqual(1);
    expect(impacto.colisoesCruzadas).toBe(0);
    const linhas = descreverImpactoDoGerente(impacto);
    expect(linhas.find((l) => l.includes(`tenant=${tenant}`))).toContain('antes=0 depois=2');
    // Só ids, slug e contagens: nenhum e-mail sai.
    expect(linhas.join('\n')).not.toContain('@example.test');

    // A consulta do runbook dá o mesmo resultado e não escreve.
    const sql = readFileSync(CONSULTA, 'utf8');
    const resultado = await comCliente(async (c) => {
      const respostas = (await c.query(sql)) as unknown as { command: string; rows: Record<string, unknown>[] }[];
      return respostas;
    });
    const comandos = resultado.map((r) => r.command);
    expect(comandos[0]).toBe('BEGIN');
    expect(comandos.at(-1)).toBe('ROLLBACK');
    expect(comandos.filter((c) => !['BEGIN', 'SELECT', 'ROLLBACK', 'SET'].includes(c))).toEqual([]);
    const porEstabelecimento = resultado.flatMap((r) => r.rows).find((linha) => linha.tenant_id === tenant);
    expect(porEstabelecimento).toMatchObject({ limite: 2, gerentes_ativos: 2, vagas_antes: 0, vagas_depois: 2, situacao_das_vagas: 'passa_ao_limite' });
  });
});
