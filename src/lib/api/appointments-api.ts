// Cliente tipado das rotas reais de agendamento e de clientes (Lote 6D.5) —
// espelha backend/src/appointments/*.ts e backend/src/consumers/*.ts. Nenhum
// campo inventado.
//
// O QUE ESTE CLIENTE NUNCA ENVIA: preço, duração, fim, status, unidade ou
// tenant. O contrato do backend nem aceita esses campos — quem decide todos
// eles é o servidor.
import { apiRequest } from "./http-client";

export type StatusAgendamentoReal =
  | "PENDING"
  | "CONFIRMED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CANCELED"
  | "NO_SHOW";

export interface AgendamentoReal {
  id: string;
  /** Instantes inequívocos (ISO 8601 em UTC). */
  startAt: string;
  /** Fim do ATENDIMENTO (o que a pessoa entende como "termina às"). */
  serviceEndAt: string;
  /** Fim da OCUPAÇÃO na agenda (atendimento + buffer congelado). */
  occupancyEndAt: string;
  /** Hora de relógio no fuso do ESTABELECIMENTO — a tela exibe estas, nunca
   * converte os instantes com o relógio do navegador. */
  localStart: string;
  localServiceEnd: string;
  timezone: string;
  status: StatusAgendamentoReal;
  durationMinutes: number;
  /** `null` = serviço sem preço definido. Nunca confundir com zero. */
  priceCents: number | null;
  notes: string | null;
  professional: { id: string; name: string };
  service: { id: string; name: string };
  consumer: { id: string; name: string; whatsapp: string };
  unitId: string;
  createdAt: string;
}

export interface AgendaDoDiaReal {
  timezone: string;
  date: string;
  appointments: AgendamentoReal[];
}

export interface ClienteReal {
  id: string;
  name: string;
  whatsapp: string;
  email: string | null;
}

export interface DadosClienteNovo {
  name: string;
  whatsapp: string;
  email?: string;
}

/** Ou um cliente já cadastrado, ou os dados de um novo — nunca os dois. */
export type SelecaoDeCliente =
  | { mode: "existing"; consumerId: string }
  | { mode: "new"; data: DadosClienteNovo };

export interface DadosAgendamentoReal {
  professionalId: string;
  serviceId: string;
  /** Instante ISO 8601 com fuso, copiado do slot devolvido pela consulta de
   * disponibilidade — nunca uma hora local remontada no navegador. */
  startAt: string;
  consumer: SelecaoDeCliente;
  notes?: string;
}

export type FalhaAgendamentoReal =
  | { tipo: "nao_autenticado" }
  | { tipo: "sem_acesso" }
  | { tipo: "sem_permissao" }
  /** 400: horário fora da jornada/grade, serviço ou profissional inativo,
   * vínculo ausente, dados recusados. A mensagem vem do servidor. */
  | { tipo: "nao_agendavel"; mensagem: string | null }
  /** 409: o horário foi ocupado por outra reserva entre a consulta e o envio. */
  | { tipo: "horario_ocupado"; mensagem: string | null }
  | { tipo: "falha_comunicacao" }
  | { tipo: "indisponivel" };

export type ResultadoAgendamentoReal<T> =
  | { ok: true; dados: T }
  | { ok: false; falha: FalhaAgendamentoReal };

function mensagemDeErroDoBackend(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const mensagem = (data as Record<string, unknown>).message;
  return typeof mensagem === "string" ? mensagem : null;
}

function falhaPorStatus(status: number, data: unknown): FalhaAgendamentoReal {
  if (status === 401) return { tipo: "nao_autenticado" };
  if (status === 403) return { tipo: "sem_permissao" };
  if (status === 404) return { tipo: "sem_acesso" };
  if (status === 409) return { tipo: "horario_ocupado", mensagem: mensagemDeErroDoBackend(data) };
  if (status === 400) return { tipo: "nao_agendavel", mensagem: mensagemDeErroDoBackend(data) };
  return { tipo: "indisponivel" };
}

