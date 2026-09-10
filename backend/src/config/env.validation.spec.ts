import { describe, expect, it } from 'vitest';
import { validateEnv } from './env.validation.js';

const CONFIG_VALIDA = {
  NODE_ENV: 'test',
  PORT: '3001',
  DATABASE_URL: 'postgresql://user:pass@host:5432/db',
  DIRECT_URL: 'postgresql://user:pass@host:5432/db',
  FRONTEND_URL: 'http://localhost:3000',
};

describe('validateEnv', () => {
  it('aceita configuração completa e válida', () => {
    const config = validateEnv(CONFIG_VALIDA);
    expect(config.PORT).toBe(3001);
    expect(config.DATABASE_URL).toBe(CONFIG_VALIDA.DATABASE_URL);
  });

  it('usa 3001 como porta padrão quando PORT está ausente', () => {
    const { PORT: _porta, ...semPorta } = CONFIG_VALIDA;
    const config = validateEnv(semPorta);
    expect(config.PORT).toBe(3001);
  });

  it('lança erro explícito quando DATABASE_URL está ausente', () => {
    const { DATABASE_URL: _url, ...semDatabaseUrl } = CONFIG_VALIDA;
    expect(() => validateEnv(semDatabaseUrl)).toThrow(/DATABASE_URL/);
  });

  it('lança erro explícito quando DIRECT_URL está ausente', () => {
    const { DIRECT_URL: _url, ...semDirectUrl } = CONFIG_VALIDA;
    expect(() => validateEnv(semDirectUrl)).toThrow(/DIRECT_URL/);
  });

  it('lança erro explícito quando FRONTEND_URL está ausente', () => {
    const { FRONTEND_URL: _url, ...semFrontendUrl } = CONFIG_VALIDA;
    expect(() => validateEnv(semFrontendUrl)).toThrow(/FRONTEND_URL/);
  });

  it('lança erro explícito quando FRONTEND_URL não é uma URL válida', () => {
    expect(() =>
      validateEnv({ ...CONFIG_VALIDA, FRONTEND_URL: 'nao-e-uma-url' }),
    ).toThrow(/FRONTEND_URL/);
  });

  it('lança erro explícito quando DATABASE_URL não é uma connection string postgres', () => {
    expect(() =>
      validateEnv({ ...CONFIG_VALIDA, DATABASE_URL: 'mysql://user:pass@host/db' }),
    ).toThrow(/DATABASE_URL/);
  });

  it('nunca inclui o valor recebido na mensagem de erro (nenhuma credencial vaza)', () => {
    const urlComSenha = 'postgresql://user:senha-super-secreta@host:5432/db';
    try {
      validateEnv({ ...CONFIG_VALIDA, DATABASE_URL: 'invalida', DIRECT_URL: urlComSenha });
      throw new Error('deveria ter lançado');
    } catch (erro) {
      const mensagem = (erro as Error).message;
      expect(mensagem).not.toContain('senha-super-secreta');
      expect(mensagem).not.toContain(urlComSenha);
      expect(mensagem).not.toContain('invalida');
      expect(mensagem).toContain('DATABASE_URL');
    }
  });
});
