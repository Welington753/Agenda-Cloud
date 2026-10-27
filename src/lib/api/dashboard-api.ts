// Cliente tipado dos indicadores do Início — espelha
// backend/src/dashboard/dashboard.service.ts. Todos os números vêm contados
// pelo servidor sobre o período inteiro; a tela só apresenta.
import { apiRequest } from "./http-client";

export const SITUACOES_ATENDIMENTO = ["PENDING", "CONFIRMED", "IN_PROGRESS", "COMPLETED", "NO_SHOW", "CANCELED"] as const;
export type SituacaoAtendimento = (typeof SITUACOES_ATENDIMENTO)[number];

export interface ProximoAtendimentoDoPainel {
  id: string;
  startAt: string;
  localDate: string;
  localStart: string;
  status: SituacaoAtendimento;
  consumer: { name: string };
  service: { name: string };
  professional: { name: string };
}

export interface PainelDoEstabelecimento {
  timezone: string;
  today: string;
  generatedAt: string;
  period: { from: string; to: string };
  todaySummary: {
    expectedClients: number;
    appointmentsByStatus: Record<SituacaoAtendimento, number>;
  };
  periodSummary: {
    servedClients: number;
    appointmentsByStatus: Record<SituacaoAtendimento, number>;
    appointmentsTotal: number;
  };
  pendingRequests: number;
  upcoming: ProximoAtendimentoDoPainel[];
  /** Recebimentos registrados no período. `averageTicketCents` é `null`
   * quando não há atendimento pago (nunca um zero inventado). */
  finance: {
    receivedCents: number;
    refundedCents: number;
    netCents: number;
    paidAppointments: number;
    paidTotalCents: number;
    averageTicketCents: number | null;
  };
  plan: {
    name: string;
    maxProfessionals: number;
    activeProfessionals: number;
    staffSeats: { used: number; pending: number; available: number; limit: number };
  };
}

export type FalhaPainel =
  | { tipo: "nao_autenticado" }
  | { tipo: "sem_acesso" }
  | { tipo: "sem_permissao" }
  | { tipo: "periodo_invalido"; mensagem: string | null }
  | { tipo: "falha_comunicacao" }
  | { tipo: "indisponivel" };

export type ResultadoPainel = { ok: true; dados: PainelDoEstabelecimento } | { ok: false; falha: FalhaPainel };

const numero = (v: unknown) => typeof v === "number" && Number.isFinite(v);
const texto = (v: unknown) => typeof v === "string";

function porSituacao(v: unknown): v is Record<SituacaoAtendimento, number> {
  if (typeof v !== "object" || v === null) return false;
  return SITUACOES_ATENDIMENTO.every((s) => numero((v as Record<string, unknown>)[s]));
}

function ehProximo(v: unknown): v is ProximoAtendimentoDoPainel {
  if (typeof v !== "object" || v === null) return false;
  const p = v as Record<string, unknown>;
  const nome = (o: unknown) => typeof o === "object" && o !== null && texto((o as Record<string, unknown>).name);
  return (
    texto(p.id) &&
    texto(p.startAt) &&
    texto(p.localDate) &&
    texto(p.localStart) &&
    (SITUACOES_ATENDIMENTO as readonly unknown[]).includes(p.status) &&
    nome(p.consumer) &&
    nome(p.service) &&
    nome(p.professional)
  );
}

/** Confere a forma inteira: um painel pela metade nunca vira número na tela. */
export function ehPainel(v: unknown): v is PainelDoEstabelecimento {
  if (typeof v !== "object" || v === null) return false;
  const p = v as Record<string, unknown>;
  const periodo = p.period as Record<string, unknown> | undefined;
  const hoje = p.todaySummary as Record<string, unknown> | undefined;
  const noPeriodo = p.periodSummary as Record<string, unknown> | undefined;
  const plano = p.plan as Record<string, unknown> | undefined;
  const vagas = plano?.staffSeats as Record<string, unknown> | undefined;
  const financeiro = p.finance as Record<string, unknown> | undefined;
  return (
    texto(p.timezone) &&
    texto(p.today) &&
    texto(p.generatedAt) &&
    !!periodo &&
    texto(periodo.from) &&
    texto(periodo.to) &&
    !!hoje &&
    numero(hoje.expectedClients) &&
    porSituacao(hoje.appointmentsByStatus) &&
    !!noPeriodo &&
    numero(noPeriodo.servedClients) &&
    numero(noPeriodo.appointmentsTotal) &&
    porSituacao(noPeriodo.appointmentsByStatus) &&
    numero(p.pendingRequests) &&
    Array.isArray(p.upcoming) &&
    p.upcoming.every(ehProximo) &&
    !!plano &&
    texto(plano.name) &&
    numero(plano.maxProfessionals) &&
    numero(plano.activeProfessionals) &&
    !!vagas &&
    numero(vagas.used) &&
    numero(vagas.pending) &&
    numero(vagas.available) &&
    numero(vagas.limit) &&
    !!financeiro &&
    ["receivedCents", "refundedCents", "netCents", "paidAppointments", "paidTotalCents"].every((k) => numero(financeiro[k])) &&
    (financeiro.averageTicketCents === null || numero(financeiro.averageTicketCents))
  );
}

function mensagemDoBackend(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const m = (data as Record<string, unknown>).message;
  return typeof m === "string" ? m : null;
}

export async function obterPainel(
  tenantId: string,
  periodo: { from: string; to: string } | null,
  signal?: AbortSignal,
): Promise<ResultadoPainel> {
  const busca = periodo ? `?${new URLSearchParams({ from: periodo.from, to: periodo.to }).toString()}` : "";
  const resultado = await apiRequest<unknown>(`/tenants/${encodeURIComponent(tenantId)}/dashboard${busca}`, {
    method: "GET",
    signal,
  });
  if (resultado.kind === "network-error") return { ok: false, falha: { tipo: "falha_comunicacao" } };
  if (resultado.kind === "http-error") {
    if (resultado.status === 401) return { ok: false, falha: { tipo: "nao_autenticado" } };
    if (resultado.status === 403) return { ok: false, falha: { tipo: "sem_permissao" } };
    if (resultado.status === 404) return { ok: false, falha: { tipo: "sem_acesso" } };
    if (resultado.status === 400) {
      return { ok: false, falha: { tipo: "periodo_invalido", mensagem: mensagemDoBackend(resultado.data) } };
    }
    return { ok: false, falha: { tipo: "indisponivel" } };
  }
  if (!ehPainel(resultado.data)) return { ok: false, falha: { tipo: "indisponivel" } };
  return { ok: true, dados: resultado.data };
}
