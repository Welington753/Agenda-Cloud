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
import { CABECALHO_ERRO_PROXY, ERRO_API_INDISPONIVEL } from "@/lib/api/proxy-marcadores";
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
    return { kind: "http-error", status: response.status, data };
  }
  return { kind: "success", status: response.status, data: data as T };
}
