// Origem exata de `FRONTEND_URL` (nunca wildcard) + `credentials: true` — a
// combinação `credentials: true` com origem `*` é proibida pela própria spec
// de CORS (navegador rejeita a resposta), e mesmo que não fosse, wildcard com
// credenciais permitiria qualquer site ler a resposta autenticada. Pura e
// testável sem Nest: recebe a URL já validada por `config/env.validation.ts`
// (`FRONTEND_URL`), nunca lê `process.env` diretamente.
import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface.js';

export function buildCorsOptions(frontendUrl: string): CorsOptions {
  return {
    origin: frontendUrl,
    credentials: true,
  };
}
