// Regras puras do acesso de equipe por login interno: a sugestão a partir do
// nome, a conferência do formato (a mesma do servidor, que confere de novo) e
// a forma da resposta da criação.
//
// O login NÃO precisa ser um e-mail real e nunca é tratado como um: pode ter
// a aparência de e-mail (`maria@salao`), mas não recebe mensagem, não é
// verificado e não serve para recuperar senha (quem define nova senha é o dono).

/** Mesmo formato de `usernameSchema` no backend (migration TeamManagerAccess). */
const FORMATO = /^[a-z0-9][a-z0-9._+-]*(@[a-z0-9]([a-z0-9.-]*[a-z0-9])?)?$/;
export const LOGIN_MAXIMO = 80;

/** "Maria José da Silva" → "maria.silva". Sem acento, minúsculo. */
export function sugestaoDeUsuario(nome: string): string {
  const partes = nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(" ")
    .filter((p) => p.length > 0 && !["da", "de", "do", "das", "dos", "e"].includes(p));
  if (partes.length === 0) return "";
  const sugestao = partes.length === 1 ? partes[0] : `${partes[0]}.${partes[partes.length - 1]}`;
  return sugestao.slice(0, 40);
}

/** Por que o login não serve (`null`: serve). */
export function erroDoUsuario(valor: string): string | null {
  const limpo = valor.trim().toLowerCase();
  if (limpo.length < 3) return "Use pelo menos 3 caracteres.";
  if (limpo.length > LOGIN_MAXIMO) return `Use até ${LOGIN_MAXIMO} caracteres.`;
  if (/\s/.test(limpo)) return "O login não pode ter espaço.";
  if ((limpo.match(/@/g) ?? []).length > 1) return "Use no máximo uma @.";
  if (!FORMATO.test(limpo)) {
    return limpo.includes("@")
      ? "Depois da @ vem um nome, como em maria@salao (letras sem acento, números, ponto ou hífen)."
      : "Use letras sem acento, números, ponto, hífen, sublinhado ou +, começando por letra ou número.";
  }
  return null;
}

export interface AcessoCriado {
  created: boolean;
  membershipId: string;
  userId: string;
  username: string;
  role?: string;
  /** Senha temporária: só na criação pelo corpo da tela anterior. Com a
   * senha escolhida pelo dono, e na repetição do formulário, `null`. */
  temporaryPassword: string | null;
}

export function ehAcessoCriado(v: unknown): v is AcessoCriado {
  if (typeof v !== "object" || v === null) return false;
  const a = v as Record<string, unknown>;
  return (
    typeof a.created === "boolean" &&
    typeof a.membershipId === "string" &&
    typeof a.userId === "string" &&
    typeof a.username === "string" &&
    (a.temporaryPassword === null || typeof a.temporaryPassword === "string")
  );
}

/** Resposta de "Definir nova senha": nunca traz a senha. */
export function ehSenhaDefinida(v: unknown): v is { membershipId: string; username: string } {
  if (typeof v !== "object" || v === null) return false;
  const a = v as Record<string, unknown>;
  return typeof a.membershipId === "string" && typeof a.username === "string" && !("temporaryPassword" in a);
}
