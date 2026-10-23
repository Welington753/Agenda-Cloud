// Limites por IP das rotas de conta que conferem senha ou token, na mesma
// fonte de IP do login (config/client-ip.ts) e com store em memória (uma
// instância só, como o resto do piloto).
//
// - aceite de convite e redefinição: 10 tentativas a cada 15 minutos;
// - consulta de link (sem escrita): 30 a cada 15 minutos;
// - reconfirmação de senha na administração: 5 a cada 15 minutos.
import { rateLimit, type RateLimitRequestHandler } from 'express-rate-limit';
import { clientIpRateLimitOptions, type ClientIpSource } from '../config/client-ip.js';

export const ACCOUNT_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
export const ACCOUNT_SUBMIT_LIMIT = 10;
export const ACCOUNT_PREVIEW_LIMIT = 30;
export const REAUTH_LIMIT = 5;

export function createAccountRateLimiter(
  limit: number,
  clientIpSource: ClientIpSource,
  proxySecret?: string,
): RateLimitRequestHandler {
  return rateLimit({
    windowMs: ACCOUNT_RATE_LIMIT_WINDOW_MS,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    ...clientIpRateLimitOptions(clientIpSource, proxySecret),
  });
}
