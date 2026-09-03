import { isSameDay } from "date-fns";
import type { Agendamento, Bloqueio, StatusAgendamento } from "@/lib/types";

/** Agendamentos de um profissional num dia, já filtrados por status e
 * ordenados por horário — mesma regra usada nas visões de dia e semana. */
export function agendamentosDoDia(
  agendamentos: Agendamento[],
  profissionalId: string,
  dia: Date,
  filtroStatus: StatusAgendamento | "todos"
): Agendamento[] {
  return agendamentos
    .filter(
      (a) =>
        a.profissionalId === profissionalId &&
        isSameDay(new Date(a.dataHoraInicio), dia) &&
        (filtroStatus === "todos" || a.status === filtroStatus)
    )
    .sort((a, b) => new Date(a.dataHoraInicio).getTime() - new Date(b.dataHoraInicio).getTime());
}

/** Bloqueios de um profissional num dia, ordenados por horário. */
export function bloqueiosDoDia(bloqueios: Bloqueio[], profissionalId: string, dia: Date): Bloqueio[] {
  return bloqueios
    .filter((b) => b.profissionalId === profissionalId && isSameDay(new Date(b.inicio), dia))
    .sort((a, b) => new Date(a.inicio).getTime() - new Date(b.inicio).getTime());
}
