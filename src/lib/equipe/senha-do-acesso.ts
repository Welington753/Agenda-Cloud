// Regra pura da senha que o dono escolhe para um acesso interno (Criar
// acesso e Definir nova senha). É a mesma política das outras senhas da
// plataforma (`passwordSchema` no backend: de 10 a 128 caracteres); o
// servidor confere de novo.

export const SENHA_MINIMA = 10;
export const SENHA_MAXIMA = 128;

/** Por que a senha e a confirmação não servem (`null`: servem). Campos
 * vazios ainda não são erro, mas também não estão prontos (ver
 * `senhaPronta`). */
export function problemaDaSenha(senha: string, confirmacao: string): string | null {
  if (senha.length > 0 && senha.length < SENHA_MINIMA) {
    return `A senha precisa ter pelo menos ${SENHA_MINIMA} caracteres.`;
  }
  if (senha.length > SENHA_MAXIMA) return `A senha pode ter até ${SENHA_MAXIMA} caracteres.`;
  if (confirmacao.length > 0 && confirmacao !== senha) return "A confirmação não é igual à senha.";
  return null;
}

export function senhaPronta(senha: string, confirmacao: string): boolean {
  return senha.length >= SENHA_MINIMA && senha.length <= SENHA_MAXIMA && confirmacao === senha;
}
