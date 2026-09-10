import { describe, expect, it } from 'vitest';
import {
  SESSION_TOKEN_BYTES,
  generateSessionToken,
  hashSessionToken,
  isValidSessionTokenFormat,
} from './session-token.js';

describe('generateSessionToken', () => {
  it('gera um token com pelo menos 32 bytes de entropia', () => {
    const { token } = generateSessionToken();
    // hex: 2 chars por byte
    expect(token.length).toBeGreaterThanOrEqual(SESSION_TOKEN_BYTES * 2);
  });

  it('SESSION_TOKEN_BYTES é pelo menos 32', () => {
    expect(SESSION_TOKEN_BYTES).toBeGreaterThanOrEqual(32);
  });

  it('gera tokens diferentes a cada chamada', () => {
    const a = generateSessionToken();
    const b = generateSessionToken();
    expect(a.token).not.toBe(b.token);
  });

  it('retorna também o hash SHA-256 do token', () => {
    const { token, tokenHash } = generateSessionToken();
    expect(tokenHash).toBe(hashSessionToken(token));
  });

  it('o hash nunca é igual ao token puro', () => {
    const { token, tokenHash } = generateSessionToken();
    expect(tokenHash).not.toBe(token);
  });
});

describe('hashSessionToken', () => {
  it('é determinístico: mesmo token produz o mesmo hash', () => {
    const token = 'token-fixo-para-teste';
    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
  });

  it('produz um hash hexadecimal de 64 caracteres (SHA-256)', () => {
    expect(hashSessionToken('qualquer-token')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('isValidSessionTokenFormat', () => {
  it('aceita um token realmente gerado por generateSessionToken', () => {
    const { token } = generateSessionToken();
    expect(isValidSessionTokenFormat(token)).toBe(true);
  });

  it('rejeita string vazia', () => {
    expect(isValidSessionTokenFormat('')).toBe(false);
  });

  it('rejeita comprimento menor que o esperado', () => {
    expect(isValidSessionTokenFormat('a'.repeat(SESSION_TOKEN_BYTES * 2 - 1))).toBe(false);
  });

  it('rejeita comprimento maior que o esperado', () => {
    expect(isValidSessionTokenFormat('a'.repeat(SESSION_TOKEN_BYTES * 2 + 1))).toBe(false);
  });

  it('rejeita caracteres fora do alfabeto hexadecimal', () => {
    expect(isValidSessionTokenFormat('z'.repeat(SESSION_TOKEN_BYTES * 2))).toBe(false);
  });

  it('rejeita maiúsculas (gerador só produz minúsculas)', () => {
    const { token } = generateSessionToken();
    expect(isValidSessionTokenFormat(token.toUpperCase())).toBe(false);
  });
});
