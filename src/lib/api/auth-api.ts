// Funções tipadas de POST /auth/login, GET /auth/me e POST /auth/logout —
// espelha exatamente o contrato de `backend/src/auth/session-context.ts` e
// `auth.controller.ts`. Nenhum campo inventado aqui: `role`/`tenantStatus` são
// os literais do enum do backend (`EstablishmentRole`/`TenantStatus`), nunca
// os literais em português usados pela simulação (`src/lib/types.ts`) — os
// dois domínios nunca se misturam (ver real-session-state.ts, que também não
// depende de `src/lib/access/access-control.ts`).
import { apiRequest } from "./http-client";

export type PapelEstabelecimentoReal = "DONO" | "GERENTE" | "RECEPCIONISTA" | "PROFISSIONAL";
export type StatusTenantReal = "TRIAL" | "ACTIVE" | "SUSPENDED" | "PAST_DUE" | "CANCELED";

export interface TenantContextReal {
  membershipId: string;
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  role: PapelEstabelecimentoReal;
  unit: { id: string; name: string; isPrimary: boolean } | null;
  planCode: string;
  planName: string;
  trial: { trialStartAt: string; trialEndAt: string; durationDays: number };
  tenantStatus: StatusTenantReal;
}

export interface SessaoRealContexto {
  user: { id: string; name: string; email: string };
  contexts: TenantContextReal[];
  activeContext: TenantContextReal | null;
  requiresTenantSelection: boolean;
  hasEstablishmentAccess: boolean;
}

export type FalhaAutenticacaoReal =
  | { tipo: "credenciais_invalidas" }
  | { tipo: "limite_tentativas" }
  | { tipo: "falha_comunicacao" }
  | { tipo: "indisponivel" };

export type ResultadoAutenticacaoReal<T> = { ok: true; dados: T } | { ok: false; falha: FalhaAutenticacaoReal };

function ehTenantContextReal(valor: unknown): valor is TenantContextReal {
  if (typeof valor !== "object" || valor === null) return false;
  const v = valor as Record<string, unknown>;
  return typeof v.tenantId === "string" && typeof v.membershipId === "string" && typeof v.role === "string";
}

function ehSessaoRealContexto(valor: unknown): valor is SessaoRealContexto {
  if (typeof valor !== "object" || valor === null) return false;
  const v = valor as Record<string, unknown>;
  if (typeof v.hasEstablishmentAccess !== "boolean" || typeof v.requiresTenantSelection !== "boolean") return false;
  if (!Array.isArray(v.contexts) || !v.contexts.every(ehTenantContextReal)) return false;
  if (v.activeContext !== null && !ehTenantContextReal(v.activeContext)) return false;
  const user = v.user as Record<string, unknown> | undefined;
  return !!user && typeof user.id === "string" && typeof user.email === "string";
}

export async function login(email: string, password: string): Promise<ResultadoAutenticacaoReal<SessaoRealContexto>> {
  const resultado = await apiRequest<unknown>("/auth/login", {
    method: "POST",
    body: { email, password },
  });

  if (resultado.kind === "network-error") return { ok: false, falha: { tipo: "falha_comunicacao" } };
  if (resultado.kind === "http-error") {
    if (resultado.status === 401) return { ok: false, falha: { tipo: "credenciais_invalidas" } };
    if (resultado.status === 429) return { ok: false, falha: { tipo: "limite_tentativas" } };
    return { ok: false, falha: { tipo: "indisponivel" } };
  }
  if (!ehSessaoRealContexto(resultado.data)) return { ok: false, falha: { tipo: "indisponivel" } };
  return { ok: true, dados: resultado.data };
}

/** `null` em `dados` é um resultado válido (`ok: true`) — 401 aqui significa
 * "não autenticado", nunca uma falha de comunicação. Só vira `falha` quando o
 * servidor não respondeu de verdade (rede) ou respondeu algo inesperado. */
export async function buscarSessaoAtual(): Promise<ResultadoAutenticacaoReal<SessaoRealContexto | null>> {
  const resultado = await apiRequest<unknown>("/auth/me", { method: "GET" });

  if (resultado.kind === "network-error") return { ok: false, falha: { tipo: "falha_comunicacao" } };
  if (resultado.kind === "http-error") {
    if (resultado.status === 401) return { ok: true, dados: null };
    return { ok: false, falha: { tipo: "indisponivel" } };
  }
  if (!ehSessaoRealContexto(resultado.data)) return { ok: false, falha: { tipo: "indisponivel" } };
  return { ok: true, dados: resultado.data };
}

export async function logout(): Promise<ResultadoAutenticacaoReal<void>> {
  const resultado = await apiRequest<void>("/auth/logout", { method: "POST" });

  if (resultado.kind === "network-error") return { ok: false, falha: { tipo: "falha_comunicacao" } };
  if (resultado.kind === "http-error") return { ok: false, falha: { tipo: "indisponivel" } };
  return { ok: true, dados: undefined };
}
