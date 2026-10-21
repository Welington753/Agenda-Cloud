// Apoio puro da tela de solicitações. A hora local já vem do servidor
// (`localStart`); a DATA local não vem na view da reserva, então é derivada
// do instante com o fuso que o próprio servidor devolveu — nunca com o fuso
// do navegador.
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
