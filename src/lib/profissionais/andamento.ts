// Andamento do atendimento na tela (Lote 6D.7) — regras PURAS de apresentação:
// quais botões a linha da reserva oferece, e as frases de sucesso e de falha.
//
// É uma CÓPIA DE APRESENTAÇÃO das regras de
// backend/src/appointments/appointment-status-transitions.ts. Esconder ou
// mostrar um botão não é controle nenhum: o servidor revalida tudo dentro da
// transação, com o relógio dele. O relógio do navegador pode estar errado, e
// por isso `agora` é sempre parâmetro.
//
// O instante comparado é `startAt` (UTC), nunca a hora local exibida.
import type { AgendamentoReal, FalhaAgendamentoReal } from "@/lib/api/appointments-api";
import type { AcaoDeStatusReal } from "@/lib/api/appointment-status-api";
import { mensagemFalhaAgendamento, podeAlterarAgendamento } from "./agendamentos";

/** Mesma antecedência do backend para iniciar o atendimento. */
export const ANTECEDENCIA_PARA_INICIAR_MINUTOS = 30;

export interface AcoesDaReserva {
  confirmar: boolean;
  iniciar: boolean;
  concluir: boolean;
  registrarFalta: boolean;
  remarcar: boolean;
  cancelar: boolean;
}

/**
 * Ações que a linha da reserva oferece neste instante.
 *
 * Na janela de 30 min antes do início, "Iniciar" SE SOMA a remarcar e
 * cancelar (que continuam valendo até o início) — nunca os substitui.
 */
export function acoesDaReserva(agendamento: AgendamentoReal, agora: Date): AcoesDaReserva {
  const inicio = new Date(agendamento.startAt).getTime();
  const instante = agora.getTime();
  const { status } = agendamento;
  const aguardando = status === "PENDING" || status === "CONFIRMED";

  return {
    confirmar: status === "PENDING" && instante < inicio,
    iniciar: aguardando && instante >= inicio - ANTECEDENCIA_PARA_INICIAR_MINUTOS * 60_000,
    concluir: status === "IN_PROGRESS" || (status === "CONFIRMED" && instante >= inicio),
    registrarFalta: aguardando && instante > inicio,
    remarcar: podeAlterarAgendamento(agendamento, agora),
    cancelar: podeAlterarAgendamento(agendamento, agora),
  };
}

export function temAlgumaAcao(acoes: AcoesDaReserva): boolean {
  return Object.values(acoes).some(Boolean);
}

const NOME_DA_ACAO: Record<AcaoDeStatusReal, string> = {
  confirm: "confirmar",
  start: "iniciar",
  complete: "concluir",
  "no-show": "registrar a falta de",
};

export function mensagemSucessoStatus(acao: AcaoDeStatusReal, agendamento: AgendamentoReal): string {
  switch (acao) {
    case "confirm":
      return `Reserva das ${agendamento.localStart} confirmada.`;
    case "start":
      return `Atendimento das ${agendamento.localStart} iniciado.`;
    case "complete":
      return `Atendimento das ${agendamento.localStart} concluído.`;
    case "no-show":
      return `Falta registrada na reserva das ${agendamento.localStart}.`;
  }
}

export function mensagemFalhaStatus(acao: AcaoDeStatusReal, falha: FalhaAgendamentoReal): string {
  switch (falha.tipo) {
    case "sem_permissao":
      return "Você não tem permissão para alterar o andamento dos atendimentos neste estabelecimento.";
    case "nao_agendavel":
      return (
        falha.mensagem ??
        `Não é possível ${NOME_DA_ACAO[acao]} esta reserva agora. Atualize a agenda para ver o estado atual.`
      );
    case "horario_ocupado":
      // O único 409 destas ações é a reserva ter mudado de horário depois de
      // a agenda carregar. Nada foi alterado; a pessoa confere e decide de novo.
      return (
        falha.mensagem ??
        "Esta reserva foi alterada desde que a agenda foi carregada. Nada foi alterado: confira os dados atualizados."
      );
    case "falha_comunicacao":
      // NUNCA afirma que a ação não aconteceu, e nunca reenvia sozinho.
      return (
        "A conexão falhou antes de o servidor confirmar. " +
        "A alteração pode ter sido gravada: consulte a reserva na agenda antes de tentar de novo."
      );
    default:
      return mensagemFalhaAgendamento(falha);
  }
}
