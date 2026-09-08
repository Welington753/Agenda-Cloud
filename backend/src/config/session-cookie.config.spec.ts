import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SESSION_MAX_AGE_MS,
  SESSION_COOKIE_NAME,
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
