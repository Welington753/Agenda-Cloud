// Links de convite e de redefinição de senha. Mesmo formato do token de
// sessão (32 bytes aleatórios em hex, SHA-256 no banco): o token em texto só
// existe na memória do processo até o e-mail sair, e no link que a pessoa
// recebe. Nunca em log, resposta da administração ou banco.
import { generateSessionToken, hashSessionToken, isValidSessionTokenFormat } from '../auth/session-token.js';

/** Validade de um link: 24 horas a partir da emissão (ou do reenvio). */
export const ACCOUNT_LINK_TTL_MS = 24 * 60 * 60 * 1000;

/** Links emitidos por convite, contando o primeiro. Reenvio troca o token. */
export const MAX_INVITE_SENDS = 5;

export const generateAccountToken = generateSessionToken;
export const hashAccountToken = hashSessionToken;
export const isValidAccountTokenFormat = isValidSessionTokenFormat;

export function linkExpiresAt(now: Date): Date {
  return new Date(now.getTime() + ACCOUNT_LINK_TTL_MS);
}
