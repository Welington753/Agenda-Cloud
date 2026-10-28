import { afterEach, describe, expect, it, vi } from 'vitest';
import { inspect } from 'node:util';
import { QueryFailedError } from 'typeorm';
import { hashPassword } from '../auth/password-hasher.js';
import { hashSessionToken } from '../auth/session-token.js';
import { DatabaseErrorFilter } from '../common/database-error.filter.js';
import {
  OMITIDO,
  SafeTypeOrmLogger,
  resumoDaFalha,
  resumoDosParametros,
  semSegredos,
} from './safe-typeorm-logger.js';

const SENHA = 'senha-escolhida-pelo-dono-1';
const TOKEN = 'a'.repeat(64);

/** Tudo o que o processo escreve em stdout e stderr enquanto `fn` roda. */
async function saidaDe(fn: () => unknown): Promise<string> {
  let saida = '';
  const capturar = (pedaco: unknown) => {
    saida += String(pedaco);
    return true;
  };
  const out = vi.spyOn(process.stdout, 'write').mockImplementation(capturar);
  const err = vi.spyOn(process.stderr, 'write').mockImplementation(capturar);
  try {
    await fn();
  } finally {
    out.mockRestore();
    err.mockRestore();
  }
  return saida;
}

/** O erro que o PostgreSQL devolveria se um gatilho recusasse a gravação da
 * credencial repetindo o hash na mensagem e no detalhe. */
async function falhaNaCredencial() {
  const hash = await hashPassword(SENHA);
  const tokenHash = hashSessionToken(TOKEN);
  const query = 'UPDATE credentials SET password_hash = $2, algorithm = $3, updated_at = $4 WHERE user_id = $1';
  const parametros = ['usuario-ficticio-0001', hash, 'argon2id', new Date('2031-03-12T12:00:00Z'), tokenHash];
  const driverError = Object.assign(new Error(`gravação recusada: ${hash}`), {
    code: 'P0001',
    table: 'credentials',
    detail: `Failing row contains (usuario-ficticio-0001, ${hash}, ${tokenHash}).`,
  });
  return { hash, tokenHash, query, parametros, erro: new QueryFailedError(query, parametros, driverError) };
}

afterEach(() => vi.restoreAllMocks());

describe('SafeTypeOrmLogger', () => {
  it('na query que falha, escreve SQL, tipos dos parâmetros e o erro, nunca a senha, o hash ou o token', async () => {
    const { hash, tokenHash, query, parametros, erro } = await falhaNaCredencial();
    // Sem a proteção, os valores iriam para o log: o próprio erro os carrega.
    expect(inspect(erro)).toContain(hash);
    expect(inspect(erro)).toContain(tokenHash);

    const saida = await saidaDe(() => new SafeTypeOrmLogger().logQueryError(erro, query, parametros));

    expect(saida).toContain('UPDATE credentials SET password_hash = $2');
    expect(saida).toContain('[string(21), string(97), string(8), Date, string(64)]');
    expect(saida).toContain('code=P0001');
    expect(saida).toContain('table=credentials');
    expect(saida).toContain(`gravação recusada: ${OMITIDO}`);
    expect(saida).not.toContain(hash);
    expect(saida).not.toContain(hash.split('$').at(-1));
    expect(saida).not.toContain(tokenHash);
    expect(saida).not.toContain(SENHA);
    expect(saida).not.toContain('usuario-ficticio-0001');
    expect(saida).not.toContain('Failing row');
  });

  it('respeita os níveis: sem "error", nada; query lenta e aviso também sem valores', async () => {
    const { query, parametros, erro, hash } = await falhaNaCredencial();
    expect(await saidaDe(() => new SafeTypeOrmLogger(['warn']).logQueryError(erro, query, parametros))).toBe('');
    const lenta = await saidaDe(() => new SafeTypeOrmLogger().logQuerySlow(1500, query, parametros));
    expect(lenta).toContain('query lenta (1500 ms)');
    expect(lenta).not.toContain(hash);
    const aviso = await saidaDe(() => new SafeTypeOrmLogger().log('warn', `algo com ${hash}`));
    expect(aviso).toContain(OMITIDO);
    expect(aviso).not.toContain(hash);
  });

  it('troca valores de parâmetro e coisas com cara de hash ou token, sem apagar o resto', () => {
    expect(semSegredos('invalid input syntax for type uuid: "segredo-qualquer"', ['segredo-qualquer'])).toBe(
      `invalid input syntax for type uuid: "${OMITIDO}"`,
    );
    expect(semSegredos(`token ${TOKEN} fim`)).toBe(`token ${OMITIDO} fim`);
    expect(semSegredos('duplicate key value violates unique constraint "uq_invites_pending_professional"')).toBe(
      'duplicate key value violates unique constraint "uq_invites_pending_professional"',
    );
    expect(resumoDosParametros([null, 3, true, ['a', 'b'], { a: 1 }])).toBe('[null, number, boolean, array(2), object]');
  });
});

describe('DatabaseErrorFilter', () => {
  it('responde 500 genérico e loga o resumo sem os valores, com a pilha sem a mensagem', async () => {
    const { hash, tokenHash, erro } = await falhaNaCredencial();
    const reply = vi.fn();
    const filtro = new DatabaseErrorFilter({
      httpAdapter: { reply, isHeadersSent: () => false, end: vi.fn() },
    } as never);
    const host = { getType: () => 'http', switchToHttp: () => ({ getResponse: () => ({}) }) } as never;

    const saida = await saidaDe(() => filtro.catch(erro, host));

    expect(reply).toHaveBeenCalledWith({}, { statusCode: 500, message: 'Internal server error' }, 500);
    expect(saida).toContain('ExceptionsHandler');
    expect(saida).toContain('query que falhou: UPDATE credentials');
    expect(saida).toContain('QueryFailedError (code=P0001 table=credentials)');
    expect(saida).toMatch(/\n\s+at /);
    expect(saida).not.toContain(hash);
    expect(saida).not.toContain(tokenHash);
    expect(saida).not.toContain('Failing row');
    expect(resumoDaFalha(erro)).not.toContain(hash);
  });
});
