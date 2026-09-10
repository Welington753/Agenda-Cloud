// Rate limit de POST /auth/login — instância própria de `rateLimit()`, nunca
// compartilhada com `register-rate-limit.ts` (MemoryStore próprio por
// instância, sem configuração explícita de `store` aqui): esgotar as
// tentativas de cadastro nunca bloqueia login, e vice-versa (ver
// login-rate-limit.spec.ts).
//
// Identificador é só o IP (via `keyGenerator` padrão da lib) — nunca
// email/senha do corpo, que permitiria um atacante rotacionar o
// identificador só trocando o payload. `trust proxy` continua desligado (ver
// main.ts) — inalterado aqui. MemoryStore aceito só para o MVP de instância
// única (mesma ressalva de register-rate-limit.ts).
import { rateLimit, type RateLimitRequestHandler } from 'express-rate-limit';

export const LOGIN_RATE_LIMIT_MAX = 5;
export const LOGIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

export function createLoginRateLimiter(): RateLimitRequestHandler {
  return rateLimit({
    windowMs: LOGIN_RATE_LIMIT_WINDOW_MS,
    limit: LOGIN_RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
  });
}
