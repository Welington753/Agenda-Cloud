// Limites por IP das rotas de conta que conferem senha ou token, na mesma
// fonte de IP do login (config/client-ip.ts) e com store em memória (uma
// instância só, como o resto do piloto).
//
// - aceite de convite e redefinição: 10 tentativas a cada 15 minutos;
// - consulta de link (sem escrita): 30 a cada 15 minutos;
// - reconfirmação de senha na administração: 5 a cada 15 minutos;
// - criação de acesso e convite de equipe: 10 RECUSAS a cada 15 minutos (as
//   criações aceitas não contam). Um login ou e-mail já usado é recusado com
//   mensagem genérica, e isto limita a sondagem em série de identificadores.
import { rateLimit, type RateLimitRequestHandler } from 'express-rate-limit';
import { clientIpRateLimitOptions, type ClientIpSource } from '../config/client-ip.js';

export const ACCOUNT_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
export const ACCOUNT_SUBMIT_LIMIT = 10;
export const ACCOUNT_PREVIEW_LIMIT = 30;
export const REAUTH_LIMIT = 5;
export const TEAM_CREATION_FAILURE_LIMIT = 10;

export function createAccountRateLimiter(
  limit: number,
  clientIpSource: ClientIpSource,
  proxySecret?: string,
  { onlyFailures = false }: { onlyFailures?: boolean } = {},
): RateLimitRequestHandler {
  return rateLimit({
    windowMs: ACCOUNT_RATE_LIMIT_WINDOW_MS,
    limit,
    // Só respostas >= 400 contam (express-rate-limit).
    skipSuccessfulRequests: onlyFailures,
    standardHeaders: true,
    legacyHeaders: false,
    ...clientIpRateLimitOptions(clientIpSource, proxySecret),
  });
}
