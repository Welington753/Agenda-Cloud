// Leitura da página pública NO SERVIDOR do frontend, só para o que precisa
// existir antes do JavaScript: título, descrição, endereço canônico, dados
// estruturados e o status 404 de um estabelecimento inexistente. A tela de
// agendamento continua lendo a página no navegador, como sempre.
//
// Regras:
// - mesma API e mesmo destino fixo do proxy (`API_PROXY_TARGET`, ver
//   lib/api/proxy-config.ts); sem essa configuração (desenvolvimento e
//   suítes em chamada direta), nada é lido e a página segue como antes;
// - prazo curto: com a API hibernada ou lenta, a página não espera — sai com
//   metadados genéricos e a tela do navegador faz a recuperação de sempre;
// - só "inexistente" (404 da API ou slug fora do formato) vira página 404.
//   Qualquer dúvida (erro, limite, resposta ilegível, tempo esgotado) é
//   `desconhecida`, nunca 404: um estabelecimento real não some da busca
//   porque a API estava acordando;
// - o IP do visitante segue para o limite por IP da API só com o segredo do
//   proxy, pela mesma regra do encaminhamento (`ipDoClienteParaRepassar`).
//   Nada do navegador (cookie, cabeçalhos) vai junto: a leitura é pública.
import type { ConfiguracaoProxy } from "@/lib/api/proxy-config";
import { CABECALHO_IP_CLIENTE, CABECALHO_SEGREDO_PROXY, ipDoClienteParaRepassar } from "@/lib/api/proxy";
import { paginaDoCorpo, type PaginaPublica } from "@/lib/api/public-booking-api";

/** Mesmo formato aceito pela API (backend/src/public-booking/public-booking.dto.ts,
 * `publicSlugSchema`), depois de minúsculas. */
const FORMATO_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;

/** Bem abaixo do proxy (90 s): aqui a página espera, não o visitante clicando. */
export const PRAZO_LEITURA_NO_SERVIDOR_MS = 2_500;

export type PaginaNoServidor =
  | { tipo: "encontrada"; pagina: PaginaPublica; slug: string }
  | { tipo: "inexistente" }
  | { tipo: "desconhecida" };

type Fetch = (entrada: URL, init: RequestInit) => Promise<Response>;

/** Slug normalizado como a API o trata, ou `null` fora do formato. */
export function slugPublicoNormalizado(slug: string): string | null {
  let valor: string;
  try {
    valor = decodeURIComponent(slug).trim().toLowerCase();
  } catch {
    return null;
  }
  return FORMATO_SLUG.test(valor) ? valor : null;
}

export async function lerPaginaNoServidor(
  slugPedido: string,
  configuracao: ConfiguracaoProxy | null,
  cabecalhosDaRequisicao: Headers,
  fetchImpl: Fetch = fetch,
  prazoMs: number = PRAZO_LEITURA_NO_SERVIDOR_MS,
): Promise<PaginaNoServidor> {
  const slug = slugPublicoNormalizado(slugPedido);
  if (slug === null) return { tipo: "inexistente" };
  if (configuracao === null) return { tipo: "desconhecida" };

  const headers = new Headers({ accept: "application/json" });
  if (configuracao.segredo !== undefined) {
    headers.set(CABECALHO_SEGREDO_PROXY, configuracao.segredo);
    const ip = ipDoClienteParaRepassar(cabecalhosDaRequisicao, configuracao);
    if (ip !== undefined) headers.set(CABECALHO_IP_CLIENTE, ip);
  }

  const url = new URL(`/public/${encodeURIComponent(slug)}`, configuracao.destino.origin);
  try {
    const resposta = await fetchImpl(url, {
      method: "GET",
      headers,
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(prazoMs),
    });
    // 404 só quando é a API respondendo (JSON): uma página da hospedagem
    // nunca decide que o estabelecimento não existe.
    const json = resposta.headers.get("content-type")?.toLowerCase().includes("application/json") ?? false;
    if (resposta.status === 404 && json) return { tipo: "inexistente" };
    if (resposta.status !== 200 || !json) return { tipo: "desconhecida" };
    const pagina = paginaDoCorpo(await resposta.json());
    if (pagina === null) return { tipo: "desconhecida" };
    const slugDaApi = typeof pagina.establishment.slug === "string" ? slugPublicoNormalizado(pagina.establishment.slug) : null;
    return { tipo: "encontrada", pagina, slug: slugDaApi ?? slug };
  } catch {
    return { tipo: "desconhecida" };
  }
}
