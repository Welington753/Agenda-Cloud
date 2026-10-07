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

describe('validateEnv — TLS do PostgreSQL', () => {
  it.each([
    'postgresql://u:p@host/db?sslmode=disable',
    'postgresql://u:p@host/db?sslmode=no-verify',
    'postgresql://u:p@host/db?sslmode=allow',
    'postgresql://u:p@host/db?sslmode=require&uselibpqcompat=true',
    'postgresql://u:p@host/db?ssl=false',
    'postgresql://u:p@host/db?ssl=0',
  ])('recusa URL que desliga ou afrouxa a verificação de certificado (%s)', (url) => {
    expect(() => validateEnv({ ...CONFIG_VALIDA, DATABASE_URL: url })).toThrow(/DATABASE_URL/);
    expect(() => validateEnv({ ...CONFIG_VALIDA, DIRECT_URL: url })).toThrow(/DIRECT_URL/);
  });

  it.each([
    'postgresql://u:p@host/db',
    'postgresql://u:p@host/db?sslmode=verify-full',
    'postgresql://u:p@host/db?sslmode=require&channel_binding=require',
  ])('aceita URL que mantém a verificação (%s)', (url) => {
    expect(() => validateEnv({ ...CONFIG_VALIDA, DATABASE_URL: url, DIRECT_URL: url })).not.toThrow();
  });
});

describe('validateEnv — hospedagem', () => {
  const PRODUCAO = { ...CONFIG_VALIDA, NODE_ENV: 'production', FRONTEND_URL: 'https://app.exemplo.test' };

  it('HOST é opcional e, quando presente, só IP literal', () => {
    expect(validateEnv(CONFIG_VALIDA).HOST).toBeUndefined();
    expect(validateEnv({ ...CONFIG_VALIDA, HOST: '0.0.0.0' }).HOST).toBe('0.0.0.0');
    expect(() => validateEnv({ ...CONFIG_VALIDA, HOST: 'localhost' })).toThrow(/HOST/);
  });

  it('CLIENT_IP_SOURCE padrão é socket e só aceita valores conhecidos', () => {
    expect(validateEnv(CONFIG_VALIDA).CLIENT_IP_SOURCE).toBe('socket');
    expect(validateEnv({ ...CONFIG_VALIDA, CLIENT_IP_SOURCE: 'cf-connecting-ip' }).CLIENT_IP_SOURCE).toBe(
      'cf-connecting-ip',
    );
    for (const valor of ['x-forwarded-for', 'true', '1']) {
      expect(() => validateEnv({ ...CONFIG_VALIDA, CLIENT_IP_SOURCE: valor })).toThrow(/CLIENT_IP_SOURCE/);
    }
  });

  it('em production, FRONTEND_URL precisa ser origem HTTPS exata', () => {
    expect(validateEnv(PRODUCAO).FRONTEND_URL).toBe('https://app.exemplo.test');
    for (const url of ['http://app.exemplo.test', 'https://app.exemplo.test/', 'https://app.exemplo.test/conta']) {
      expect(() => validateEnv({ ...PRODUCAO, FRONTEND_URL: url })).toThrow(/FRONTEND_URL/);
    }
  });

  it('fora de production, FRONTEND_URL local em HTTP continua aceito', () => {
    expect(validateEnv(CONFIG_VALIDA).FRONTEND_URL).toBe('http://localhost:3000');
  });
});
