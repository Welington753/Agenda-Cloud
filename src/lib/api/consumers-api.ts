// Cliente tipado da tela de Clientes (`/conta/clientes`) — espelha
// backend/src/consumers/consumers.controller.ts e consumer.dto.ts. Só as duas
// rotas que existem: BUSCA por termo (mínimo 2 caracteres, no máximo 20
// linhas) e CADASTRO. Não há listagem completa, edição nem exclusão.
//
// O formato do cliente (`ClienteReal`) é o mesmo que o seletor da Agenda já
// usa (appointments-api.ts) — um cliente cadastrado aqui aparece lá sem
// conversão nenhuma.
import { apiRequest } from "./http-client";
import type { ClienteReal } from "./appointments-api";

export type { ClienteReal };

/** Teto da busca no backend (`LIMITE_DE_BUSCA` em consumers.service.ts): uma
 * resposta com este número de linhas pode ter deixado clientes de fora. */
export const LIMITE_BUSCA_CLIENTES = 20;
/** Espelha `z.string().trim().min(2)` de `consumerSearchSchema`. */
export const TERMO_MINIMO_BUSCA = 2;

export interface DadosCadastroCliente {
  name: string;
  whatsapp: string;
  email?: string;
}

export type FalhaClientesReal =
  | { tipo: "nao_autenticado" }
  /** 404: o estabelecimento não existe OU não há vínculo — indistinguíveis. */
  | { tipo: "sem_acesso" }
  | { tipo: "sem_permissao" }
  | { tipo: "dados_invalidos"; mensagem: string | null }
  /** 409: já existe cliente com este WhatsApp neste estabelecimento. Nada foi
   * sobrescrito. */
  | { tipo: "duplicado"; mensagem: string | null }
  | { tipo: "falha_comunicacao" }
  | { tipo: "indisponivel" };

export type ResultadoClientesReal<T> =
  | { ok: true; dados: T }
  | { ok: false; falha: FalhaClientesReal };

function mensagemDeErroDoBackend(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const mensagem = (data as Record<string, unknown>).message;
  return typeof mensagem === "string" ? mensagem : null;
}

function falhaPorStatus(status: number, data: unknown): FalhaClientesReal {
  if (status === 401) return { tipo: "nao_autenticado" };
  if (status === 403) return { tipo: "sem_permissao" };
  if (status === 404) return { tipo: "sem_acesso" };
  if (status === 409) return { tipo: "duplicado", mensagem: mensagemDeErroDoBackend(data) };
  if (status === 400) return { tipo: "dados_invalidos", mensagem: mensagemDeErroDoBackend(data) };
  return { tipo: "indisponivel" };
}

function ehCliente(valor: unknown): valor is ClienteReal {
  if (typeof valor !== "object" || valor === null) return false;
  const v = valor as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    typeof v.whatsapp === "string" &&
    (v.email === null || typeof v.email === "string")
  );
}

const caminhoClientes = (tenantId: string) =>
  `/tenants/${encodeURIComponent(tenantId)}/consumers`;

export async function pesquisarClientes(
  tenantId: string,
  termo: string,
  signal?: AbortSignal,
): Promise<ResultadoClientesReal<ClienteReal[]>> {
  const resultado = await apiRequest<unknown>(
    `${caminhoClientes(tenantId)}?q=${encodeURIComponent(termo)}`,
    { method: "GET", signal },
  );

  if (resultado.kind === "network-error") return { ok: false, falha: { tipo: "falha_comunicacao" } };
  if (resultado.kind === "http-error") {
    return { ok: false, falha: falhaPorStatus(resultado.status, resultado.data) };
  }

  const corpo = resultado.data as { consumers?: unknown };
  if (!Array.isArray(corpo?.consumers) || !corpo.consumers.every(ehCliente)) {
    return { ok: false, falha: { tipo: "indisponivel" } };
  }
  return { ok: true, dados: corpo.consumers };
}

/** Sem `signal` de propósito: um cadastro já enviado não é abortado pela
 * tela — abortar só esconderia se ele foi gravado ou não. */
export async function cadastrarCliente(
  tenantId: string,
  dados: DadosCadastroCliente,
): Promise<ResultadoClientesReal<ClienteReal>> {
  const resultado = await apiRequest<unknown>(caminhoClientes(tenantId), {
    method: "POST",
    body: dados,
  });

  if (resultado.kind === "network-error") return { ok: false, falha: { tipo: "falha_comunicacao" } };
  if (resultado.kind === "http-error") {
    return { ok: false, falha: falhaPorStatus(resultado.status, resultado.data) };
  }

  const corpo = resultado.data as { consumer?: unknown };
  if (!ehCliente(corpo?.consumer)) return { ok: false, falha: { tipo: "indisponivel" } };
  return { ok: true, dados: corpo.consumer };
}
