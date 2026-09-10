// Sessão opaca (nunca JWT) — token aleatório com `node:crypto`, exposto ao
// cliente só via cookie (ver config/session-cookie.config.ts). Só o SHA-256
// do token vai para `Session.tokenHash`; o token puro nunca é persistido em
// lugar nenhum (ver entities/session.entity.ts).
import { createHash, randomBytes } from 'node:crypto';

export const SESSION_TOKEN_BYTES = 32;

const SESSION_TOKEN_FORMAT = new RegExp(`^[0-9a-f]{${SESSION_TOKEN_BYTES * 2}}$`);

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generateSessionToken(): { token: string; tokenHash: string } {
  const token = randomBytes(SESSION_TOKEN_BYTES).toString('hex');
  return { token, tokenHash: hashSessionToken(token) };
}

/** Checa formato/tamanho ANTES de consultar o banco — cookie malformado ou
 * forjado nunca gera um SELECT (ver auditoria do guard de sessão, Lote
 * 6B.4/6B.5). Não prova que o token é válido, só que tem a forma certa. */
export function isValidSessionTokenFormat(token: string): boolean {
  return SESSION_TOKEN_FORMAT.test(token);
}
