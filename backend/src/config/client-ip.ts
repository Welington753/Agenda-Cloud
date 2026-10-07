// Origem do IP do cliente usado no rate limit e na auditoria de sessão.
//
// `trust proxy` do Express continua DESLIGADO (ver main.ts). Ele só sabe
// confiar em `X-Forwarded-For` por contagem de saltos ou por faixa de IP, e
// nenhuma das duas coisas é garantida pela hospedagem: no Render, a borda
// (Cloudflare) ACRESCENTA ao `X-Forwarded-For` que o cliente mandou, então o
// valor mais à esquerda é controlado por quem chama, e o número de saltos
// até a aplicação não é documentado.
//
// Há duas fontes possíveis além do endereço da conexão, ambas desligadas por
// padrão:
//
// 1. `CF-Connecting-IP`, um cabeçalho único escrito pela borda, que
//    SOBRESCREVE o que o cliente mandou. Só é lido com
//    `CLIENT_IP_SOURCE=cf-connecting-ip`, depois de a hospedagem confirmar
//    essa garantia (ver docs/runbooks/publicacao-piloto-render.md, seção "IP
//    do cliente").
//
// 2. O proxy do frontend (Next.js, rota `/agenda_api`). No piloto, o
//    navegador fala só com o frontend, e o frontend chama esta API pela
//    internet pública. Para a API, todo o tráfego vem então do mesmo
//    endereço (o do frontend). O frontend informa o IP do cliente em
//    `X-Agenda-Client-IP`, e a API só aceita esse cabeçalho quando a mesma
//    requisição traz `X-Agenda-Proxy-Secret` igual a `API_PROXY_SECRET`, um
//    segredo que só os dois serviços conhecem. Sem o segredo, ou com segredo
//    errado, o cabeçalho é ignorado, e o IP vem da fonte do item anterior.
//
// O padrão (`socket`, sem `API_PROXY_SECRET`) é exatamente o comportamento
// anterior: `req.ip` com `trust proxy` desligado, ou seja, o endereço da
// conexão TCP.
import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import type { Request } from 'express';
import {
  ipKeyGenerator,
  type Options as RateLimitOptions,
} from 'express-rate-limit';

export const CLIENT_IP_SOURCES = ['socket', 'cf-connecting-ip'] as const;
export type ClientIpSource = (typeof CLIENT_IP_SOURCES)[number];
export const DEFAULT_CLIENT_IP_SOURCE: ClientIpSource = 'socket';

const CF_CONNECTING_IP_HEADER = 'cf-connecting-ip';

/** Cabeçalhos escritos pelo proxy do frontend. Os nomes precisam bater com
 * src/lib/api/proxy.ts. O proxy nunca repassa estes cabeçalhos vindos do
 * navegador: ele monta os dele. */
export const PROXY_SECRET_HEADER = 'x-agenda-proxy-secret';
export const PROXY_CLIENT_IP_HEADER = 'x-agenda-client-ip';

/** Tamanho mínimo de `API_PROXY_SECRET`. O valor do Render
 * (`generateValue: true`) é bem maior. */
export const MIN_PROXY_SECRET_LENGTH = 32;

/** Valor de configuração desconhecido ou ausente nunca liga a leitura de
 * cabeçalho: cai no padrão `socket`. O valor já chega validado pelo
 * `env.validation.ts` na aplicação real; isto cobre módulos testados isolados
 * (sem a validação global). */
export function parseClientIpSource(value: unknown): ClientIpSource {
  return CLIENT_IP_SOURCES.includes(value as ClientIpSource)
    ? (value as ClientIpSource)
    : DEFAULT_CLIENT_IP_SOURCE;
}

/** Segredo curto, vazio ou de outro tipo conta como ausente: nunca liga a
 * leitura de `X-Agenda-Client-IP`. Mesma razão de `parseClientIpSource`. */
export function parseProxySecret(value: unknown): string | undefined {
  return typeof value === 'string' && value.length >= MIN_PROXY_SECRET_LENGTH
    ? value
    : undefined;
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/** Comparação em tempo constante (sobre o hash, que tem tamanho fixo, então
 * nem o tamanho do segredo vaza). Cabeçalho repetido chega como lista ou
 * junto com vírgula e nunca confere. */
function hasValidProxySecret(
  headers: Request['headers'],
  proxySecret: string | undefined,
): boolean {
  if (proxySecret === undefined) return false;
  const raw = headers[PROXY_SECRET_HEADER];
  if (typeof raw !== 'string' || raw.length === 0) return false;
  return timingSafeEqual(digest(raw), digest(proxySecret));
}

/** Um único endereço IP válido, ou `undefined`. */
function singleIp(raw: string | string[] | undefined): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const candidate = raw.trim();
  return isIP(candidate) !== 0 ? candidate : undefined;
}

/** IP do cliente segundo a configuração.
 *
 * 1. Com `proxySecret` configurado e a requisição trazendo esse mesmo
 *    segredo em `X-Agenda-Proxy-Secret`: `X-Agenda-Client-IP`, se for UM
 *    endereço IP válido.
 * 2. Senão, ou se esse cabeçalho estiver ausente ou malformado, a fonte
 *    `source`:
 *    - `socket`: `req.ip` (com `trust proxy` desligado, o endereço da
 *      conexão). Nenhum cabeçalho é lido.
 *    - `cf-connecting-ip`: o cabeçalho, só se for UM endereço IP válido.
 *      Valor ausente, repetido (o Node junta repetições com vírgula) ou
 *      malformado cai no endereço da conexão.
 *
 * Toda falha cai num endereço que quem chama não escolhe. No Render, esse
 * endereço é o de um proxy, compartilhado por muitos clientes: falhar assim
 * deixa o limite MAIS restritivo, nunca mais frouxo.
 *
 * `X-Forwarded-For` nunca é lido em nenhum dos modos. */
export function resolveClientIp(
  req: Pick<Request, 'ip' | 'headers'>,
  source: ClientIpSource,
  proxySecret?: string,
): string | undefined {
  if (hasValidProxySecret(req.headers, proxySecret)) {
    const forwarded = singleIp(req.headers[PROXY_CLIENT_IP_HEADER]);
    if (forwarded !== undefined) return forwarded;
  }
  if (source === 'cf-connecting-ip') {
    const edge = singleIp(req.headers[CF_CONNECTING_IP_HEADER]);
    if (edge !== undefined) return edge;
  }
  return req.ip;
}

/** Opções de `rateLimit()` para a configuração. Em `socket` sem segredo de
 * proxy não muda nada: o `keyGenerator` padrão da lib continua valendo, com
 * as validações dela (inclusive o aviso de `X-Forwarded-For` com `trust
 * proxy` desligado). Nos outros casos, a chave vem de `resolveClientIp`,
 * com o mesmo agrupamento de IPv6 por sub-rede (`ipKeyGenerator`) do
 * padrão. */
export function clientIpRateLimitOptions(
  source: ClientIpSource,
  proxySecret?: string,
): Pick<Partial<RateLimitOptions>, 'keyGenerator'> {
  if (source === 'socket' && proxySecret === undefined) return {};
  return {
    keyGenerator: (request) =>
      ipKeyGenerator(
        resolveClientIp(request, source, proxySecret) ?? 'unknown',
      ),
  };
}
