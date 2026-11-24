// Regras da tela "Esqueci minha senha" (módulo puro, sem React).
//
// A resposta do servidor é sempre a mesma para qualquer conta, então os
// textos depois do envio são GERAIS: nunca dizem se o e-mail ou login existe,
// se tem e-mail confirmado ou se um link já estava pendente.
import type { ResultadoDoPedidoDeRecuperacao } from "@/lib/api/recuperacao-senha-api";

export type OrigemDaRecuperacao = "login" | "portal";

/** De onde a pessoa veio (`?origem=portal`); qualquer outro valor é o login. */
export function origemDaRecuperacao(valor: string | null | undefined): OrigemDaRecuperacao {
  return valor === "portal" ? "portal" : "login";
}

/** Para onde "Voltar" leva: só as duas entradas, nunca um endereço vindo da URL. */
export function entradaDaOrigem(origem: OrigemDaRecuperacao): "/login" | "/portal" {
  return origem === "portal" ? "/portal" : "/login";
}

/** Link "Esqueci minha senha" de cada entrada. */
export function linkEsqueciSenha(origem: OrigemDaRecuperacao): string {
  return origem === "portal" ? "/esqueci-senha?origem=portal" : "/esqueci-senha";
}

/** Mesmo limite do servidor (e-mail ou login até 254 caracteres). */
export const IDENTIFICADOR_MAX = 254;

export function erroDoIdentificador(texto: string): string | null {
  const valor = texto.trim();
  if (!valor) return "Informe seu e-mail ou login.";
  if (valor.length > IDENTIFICADOR_MAX) return "Use no máximo 254 caracteres.";
  if (/\s/.test(valor)) return "O e-mail ou login não tem espaços.";
  return null;
}

/** Orientação fixa para quem entra com login sem e-mail (a mesma para todos). */
export const ORIENTACAO_LOGIN_SEM_EMAIL =
  "Usa um login sem e-mail? Peça ao responsável pelo estabelecimento para redefinir sua senha.";

/** Texto depois do pedido aceito: igual para qualquer conta. */
export const CONFIRMACAO_DO_PEDIDO = [
  "Se o e-mail ou login informado for de uma conta com e-mail confirmado, enviaremos um link para esse e-mail em alguns minutos. Confira também o spam.",
  "O link vale por 1 hora e pode ser usado uma vez. Se você já pediu um link há pouco, use o e-mail anterior: ele continua valendo.",
] as const;

/** Mensagem de erro do envio (o aceito não é erro). */
export function erroDoPedido(resultado: Exclude<ResultadoDoPedidoDeRecuperacao, "aceito">): string {
  switch (resultado) {
    case "limite":
      return "Muitos pedidos seguidos. Aguarde alguns minutos e tente de novo.";
    case "invalido":
      return "Confira o e-mail ou login digitado.";
    case "falha_comunicacao":
      return "Não foi possível conectar ao servidor. Verifique sua conexão e tente de novo.";
    default:
      return "Não foi possível enviar o pedido agora. Tente de novo em instantes.";
  }
}
