// Opções centralizadas do futuro cookie de sessão (`Session.tokenHash`, ver
// entities/session.entity.ts) — preparadas no Lote 6B.2, aplicadas só quando
// os endpoints de autenticação existirem (Lote 6B.3+). Nenhum código aqui
// emite cookie nenhum; isto é só a fonte única de verdade das opções, para
// nunca haver duas configurações divergentes entre register/login/logout.
import type { CookieOptions } from 'express';

/** Nome estável e sem informação sensível (não entrega algoritmo, formato de
 * sessão nem nada além de "isto é o cookie de sessão"). Nunca renomear sem
 * plano de migração — invalidaria toda sessão ativa. */
export const SESSION_COOKIE_NAME = 'session_token';

/** Default provisório (30 dias) — quem emitir o cookie decide a duração real
 * por chamada (ver parâmetro `maxAgeMs` abaixo); existe só para o caso comum,
 * nunca hardcoded dentro de `buildSessionCookieOptions`. */
export const DEFAULT_SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** Pura e testável sem Nest/Express real: recebe `NODE_ENV` já validado (ver
 * config/env.validation.ts) em vez de ler `process.env` diretamente.
 * `secure` só liga em produção porque desenvolvimento local roda em HTTP puro
 * (sem TLS) — um cookie `Secure` nunca seria enviado pelo navegador nesse
 * caso, quebrando login em dev. */
export function buildSessionCookieOptions(
  nodeEnv: string,
  maxAgeMs: number = DEFAULT_SESSION_MAX_AGE_MS,
): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: nodeEnv === 'production',
    path: '/',
    maxAge: maxAgeMs,
  };
}
