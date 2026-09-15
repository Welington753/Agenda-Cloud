// Mensagens de falha da gestão real de profissionais — espelho de
// lib/servicos/mensagens.ts. Módulo puro, para a regra ficar testável e para
// nunca existirem duas redações diferentes do mesmo erro.
//
// `falha_comunicacao` nunca afirma que a gravação não aconteceu — orienta a
// conferir a lista antes de repetir (mesma disciplina de servicos/mensagens.ts).
import type { FalhaProfissionaisReal } from "@/lib/api/professionals-api";

export function mensagemFalhaProfissionais(falha: FalhaProfissionaisReal): string {
  switch (falha.tipo) {
    case "nao_autenticado":
      return "Sua sessão expirou. Entre novamente para continuar.";
    case "sem_acesso":
      return "Você não tem acesso a este estabelecimento.";
    case "sem_permissao":
      return "Você não tem permissão para gerenciar os profissionais deste estabelecimento.";
    case "dados_invalidos":
      return falha.mensagem ?? "Alguns dados não foram aceitos. Revise os campos e tente novamente.";
    case "conflito":
      return "Este serviço já estava sendo vinculado por outra ação. Atualize a lista e tente de novo.";
    case "falha_comunicacao":
      return (
        "A conexão falhou antes de o servidor confirmar. " +
        "Atualize a lista para conferir se a alteração foi salva antes de tentar de novo."
      );
    default:
      return "Não foi possível concluir agora. Tente novamente em instantes.";
  }
}
