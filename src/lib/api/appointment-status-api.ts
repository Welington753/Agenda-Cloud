// Andamento do atendimento (Lote 6D.7) — espelha as quatro rotas explícitas
// de backend/src/appointments/appointments.controller.ts. O destino de cada
// ação é fixo pela ROTA: este cliente nunca envia um `status`.
import {
  acaoSobreReserva,
  type AgendamentoReal,
  type DadosCancelamentoReal,
  type ResultadoAgendamentoReal,
} from "./appointments-api";

/** Os segmentos de rota aceitos pelo backend — nenhum outro existe. */
export type AcaoDeStatusReal = "confirm" | "start" | "complete" | "no-show";

/** Mesmo corpo do cancelamento: só o instante que a tela mostrava. */
export type DadosAcaoDeStatusReal = DadosCancelamentoReal;

export function alterarStatusAgendamento(
  tenantId: string,
  appointmentId: string,
  acao: AcaoDeStatusReal,
  dados: DadosAcaoDeStatusReal,
  signal?: AbortSignal,
): Promise<ResultadoAgendamentoReal<AgendamentoReal>> {
  return acaoSobreReserva(tenantId, appointmentId, acao, dados, signal);
}
