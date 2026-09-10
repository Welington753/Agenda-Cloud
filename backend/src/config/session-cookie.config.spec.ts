import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SESSION_MAX_AGE_MS,
  SESSION_COOKIE_NAME,
  buildClearSessionCookieOptions,
  buildSessionCookieOptions,
} from './session-cookie.config.js';

describe('buildSessionCookieOptions', () => {
  it('sempre HttpOnly', () => {
    expect(buildSessionCookieOptions('production').httpOnly).toBe(true);
    expect(buildSessionCookieOptions('development').httpOnly).toBe(true);
  });

  it('sempre SameSite=Lax', () => {
    expect(buildSessionCookieOptions('production').sameSite).toBe('lax');
    expect(buildSessionCookieOptions('development').sameSite).toBe('lax');
  });

  it('sempre Path=/', () => {
    expect(buildSessionCookieOptions('production').path).toBe('/');
  });

  it('Secure apenas em produção', () => {
    expect(buildSessionCookieOptions('production').secure).toBe(true);
    expect(buildSessionCookieOptions('development').secure).toBe(false);
    expect(buildSessionCookieOptions('test').secure).toBe(false);
  });

  it('usa a expiração padrão quando nenhuma é informada, mas aceita override', () => {
    expect(buildSessionCookieOptions('development').maxAge).toBe(
      DEFAULT_SESSION_MAX_AGE_MS,
    );
    expect(buildSessionCookieOptions('development', 60_000).maxAge).toBe(
      60_000,
    );
  });

  it('nome do cookie é estável e não revela informação sensível', () => {
    expect(SESSION_COOKIE_NAME).toBe('session_token');
    expect(SESSION_COOKIE_NAME).not.toMatch(/hash|secret|token-real/i);
  });
});

describe('buildClearSessionCookieOptions', () => {
  it('mesmos atributos de identidade do cookie (httpOnly/sameSite/path/secure), para o navegador reconhecer o cookie a limpar', () => {
    const options = buildClearSessionCookieOptions('production');
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe('lax');
    expect(options.path).toBe('/');
    expect(options.secure).toBe(true);
  });

  it('secure=false fora de produção, igual ao cookie de emissão', () => {
    expect(buildClearSessionCookieOptions('development').secure).toBe(false);
  });

  it('NUNCA inclui maxAge — Max-Age sobrepõe Expires no navegador e impediria o clearCookie de limpar de verdade', () => {
    const options = buildClearSessionCookieOptions('production') as Record<string, unknown>;
    expect(options.maxAge).toBeUndefined();
  });
});
