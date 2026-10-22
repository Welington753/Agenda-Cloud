// Destino do envio (o `endpoint` da inscrição) — proteção contra SSRF.
//
// O endpoint vem do navegador, então é dado de quem chama: sem conferência,
// qualquer usuário autenticado faria o servidor mandar POST para onde
// quisesse (rede interna, metadados da nuvem). Só são aceitos os serviços de
// push dos navegadores, por nome exato ou sufixo de domínio, em HTTPS na
// porta padrão, sem usuário/senha e sem IP literal. A conferência roda no
// cadastro E de novo antes de cada envio. O transporte não segue
// redirecionamento (ver push-transport.ts).
//
// O endpoint completo é uma credencial de entrega: nunca vai para log. Para
// busca e deduplicação usa-se o SHA-256; para diagnóstico, só o host.
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

/** Serviços de push conhecidos (Chrome/Android, Firefox, Safari/iOS, Edge). */
const HOSTS_EXATOS: ReadonlySet<string> = new Set([
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'web.push.apple.com',
]);
const SUFIXOS: readonly string[] = ['.push.apple.com', '.notify.windows.com'];

export const TAMANHO_MAXIMO_DO_ENDPOINT = 2048;

/** URL do serviço de push, ou `null` quando o destino não é aceito. */
export function endpointAceito(bruto: string): URL | null {
  if (typeof bruto !== 'string' || bruto.length === 0 || bruto.length > TAMANHO_MAXIMO_DO_ENDPOINT) return null;
  let url: URL;
  try {
    url = new URL(bruto);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  if (url.port !== '' && url.port !== '443') return null;
  const host = url.hostname.toLowerCase();
  if (isIP(host.replace(/^\[|\]$/g, '')) !== 0) return null;
  const conhecido =
    HOSTS_EXATOS.has(host) ||
    SUFIXOS.some((sufixo) => host.endsWith(sufixo) && host.length > sufixo.length);
  return conhecido ? url : null;
}

export function hashDoEndpoint(endpoint: string): string {
  return createHash('sha256').update(endpoint).digest('hex');
}

/** O que pode aparecer num log: só o host do serviço de push. */
export function hostParaLog(endpoint: string): string {
  try {
    return new URL(endpoint).hostname;
  } catch {
    return 'endpoint-invalido';
  }
}
