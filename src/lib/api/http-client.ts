// Cliente HTTP fino sobre `fetch`, único ponto que fala com o backend real.
// `credentials: "include"` sempre — é isto que envia/recebe o cookie HttpOnly
// de sessão; o JavaScript nunca lê o valor do cookie em si. Nunca usa cache
// compartilhado (respostas autenticadas nunca podem ser reaproveitadas entre
// usuários) — por isso `cache: "no-store"` fixo, nunca configurável por
// chamador.
//
// Distingue explicitamente falha de REDE (`network-error`: fetch rejeitou —
// offline, DNS, servidor fora do ar) de uma resposta HTTP com status de erro
// (`http-error`: o servidor respondeu, só que com 4xx/5xx). Um 401 nunca deve
// ser tratado como "backend indisponível" e vice-versa — são estados
// diferentes para quem decide a UI (ver real-session-state.ts).
//
// No modo mesma origem (`NEXT_PUBLIC_API_URL=/agenda_api`, ver
// lib/api/proxy.ts), quem responde é o proxy do Next.js. Quando a API não
// responde, o proxy devolve 502/504 marcado com `X-Agenda-Proxy-Error`, e
// isso continua sendo `network-error`: para a UI, a API está fora do ar do
// mesmo jeito que numa chamada direta. O mesmo vale para uma página HTML da
// hospedagem (ver abaixo): a API não chegou a responder.
import { pedirPartidaDaApi } from "@/lib/api/acordar-api";
import { CABECALHO_ACORDAR_API, CABECALHO_ERRO_PROXY, ERRO_API_INDISPONIVEL } from "@/lib/api/proxy-marcadores";
import { API_BASE_URL } from "@/lib/config";

export type ApiResult<T> =
  | { kind: "success"; status: number; data: T }
  | { kind: "http-error"; status: number; data: unknown }
  | { kind: "network-error" };

export interface ApiRequestInit {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
}

/** O `message` de um erro da API, quando é texto. Os módulos de cada área
 * decidem o que fazer com ele; o status continua sendo o que classifica. */
export function mensagemDoBackend(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const mensagem = (data as Record<string, unknown>).message;
  return typeof mensagem === "string" ? mensagem : null;
}

const STATUS_DE_GATEWAY = new Set([502, 503, 504]);

export async function apiRequest<T>(path: string, init: ApiRequestInit = {}): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: init.method ?? "GET",
      credentials: "include",
      cache: "no-store",
      signal: init.signal,
      headers: init.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    return { kind: "network-error" };
  }
  if (response.headers.get(CABECALHO_ERRO_PROXY) === ERRO_API_INDISPONIVEL) {
    // A hospedagem respondeu no lugar da API: só um pedido do navegador a
    // acorda (lib/api/acordar-api.ts). O pedido original nunca é repetido aqui.
    pedirPartidaDaApi(response.headers.get(CABECALHO_ACORDAR_API));
    return { kind: "network-error" };
  }
  // A API e o proxy só respondem JSON (ou corpo vazio). Uma página HTML
  // aqui é da HOSPEDAGEM respondendo no lugar deles, com qualquer status:
  // erro da borda ou página de "serviço acordando" do Render.
  if (response.headers.get("content-type")?.toLowerCase().includes("text/html")) {
    return { kind: "network-error" };
  }

  // Corpo pode ser vazio (204) ou não-JSON (ex.: texto puro de um rate
  // limiter genérico) — nunca deixar `JSON.parse` derrubar a chamada por
  // causa disso; nesse caso `data` fica `null` e quem chama decide pelo
  // `status`, nunca pelo corpo.
  let raw: string;
  try {
    raw = await response.text();
  } catch {
    // Conexão caiu (ou leitura cancelada) no meio do corpo.
    return { kind: "network-error" };
  }
  let data: unknown = null;
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = null;
    }
  }

  // 502/503/504 sem corpo JSON também é a hospedagem: um erro da própria API
  // sempre traz `{ message, statusCode }`.
  if (STATUS_DE_GATEWAY.has(response.status) && data === null) {
    return { kind: "network-error" };
  }
  if (!response.ok) {
    if (response.status === 403 && codigoDoBackend(data) === CODIGO_ACESSO_VENCIDO) avisarAcessoVencido();
    return { kind: "http-error", status: response.status, data };
  }
  return { kind: "success", status: response.status, data: data as T };
}

/** Código do servidor para o estabelecimento com o acesso vencido. */
export const CODIGO_ACESSO_VENCIDO = "ACESSO_VENCIDO";
/** Evento de `window` quando uma rota responde ACESSO_VENCIDO: a sessão
 * aberta antes do vencimento é relida, e a tela troca a página pelo aviso
 * de regularização em vez de ficar com erro (real-auth-context.tsx). */
export const EVENTO_ACESSO_VENCIDO = "agenda:acesso-vencido";

function codigoDoBackend(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const codigo = (data as Record<string, unknown>).code;
  return typeof codigo === "string" ? codigo : null;
}

function avisarAcessoVencido() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENTO_ACESSO_VENCIDO));
}
