import { describe, expect, it } from 'vitest';
import {
  buildMigrationsDataSourceOptions,
  MigrationsDataSource,
} from './migrations-data-source.js';

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
});
