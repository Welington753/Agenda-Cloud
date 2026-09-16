import { describe, expect, it } from 'vitest';
import { shouldIgnoreEnvFile } from './ignore-env-file.js';

describe('shouldIgnoreEnvFile', () => {
  it('por padrão (sem a variável), carrega o .env normalmente', () => {
    expect(shouldIgnoreEnvFile({})).toBe(false);
  });

  it('NODE_ENV=development sozinho nunca ativa isto — é o valor padrão de hoje', () => {
    expect(shouldIgnoreEnvFile({ NODE_ENV: 'development' })).toBe(false);
  });

  it('só o valor exato "true" ativa o opt-in', () => {
    expect(shouldIgnoreEnvFile({ IGNORE_DOTENV_FILE: 'true' })).toBe(true);
  });

  it.each(['1', 'TRUE', 'yes', ''])('valor "%s" não ativa — precisa ser exatamente "true"', (valor) => {
    expect(shouldIgnoreEnvFile({ IGNORE_DOTENV_FILE: valor })).toBe(false);
  });
});
