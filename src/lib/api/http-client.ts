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

  // Corpo pode ser vazio (204) ou não-JSON (ex.: texto puro de um rate
  // limiter genérico) — nunca deixar `JSON.parse` derrubar a chamada por
  // causa disso; nesse caso `data` fica `null` e quem chama decide pelo
  // `status`, nunca pelo corpo.
  const raw = await response.text();
  let data: unknown = null;
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    return { kind: "http-error", status: response.status, data };
  }
  return { kind: "success", status: response.status, data: data as T };
}
