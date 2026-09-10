import { describe, expect, it } from 'vitest';
import {
  SESSION_TOKEN_BYTES,
  generateSessionToken,
  hashSessionToken,
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
