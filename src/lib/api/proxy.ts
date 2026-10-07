// Encaminhamento da API pelo próprio Next.js: o navegador chama
// `<frontend>/agenda_api/<caminho>` e este código repete a chamada em
// `<API_PROXY_TARGET>/<caminho>`, servidor a servidor. Assim frontend e API
// ficam na MESMA origem para o navegador, e o cookie de sessão
// (`SameSite=Lax`) funciona mesmo nos endereços gratuitos `*.onrender.com`,
// que estão na Public Suffix List (ver docs/runbooks/publicacao-piloto-render.md).
//
// Regras:
// - destino fixo, da configuração do servidor; o caminho pedido nunca muda
//   o host (conferido depois de montar a URL);
// - só cabeçalhos de uma lista fechada vão à API. `X-Forwarded-For`,
//   `CF-Connecting-IP`, `Origin` e os `X-Agenda-*` enviados pelo navegador
//   nunca passam; os `X-Agenda-*` são escritos aqui;
// - escritas exigem `Origin` igual à origem pública deste frontend;
// - resposta sem cache (`no-store`) e sem nova tentativa: uma escrita que
//   falhou no meio nunca é repetida aqui;
// - `Set-Cookie` da API chega ao navegador sem alteração (HttpOnly, Secure
//   e SameSite são decididos só pela API).
import { isIP } from "node:net";

import type { ConfiguracaoProxy } from "./proxy-config";
import { CABECALHO_ERRO_PROXY, ERRO_API_INDISPONIVEL } from "./proxy-marcadores";

export const CABECALHO_SEGREDO_PROXY = "x-agenda-proxy-secret";
export const CABECALHO_IP_CLIENTE = "x-agenda-client-ip";

/** O plano gratuito do Render hiberna o serviço sem tráfego, e a primeira
 * requisição pode esperar o serviço subir de novo (perto de um minuto). */
export const TEMPO_LIMITE_MS = 90_000;
/** Bem acima de qualquer corpo legítimo da API (JSON pequeno). */
export const TAMANHO_MAXIMO_CORPO = 1024 * 1024;

const METODOS_DE_ESCRITA = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const CABECALHOS_PARA_API = ["accept", "accept-language", "content-type", "cookie", "user-agent"];
const CABECALHOS_PARA_NAVEGADOR = [
  "content-type",
  "retry-after",
  "ratelimit-limit",
  "ratelimit-remaining",
  "ratelimit-reset",
  "ratelimit-policy",
];

type Fetch = (entrada: URL, init: RequestInit) => Promise<Response>;

function respostaDoProxy(status: number, mensagem: string, apiIndisponivel = false): Response {
  const headers = new Headers({ "cache-control": "no-store" });
  if (apiIndisponivel) headers.set(CABECALHO_ERRO_PROXY, ERRO_API_INDISPONIVEL);
  return Response.json({ message: mensagem }, { status, headers });
}

/** URL final na API, ou `null` se o caminho for inválido. Cada segmento é
 * recodificado, então `/`, `\`, `?` e `#` dentro dele nunca viram
 * separador, e `.`/`..` são recusados. */
export function montarUrlDestino(destino: URL, segmentos: string[], busca: string): URL | null {
  if (segmentos.length === 0) return null;
  if (segmentos.some((segmento) => segmento === "" || segmento === "." || segmento === "..")) return null;
  const caminho = segmentos.map((segmento) => encodeURIComponent(segmento)).join("/");
  const url = new URL(`/${caminho}${busca}`, destino.origin);
  return url.origin === destino.origin ? url : null;
}

/** IP do cliente a repassar, ou `undefined`. Só com o segredo configurado e
 * só de uma fonte que o navegador não escolhe:
 * - `socket`: nenhum. O Route Handler não expõe o endereço da conexão, e o
 *   `X-Forwarded-For` que o Next.js preenche só quando AUSENTE pode vir
 *   pronto do navegador.
 * - `cf-connecting-ip`: o cabeçalho escrito pela borda do Render, se for UM
 *   IP válido. Mesma condição de confirmação da API (runbook, seção 5). */
