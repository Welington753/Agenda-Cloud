// Cliente das rotas PRIVADAS do agendamento online — espelha
// `PublicBookingAdminController` (backend/src/public-booking/). Exigem
// sessão: confirmar e recusar continuam sendo as ações de
// appointment-status-api.ts e appointments-api.ts (`confirm` e `cancel`).
import { apiRequest } from "./http-client";
import type { AgendamentoReal } from "./appointments-api";

export type SolicitacaoPendente = AgendamentoReal & {
  /** `PUBLIC` = veio do agendamento online; `INTERNAL` = criada pela agenda. */
  origin: "PUBLIC" | "INTERNAL";
  requestedAt: string | null;
};

export interface ListaDeSolicitacoes {
  solicitacoes: SolicitacaoPendente[];
  completa: boolean;
}

export interface ConfiguracaoAgendamentoOnline {
  enabled: boolean;
  slug: string;
  updatedAt: string | null;
}

export type FalhaPrivada =
  | { tipo: "nao_autenticado" }
  | { tipo: "sem_acesso" }
  | { tipo: "sem_permissao"; mensagem: string | null }
  | { tipo: "falha_comunicacao" }
  | { tipo: "indisponivel" };

export type ResultadoPrivado<T> = { ok: true; dados: T } | { ok: false; falha: FalhaPrivada };

export function falhaPorStatus(status: number, data: unknown): FalhaPrivada {
  if (status === 401) return { tipo: "nao_autenticado" };
  if (status === 403) {
    const m = (data as Record<string, unknown> | null)?.message;
    return { tipo: "sem_permissao", mensagem: typeof m === "string" ? m : null };
  }
  if (status === 404) return { tipo: "sem_acesso" };
  return { tipo: "indisponivel" };
}

const caminho = (tenantId: string, sufixo: string) =>
  `/tenants/${encodeURIComponent(tenantId)}/${sufixo}`;

export async function listarSolicitacoes(
  tenantId: string,
  signal?: AbortSignal,
): Promise<ResultadoPrivado<ListaDeSolicitacoes>> {
  const r = await apiRequest<unknown>(caminho(tenantId, "booking-requests"), { signal });
  if (r.kind === "network-error") return { ok: false, falha: { tipo: "falha_comunicacao" } };
  if (r.kind === "http-error") return { ok: false, falha: falhaPorStatus(r.status, r.data) };
  const corpo = r.data as { requests?: unknown; complete?: unknown };
  if (!Array.isArray(corpo?.requests)) return { ok: false, falha: { tipo: "indisponivel" } };
  return {
    ok: true,
    dados: { solicitacoes: corpo.requests as SolicitacaoPendente[], completa: corpo.complete === true },
  };
}

function ehConfiguracao(v: unknown): v is ConfiguracaoAgendamentoOnline {
  if (typeof v !== "object" || v === null) return false;
  const c = v as Record<string, unknown>;
  return typeof c.enabled === "boolean" && typeof c.slug === "string";
}

export async function obterConfiguracaoOnline(
  tenantId: string,
  signal?: AbortSignal,
): Promise<ResultadoPrivado<ConfiguracaoAgendamentoOnline>> {
  const r = await apiRequest<unknown>(caminho(tenantId, "public-booking"), { signal });
  if (r.kind === "network-error") return { ok: false, falha: { tipo: "falha_comunicacao" } };
  if (r.kind === "http-error") return { ok: false, falha: falhaPorStatus(r.status, r.data) };
  const corpo = r.data as { settings?: unknown };
  if (!ehConfiguracao(corpo?.settings)) return { ok: false, falha: { tipo: "indisponivel" } };
  return { ok: true, dados: corpo.settings };
}

export async function salvarConfiguracaoOnline(
  tenantId: string,
  enabled: boolean,
): Promise<ResultadoPrivado<ConfiguracaoAgendamentoOnline>> {
  const r = await apiRequest<unknown>(caminho(tenantId, "public-booking"), {
    method: "PUT",
    body: { enabled },
  });
  if (r.kind === "network-error") return { ok: false, falha: { tipo: "falha_comunicacao" } };
  if (r.kind === "http-error") return { ok: false, falha: falhaPorStatus(r.status, r.data) };
  const corpo = r.data as { settings?: unknown };
  if (!ehConfiguracao(corpo?.settings)) return { ok: false, falha: { tipo: "indisponivel" } };
  return { ok: true, dados: corpo.settings };
}
