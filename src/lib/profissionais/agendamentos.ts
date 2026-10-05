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

/**
 * Estados em que a tela oferece cancelar e remarcar (Lote 6D.6) — os MESMOS
 * do backend (`STATUS_ALTERAVEIS` em appointments.service.ts). Esta é uma
 * cópia de APRESENTAÇÃO: esconder o botão não é controle nenhum, quem decide é
 * sempre o servidor. Ela existe para a tela não oferecer uma ação que já se
 * sabe que será recusada.
 */
const STATUS_ALTERAVEIS: readonly StatusAgendamentoReal[] = ["PENDING", "CONFIRMED"];

/**
 * A reserva ainda pode ser cancelada/remarcada?
 *
 * `agora` é PARÂMETRO, nunca `new Date()` aqui dentro: o mesmo motivo do resto
 * do projeto — nenhum teste pode depender da hora em que roda. O instante
 * comparado é `startAt` (UTC, inequívoco), não a hora local exibida.
 *
 * O relógio do navegador pode estar errado, então isto NUNCA é garantia: o
 * servidor revalida dentro da transação e recusa com 400 se já começou.
 */
export function podeAlterarAgendamento(agendamento: AgendamentoReal, agora: Date): boolean {
  if (!STATUS_ALTERAVEIS.includes(agendamento.status)) return false;
  return new Date(agendamento.startAt).getTime() > agora.getTime();
}

export function mensagemFalhaCancelamento(falha: FalhaAgendamentoReal): string {
  switch (falha.tipo) {
    case "sem_permissao":
      return "Você não tem permissão para cancelar agendamentos neste estabelecimento.";
    case "nao_agendavel":
      return (
        falha.mensagem ??
        "Esta reserva não pode mais ser cancelada. Atualize a agenda para ver o estado atual."
      );
    case "horario_ocupado":
      // No cancelamento, o único 409 é a reserva ter mudado depois de a
      // confirmação abrir. Nada foi cancelado; a pessoa confere e decide de novo.
      return (
        falha.mensagem ??
        "Esta reserva foi alterada desde que a confirmação foi aberta. Nada foi cancelado: confira os dados atualizados."
      );
    case "falha_comunicacao":
      // NUNCA afirma que o cancelamento não aconteceu: a requisição não teve
      // resposta, então é impossível saber. Também não reenvia sozinho.
      return (
        "A conexão falhou antes de o servidor confirmar. " +
        "O cancelamento pode ter sido gravado: consulte a reserva na agenda antes de tentar de novo."
      );
    default:
      return mensagemFalhaAgendamento(falha);
  }
}

export function mensagemFalhaRemarcacao(falha: FalhaAgendamentoReal): string {
  switch (falha.tipo) {
    case "sem_permissao":
      return "Você não tem permissão para remarcar agendamentos neste estabelecimento.";
    case "horario_ocupado":
      // A mensagem do servidor distingue "o horário foi ocupado" de "a reserva
      // mudou desde que a tela carregou" — as duas pedem a mesma ação (conferir
      // a agenda), mas dizer qual das duas foi evita a pessoa procurar o
      // problema no lugar errado.
      return (
        falha.mensagem ??
        "Este horário acabou de ser ocupado. Consulte os horários disponíveis novamente."
      );
    case "nao_agendavel":
      return (
        falha.mensagem ??
        "Não foi possível remarcar para este horário. Consulte os horários disponíveis."
      );
    case "falha_comunicacao":
      return (
        "A conexão falhou antes de o servidor confirmar. " +
        "A remarcação pode ter sido gravada: consulte a reserva na agenda antes de tentar de novo."
      );
    default:
      return mensagemFalhaAgendamento(falha);
  }
}
