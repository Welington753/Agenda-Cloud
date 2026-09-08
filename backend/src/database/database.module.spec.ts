// Testa `createRuntimeTypeOrmOptions` isolado, sem Nest e sem rede — nunca
// compila `DatabaseModule` via `Test.createTestingModule` aqui, porque isso
// instanciaria o provider real do `TypeOrmModule` e tentaria abrir conexão de
// verdade (ver comentário em database.module.ts e test/app.e2e-spec.ts, que
// cobre esse caminho substituindo o provider `DataSource`).
import { describe, expect, it, vi } from 'vitest';
import { buildRuntimeDataSourceOptions } from './runtime-data-source.js';
import { createRuntimeTypeOrmOptions } from './database.module.js';

const FAKE_URL = 'postgresql://user:pass@host:5432/db';

describe('createRuntimeTypeOrmOptions', () => {
  it('usa DATABASE_URL lida via ConfigService.getOrThrow, nunca process.env direto', () => {
    const getOrThrow = vi.fn().mockReturnValue(FAKE_URL);
    createRuntimeTypeOrmOptions({ getOrThrow });
    expect(getOrThrow).toHaveBeenCalledWith('DATABASE_URL');
  });

  it('devolve exatamente as mesmas opções de buildRuntimeDataSourceOptions (fonte única de verdade)', () => {
    const getOrThrow = vi.fn().mockReturnValue(FAKE_URL);
    const opcoes = createRuntimeTypeOrmOptions({ getOrThrow });
    expect(opcoes).toEqual(buildRuntimeDataSourceOptions(FAKE_URL));
  });

  it('propaga o erro do ConfigService quando DATABASE_URL está ausente — nunca desliga o banco silenciosamente', () => {
    const getOrThrow = vi.fn().mockImplementation(() => {
      throw new Error('DATABASE_URL não configurada');
    });
    expect(() => createRuntimeTypeOrmOptions({ getOrThrow })).toThrow(
      /DATABASE_URL/,
    );
  });
});
