// Segundo fator (TOTP) das contas da administração da plataforma
// (`/auth/second-factor/*` e a liberação emitida por outro proprietário).
// Cada resposta vira um resultado explícito, classificado pelo status e pelo
// `code` do servidor, nunca pelo texto. Nada é reenviado sozinho: sem
// resposta, a tela diz que não confirmou.
//
// Segredo, chave manual, URI, QR e códigos de recuperação só existem na
// memória da tela que os recebeu; nada aqui grava, registra ou repete.
import { apiRequest, mensagemDoBackend } from "./http-client";

export interface SituacaoDoSegundoFator {
  state: "NOT_REQUIRED" | "ENROLLMENT_OPTIONAL" | "ENROLLMENT_REQUIRED" | "VERIFICATION_REQUIRED" | "VERIFIED";
  enrollmentPermitted: boolean;
  recoveryPending: boolean;
  verifiedUntil: string | null;
  factor: { method: "TOTP"; confirmedAt: string; remainingRecoveryCodes: number } | null;
  locked: { until: string } | null;
  available: boolean;
}

export interface CadastroIniciado {
  otpauthUri: string;
  qrSvg: string;
  manualKey: string;
  expiresAt: string;
}

export type FalhaDoSegundoFator =
  | { tipo: "codigo-invalido" }
  | { tipo: "bloqueado"; segundos: number }
  | { tipo: "indisponivel" }
  | { tipo: "reautenticar" }
  | { tipo: "codigo-necessario" }
  | { tipo: "liberacao-necessaria" }
  | { tipo: "verificacao-necessaria" }
  | { tipo: "segundo-fator-recente" }
  | { tipo: "liberacao-invalida" }
  | { tipo: "cadastro-expirado" }
  | { tipo: "cadastro-inexistente" }
  | { tipo: "conflito"; codigo: string | null; mensagem: string }
  | { tipo: "proibido"; mensagem: string }
  | { tipo: "sessao" }
  | { tipo: "limite" }
  | { tipo: "rede" }
  | { tipo: "erro" };

export type Resultado<T> = { ok: true; dados: T } | { ok: false; falha: FalhaDoSegundoFator };

const objeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const texto = (v: unknown): v is string => typeof v === "string";
const data = (v: unknown) => texto(v) && Number.isFinite(Date.parse(v));
const ESTADOS = ["NOT_REQUIRED", "ENROLLMENT_OPTIONAL", "ENROLLMENT_REQUIRED", "VERIFICATION_REQUIRED", "VERIFIED"];

export function ehSituacao(v: unknown): v is SituacaoDoSegundoFator {
  if (!objeto(v) || !ESTADOS.includes(v.state as string)) return false;
  if (typeof v.enrollmentPermitted !== "boolean" || typeof v.recoveryPending !== "boolean" || typeof v.available !== "boolean")
    return false;
  if (!(v.verifiedUntil === null || data(v.verifiedUntil))) return false;
  if (!(v.locked === null || (objeto(v.locked) && data(v.locked.until)))) return false;
  const f = v.factor;
  return (
    f === null ||
    (objeto(f) && f.method === "TOTP" && data(f.confirmedAt) && Number.isSafeInteger(f.remainingRecoveryCodes))
  );
}

function ehCadastro(v: unknown): v is CadastroIniciado {
  return (
    objeto(v) &&
    texto(v.otpauthUri) &&
    v.otpauthUri.startsWith("otpauth://totp/") &&
    texto(v.qrSvg) &&
    v.qrSvg.trimStart().startsWith("<svg") &&
    texto(v.manualKey) &&
    /^[A-Z2-7 ]+$/.test(v.manualKey) &&
    data(v.expiresAt)
  );
}

function ehCodigos(v: unknown): v is { recoveryCodes: string[] } {
  return (
    objeto(v) &&
    Array.isArray(v.recoveryCodes) &&
    v.recoveryCodes.length > 0 &&
    v.recoveryCodes.every((c) => texto(c) && /^[A-Z2-7]{4}(-[A-Z2-7]{4}){3}$/.test(c))
  );
}

