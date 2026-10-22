// Apoio puro da tela de solicitações. A hora local já vem do servidor
// (`localStart`); a DATA local não vem na view da reserva, então é derivada
// do instante com o fuso que o próprio servidor devolveu — nunca com o fuso
// do navegador.
import type { FalhaPrivada } from "@/lib/api/booking-requests-api";
import { hojeNoFuso } from "@/lib/profissionais/agenda-visual";

/** `YYYY-MM-DD` do instante no fuso do estabelecimento, ou `null`. */
export function dataLocalDoInstante(instante: string, timezone: string): string | null {
  const data = new Date(instante);
  if (Number.isNaN(data.getTime())) return null;
  return hojeNoFuso(timezone, data);
}

/** Texto da Visão geral para o número de pendentes. */
export function textoPendentes(total: number): string {
  if (total === 0) return "Nenhuma solicitação aguardando confirmação.";
  if (total === 1) return "1 solicitação aguardando sua confirmação.";
  return `${total} solicitações aguardando sua confirmação.`;
}

/** Mensagem das falhas das rotas privadas da área real (solicitações,
 * agendamento online, notificações). */
export function mensagemFalhaPrivada(falha: FalhaPrivada): string {
  switch (falha.tipo) {
    case "sem_permissao":
      return falha.mensagem ?? "Você não tem permissão para esta área.";
    case "falha_comunicacao":
      return "Não foi possível falar com o servidor. Verifique a conexão e tente de novo.";
    case "sem_acesso":
      return "Estabelecimento não encontrado.";
    case "nao_autenticado":
      return "Sua sessão terminou. Entre de novo.";
    default:
      return "O servidor não respondeu como esperado. Tente de novo em instantes.";
  }
}
