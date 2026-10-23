import { describe, expect, it } from 'vitest';
import {
  ACOES_NOVAS,
  COLUNAS_NOVAS,
  CONSTRAINTS_NOVAS,
  INDICES_NOVOS,
  MIGRATION_CONTAS,
  MIGRATIONS_ATE_WEB_PUSH,
  TOTAL_OBJETOS_CONTAS,
  falhasAntesDeContas,
  falhasDepoisDeContas,
  lerEstadoContas,
  objetosPresentes,
  type EstadoContas,
} from './contas-administracao-schema.js';
import type { PgClientLike } from './pg-client.js';

const antes: EstadoContas = {
  migrationNames: [...MIGRATIONS_ATE_WEB_PUSH],
  tabelaPasswordResets: false,
  colunas: [],
  constraints: [],
  indices: [],
  acoes: [],
  convitesIncoerentes: 0,
  convitesPendentesDuplicados: 0,
};

const depois: EstadoContas = {
  ...antes,
  migrationNames: [...MIGRATIONS_ATE_WEB_PUSH, MIGRATION_CONTAS],
  tabelaPasswordResets: true,
  colunas: COLUNAS_NOVAS.map(([t, c]) => `${t}.${c}`),
  constraints: [...CONSTRAINTS_NOVAS],
  indices: [...INDICES_NOVOS],
  acoes: [...ACOES_NOVAS],
};

describe('conferência da migration de contas no piloto', () => {
  it('antes: seis migrations exatas, nada novo e nenhum convite que as constraints recusariam', () => {
    expect(falhasAntesDeContas(antes)).toEqual([]);
    expect(falhasAntesDeContas({ ...antes, migrationNames: antes.migrationNames.slice(0, 5) })).toEqual(['migration_history']);
    expect(falhasAntesDeContas({ ...antes, convitesIncoerentes: 1, convitesPendentesDuplicados: 2 })).toEqual([
      'invites_incoherent_rows',
      'invites_duplicated_pending',
    ]);
    expect(falhasAntesDeContas(depois)).toContain('password_resets_already_exists');
  });

  it('depois: sete migrations na ordem e cada objeto pelo nome', () => {
    expect(falhasDepoisDeContas(depois)).toEqual([]);
    expect(objetosPresentes(depois)).toBe(TOTAL_OBJETOS_CONTAS);
    expect(falhasDepoisDeContas({ ...depois, indices: depois.indices.slice(1) })).toEqual([INDICES_NOVOS[0]]);
    expect(falhasDepoisDeContas({ ...depois, migrationNames: [...antes.migrationNames] })).toEqual(['migration_history']);
  });

  it('lê só em transação READ ONLY e sempre termina em ROLLBACK', async () => {
    const sqls: string[] = [];
    const client: PgClientLike = {
      connect: async () => undefined,
      end: async () => undefined,
      query: async <T>(sql: string) => {
        sqls.push(sql);
        if (sql.includes('typeorm_migrations')) return { rows: MIGRATIONS_ATE_WEB_PUSH.map((name) => ({ name })) as T[] };
        if (sql.includes('count(*)::text')) return { rows: [{ total: '0' }] as T[] };
        if (sql.includes('to_regclass')) return { rows: [{ presente: false }] as T[] };
        return { rows: [] };
      },
    };
    expect(falhasAntesDeContas(await lerEstadoContas(client))).toEqual([]);
    expect(sqls[0]).toBe('BEGIN TRANSACTION READ ONLY');
    expect(sqls.at(-1)).toBe('ROLLBACK');
    expect(sqls.some((sql) => /\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b/i.test(sql))).toBe(false);
  });
});