const CODIGOS: Record<string, FalhaDoSegundoFator["tipo"]> = {
  CODIGO_INVALIDO: "codigo-invalido",
  SEGUNDO_FATOR_INDISPONIVEL: "indisponivel",
  REAUTENTICACAO_NECESSARIA: "reautenticar",
  SEGUNDO_FATOR_CODIGO_NECESSARIO: "codigo-necessario",
  SEGUNDO_FATOR_LIBERACAO_NECESSARIA: "liberacao-necessaria",
  SEGUNDO_FATOR_NECESSARIO: "verificacao-necessaria",
  SEGUNDO_FATOR_RECENTE_NECESSARIO: "segundo-fator-recente",
  LIBERACAO_INVALIDA: "liberacao-invalida",
  CADASTRO_EXPIRADO: "cadastro-expirado",
  CADASTRO_INEXISTENTE: "cadastro-inexistente",
};

export function classificar(status: number, corpo: unknown): FalhaDoSegundoFator {
  const codigo = objeto(corpo) && texto(corpo.code) ? corpo.code : null;
  if (codigo === "SEGUNDO_FATOR_BLOQUEADO") {
    const s = objeto(corpo) && Number.isSafeInteger(corpo.retryAfterSeconds) ? (corpo.retryAfterSeconds as number) : 900;
    return { tipo: "bloqueado", segundos: s };
  }
  const tipo = codigo ? CODIGOS[codigo] : undefined;
  if (tipo) return { tipo } as FalhaDoSegundoFator;
  if (status === 401) return { tipo: "sessao" };
  if (status === 429) return { tipo: "limite" };
  if (status === 409 || status === 410) {
    return { tipo: "conflito", codigo, mensagem: mensagemDoBackend(corpo) ?? "A operação não pôde ser feita agora." };
  }
  if (status === 403) return { tipo: "proibido", mensagem: mensagemDoBackend(corpo) ?? "Sua conta não pode fazer isto." };
  return { tipo: "erro" };
}

async function chamar<T>(
  caminho: string,
  metodo: "GET" | "POST",
  corpo: unknown,
  conferir: (v: unknown) => v is T,
): Promise<Resultado<T>> {
  const r = await apiRequest<unknown>(caminho, { method: metodo, body: corpo });
  if (r.kind === "network-error") return { ok: false, falha: { tipo: "rede" } };
  if (r.kind === "http-error") return { ok: false, falha: classificar(r.status, r.data) };
  // Resposta 2xx em forma inesperada nunca é tratada como sucesso.
  return conferir(r.data) ? { ok: true, dados: r.data } : { ok: false, falha: { tipo: "erro" } };
}

export const lerSituacao = () => chamar("/auth/second-factor", "GET", undefined, ehSituacao);
export const verificarCodigo = (code: string) => chamar("/auth/second-factor/verify", "POST", { code }, ehSituacao);
export const usarCodigoDeRecuperacao = (code: string) => chamar("/auth/second-factor/recovery", "POST", { code }, ehSituacao);
export const usarLiberacao = (token: string) => chamar("/auth/second-factor/grant", "POST", { token }, ehSituacao);
export const iniciarCadastro = (code?: string) =>
  chamar("/auth/second-factor/enrollment", "POST", code === undefined ? {} : { code }, ehCadastro);
export const confirmarCadastro = (code: string) =>
  chamar("/auth/second-factor/enrollment/confirm", "POST", { code }, ehCodigos);
export const gerarNovosCodigos = (code: string) => chamar("/auth/second-factor/recovery-codes", "POST", { code }, ehCodigos);

export interface LiberacaoEmitida {
  created: boolean;
  grantId: string;
  expiresAt: string;
  delivery: { status: string };
}

function ehLiberacao(v: unknown): v is LiberacaoEmitida {
  return (
    objeto(v) &&
    typeof v.created === "boolean" &&
    texto(v.grantId) &&
    data(v.expiresAt) &&
    objeto(v.delivery) &&
    texto(v.delivery.status)
  );
}

/** Outro proprietário emite a liberação. A resposta nunca traz o link: ele
 * vai só ao e-mail verificado do titular. */
export const emitirLiberacao = (userId: string, reason: string, requestKey: string) =>
  chamar(`/platform/users/${encodeURIComponent(userId)}/second-factor/grants`, "POST", { reason, requestKey }, ehLiberacao);
