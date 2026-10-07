import { describe, expect, it, vi } from 'vitest';
import {
  EXPECTED_FEATURE_COUNT_POST_MIGRATION,
  EXPECTED_PLAN_COUNT_POST_MIGRATION,
  EXPECTED_PLAN_FEATURE_LINK_COUNT_POST_MIGRATION,
} from './baseline-checks.js';
import type { PgClientLike, PgQueryResult } from './pg-client.js';
import { assertPilotTarget, checkPilotDatabase, urlKeepsTlsVerification } from './pilot-database-check.js';

const PILOT_ID = 'ep-pilot-forest-111111';
const PRODUCTION_ID = 'ep-prod-river-222222';
const PILOT_URL = `postgresql://user:segredo-do-piloto@${PILOT_ID}.sa-east-1.aws.neon.tech/neondb?sslmode=verify-full`;

const ENV_VALIDO = {
  PILOT_EXPECT: 'empty',
  PILOT_DIRECT_URL: PILOT_URL,
  PILOT_ENDPOINT_ID: PILOT_ID,
  PRODUCTION_ENDPOINT_ID: PRODUCTION_ID,
};

/** Cliente falso: responde por trecho de SQL e registra tudo o que foi
 * executado, para provar que nenhuma escrita acontece. */
function fakeClient(respostas: Array<[RegExp, PgQueryResult<Record<string, unknown>>]>) {
  const sql: string[] = [];
  const client: PgClientLike = {
    connect: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockImplementation(async (texto: string) => {
      sql.push(texto);
      return respostas.find(([padrao]) => padrao.test(texto))?.[1] ?? { rows: [] };
    }),
    end: vi.fn().mockResolvedValue(undefined),
  };
  return { client, sql };
}

const BANCO_VAZIO: Array<[RegExp, PgQueryResult<Record<string, unknown>>]> = [
  [/information_schema\.tables/, { rows: [{ count: '0' }] }],
  [/to_regclass/, { rows: [{ present: false }] }],
];

const BANCO_INICIALIZADO: Array<[RegExp, PgQueryResult<Record<string, unknown>>]> = [
  [/FROM typeorm_migrations/, { rows: [{ count: '3' }] }],
  [/column_name = 'price_cents'/, { rows: [{ is_nullable: 'YES' }] }],
  [/FROM plans/, { rows: [{ count: String(EXPECTED_PLAN_COUNT_POST_MIGRATION) }] }],
  [/FROM features/, { rows: [{ count: String(EXPECTED_FEATURE_COUNT_POST_MIGRATION) }] }],
  [/FROM plan_features/, { rows: [{ count: String(EXPECTED_PLAN_FEATURE_LINK_COUNT_POST_MIGRATION) }] }],
  [/FROM tenants/, { rows: [{ count: '0' }] }],
  [/FROM users/, { rows: [{ count: '0' }] }],
];

async function rodar(env: Record<string, string | undefined>, respostas = BANCO_VAZIO) {
  const { client, sql } = fakeClient(respostas);
  const linhas: string[] = [];
  const createClient = vi.fn().mockResolvedValue(client);
  const resultado = await checkPilotDatabase({ env, createClient, log: (linha) => linhas.push(linha) });
  return { resultado, linhas, sql, createClient, client };
}

describe('assertPilotTarget (sem rede)', () => {
  it('aceita destino direto, do piloto, distinto de production e com TLS verificado', () => {
    expect(assertPilotTarget(ENV_VALIDO)).toEqual({ directUrl: PILOT_URL, expectation: 'empty' });
  });

  it.each([
    ['endpoint do piloto igual ao de production', { PRODUCTION_ENDPOINT_ID: PILOT_ID }, 'ERR_PILOT_AS_PRODUCTION'],
    ['URL de outro endpoint', { PILOT_ENDPOINT_ID: 'ep-outro-333333' }, 'ERR_ENDPOINT_MISMATCH'],
    [
      'URL pooler',
      { PILOT_DIRECT_URL: PILOT_URL.replace(PILOT_ID, `${PILOT_ID}-pooler`) },
      'ERR_POOLER_FORBIDDEN',
    ],
    ['sslmode=no-verify', { PILOT_DIRECT_URL: PILOT_URL.replace('verify-full', 'no-verify') }, 'ERR_TLS_VERIFICATION_DISABLED'],
    ['sslmode=disable', { PILOT_DIRECT_URL: PILOT_URL.replace('verify-full', 'disable') }, 'ERR_TLS_VERIFICATION_DISABLED'],
    ['expectativa ausente', { PILOT_EXPECT: undefined }, 'ERR_INVALID_EXPECTATION'],
    ['expectativa desconhecida', { PILOT_EXPECT: 'migrate' }, 'ERR_INVALID_EXPECTATION'],
    ['URL ausente', { PILOT_DIRECT_URL: undefined }, 'ERR_MISSING_SECRET'],
    ['endpoint de production ausente', { PRODUCTION_ENDPOINT_ID: undefined }, 'ERR_MISSING_SECRET'],
  ])('recusa %s', (_caso, alteracao, codigo) => {
    expect(() => assertPilotTarget({ ...ENV_VALIDO, ...alteracao })).toThrow(
      expect.objectContaining({ code: codigo }),
    );
  });

  it('urlKeepsTlsVerification segue a mesma regra do backend', () => {
    expect(urlKeepsTlsVerification('postgresql://u:p@h/db?sslmode=require')).toBe(true);
    expect(urlKeepsTlsVerification('postgresql://u:p@h/db?sslmode=require&uselibpqcompat=true')).toBe(false);
    expect(urlKeepsTlsVerification('postgresql://u:p@h/db?ssl=false')).toBe(false);
  });
});

