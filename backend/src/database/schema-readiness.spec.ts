// Regras da conferência de inicialização, sem banco: a comparação dos
// conjuntos, o diagnóstico e a disciplina da leitura (só leitura, transação
// sempre desfeita, conexão sempre devolvida). Os mesmos cenários contra
// PostgreSQL real estão em test/schema-readiness-postgres.db-e2e-spec.ts.
import { describe, expect, it, vi } from 'vitest';
import {
  SCHEMA_CHECK_STATEMENT_TIMEOUT_MS,
  SchemaNotReadyError,
  checkRequiredMigrations,
  compareMigrations,
  describeSchemaProblem,
  ensureRequiredMigrations,
} from './schema-readiness.js';

const EXIGIDAS = ['Primeira1700000000001', 'Segunda1700000000002', 'Terceira1700000000003'];

type Resposta = unknown[] | Error | Promise<never>;

/** DataSource mínimo: registra cada comando e responde pelo início do SQL. */
function bancoFalso(opcoes: {
  tabelaExiste?: boolean;
  aplicadas?: string[];
  respostas?: Record<string, Resposta>;
  falhaAoConectar?: Error;
}) {
  const comandos: string[] = [];
  const release = vi.fn(async () => undefined);
  const runner = {
    connect: vi.fn(async () => {
      if (opcoes.falhaAoConectar) throw opcoes.falhaAoConectar;
    }),
    query: vi.fn(async (sql: string) => {
      comandos.push(sql);
      for (const [inicio, resposta] of Object.entries(opcoes.respostas ?? {})) {
        if (!sql.startsWith(inicio)) continue;
        if (resposta instanceof Error) throw resposta;
        return resposta;
      }
      if (sql.startsWith('SELECT to_regclass')) {
        return [{ tabela: opcoes.tabelaExiste === false ? null : '"typeorm_migrations"' }];
      }
      if (sql.startsWith('SELECT name')) return (opcoes.aplicadas ?? []).map((name) => ({ name }));
      return [];
    }),
    release,
  };
  const dataSource = {
    options: { type: 'postgres', migrationsTableName: 'typeorm_migrations' },
    driver: { escape: (nome: string) => `"${nome}"` },
    createQueryRunner: () => runner,
  } as unknown as Parameters<typeof checkRequiredMigrations>[0];
  return { dataSource, comandos, runner, release };
}

async function problemaDe(promessa: Promise<unknown>) {
  const erro = await promessa.then(
    () => null,
    (e: unknown) => e,
  );
  expect(erro).toBeInstanceOf(SchemaNotReadyError);
  return (erro as SchemaNotReadyError).problem;
}

describe('compareMigrations', () => {
  it('todas presentes: nada falta, nada sobra', () => {
    expect(compareMigrations(EXIGIDAS, [...EXIGIDAS].reverse())).toEqual({ missing: [], extra: [] });
  });

  it('a última ausente aparece como ausente', () => {
    expect(compareMigrations(EXIGIDAS, EXIGIDAS.slice(0, 2)).missing).toEqual(['Terceira1700000000003']);
  });

  it('uma anterior ausente é apontada mesmo com a última registrada e a mesma quantidade', () => {
    const aplicadas = ['Primeira1700000000001', 'Terceira1700000000003', 'Outra1700000000009'];
    expect(aplicadas).toHaveLength(EXIGIDAS.length);
    expect(compareMigrations(EXIGIDAS, aplicadas)).toEqual({
      missing: ['Segunda1700000000002'],
      extra: ['Outra1700000000009'],
    });
  });

  it('migrations a mais não entram nas ausentes', () => {
    expect(compareMigrations(EXIGIDAS, [...EXIGIDAS, 'Futura1800000000000'])).toEqual({
      missing: [],
      extra: ['Futura1800000000000'],
    });
  });
});

