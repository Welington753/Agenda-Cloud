import { describe, expect, it } from 'vitest';
import {
  buildRuntimeDataSourceOptions,
  RuntimeDataSource,
} from './runtime-data-source.js';

const FAKE_URL = 'postgresql://user:pass@host:5432/db';

describe('buildRuntimeDataSourceOptions', () => {
  it('nunca habilita synchronize', () => {
    expect(buildRuntimeDataSourceOptions(FAKE_URL).synchronize).toBe(false);
  });

  it('nunca habilita migrationsRun', () => {
    expect(buildRuntimeDataSourceOptions(FAKE_URL).migrationsRun).toBe(false);
  });

  it('nunca desativa a validação de certificado TLS', () => {
    const opcoes = buildRuntimeDataSourceOptions(FAKE_URL);
    expect(opcoes.ssl).toEqual({ rejectUnauthorized: true });
  });

  it('nunca loga em nível query/all (evita vazar parâmetros de bind)', () => {
    const opcoes = buildRuntimeDataSourceOptions(FAKE_URL);
    expect(opcoes.logging).not.toContain('query');
    expect(opcoes.logging).not.toContain('all');
  });
});

describe('RuntimeDataSource (importação do módulo)', () => {
  it('é construído mas nunca inicializado/conectado ao importar o módulo', () => {
    expect(RuntimeDataSource.isInitialized).toBe(false);
  });

  it('mantém synchronize e migrationsRun falsos na instância exportada', () => {
    expect(RuntimeDataSource.options.synchronize).toBe(false);
    expect(RuntimeDataSource.options.migrationsRun).toBe(false);
  });
});
