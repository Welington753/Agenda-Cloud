// Limites por IP das rotas PÚBLICAS do agendamento online. Mesmo store em
// memória e a mesma fonte de IP explícita do login e do cadastro (ver
// auth/register-rate-limit.ts e config/client-ip.ts) — com a mesma
// ressalva: em várias instâncias o limite vale por processo.
//
// São limiters PRÓPRIOS (instâncias separadas): consultar a página pública
// nunca consome o orçamento de login ou de cadastro, e vice-versa. Os
// limites de login e cadastro não mudam.
//
// O limite por TELEFONE não está aqui: é contado no banco, dentro da
// transação do pedido (ver public-booking.service.ts), porque precisa
// sobreviver a reinício e não pode ser contornado trocando de IP.
import { rateLimit, type RateLimitRequestHandler } from 'express-rate-limit';
import {
  clientIpRateLimitOptions,
  DEFAULT_CLIENT_IP_SOURCE,
  type ClientIpSource,
} from '../config/client-ip.js';

/** Envio de pedidos: 10 por hora por IP (plano, Lote A, item 1). */
export const PUBLIC_REQUEST_RATE_LIMIT_MAX = 10;
export const PUBLIC_REQUEST_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

/** Leitura da página e dos horários: 120 por 10 min por IP. Folga para
 * quem navega por vários dias e profissionais; trava varredura em massa. */
export const PUBLIC_READ_RATE_LIMIT_MAX = 120;
export const PUBLIC_READ_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

export const PUBLIC_RATE_LIMIT_MESSAGE =
  'Muitas tentativas a partir desta conexão. Aguarde alguns minutos e tente de novo.';

function criar(
  limit: number,
  windowMs: number,
  clientIpSource: ClientIpSource,
  proxySecret?: string,
): RateLimitRequestHandler {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    // JSON no mesmo formato dos erros do Nest, para a tela mostrar a frase.
    message: { statusCode: 429, message: PUBLIC_RATE_LIMIT_MESSAGE },
    ...clientIpRateLimitOptions(clientIpSource, proxySecret),
  });
}

export function createPublicRequestRateLimiter(
  clientIpSource: ClientIpSource = DEFAULT_CLIENT_IP_SOURCE,
  proxySecret?: string,
): RateLimitRequestHandler {
  return criar(
    PUBLIC_REQUEST_RATE_LIMIT_MAX,
    PUBLIC_REQUEST_RATE_LIMIT_WINDOW_MS,
    clientIpSource,
    proxySecret,
  );
}

export function createPublicReadRateLimiter(
  clientIpSource: ClientIpSource = DEFAULT_CLIENT_IP_SOURCE,
  proxySecret?: string,
): RateLimitRequestHandler {
  return criar(
    PUBLIC_READ_RATE_LIMIT_MAX,
    PUBLIC_READ_RATE_LIMIT_WINDOW_MS,
    clientIpSource,
    proxySecret,
  );
}
