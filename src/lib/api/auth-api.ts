// Funções tipadas de POST /auth/login, GET /auth/me e
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
  /** Validade do acesso (assinatura do Agenda Cloud). `blocked`: vencido; o
   * estabelecimento continua na lista, sem áreas, e a tela mostra o motivo e
   * o caminho de regularização. Ausente numa API anterior: não vence. */
  access?: ValidadeDoAcessoReal;
  /** Áreas que este vínculo opera agora, calculadas no servidor pelas mesmas
   * políticas das rotas. Ausente numa API anterior (ver `temArea`). Só para a
   * tela: o servidor refaz a prova em toda requisição. */
  areas?: string[];
}

export interface ValidadeDoAcessoReal {
  state: "UNTRACKED" | "TRIAL" | "PAID" | "COURTESY" | "EXPIRED";
  blocked: boolean;
  validUntil: string | null;
  expiredAt: string | null;
  expiredKind: "TRIAL" | "PAID" | "COURTESY" | null;
}

export interface SessaoRealContexto {
  /** `email` é `null` na conta de funcionário que entra com nome de
   * usuário. `mustChangePassword`: senha temporária — só a troca de senha
   * funciona até a pessoa escolher a dela (o servidor recusa o resto). */
  user: { id: string; name: string; email: string | null; username?: string | null; mustChangePassword?: boolean };
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
  if (v.access !== undefined) {
    const a = v.access as Record<string, unknown> | null;
    if (!a || typeof a !== "object" || typeof a.blocked !== "boolean" || typeof a.state !== "string") return false;
  }
  return typeof v.tenantId === "string" && typeof v.membershipId === "string" && typeof v.role === "string";
}

/** O estabelecimento deste vínculo está com o acesso vencido. */
export function acessoVencido(contexto: Pick<TenantContextReal, "access"> | null | undefined): boolean {
  return contexto?.access?.blocked === true;
}

function ehSessaoRealContexto(valor: unknown): valor is SessaoRealContexto {
  if (typeof valor !== "object" || valor === null) return false;
  const v = valor as Record<string, unknown>;
  if (typeof v.hasEstablishmentAccess !== "boolean" || typeof v.requiresTenantSelection !== "boolean") return false;
  if (!Array.isArray(v.contexts) || !v.contexts.every(ehTenantContextReal)) return false;
  if (v.activeContext !== null && !ehTenantContextReal(v.activeContext)) return false;
  const user = v.user as Record<string, unknown> | undefined;
  return (
    !!user &&
    typeof user.id === "string" &&
    (typeof user.email === "string" || user.email === null) &&
    (user.username === undefined || user.username === null || typeof user.username === "string") &&
    (user.mustChangePassword === undefined || typeof user.mustChangePassword === "boolean")
  );
}

/** Como a conta aparece para a própria pessoa: o e-mail ou, sem ele, o login
 * interno. */
export function identificacaoDaConta(user: SessaoRealContexto["user"]): string {
  return user.email ?? user.username ?? "";
}

/** "E-mail ou login": sempre no corpo `login`, que as duas versões da API
 * aceitam. A presença de `@` não decide mais nada: o login interno criado pelo
 * dono pode ter aparência de e-mail (`maria@salao`), e o servidor procura o
 * identificador nos dois campos, sem ambiguidade. */
export async function login(
  identificador: string,
  password: string,
): Promise<ResultadoAutenticacaoReal<SessaoRealContexto>> {
  const valor = identificador.trim();
  const resultado = await apiRequest<unknown>("/auth/login", {
    method: "POST",
    body: { login: valor, password },
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
 * servidor não respondeu de verdade (rede) ou respondeu algo inesperado.
 *
 * O que a borda da hospedagem devolve enquanto o serviço hibernado do Render
 * acorda (502/503/504 ou página HTML, sem passar pela API) já chega aqui
 * como `network-error` (ver http-client.ts): falha de comunicação. Um erro
 * da própria API (JSON) é `indisponivel`. */
export async function buscarSessaoAtual(
  signal?: AbortSignal,
): Promise<ResultadoAutenticacaoReal<SessaoRealContexto | null>> {
  const resultado = await apiRequest<unknown>("/auth/me", { method: "GET", signal });

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

// O cadastro livre (POST /auth/register) foi fechado: contas novas só
// entram pelo convite da administração (ver lib/administracao e /convite).

export type FalhaTrocaDeSenha =
  | { tipo: "senha_incorreta" }
  | { tipo: "limite_tentativas" }
  | { tipo: "dados_invalidos"; mensagem: string | null }
  | { tipo: "nao_autenticado" }
  | { tipo: "falha_comunicacao" }
  | { tipo: "indisponivel" };

/** POST /auth/password: troca a própria senha. As outras sessões da conta são
 * encerradas; esta continua. Sem resposta, a troca pode ou não ter
 * acontecido: a tela diz isso e não reenvia sozinha. */
export async function trocarSenha(
  senhaAtual: string,
  senhaNova: string,
): Promise<{ ok: true } | { ok: false; falha: FalhaTrocaDeSenha }> {
  const resultado = await apiRequest<void>("/auth/password", {
    method: "POST",
    body: { currentPassword: senhaAtual, newPassword: senhaNova },
  });
  if (resultado.kind === "network-error") return { ok: false, falha: { tipo: "falha_comunicacao" } };
  if (resultado.kind === "http-error") {
    if (resultado.status === 401) {
      const codigo = (resultado.data as { code?: unknown } | null)?.code;
      return { ok: false, falha: codigo === "SENHA_INCORRETA" ? { tipo: "senha_incorreta" } : { tipo: "nao_autenticado" } };
    }
    if (resultado.status === 429) return { ok: false, falha: { tipo: "limite_tentativas" } };
    if (resultado.status === 400) {
      const mensagem = (resultado.data as { message?: unknown } | null)?.message;
      return { ok: false, falha: { tipo: "dados_invalidos", mensagem: typeof mensagem === "string" ? mensagem : null } };
    }
    return { ok: false, falha: { tipo: "indisponivel" } };
  }
  return { ok: true };
}