export function ipDoClienteParaRepassar(
  headers: Headers,
  configuracao: Pick<ConfiguracaoProxy, "segredo" | "fonteIpCliente">,
): string | undefined {
  if (configuracao.segredo === undefined || configuracao.fonteIpCliente !== "cf-connecting-ip") return undefined;
  const valor = headers.get("cf-connecting-ip")?.trim();
  return valor && isIP(valor) !== 0 ? valor : undefined;
}

function cabecalhosParaApi(entrada: Headers, configuracao: ConfiguracaoProxy): Headers {
  const saida = new Headers();
  for (const nome of CABECALHOS_PARA_API) {
    const valor = entrada.get(nome);
    if (valor !== null) saida.set(nome, valor);
  }
  if (configuracao.segredo !== undefined) {
    saida.set(CABECALHO_SEGREDO_PROXY, configuracao.segredo);
    const ip = ipDoClienteParaRepassar(entrada, configuracao);
    if (ip !== undefined) saida.set(CABECALHO_IP_CLIENTE, ip);
  }
  return saida;
}

function cabecalhosParaNavegador(resposta: Response): Headers {
  const saida = new Headers({ "cache-control": "no-store" });
  for (const nome of CABECALHOS_PARA_NAVEGADOR) {
    const valor = resposta.headers.get(nome);
    if (valor !== null) saida.set(nome, valor);
  }
  for (const cookie of resposta.headers.getSetCookie()) saida.append("set-cookie", cookie);
  return saida;
}

async function lerCorpo(requisicao: Request): Promise<ArrayBuffer | null | "grande-demais"> {
  if (requisicao.method === "GET" || requisicao.method === "HEAD") return null;
  const declarado = Number(requisicao.headers.get("content-length"));
  if (Number.isFinite(declarado) && declarado > TAMANHO_MAXIMO_CORPO) return "grande-demais";
  const corpo = await requisicao.arrayBuffer();
  if (corpo.byteLength > TAMANHO_MAXIMO_CORPO) return "grande-demais";
  return corpo.byteLength > 0 ? corpo : null;
}

export async function encaminharParaApi(
  requisicao: Request,
  segmentos: string[],
  configuracao: ConfiguracaoProxy,
  fetchImpl: Fetch = fetch,
): Promise<Response> {
  if (METODOS_DE_ESCRITA.has(requisicao.method)) {
    // Mesma regra das Server Actions do Next.js: o navegador sempre manda
    // `Origin` em escritas, e outro site nunca consegue forjá-lo.
    if (requisicao.headers.get("origin") !== configuracao.origemPublica) {
      return respostaDoProxy(403, "Origem não permitida.");
    }
  }

  const url = montarUrlDestino(configuracao.destino, segmentos, new URL(requisicao.url).search);
  if (url === null) return respostaDoProxy(404, "Caminho inválido.");

  const corpo = await lerCorpo(requisicao);
  if (corpo === "grande-demais") return respostaDoProxy(413, "Requisição grande demais.");

  let resposta: Response;
  try {
    resposta = await fetchImpl(url, {
      method: requisicao.method,
      headers: cabecalhosParaApi(requisicao.headers, configuracao),
      body: corpo,
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.any([requisicao.signal, AbortSignal.timeout(TEMPO_LIMITE_MS)]),
    });
  } catch (erro) {
    const tempoEsgotado = erro instanceof DOMException && erro.name === "TimeoutError";
    return respostaDoProxy(tempoEsgotado ? 504 : 502, "API indisponível.", true);
  }

  // Corpo inteiro em memória: respostas da API são JSON pequenos, e assim o
  // status e os cabeçalhos só saem depois de a API terminar de responder.
  // Um redirecionamento da API nunca é seguido nem repassado (`Location`
  // fica de fora): o navegador nunca é levado para fora desta origem.
  let conteudo: ArrayBuffer;
  try {
    conteudo = await resposta.arrayBuffer();
  } catch {
    return respostaDoProxy(502, "API indisponível.", true);
  }
  const semCorpo = resposta.status === 204 || resposta.status === 304 || conteudo.byteLength === 0;
  return new Response(semCorpo ? null : conteudo, {
    status: resposta.status,
    headers: cabecalhosParaNavegador(resposta),
  });
}