describe('checkRequiredMigrations', () => {
  it('todas presentes: devolve o relatório e só emite comandos de leitura numa transação desfeita', async () => {
    const { dataSource, comandos, release } = bancoFalso({ aplicadas: EXIGIDAS });

    await expect(checkRequiredMigrations(dataSource, { required: EXIGIDAS })).resolves.toEqual({
      required: 3,
      applied: 3,
      extra: [],
    });
    expect(comandos).toEqual([
      'BEGIN TRANSACTION READ ONLY',
      `SET LOCAL statement_timeout = ${SCHEMA_CHECK_STATEMENT_TIMEOUT_MS}`,
      'SELECT to_regclass($1)::text AS tabela',
      'SELECT name FROM "typeorm_migrations"',
      'ROLLBACK',
    ]);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('migration a mais no banco não bloqueia e vem no relatório', async () => {
    const { dataSource } = bancoFalso({ aplicadas: [...EXIGIDAS, 'Futura1800000000000'] });

    await expect(checkRequiredMigrations(dataSource, { required: EXIGIDAS })).resolves.toEqual({
      required: 3,
      applied: 4,
      extra: ['Futura1800000000000'],
    });
  });

  it('última ausente: recusa e nomeia a ausente', async () => {
    const { dataSource, comandos, release } = bancoFalso({ aplicadas: EXIGIDAS.slice(0, 2) });

    expect(await problemaDe(checkRequiredMigrations(dataSource, { required: EXIGIDAS }))).toEqual({
      reason: 'missing-migrations',
      table: 'typeorm_migrations',
      missing: ['Terceira1700000000003'],
      required: 3,
    });
    expect(comandos.at(-1)).toBe('ROLLBACK');
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('anterior ausente com a última registrada: recusa', async () => {
    const { dataSource } = bancoFalso({ aplicadas: ['Primeira1700000000001', 'Terceira1700000000003'] });

    expect(await problemaDe(checkRequiredMigrations(dataSource, { required: EXIGIDAS }))).toMatchObject({
      reason: 'missing-migrations',
      missing: ['Segunda1700000000002'],
    });
  });

  it('tabela de controle ausente: recusa sem tentar ler a tabela', async () => {
    const { dataSource, comandos, release } = bancoFalso({ tabelaExiste: false });

    expect(await problemaDe(checkRequiredMigrations(dataSource, { required: EXIGIDAS }))).toEqual({
      reason: 'control-table-missing',
      table: 'typeorm_migrations',
    });
    expect(comandos.some((sql) => sql.startsWith('SELECT name'))).toBe(false);
    expect(comandos.at(-1)).toBe('ROLLBACK');
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('banco indisponível ao conectar: recusa só com o código do driver e devolve a conexão', async () => {
    const recusa = Object.assign(
      new Error('connect ECONNREFUSED postgresql://usuario:senha-secreta@banco.exemplo:5432/base'),
      { code: 'ECONNREFUSED' },
    );
    const { dataSource, comandos, release } = bancoFalso({ falhaAoConectar: recusa });

    const erro = await checkRequiredMigrations(dataSource, { required: EXIGIDAS }).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(SchemaNotReadyError);
    expect((erro as SchemaNotReadyError).problem).toEqual({ reason: 'database-unavailable', code: 'ECONNREFUSED' });
    expect((erro as SchemaNotReadyError).message).not.toMatch(/senha-secreta|usuario|banco\.exemplo|postgresql:/);
    // Sem transação aberta, nenhum ROLLBACK é enviado.
    expect(comandos).toEqual([]);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('falha da consulta (código no driverError): recusa, desfaz a transação e não repassa a mensagem', async () => {
    const falha = Object.assign(new Error('falha com detalhe do servidor'), { driverError: { code: '57014' } });
    const { dataSource, comandos } = bancoFalso({ respostas: { 'SELECT name': falha } });

    const erro = (await checkRequiredMigrations(dataSource, { required: EXIGIDAS }).catch(
      (e: unknown) => e,
    )) as SchemaNotReadyError;
    expect(erro.problem).toEqual({ reason: 'database-unavailable', code: '57014' });
    expect(erro.message).not.toContain('detalhe do servidor');
    expect(comandos.at(-1)).toBe('ROLLBACK');
  });

  it('código do driver fora do formato esperado não é repassado', async () => {
    const falha = Object.assign(new Error('x'), { code: 'senha=abc 123; host' });
    const { dataSource } = bancoFalso({ falhaAoConectar: falha });

    expect(await problemaDe(checkRequiredMigrations(dataSource, { required: EXIGIDAS }))).toEqual({
      reason: 'database-unavailable',
      code: null,
    });
  });

  it('banco que não responde: desiste no prazo total', async () => {
    const { dataSource } = bancoFalso({});
    const runner = dataSource.createQueryRunner() as unknown as { connect: ReturnType<typeof vi.fn> };
    runner.connect.mockImplementation(() => new Promise(() => undefined));

    expect(
      await problemaDe(checkRequiredMigrations(dataSource, { required: EXIGIDAS, totalTimeoutMs: 20 })),
    ).toEqual({ reason: 'database-unavailable', code: 'TEMPO_ESGOTADO' });
  });
});

describe('describeSchemaProblem', () => {
  it('nomeia todas as ausentes e diz que a API não aplica migrations', () => {
    const texto = describeSchemaProblem({
      reason: 'missing-migrations',
      table: 'typeorm_migrations',
      missing: ['Segunda1700000000002', 'Terceira1700000000003'],
      required: 3,
    });
    expect(texto).toContain('2 de 3 migrations exigidas');
    expect(texto).toContain('Segunda1700000000002, Terceira1700000000003');
    expect(texto).toContain('A API não executa migrations');
  });

  it('distingue a tabela de controle ausente e o banco indisponível', () => {
    expect(describeSchemaProblem({ reason: 'control-table-missing', table: 'typeorm_migrations' })).toContain(
      'tabela de controle de migrations "typeorm_migrations" não existe',
    );
    expect(describeSchemaProblem({ reason: 'database-unavailable', code: null })).toContain('sem código do driver');
    expect(describeSchemaProblem({ reason: 'database-unavailable', code: 'ECONNREFUSED' })).toContain(
      'código ECONNREFUSED',
    );
  });
});

describe('ensureRequiredMigrations', () => {
  it('registra o sucesso e avisa sobre migrations que o código não conhece, sem bloquear', async () => {
    const { dataSource } = bancoFalso({ aplicadas: [...EXIGIDAS, 'Futura1800000000000'] });
    const logger = { log: vi.fn(), warn: vi.fn() };

    await expect(ensureRequiredMigrations(dataSource, logger, { required: EXIGIDAS })).resolves.toMatchObject({
      extra: ['Futura1800000000000'],
    });
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('3 de 3 registradas'));
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][0]).toContain('Futura1800000000000');
    expect(logger.warn.mock.calls[0][0]).toContain('não garante compatibilidade');
  });

  it('sem migrations a mais, não avisa nada', async () => {
    const { dataSource } = bancoFalso({ aplicadas: EXIGIDAS });
    const logger = { log: vi.fn(), warn: vi.fn() };

    await ensureRequiredMigrations(dataSource, logger, { required: EXIGIDAS });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('faltando migration, lança e não registra sucesso', async () => {
    const { dataSource } = bancoFalso({ aplicadas: EXIGIDAS.slice(0, 1) });
    const logger = { log: vi.fn(), warn: vi.fn() };

    await expect(ensureRequiredMigrations(dataSource, logger, { required: EXIGIDAS })).rejects.toBeInstanceOf(
      SchemaNotReadyError,
    );
    expect(logger.log).not.toHaveBeenCalled();
  });

  it('sem lista informada, usa o manifesto real do código', async () => {
    const { REQUIRED_MIGRATIONS } = await import('./required-migrations.js');
    const { dataSource } = bancoFalso({ aplicadas: REQUIRED_MIGRATIONS.slice(0, -1) });

    expect(await problemaDe(checkRequiredMigrations(dataSource))).toMatchObject({
      reason: 'missing-migrations',
      missing: [REQUIRED_MIGRATIONS.at(-1)],
      required: REQUIRED_MIGRATIONS.length,
    });
  });
});
