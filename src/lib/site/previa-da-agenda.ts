// Prévia da agenda na página inicial: dados FICTÍCIOS, na forma exata que a
// API devolve (`AgendamentoReal`), desenhados pelos mesmos componentes da
// agenda real (visualização "Lista" da agenda do dia, agenda-do-dia.tsx, com
// cartao-atendimento.tsx). Nada aqui é inventado para enfeitar: só estados que
// a agenda mostra de verdade e nenhuma ação (a prévia não tem botões).
//
// Nomes, serviços e preços são exemplos; a página os identifica como
// demonstração. Nada vem do banco nem do navegador.
import type { AgendamentoReal, StatusAgendamentoReal } from "@/lib/api/appointments-api";
import { ordenarPorHorario } from "@/lib/profissionais/agenda-visual";

export const ROTULO_DA_PREVIA = "Demonstração · dados fictícios";
export const LEGENDA_DA_PREVIA = "Agenda do dia na visualização em lista, com dados fictícios.";

const DIA = "2026-03-10";
const FUSO = "America/Sao_Paulo";

function exemplo(
  id: string,
  inicio: string,
  fim: string,
  status: StatusAgendamentoReal,
  profissional: { id: string; name: string },
  servico: string,
  minutos: number,
  precoCentavos: number,
  cliente: string,
): AgendamentoReal {
  return {
    id,
    startAt: `${DIA}T${inicio}:00-03:00`,
    serviceEndAt: `${DIA}T${fim}:00-03:00`,
    occupancyEndAt: `${DIA}T${fim}:00-03:00`,
    localStart: inicio,
    localServiceEnd: fim,
    timezone: FUSO,
    status,
    durationMinutes: minutos,
    priceCents: precoCentavos,
    notes: null,
    professional: profissional,
    service: { id: `servico-${id}`, name: servico },
    consumer: { id: `cliente-${id}`, name: cliente, whatsapp: null },
    unitId: "unidade-exemplo",
    createdAt: `${DIA}T08:00:00-03:00`,
  };
}

const CARLA = { id: "profissional-exemplo-1", name: "Carla Mendes" };
const DIEGO = { id: "profissional-exemplo-2", name: "Diego Rocha" };

export const AGENDAMENTOS_DA_PREVIA: AgendamentoReal[] = [
  exemplo("exemplo-1", "09:00", "09:45", "COMPLETED", CARLA, "Corte", 45, 6000, "Ana Souza"),
  exemplo("exemplo-2", "10:30", "11:30", "CONFIRMED", CARLA, "Coloração", 60, 12000, "Paula Reis"),
  exemplo("exemplo-3", "14:00", "14:45", "PENDING", CARLA, "Corte", 45, 6000, "Rafael Costa"),
  exemplo("exemplo-4", "09:30", "10:30", "CONFIRMED", DIEGO, "Massagem relaxante", 60, 9000, "Bruno Lima"),
  exemplo("exemplo-5", "11:00", "11:50", "PENDING", DIEGO, "Limpeza de pele", 50, 8500, "Juliana Alves"),
];

/** Mesma ordem da agenda real (por horário). */
export function agendamentosDaPrevia(): AgendamentoReal[] {
  return ordenarPorHorario(AGENDAMENTOS_DA_PREVIA);
}
