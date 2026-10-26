// A conferência só-leitura do piloto (scripts/lib/contas-administracao-schema.ts
// e scripts/lib/equipe-acessos-schema.ts) rodada contra o PostgreSQL
// DESCARTÁVEL já migrado: prova que as consultas são válidas e que o banco
// migrado passa no estado "depois" de cada uma.
import { Client } from 'pg';
import { falhasDepoisDeContas, lerEstadoContas, objetosPresentes, TOTAL_OBJETOS_CONTAS } from '../scripts/lib/contas-administracao-schema.js';
import {
  MIGRATIONS_ATE_CONTAS,
  MIGRATION_EQUIPE,
  falhasAntesDeEquipe,
  falhasDepoisDeEquipe,
  lerEstadoEquipe,
  objetosEquipePresentes,
  TOTAL_OBJETOS_EQUIPE,
} from '../scripts/lib/equipe-acessos-schema.js';

const url = process.env.DB_E2E_DIRECT_URL;
if (url && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)) {
  throw new Error('Este teste exige PostgreSQL descartável local.');
}

describe.skipIf(!url)('conferências das migrations do piloto contra PostgreSQL descartável', () => {
  async function comCliente<T>(fn: (client: Client) => Promise<T>): Promise<T> {
    const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: true } });
    await client.connect();
    try {
      return await fn(client);
    } finally {
      await client.end();
    }
  }

  it('contas: as sete primeiras migrations e cada objeto de AccountsAdministration, sem escrever nada', async () => {
    const estado = await comCliente(lerEstadoContas);
    // O banco descartável já tem também a migration seguinte (TeamAccess): a
    // conferência de contas vale para o histórico até ela.
    expect(estado.migrationNames).toEqual([...MIGRATIONS_ATE_CONTAS, MIGRATION_EQUIPE]);
    expect(falhasDepoisDeContas({ ...estado, migrationNames: [...MIGRATIONS_ATE_CONTAS] })).toEqual([]);
    expect(objetosPresentes(estado)).toBe(TOTAL_OBJETOS_CONTAS);
  });

  it('equipe: banco com as oito migrations passa no "depois" e é recusado no "antes"', async () => {
    const estado = await comCliente(lerEstadoEquipe);
    expect(falhasDepoisDeEquipe(estado)).toEqual([]);
    expect(objetosEquipePresentes(estado)).toBe(TOTAL_OBJETOS_EQUIPE);
    expect(falhasAntesDeEquipe(estado)).toEqual([
      'migration_history',
      'new_columns_already_exist',
      'new_constraints_already_exist',
      'new_indexes_already_exist',
    ]);
  });
});
