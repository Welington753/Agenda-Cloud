// Regras do cliente para uma senha NOVA (ativação de convite e redefinição),
// espelho de `password: z.string().min(10).max(128)` do backend: só
// comprimento, nada de símbolo ou maiúscula obrigatórios. O backend continua
// sendo a autoridade; isto só aponta o erro no campo antes da rede.
//
// Módulo puro (sem React, sem `window`).
export const SENHA_MIN = 10;
export const SENHA_MAX = 128;

export function erroDaSenhaNova(senha: string, confirmacao: string): string | null {
  if (senha.length < SENHA_MIN) return `A senha precisa ter pelo menos ${SENHA_MIN} caracteres.`;
  if (senha.length > SENHA_MAX) return `A senha pode ter no máximo ${SENHA_MAX} caracteres.`;
  if (senha !== confirmacao) return "As duas senhas não são iguais.";
  return null;
}

export function contarDigitos(valor: string): number {
  return valor.replace(/\D/g, "").length;
}