function ehAgendamento(valor: unknown): valor is AgendamentoReal {
  if (typeof valor !== "object" || valor === null) return false;
  const v = valor as Record<string, unknown>;
  const pessoa = (x: unknown) =>
    typeof x === "object" && x !== null && typeof (x as Record<string, unknown>).id === "string";
  return (
    typeof v.id === "string" &&
    typeof v.startAt === "string" &&
    typeof v.serviceEndAt === "string" &&
    typeof v.occupancyEndAt === "string" &&
    typeof v.localStart === "string" &&
    typeof v.localServiceEnd === "string" &&
    typeof v.timezone === "string" &&
    typeof v.status === "string" &&
    typeof v.durationMinutes === "number" &&
    (v.priceCents === null || typeof v.priceCents === "number") &&
    pessoa(v.professional) &&
    pessoa(v.service) &&
    pessoa(v.consumer)
  );
}

function ehCliente(valor: unknown): valor is ClienteReal {
  if (typeof valor !== "object" || valor === null) return false;
  const v = valor as Record<string, unknown>;
  return (
    typeof v.id === "string" && typeof v.name === "string" && typeof v.whatsapp === "string"
  );
}

const caminhoAgendamentos = (tenantId: string) =>
  `/tenants/${encodeURIComponent(tenantId)}/appointments`;
const caminhoClientes = (tenantId: string) =>
  `/tenants/${encodeURIComponent(tenantId)}/consumers`;

export async function listarAgendamentos(
  tenantId: string,
  date: string,
  signal?: AbortSignal,
): Promise<ResultadoAgendamentoReal<AgendaDoDiaReal>> {
  const resultado = await apiRequest<unknown>(
    `${caminhoAgendamentos(tenantId)}?date=${encodeURIComponent(date)}`,
    { method: "GET", signal },
  );

  if (resultado.kind === "network-error") return { ok: false, falha: { tipo: "falha_comunicacao" } };
  if (resultado.kind === "http-error") {
    return { ok: false, falha: falhaPorStatus(resultado.status, resultado.data) };
  }

  const corpo = resultado.data as { timezone?: unknown; date?: unknown; appointments?: unknown };
  if (
    typeof corpo?.timezone !== "string" ||
    typeof corpo?.date !== "string" ||
    !Array.isArray(corpo.appointments) ||
    !corpo.appointments.every(ehAgendamento)
  ) {
    return { ok: false, falha: { tipo: "indisponivel" } };
  }
  return {
    ok: true,
    dados: { timezone: corpo.timezone, date: corpo.date, appointments: corpo.appointments },
  };
}

export async function criarAgendamento(
  tenantId: string,
  dados: DadosAgendamentoReal,
  signal?: AbortSignal,
): Promise<ResultadoAgendamentoReal<AgendamentoReal>> {
  const resultado = await apiRequest<unknown>(caminhoAgendamentos(tenantId), {
    method: "POST",
    body: dados,
    signal,
  });

  if (resultado.kind === "network-error") return { ok: false, falha: { tipo: "falha_comunicacao" } };
  if (resultado.kind === "http-error") {
    return { ok: false, falha: falhaPorStatus(resultado.status, resultado.data) };
  }

  const corpo = resultado.data as { appointment?: unknown };
  if (!ehAgendamento(corpo?.appointment)) return { ok: false, falha: { tipo: "indisponivel" } };
  return { ok: true, dados: corpo.appointment };
}

export async function buscarClientes(
  tenantId: string,
  termo: string,
  signal?: AbortSignal,
): Promise<ResultadoAgendamentoReal<ClienteReal[]>> {
  const resultado = await apiRequest<unknown>(
    `${caminhoClientes(tenantId)}?q=${encodeURIComponent(termo)}`,
    { method: "GET", signal },
  );

  if (resultado.kind === "network-error") return { ok: false, falha: { tipo: "falha_comunicacao" } };
  if (resultado.kind === "http-error") {
    return { ok: false, falha: falhaPorStatus(resultado.status, resultado.data) };
  }

  const corpo = resultado.data as { consumers?: unknown };
  if (!Array.isArray(corpo?.consumers) || !corpo.consumers.every(ehCliente)) {
    return { ok: false, falha: { tipo: "indisponivel" } };
  }
  return { ok: true, dados: corpo.consumers };
}
