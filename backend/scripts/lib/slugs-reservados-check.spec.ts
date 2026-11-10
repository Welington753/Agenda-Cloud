// Conferência de colisões de slug, sem banco: a cópia da lista bate com a
// fonte do backend; a leitura é só leitura e a saída não traz dado pessoal.
// Contra PostgreSQL descartável: test/tenant-test-flag.db-e2e-spec.ts.
import { describe, expect, it, vi } from 'vitest';
import { RESERVED_SLUGS } from '../../src/common/reserved-slugs.js';
import type { PgClientLike } from './pg-client.js';
import { SLUGS_RESERVADOS, checkReservedSlugCollisions, descreverColisoes } from './slugs-reservados-check.js';

const PILOT_ID = 'ep-pilot-forest-111111';
const PILOT_URL = `postgresql://user:segredo-do-piloto@${PILOT_ID}.sa-east-1.aws.neon.tech/neondb?sslmode=verify-full`;
const ENV = { PILOT_DIRECT_URL: PILOT_URL, PILOT_ENDPOINT_ID: PILOT_ID, PRODUCTION_ENDPOINT_ID: 'ep-prod-river-222222' };

function fakeClient(colisoes: Array<{ slug: string; status: string }>) {
  const sql: string[] = [];
  const client = {
    connect: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockImplementation(async (texto: string) => {
      sql.push(texto);
      if (/count\(\*\)/.test(texto)) return { rows: [{ total: '7' }] };
      if (/ANY\(\$1::text\[\]\)/.test(texto)) return { rows: colisoes };
      return { rows: [] };
    }),
    end: vi.fn().mockResolvedValue(undefined),
  } as unknown as PgClientLike;
  return { client, sql };
}

describe('lista de slugs reservados nos scripts', () => {
  it('é a mesma de src/common/reserved-slugs.ts', () => {
    expect([...SLUGS_RESERVADOS]).toEqual([...RESERVED_SLUGS]);
  });
});

describe('checkReservedSlugCollisions', () => {
  it('só leitura, lista as colisões e não renomeia', async () => {
    const { client, sql } = fakeClient([{ slug: 'portal', status: 'ACTIVE' }]);
    const linhas: string[] = [];
    const r = await checkReservedSlugCollisions({ env: ENV, createClient: async () => client, log: (l) => linhas.push(l) });
    expect(r).toEqual({ success: true });
    expect(sql[0]).toBe('BEGIN TRANSACTION READ ONLY');
    expect(sql.at(-1)).toBe('ROLLBACK');
    expect(sql.some((s) => /\b(UPDATE|INSERT|DELETE|ALTER|DROP)\b/i.test(s))).toBe(false);
    expect(linhas).toContain('COLISOES: 1');
    expect(linhas).toContain('COLISAO: portal (situacao=ACTIVE; continua em /agendar/portal)');
    expect(linhas.join('\n')).not.toContain(PILOT_ID);
    expect(linhas.join('\n')).not.toContain('segredo');
  });

  it('sem colisão também é sucesso', async () => {
    const { client } = fakeClient([]);
    const linhas: string[] = [];
    await checkReservedSlugCollisions({ env: ENV, createClient: async () => client, log: (l) => linhas.push(l) });
    expect(linhas).toContain('COLISOES: 0');
  });

  it('recusa destino sem verificação TLS antes de conectar', async () => {
    const createClient = vi.fn();
    const r = await checkReservedSlugCollisions({
      env: { ...ENV, PILOT_DIRECT_URL: PILOT_URL.replace('verify-full', 'no-verify') },
      createClient,
      log: () => undefined,
    });
    expect(r).toEqual({ success: false, code: 'ERR_TLS_VERIFICATION_DISABLED' });
    expect(createClient).not.toHaveBeenCalled();
  });

  it('recusa piloto igual a production antes de conectar', async () => {
    const createClient = vi.fn();
    const r = await checkReservedSlugCollisions({
      env: { ...ENV, PRODUCTION_ENDPOINT_ID: PILOT_ID },
      createClient,
      log: () => undefined,
    });
    expect(r).toEqual({ success: false, code: 'ERR_PILOT_AS_PRODUCTION' });
    expect(createClient).not.toHaveBeenCalled();
  });

  it('a descrição sempre lembra que nada foi renomeado', () => {
    expect(descreverColisoes({ estabelecimentos: 0, colisoes: [] }).at(-1)).toMatch(/nada foi renomeado/);
  });
});
