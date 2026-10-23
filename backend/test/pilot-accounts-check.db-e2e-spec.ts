// A conferência só-leitura do piloto (scripts/lib/contas-administracao-schema.ts)
// rodada contra o PostgreSQL DESCARTÁVEL já migrado: prova que as consultas
// são válidas e que o banco migrado passa no estado "depois".
import { Client } from 'pg';
import { falhasDepoisDeContas, lerEstadoContas, objetosPresentes, TOTAL_OBJETOS_CONTAS } from '../scripts/lib/contas-administracao-schema.js';

const url = process.env.DB_E2E_DIRECT_URL;
if (url && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)) {
  throw new Error('Este teste exige PostgreSQL descartável local.');
}

describe.skipIf(!url)('conferência da migration de contas contra PostgreSQL descartável', () => {
  it('banco com as sete migrations passa no estado "depois" sem escrever nada', async () => {
    const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: true } });
    await client.connect();
    try {
      const estado = await lerEstadoContas(client);
      expect(falhasDepoisDeContas(estado)).toEqual([]);
      expect(objetosPresentes(estado)).toBe(TOTAL_OBJETOS_CONTAS);
    } finally {
      await client.end();
    }
  });
});
