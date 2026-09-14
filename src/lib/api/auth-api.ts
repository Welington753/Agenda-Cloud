// Funções tipadas de POST /auth/register, POST /auth/login, GET /auth/me e
// POST /auth/logout —
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

// --- Cadastro (Lote 6C.2) -------------------------------------------------
// Espelha `backend/src/auth/register.dto.ts` (corpo enviado) e o retorno de
// `AuthController.register` (que NÃO é o mesmo shape de `/auth/login`: aqui
// vem `tenant`/`unit`/`membership`/`plan`/`trial` soltos, sem `contexts`).
// Por isso o contexto de sessão depois do cadastro vem sempre de `/auth/me`,
// nunca de uma conversão adivinhada desta resposta.

export interface DadosCadastroReal {
  ownerName: string;
  businessName: string;
  email: string;
  phone: string;
  /** Nunca persistida em lugar nenhum do cliente — só viaja no corpo do POST. */
  password: string;
}

export interface CadastroRealResposta {
  user: { id: string; name: string; email: string };
  tenant: { id: string; slug: string; status: StatusTenantReal };
  unit: { id: string; name: string; isPrimary: boolean };
  membership: { role: PapelEstabelecimentoReal };
  plan: { code: string; name: string; priceCents: number | null };
  trial: { trialStartAt: string; trialEndAt: string; durationDays: number };
}

export type FalhaCadastroReal =
  /** 400 do `ZodValidationPipe`: o backend recusou o formato. `mensagem` é a
   * do próprio backend, que por contrato nunca ecoa o valor recebido. */
  | { tipo: "dados_invalidos"; mensagem: string | null }
  | { tipo: "email_em_uso" }
  | { tipo: "limite_tentativas" }
  | { tipo: "falha_comunicacao" }
  | { tipo: "indisponivel" };

export type ResultadoCadastroReal =
  | { ok: true; dados: CadastroRealResposta }
  | { ok: false; falha: FalhaCadastroReal };

function ehCadastroRealResposta(valor: unknown): valor is CadastroRealResposta {
  if (typeof valor !== "object" || valor === null) return false;
  const v = valor as Record<string, unknown>;
  const user = v.user as Record<string, unknown> | undefined;
  const tenant = v.tenant as Record<string, unknown> | undefined;
  if (!user || typeof user.id !== "string" || typeof user.email !== "string") return false;
  return !!tenant && typeof tenant.id === "string" && typeof tenant.slug === "string";
}

function mensagemDeErroDoBackend(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const mensagem = (data as Record<string, unknown>).message;
  return typeof mensagem === "string" ? mensagem : null;
}

/**
 * POST /auth/register. Em caso de sucesso o backend já emitiu o cookie
 * HttpOnly de sessão (ver auth.controller.ts) — esta função nunca devolve
 * token nenhum e nunca guarda a senha.
 *
 * `network-error` aqui significa APENAS "não houve resposta"; é impossível
 * saber se o servidor chegou a criar a conta, então o tipo devolvido é
 * `falha_comunicacao` e quem mostra a mensagem nunca pode afirmar que a conta
 * não foi criada (ver `mensagemFalhaCadastro`).
 */
export async function cadastrar(dados: DadosCadastroReal): Promise<ResultadoCadastroReal> {
  const resultado = await apiRequest<unknown>("/auth/register", { method: "POST", body: dados });

  if (resultado.kind === "network-error") return { ok: false, falha: { tipo: "falha_comunicacao" } };
  if (resultado.kind === "http-error") {
    if (resultado.status === 400) {
      return { ok: false, falha: { tipo: "dados_invalidos", mensagem: mensagemDeErroDoBackend(resultado.data) } };
    }
    if (resultado.status === 409) return { ok: false, falha: { tipo: "email_em_uso" } };
    if (resultado.status === 429) return { ok: false, falha: { tipo: "limite_tentativas" } };
    return { ok: false, falha: { tipo: "indisponivel" } };
  }
  if (!ehCadastroRealResposta(resultado.data)) return { ok: false, falha: { tipo: "indisponivel" } };
  return { ok: true, dados: resultado.data };
}
