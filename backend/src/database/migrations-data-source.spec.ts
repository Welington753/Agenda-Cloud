import { DataSource } from 'typeorm';
import { describe, expect, it } from 'vitest';
import {
  buildMigrationsDataSourceOptions,
  MigrationsDataSource,
} from './migrations-data-source.js';
import * as migrationsDataSourceModule from './migrations-data-source.js';

const FAKE_URL = 'postgresql://user:pass@host:5432/db';

describe('buildMigrationsDataSourceOptions', () => {
  it('nunca habilita synchronize', () => {
    expect(buildMigrationsDataSourceOptions(FAKE_URL).synchronize).toBe(false);
  });

  it('nunca habilita migrationsRun', () => {
    expect(buildMigrationsDataSourceOptions(FAKE_URL).migrationsRun).toBe(
      false,
    );
  });

  it('nunca desativa a validação de certificado TLS', () => {
    const opcoes = buildMigrationsDataSourceOptions(FAKE_URL);
    expect(opcoes.ssl).toEqual({ rejectUnauthorized: true });
  });

  it('usa nome explícito e estável para a tabela de controle de migrations', () => {
    expect(buildMigrationsDataSourceOptions(FAKE_URL).migrationsTableName).toBe(
      'typeorm_migrations',
    );
  });
});

describe('MigrationsDataSource (importação do módulo)', () => {
  it('é construído mas nunca inicializado/conectado ao importar o módulo', () => {
    expect(MigrationsDataSource.isInitialized).toBe(false);
  });

  it('mantém synchronize e migrationsRun falsos na instância exportada', () => {
    expect(MigrationsDataSource.options.synchronize).toBe(false);
    expect(MigrationsDataSource.options.migrationsRun).toBe(false);
  });

  // O CLI do TypeORM (`CommandUtils.loadDataSource`) itera todos os exports
  // do módulo e falha com "must contain only one export of DataSource
  // instance" se mais de um for instância de DataSource — mesmo que os dois
  // apontem para o mesmo objeto (ex.: named export + default export). Este
  // teste replica essa varredura para travar a regressão.
  it('expõe exatamente uma instância de DataSource entre os exports do módulo', () => {
    const dataSourceExports = Object.values(migrationsDataSourceModule).filter(
      (value) => value instanceof DataSource,
    );
    expect(dataSourceExports).toHaveLength(1);
    expect(dataSourceExports[0]).toBe(MigrationsDataSource);
  });

  it('não possui export default', () => {
    expect(
      (migrationsDataSourceModule as { default?: unknown }).default,
    ).toBeUndefined();
  });

  it('usa DIRECT_URL (não DATABASE_URL) como origem da URL de conexão', () => {
    expect(MigrationsDataSource.options).toMatchObject({
      url: process.env.DIRECT_URL ?? '',
    });
  });
});