describe('checkPilotDatabase', () => {
  it('destino errado: recusa antes de abrir qualquer conexão', async () => {
    const { resultado, createClient } = await rodar({ ...ENV_VALIDO, PRODUCTION_ENDPOINT_ID: PILOT_ID });
    expect(resultado).toEqual({ success: false, code: 'ERR_PILOT_AS_PRODUCTION' });
    expect(createClient).not.toHaveBeenCalled();
  });

  it('banco vazio: sucesso, só leitura, transação READ ONLY terminando em ROLLBACK', async () => {
    const { resultado, sql, client } = await rodar(ENV_VALIDO);
    expect(resultado).toEqual({ success: true });
    expect(sql[0]).toBe('BEGIN TRANSACTION READ ONLY');
    expect(sql.at(-1)).toBe('ROLLBACK');
    for (const comando of sql) {
      expect(comando).not.toMatch(/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|COMMIT)\b/i);
    }
    expect(client.end).toHaveBeenCalled();
  });

  it('banco que já tem tabelas: recusa como destino de inicialização', async () => {
    const { resultado } = await rodar(ENV_VALIDO, [
      [/information_schema\.tables/, { rows: [{ count: '31' }] }],
      [/to_regclass/, { rows: [{ present: true }] }],
    ]);
    expect(resultado).toEqual({ success: false, code: 'ERR_TARGET_NOT_EMPTY' });
  });

  it('depois das migrations: confere o baseline completo (3 migrations, catálogo, nenhum tenant)', async () => {
    const { resultado, linhas } = await rodar({ ...ENV_VALIDO, PILOT_EXPECT: 'initialized' }, BANCO_INICIALIZADO);
    expect(resultado).toEqual({ success: true });
    expect(linhas).toContain('MIGRATIONS_APPLIED: 3');
    expect(linhas).toContain('BASELINE_FAILURES: none');
  });

  it('depois das migrations, baseline divergente: falha com código próprio', async () => {
    const divergente = BANCO_INICIALIZADO.map(([padrao, resposta]): [RegExp, PgQueryResult<Record<string, unknown>>] =>
      padrao.source.includes('typeorm_migrations') ? [padrao, { rows: [{ count: '1' }] }] : [padrao, resposta],
    );
    const { resultado } = await rodar({ ...ENV_VALIDO, PILOT_EXPECT: 'initialized' }, divergente);
    expect(resultado).toEqual({ success: false, code: 'ERR_POST_MIGRATION_BASELINE_MISMATCH' });
  });

  it('nenhuma linha de saída contém URL, senha, host ou Endpoint ID', async () => {
    const execucoes = [
      await rodar(ENV_VALIDO),
      await rodar({ ...ENV_VALIDO, PILOT_ENDPOINT_ID: 'ep-outro-333333' }),
      await rodar({ ...ENV_VALIDO, PILOT_EXPECT: 'initialized' }, BANCO_INICIALIZADO),
    ];
    for (const { linhas } of execucoes) {
      const saida = linhas.join('\n');
      for (const proibido of ['segredo-do-piloto', 'neon.tech', PILOT_ID, PRODUCTION_ID, 'postgresql://']) {
        expect(saida).not.toContain(proibido);
      }
    }
  });

  it('erro do driver é sanitizado antes de chegar à saída', async () => {
    const createClient = vi.fn().mockRejectedValue(new Error(`connect ETIMEDOUT ${PILOT_ID}.sa-east-1.aws.neon.tech:5432`));
    const linhas: string[] = [];
    const resultado = await checkPilotDatabase({ env: ENV_VALIDO, createClient, log: (l) => linhas.push(l) });
    expect(resultado).toEqual({ success: false, code: 'ERR_UNEXPECTED' });
    expect(linhas.join('\n')).not.toContain(PILOT_ID);
    expect(linhas.join('\n')).not.toContain('neon.tech');
  });
});
