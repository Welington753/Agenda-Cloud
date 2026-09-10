import { describe, expect, it } from 'vitest';
import { GuardedMigrationError, redactSecrets, toSanitizedFailure } from './sanitize.js';

describe('redactSecrets', () => {
  it('redige uma connection string postgresql:// completa', () => {
    const texto = 'falha ao conectar em postgresql://user:senha123@ep-abc-123.sa-east-1.aws.neon.tech/db?sslmode=require';
    const resultado = redactSecrets(texto);
    expect(resultado).not.toContain('postgresql://');
    expect(resultado).not.toContain('senha123');
    expect(resultado).not.toContain('ep-abc-123');
  });

  it('redige um hostname Neon isolado, fora de uma URL completa', () => {
    const texto = 'connect ETIMEDOUT ep-cool-forest-123456.sa-east-1.aws.neon.tech:5432';
    const resultado = redactSecrets(texto);
    expect(resultado).not.toContain('ep-cool-forest-123456');
    expect(resultado).not.toContain('.neon.tech');
  });

  it('redige um Endpoint ID isolado (padrão ep-xxxxx)', () => {
    const texto = 'endpoint ep-quiet-river-987654 rejeitado';
    const resultado = redactSecrets(texto);
    expect(resultado).not.toContain('ep-quiet-river-987654');
  });

  it('nunca lança para texto sem nenhum segredo — devolve o texto igual', () => {
    const texto = 'migration InitialSchema aplicada com sucesso';
    expect(redactSecrets(texto)).toBe(texto);
  });

  it('redige múltiplas ocorrências no mesmo texto', () => {
    const texto = 'postgresql://a:b@ep-um-111.neon.tech/db e também postgresql://c:d@ep-dois-222.neon.tech/db';
    const resultado = redactSecrets(texto);
    expect(resultado).not.toContain('ep-um-111');
    expect(resultado).not.toContain('ep-dois-222');
  });
});

describe('GuardedMigrationError', () => {
  it('carrega um código interno estável e uma mensagem sempre estática (nunca interpolada com dado dinâmico)', () => {
    const error = new GuardedMigrationError('ERR_POOLER_FORBIDDEN', 'URL direta não pode usar endpoint pooler.');
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('ERR_POOLER_FORBIDDEN');
    expect(error.message).toBe('URL direta não pode usar endpoint pooler.');
  });
});

describe('toSanitizedFailure', () => {
  it('para um GuardedMigrationError, devolve {code, message} exatamente como definidos (já são seguros)', () => {
    const error = new GuardedMigrationError('ERR_CONFIRMATION_MISMATCH', 'Confirmação incorreta.');
    const failure = toSanitizedFailure(error);
    expect(failure).toEqual({ code: 'ERR_CONFIRMATION_MISMATCH', message: 'Confirmação incorreta.' });
  });

  it('para um erro desconhecido contendo uma connection string, nunca vaza a connection string', () => {
    const error = new Error('connect ECONNREFUSED postgresql://user:pass@ep-real-host-999.neon.tech/db');
    const failure = toSanitizedFailure(error);
    expect(failure.code).toBe('ERR_UNEXPECTED');
    expect(failure.message).not.toContain('postgresql://');
    expect(failure.message).not.toContain('ep-real-host-999');
  });

  it('para um valor lançado que não é nem Error nem GuardedMigrationError, ainda devolve uma falha sanitizada genérica', () => {
    const failure = toSanitizedFailure('string qualquer lançada');
    expect(failure.code).toBe('ERR_UNEXPECTED');
    expect(failure.message.length).toBeGreaterThan(0);
  });
});
