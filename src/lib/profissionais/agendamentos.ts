// Regras puras da tela de agendamentos (Lote 6D.5) — sem React, sem fetch,
// sem relógio implícito. É aqui que ficam as redações e as decisões de
// apresentação, para nunca existirem duas versões da mesma frase.
//
// NADA aqui converte fuso: os horários já chegam do backend com a hora local
// do estabelecimento (`localStart`/`localServiceEnd`). O relógio do navegador
// pode estar em outro fuso e nunca decide o que é exibido.
import type {
  AgendamentoReal,
  FalhaAgendamentoReal,
  StatusAgendamentoReal,
} from "@/lib/api/appointments-api";

export function mensagemFalhaAgendamento(falha: FalhaAgendamentoReal): string {
  switch (falha.tipo) {
    case "nao_autenticado":
      return "Sua sessão expirou. Entre novamente para continuar.";
    case "sem_acesso":
      return "Você não tem acesso a este estabelecimento.";
    case "sem_permissao":
      return "Você não tem permissão para agendar neste estabelecimento.";
    case "horario_ocupado":
      return (
        falha.mensagem ??
        "Este horário acabou de ser ocupado. Consulte os horários disponíveis novamente."
      );
    case "nao_agendavel":
      return falha.mensagem ?? "Não foi possível agendar com estes dados. Revise a seleção.";
    case "falha_comunicacao":
      // NUNCA afirma que a reserva não foi criada: a requisição não teve
      // resposta, então é impossível saber. Não existe chave de idempotência
      // no servidor, então reenviar às cegas pode duplicar.
      return (
        "A conexão falhou antes de o servidor confirmar. " +
        "A reserva pode ter sido criada: confira a agenda do dia antes de tentar de novo."
      );
    default:
      return "Não foi possível concluir agora. Tente novamente em instantes.";
  }
}

export const ROTULO_STATUS: Record<StatusAgendamentoReal, string> = {
  PENDING: "Aguardando confirmação",
  CONFIRMED: "Confirmado",
  IN_PROGRESS: "Em atendimento",
  COMPLETED: "Concluído",
  CANCELED: "Cancelado",
  NO_SHOW: "Não compareceu",
};

/** `YYYY-MM-DD` de uma data de CALENDÁRIO, montado com os componentes locais
 * — nunca por `toISOString()`, que converte para UTC e devolveria o dia
 * anterior em qualquer fuso a oeste de Greenwich. */
export function comoDataDeCalendario(data: Date): string {
  const ano = String(data.getFullYear()).padStart(4, "0");
  const mes = String(data.getMonth() + 1).padStart(2, "0");
  const dia = String(data.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

/** `"2026-09-20"` em texto legível. Aritmética em UTC de propósito: é uma
 * data de calendário, não um instante. */
export function rotuloDaData(data: string): string {
  const [ano, mes, dia] = data.split("-").map(Number);
  if (!ano || !mes || !dia) return data;
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(ano, mes - 1, dia)));
}

/** Centavos para texto. `null` é "sob consulta" — NUNCA "R$ 0,00", que
 * afirmaria que o atendimento é gratuito. */
export function rotuloDePreco(priceCents: number | null): string {
  if (priceCents === null) return "Sob consulta";
  return (priceCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** `30` -> `"30 min"`, `90` -> `"1 h 30 min"`. */
export function rotuloDeDuracao(minutos: number): string {
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return resto === 0 ? `${horas} h` : `${horas} h ${resto} min`;
}

/** Linha de resumo de uma reserva já criada, para a confirmação identificar
 * exatamente o que foi marcado. */
export function resumoDoAgendamento(agendamento: AgendamentoReal): string {
  return [
    `${agendamento.localStart}–${agendamento.localServiceEnd}`,
    agendamento.service.name,
    `com ${agendamento.professional.name}`,
    `para ${agendamento.consumer.name}`,
  ].join(" · ");
}
