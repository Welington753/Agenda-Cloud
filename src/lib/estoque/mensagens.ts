// Texto de cada recusa do estoque para a tela. A classificação vem de
// lib/api/estoque-api.ts (status e `code`); o `message` da API é usado quando
// ela explica o caso (409 e 400).
import type { FalhaEstoque } from "@/lib/api/estoque-api";

export const MENSAGEM_NAO_CONTRATADO =
  "O Estoque não faz parte do plano deste estabelecimento. A contratação é feita com a administração do TimVix.";

export function mensagemDaFalha(falha: FalhaEstoque): string {
  switch (falha.tipo) {
    case "nao_autenticado":
      return "Sua sessão terminou. Entre de novo para continuar.";
    case "nao_encontrado":
      return falha.mensagem ?? "Item não encontrado neste estabelecimento.";
    case "nao_contratado":
      return MENSAGEM_NAO_CONTRATADO;
    case "acesso_vencido":
      return "O acesso deste estabelecimento venceu. Os dados estão preservados.";
    case "sem_permissao":
      return falha.mensagem ?? "Você não tem permissão para esta ação no estoque.";
    case "dados_invalidos":
      return falha.mensagem ?? "Confira os campos e tente de novo.";
    case "conflito":
      return falha.mensagem ?? "Não foi possível concluir. Recarregue a página e tente de novo.";
    case "falha_comunicacao":
      return "Não foi possível falar com o servidor. Se o envio pode ter chegado, confira antes de repetir.";
    default:
      return "O serviço está indisponível agora. Tente de novo em instantes.";
  }
}

/** Recusa que tira o acesso à tela inteira (o rascunho da conferência é
 * apagado e a página mostra o motivo). */
export function falhaDeAcesso(falha: FalhaEstoque): boolean {
  return ["nao_autenticado", "nao_encontrado", "nao_contratado", "sem_permissao", "acesso_vencido"].includes(falha.tipo);
}
