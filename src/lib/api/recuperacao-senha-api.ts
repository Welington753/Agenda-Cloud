// "Esqueci minha senha": POST /password-resets/request. O servidor responde
// 202, sempre igual, sem dizer se a conta existe; esta função também não tem
// como saber. O resultado só separa o que a tela precisa mostrar de forma
// diferente: pedido aceito, limite por IP (429), forma inválida (400) ou
// falha de comunicação. Nada é repetido sozinho.
import { apiRequest } from "./http-client";

export type ResultadoDoPedidoDeRecuperacao = "aceito" | "limite" | "invalido" | "falha_comunicacao" | "indisponivel";

export async function pedirRecuperacaoDeSenha(identificador: string): Promise<ResultadoDoPedidoDeRecuperacao> {
  const r = await apiRequest<null>("/password-resets/request", {
    method: "POST",
    body: { identifier: identificador.trim() },
  });
  if (r.kind === "network-error") return "falha_comunicacao";
  if (r.kind === "success") return r.status === 202 ? "aceito" : "indisponivel";
  if (r.status === 429) return "limite";
  if (r.status === 400) return "invalido";
  return "indisponivel";
}
