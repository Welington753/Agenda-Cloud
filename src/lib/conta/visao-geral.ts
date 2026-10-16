// Regras puras da Visão geral da área REAL — sem React, sem fetch, sem relógio
// implícito (`agora` é sempre parâmetro).
//
// Tudo aqui parte da MESMA resposta da agenda do dia que a tela de agenda usa
// (GET /tenants/:id/appointments?date=). Nenhum número é produzido sem a
// resposta provar que veio inteira (`completa`) e que é mesmo do "hoje" do
// estabelecimento — um total errado é pior do que total nenhum.
import type { AgendaDoDiaReal, AgendamentoReal } from "@/lib/api/appointments-api";
import { hojeNoFuso, ordenarPorHorario } from "@/lib/profissionais/agenda-visual";

export interface IndicadoresDoDia {
  /** Reservas do dia que não estão canceladas. */
  agendamentos: number;
  aguardandoConfirmacao: number;
  emAtendimento: number;
  concluidos: number;
}

export function indicadoresDoDia(agendamentos: readonly AgendamentoReal[]): IndicadoresDoDia {
  const contagem: IndicadoresDoDia = {
    agendamentos: 0,
    aguardandoConfirmacao: 0,
    emAtendimento: 0,
    concluidos: 0,
  };
  for (const a of agendamentos) {
    if (a.status !== "CANCELED") contagem.agendamentos += 1;
    if (a.status === "PENDING") contagem.aguardandoConfirmacao += 1;
    if (a.status === "IN_PROGRESS") contagem.emAtendimento += 1;
    if (a.status === "COMPLETED") contagem.concluidos += 1;
  }
  return contagem;
}

/**
 * Próximos atendimentos do dia: só os que ainda vão começar (início depois
 * de `agora`) e continuam valendo (`PENDING` ou `CONFIRMED`), em ordem
 * cronológica. Quem já começou e está sendo atendido aparece à parte
 * (`atendimentosEmAndamento`), nunca misturado com "próximos".
 */
export function proximosAtendimentos(
  agendamentos: readonly AgendamentoReal[],
  agora: Date,
): AgendamentoReal[] {
  const instante = agora.getTime();
  return ordenarPorHorario(
    agendamentos.filter(
      (a) =>
        (a.status === "PENDING" || a.status === "CONFIRMED") && Date.parse(a.startAt) > instante,
    ),
  );
}

export function atendimentosEmAndamento(
  agendamentos: readonly AgendamentoReal[],
): AgendamentoReal[] {
  return ordenarPorHorario(agendamentos.filter((a) => a.status === "IN_PROGRESS"));
}

export type ResumoDoDia =
  | { tipo: "pronto"; agenda: AgendaDoDiaReal }
  /** A resposta não prova que o dia veio inteiro: nada de totais. */
  | { tipo: "incompleto" }
  /** A resposta é de outro dia (o "hoje" ainda está sendo ajustado ao fuso
   * do estabelecimento, ou virou a meia-noite): ainda não dá para resumir. */
  | { tipo: "ajustando" };

/** A agenda recebida serve para resumir o "hoje" do estabelecimento? */
export function avaliarAgendaDeHoje(agenda: AgendaDoDiaReal, agora: Date): ResumoDoDia {
  if (hojeNoFuso(agenda.timezone, agora) !== agenda.date) return { tipo: "ajustando" };
  if (!agenda.completa) return { tipo: "incompleto" };
  return { tipo: "pronto", agenda };
}
