// Rate limit de POST /auth/register — MemoryStore padrão do
// `express-rate-limit`, aceitável só para o MVP de instância única (ver
// docs/plans/mvp-agendamento-pequenos-negocios.md). Hospedagem horizontal
// (múltiplas instâncias) vai precisar de um store compartilhado (Redis etc.)
// para o limite valer entre processos — fora de escopo deste lote.
//
// Identificador é só o IP (via `keyGenerator` padrão da lib, que já trata
// IPv6 com `ipKeyGenerator`) — nunca email/telefone/dado do corpo, que
// permitiria um atacante rotacionar o identificador só trocando o payload.
// `trust proxy` continua desligado (ver main.ts); a fonte do IP é explícita
// (`CLIENT_IP_SOURCE`, ver config/client-ip.ts).
import { rateLimit, type RateLimitRequestHandler } from 'express-rate-limit';
import {
  clientIpRateLimitOptions,
  DEFAULT_CLIENT_IP_SOURCE,
  type ClientIpSource,
} from '../config/client-ip.js';

export const REGISTER_RATE_LIMIT_MAX = 5;
export const REGISTER_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

export function createRegisterRateLimiter(
  clientIpSource: ClientIpSource = DEFAULT_CLIENT_IP_SOURCE,
): RateLimitRequestHandler {
  return rateLimit({
    windowMs: REGISTER_RATE_LIMIT_WINDOW_MS,
    limit: REGISTER_RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    ...clientIpRateLimitOptions(clientIpSource),
  });
}
