// Agenda por período (Calendário do dono) — espelha
// GET /tenants/:id/appointments/range (backend/src/appointments). Mesmo
// formato de reserva da agenda do dia, mais a data local de cada uma.
import { apiRequest } from "./http-client";
import {
  caminhoAgendamentos,
  ehAgendamento,
  falhaPorStatus,
  type AgendamentoReal,
  type ResultadoAgendamentoReal,
} from "./appointments-api";

/** Agenda de um período (Calendário), com a data local de cada reserva. */
export interface AgendaDoPeriodoReal {
  timezone: string;
  from: string;
  to: string;
  appointments: (AgendamentoReal & { localDate: string })[];
  completa: boolean;
}

export async function listarAgendamentosDoPeriodo(
  tenantId: string,
  periodo: { from: string; to: string; professionalId?: string | null },
  signal?: AbortSignal,
): Promise<ResultadoAgendamentoReal<AgendaDoPeriodoReal>> {
  const busca = new URLSearchParams({ from: periodo.from, to: periodo.to });
  if (periodo.professionalId) busca.set("professionalId", periodo.professionalId);
  const resultado = await apiRequest<unknown>(`${caminhoAgendamentos(tenantId)}/range?${busca.toString()}`, {
    method: "GET",
    signal,
  });

  if (resultado.kind === "network-error") return { ok: false, falha: { tipo: "falha_comunicacao" } };
  if (resultado.kind === "http-error") {
    return { ok: false, falha: falhaPorStatus(resultado.status, resultado.data) };
  }

  const corpo = resultado.data as Partial<Record<"timezone" | "from" | "to" | "appointments" | "complete", unknown>>;
  if (
    typeof corpo?.timezone !== "string" ||
    typeof corpo?.from !== "string" ||
    typeof corpo?.to !== "string" ||
    !Array.isArray(corpo.appointments) ||
    !corpo.appointments.every(
      (a) => ehAgendamento(a) && typeof (a as unknown as Record<string, unknown>).localDate === "string",
    )
  ) {
    return { ok: false, falha: { tipo: "indisponivel" } };
  }
  return {
    ok: true,
    dados: {
      timezone: corpo.timezone,
      from: corpo.from,
      to: corpo.to,
      appointments: corpo.appointments as (AgendamentoReal & { localDate: string })[],
      completa: corpo.complete === true,
    },
  };
}

