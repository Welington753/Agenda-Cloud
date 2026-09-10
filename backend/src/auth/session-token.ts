// Sessão opaca (nunca JWT) — token aleatório com `node:crypto`, exposto ao
// cliente só via cookie (ver config/session-cookie.config.ts). Só o SHA-256
// do token vai para `Session.tokenHash`; o token puro nunca é persistido em
// lugar nenhum (ver entities/session.entity.ts).
import { createHash, randomBytes } from 'node:crypto';

export const SESSION_TOKEN_BYTES = 32;

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generateSessionToken(): { token: string; tokenHash: string } {
  const token = randomBytes(SESSION_TOKEN_BYTES).toString('hex');
  return { token, tokenHash: hashSessionToken(token) };
}
