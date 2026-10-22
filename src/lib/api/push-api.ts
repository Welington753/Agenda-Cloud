// Cliente das rotas de Web Push (backend/src/push/push.controller.ts). O
// endpoint da inscrição vai sempre no CORPO, nunca na URL. Exigem sessão; a
// API confere o vínculo e a permissão a cada chamada.
import { apiRequest } from "./http-client";
import { falhaPorStatus, type FalhaPrivada, type ResultadoPrivado } from "./booking-requests-api";

export interface ConfiguracaoPush {
  enabled: boolean;
  publicKey: string | null;
}

export type FalhaPush = FalhaPrivada | { tipo: "push_desligado" } | { tipo: "inscricao_recusada"; mensagem: string | null };

export type ResultadoPush<T> = { ok: true; dados: T } | { ok: false; falha: FalhaPush };

const caminho = (tenantId: string) => `/tenants/${encodeURIComponent(tenantId)}/push-subscription`;

function falhaDaInscricao(status: number, data: unknown): FalhaPush {
  if (status === 503) return { tipo: "push_desligado" };
  if (status === 400) {
    const m = (data as Record<string, unknown> | null)?.message;
    return { tipo: "inscricao_recusada", mensagem: typeof m === "string" ? m : null };
  }
  return falhaPorStatus(status, data);
}

export async function obterConfiguracaoPush(signal?: AbortSignal): Promise<ResultadoPrivado<ConfiguracaoPush>> {
  const r = await apiRequest<unknown>("/push/config", { signal });
  if (r.kind === "network-error") return { ok: false, falha: { tipo: "falha_comunicacao" } };
  if (r.kind === "http-error") return { ok: false, falha: falhaPorStatus(r.status, r.data) };
  const push = (r.data as { push?: Partial<ConfiguracaoPush> } | null)?.push;
  if (typeof push?.enabled !== "boolean") return { ok: false, falha: { tipo: "indisponivel" } };
  return {
    ok: true,
    dados: { enabled: push.enabled, publicKey: typeof push.publicKey === "string" ? push.publicKey : null },
  };
}

function ativo(data: unknown): boolean | null {
  const v = (data as { subscription?: { active?: unknown } } | null)?.subscription?.active;
  return typeof v === "boolean" ? v : null;
}

export async function ativarInscricao(tenantId: string, inscricao: PushSubscriptionJSON): Promise<ResultadoPush<true>> {
  const r = await apiRequest<unknown>(caminho(tenantId), {
    method: "PUT",
    body: { endpoint: inscricao.endpoint, expirationTime: inscricao.expirationTime ?? null, keys: inscricao.keys },
  });
  if (r.kind === "network-error") return { ok: false, falha: { tipo: "falha_comunicacao" } };
  if (r.kind === "http-error") return { ok: false, falha: falhaDaInscricao(r.status, r.data) };
  return ativo(r.data) === true ? { ok: true, dados: true } : { ok: false, falha: { tipo: "indisponivel" } };
}

export async function consultarInscricao(
  tenantId: string,
  endpoint: string,
  signal?: AbortSignal,
): Promise<ResultadoPush<boolean>> {
  const r = await apiRequest<unknown>(`${caminho(tenantId)}/status`, { method: "POST", body: { endpoint }, signal });
  if (r.kind === "network-error") return { ok: false, falha: { tipo: "falha_comunicacao" } };
  if (r.kind === "http-error") return { ok: false, falha: falhaDaInscricao(r.status, r.data) };
  const valor = ativo(r.data);
  return valor === null ? { ok: false, falha: { tipo: "indisponivel" } } : { ok: true, dados: valor };
}

export async function desativarInscricao(tenantId: string, endpoint: string): Promise<ResultadoPush<false>> {
  const r = await apiRequest<unknown>(caminho(tenantId), { method: "DELETE", body: { endpoint } });
  if (r.kind === "network-error") return { ok: false, falha: { tipo: "falha_comunicacao" } };
  if (r.kind === "http-error") return { ok: false, falha: falhaDaInscricao(r.status, r.data) };
  return { ok: true, dados: false };
}
