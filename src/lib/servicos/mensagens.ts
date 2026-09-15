// Mensagens de falha da gestão real de serviços — módulo puro, para a regra
// ficar testável e para nunca existirem duas redações diferentes do mesmo
// erro em telas distintas.
//
// `falha_comunicacao` é o caso delicado: a requisição não teve resposta, então
// é impossível saber se a gravação chegou a acontecer. A mensagem nunca afirma
// que não aconteceu — orienta a conferir a lista antes de repetir (mesma
// disciplina do cadastro, ver lib/auth/cadastro-fluxo.ts).
import type { FalhaServicosReal } from "@/lib/api/services-api";

export function mensagemFalhaServicos(falha: FalhaServicosReal): string {
  switch (falha.tipo) {
    case "nao_autenticado":
      return "Sua sessão expirou. Entre novamente para continuar.";
    case "sem_acesso":
      return "Você não tem acesso a este estabelecimento.";
    case "sem_permissao":
      return "Você não tem permissão para gerenciar os serviços deste estabelecimento.";
    case "dados_invalidos":
      return falha.mensagem ?? "Alguns dados não foram aceitos. Revise os campos e tente novamente.";
    case "falha_comunicacao":
      return (
        "A conexão falhou antes de o servidor confirmar. " +
        "Atualize a lista para conferir se a alteração foi salva antes de tentar de novo."
      );
    default:
      return "Não foi possível concluir agora. Tente novamente em instantes.";
  }
}
