// Origem do IP do cliente usado no rate limit e na auditoria de sessão.
//
// `trust proxy` do Express continua DESLIGADO (ver main.ts). Ele só sabe
// confiar em `X-Forwarded-For` por contagem de saltos ou por faixa de IP, e
// nenhuma das duas coisas é garantida pela hospedagem: no Render, a borda
// (Cloudflare) ACRESCENTA ao `X-Forwarded-For` que o cliente mandou, então o
// valor mais à esquerda é controlado por quem chama, e o número de saltos
// até a aplicação não é documentado.
//
// A alternativa é um cabeçalho único, escrito pela borda, que SOBRESCREVE o
// que o cliente mandou (`CF-Connecting-IP`). Ela só é ligada por opção
// explícita (`CLIENT_IP_SOURCE=cf-connecting-ip`), depois de a hospedagem
// confirmar essa garantia (ver docs/runbooks/publicacao-piloto-render.md,
// seção "IP do cliente"). O padrão (`socket`) é exatamente o comportamento
// anterior: `req.ip` com `trust proxy` desligado, ou seja, o endereço da
// conexão TCP.
import { isIP } from 'node:net';
import type { Request } from 'express';
import { ipKeyGenerator, type Options as RateLimitOptions } from 'express-rate-limit';

export const CLIENT_IP_SOURCES = ['socket', 'cf-connecting-ip'] as const;
export type ClientIpSource = (typeof CLIENT_IP_SOURCES)[number];
export const DEFAULT_CLIENT_IP_SOURCE: ClientIpSource = 'socket';

const CF_CONNECTING_IP_HEADER = 'cf-connecting-ip';

/** Valor de configuração desconhecido ou ausente nunca liga a leitura de
 * cabeçalho: cai no padrão `socket`. O valor já chega validado pelo
 * `env.validation.ts` na aplicação real; isto cobre módulos testados isolados
 * (sem a validação global). */
export function parseClientIpSource(value: unknown): ClientIpSource {
  return CLIENT_IP_SOURCES.includes(value as ClientIpSource)
    ? (value as ClientIpSource)
    : DEFAULT_CLIENT_IP_SOURCE;
}

/** IP do cliente segundo a fonte configurada.
 *
 * - `socket`: `req.ip` (com `trust proxy` desligado, o endereço da conexão).
 *   Nenhum cabeçalho é lido, nem `X-Forwarded-For` nem `CF-Connecting-IP`.
 * - `cf-connecting-ip`: o cabeçalho, só se for UM endereço IP válido. Valor
 *   ausente, repetido (o Node junta repetições com vírgula) ou malformado cai
 *   no endereço da conexão, nunca num valor escolhido por quem chama. No
 *   Render, esse endereço é o do proxy, compartilhado por todos: falhar assim
 *   deixa o limite MAIS restritivo, nunca mais frouxo.
 *
 * `X-Forwarded-For` nunca é lido em nenhum dos modos. */
export function resolveClientIp(
  req: Pick<Request, 'ip' | 'headers'>,
  source: ClientIpSource,
): string | undefined {
  if (source === 'cf-connecting-ip') {
    const raw = req.headers[CF_CONNECTING_IP_HEADER];
    if (typeof raw === 'string') {
      const candidate = raw.trim();
      if (isIP(candidate) !== 0) return candidate;
    }
  }
  return req.ip;
}

/** Opções de `rateLimit()` para a fonte configurada. Em `socket` não muda
 * nada: o `keyGenerator` padrão da lib continua valendo, com as validações
 * dela (inclusive o aviso de `X-Forwarded-For` com `trust proxy` desligado).
 * Em `cf-connecting-ip`, a chave vem de `resolveClientIp`, com o mesmo
 * agrupamento de IPv6 por sub-rede (`ipKeyGenerator`) do padrão. */
export function clientIpRateLimitOptions(
  source: ClientIpSource,
): Pick<Partial<RateLimitOptions>, 'keyGenerator'> {
  if (source === 'socket') return {};
  return {
    keyGenerator: (request) => ipKeyGenerator(resolveClientIp(request, source) ?? 'unknown'),
  };
}
