// Coleta do alcance real sobre uma CÓPIA RESTAURADA num PostgreSQL
// descartável local (roteiro docs/runbooks/ensaio-alcance-real-permissoes.md).
// Só roda com `ALCANCE_SAIDA` (arquivo JSON de saída, fora do repositório);
// no CI e na bateria comum fica desligado.
//
// Roda igual com o código do piloto (8f71335, este arquivo e o coletor
// copiados para uma worktree desse commit) e com o código atual. Confere
// antes e depois da coleta o md5 de cada tabela: a coleta não pode escrever.
import { createHash } from 'node:crypto';
import { globSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DataSource } from 'typeorm';
import { buildRuntimeDataSourceOptions } from '../../src/database/runtime-data-source.js';
import { coletarAlcance } from './coletar-alcance.js';

const url = process.env.DB_E2E_DIRECT_URL;
const saida = process.env.ALCANCE_SAIDA;
if (saida && url && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)) {
  throw new Error('A coleta da cópia exige PostgreSQL descartável local.');
}

async function md5DasTabelas(db: DataSource): Promise<Record<string, string>> {
  const tabelas = (await db.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
  )) as { tablename: string }[];
  const out: Record<string, string> = {};
  for (const { tablename } of tabelas) {
    const [linha] = (await db.query(
      `SELECT count(*)::int AS n, coalesce(md5(string_agg(t::text, '|' ORDER BY t::text)), '') AS h FROM "${tablename.replaceAll('"', '')}" t`,
    )) as { n: number; h: string }[];
    out[tablename] = `${linha.n}:${linha.h}`;
  }
  return out;
}

describe.skipIf(!url || !saida)('coleta do alcance real numa cópia restaurada', () => {
  it('coleta todos os vínculos sem escrever no banco', async () => {
    const directoryPath = path.dirname(fileURLToPath(import.meta.url));
    const entities: (new () => object)[] = [];
    for (const file of globSync(path.join(directoryPath, '../../src/entities/**/*.entity.ts'))) {
      const exports = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
      for (const value of Object.values(exports)) if (typeof value === 'function') entities.push(value as new () => object);
    }
    const db = new DataSource({ ...buildRuntimeDataSourceOptions(url!), entities, logging: ['error'] });
    await db.initialize();
    try {
      const [{ n: migracoes }] = (await db.query('SELECT count(*)::int AS n FROM typeorm_migrations')) as { n: number }[];
      const antes = await md5DasTabelas(db);
      const coleta = await coletarAlcance(db, {
        agora: new Date(process.env.ALCANCE_AGORA ?? '2026-11-26T15:00:00.000Z'),
        de: process.env.ALCANCE_DE ?? '2026-01-01',
        ate: process.env.ALCANCE_ATE ?? '2026-12-31',
        dia: process.env.ALCANCE_DIA ?? '2026-11-27',
      });
      const depois = await md5DasTabelas(db);
      const alteradas = Object.keys({ ...antes, ...depois }).filter((t) => antes[t] !== depois[t]);
      const conteudo = JSON.stringify({ migracoes, tabelasAlteradas: alteradas, ...coleta }, null, 1);
      writeFileSync(saida!, conteudo);
      console.log(
        `coleta: ${coleta.vinculos.length} vínculos, ${migracoes} migrations, tabelas alteradas ${alteradas.length}, sha256 ${createHash('sha256').update(conteudo).digest('hex').slice(0, 16)}`,
      );
      expect(alteradas).toEqual([]);
    } finally {
      await db.destroy();
    }
  }, 600_000);
});
