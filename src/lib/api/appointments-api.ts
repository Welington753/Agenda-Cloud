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
  /** 409: o horário foi ocupado por outra reserva entre a consulta e o envio,
   * OU (na remarcação e no cancelamento) a reserva mudou desde que a tela
   * carregou. Os dois vêm com a mensagem do servidor, que distingue os casos. */
  | { tipo: "horario_ocupado"; mensagem: string | null }
  | { tipo: "falha_comunicacao" }
  | { tipo: "indisponivel" };

/** Horários oferecidos para remarcar UMA reserva (Lote 6D.6) — espelha
 * `RescheduleOptionsView` do backend. A duração é a CONGELADA na reserva. */
export interface OpcoesDeRemarcacao {
  appointmentId: string;
  date: string;
  timezone: string;
  durationMinutes: number;
  slots: {
    startAt: string;
    endAt: string;
    localStart: string;
    localEnd: string;
    offsetMinutes: number;
    offsetLabel: string;
  }[];
  emptyReason: string | null;
}

/** Remarcação: só o novo instante e o que a tela estava mostrando. Nenhum
 * outro campo existe no contrato do backend. */
export interface DadosRemarcacaoReal {
  /** Instante copiado do slot devolvido pelo servidor — nunca remontado. */
  startAt: string;
  /** Instante atual da reserva conforme a tela: o servidor recusa se a
   * reserva já tiver sido movida por outra pessoa ou outra aba. */
  expectedStartAt: string;
}

/** Cancelamento: só o instante que a CONFIRMAÇÃO mostrou, mesmo controle da
 * remarcação (409 se a reserva foi movida depois; cobre só o início). */
export type DadosCancelamentoReal = Pick<DadosRemarcacaoReal, "expectedStartAt">;

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

function ehSlotDeRemarcacao(valor: unknown): boolean {
  if (typeof valor !== "object" || valor === null) return false;
  const v = valor as Record<string, unknown>;
  return (
    typeof v.startAt === "string" &&
    typeof v.endAt === "string" &&
    typeof v.localStart === "string" &&
    typeof v.localEnd === "string" &&
    typeof v.offsetMinutes === "number" &&
    typeof v.offsetLabel === "string"
  );
}

function ehOpcoesDeRemarcacao(valor: unknown): valor is OpcoesDeRemarcacao {
  if (typeof valor !== "object" || valor === null) return false;
  const v = valor as Record<string, unknown>;
  return (
    typeof v.appointmentId === "string" &&
    typeof v.date === "string" &&
    typeof v.timezone === "string" &&
    typeof v.durationMinutes === "number" &&
    Array.isArray(v.slots) &&
    v.slots.every(ehSlotDeRemarcacao) &&
    (v.emptyReason === null || typeof v.emptyReason === "string")
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

/** `POST .../{appointmentId}/{acao}` sobre UMA reserva existente — base comum de
 * cancelar, remarcar e do andamento (Lote 6D.7), com o mesmo mapeamento de falhas. */
export async function acaoSobreReserva(
  tenantId: string,
  appointmentId: string,
  acao: string,
  dados: object,
  signal?: AbortSignal,
): Promise<ResultadoAgendamentoReal<AgendamentoReal>> {
  const resultado = await apiRequest<unknown>(
    `${caminhoAgendamentos(tenantId)}/${encodeURIComponent(appointmentId)}/${acao}`,
    { method: "POST", body: dados, signal },
  );

  if (resultado.kind === "network-error") return { ok: false, falha: { tipo: "falha_comunicacao" } };
  if (resultado.kind === "http-error") {
    return { ok: false, falha: falhaPorStatus(resultado.status, resultado.data) };
  }

  const corpo = resultado.data as { appointment?: unknown };
  if (!ehAgendamento(corpo?.appointment)) return { ok: false, falha: { tipo: "indisponivel" } };
  return { ok: true, dados: corpo.appointment };
}

/** Cancela a reserva, só com o instante que a confirmação mostrava: o backend
 * recusa qualquer outro campo; QUAL reserva vai no caminho. */
export function cancelarAgendamento(
  tenantId: string,
  appointmentId: string,
  dados: DadosCancelamentoReal,
  signal?: AbortSignal,
): Promise<ResultadoAgendamentoReal<AgendamentoReal>> {
  return acaoSobreReserva(tenantId, appointmentId, "cancel", dados, signal);
}

/** Horários que o servidor aceita para remarcar ESTA reserva, num dia. O
 * profissional e o serviço não são enviados: o backend os lê da reserva. */
export async function listarHorariosParaRemarcar(
  tenantId: string,
  appointmentId: string,
  date: string,
  signal?: AbortSignal,
): Promise<ResultadoAgendamentoReal<OpcoesDeRemarcacao>> {
  const resultado = await apiRequest<unknown>(
    `${caminhoAgendamentos(tenantId)}/${encodeURIComponent(appointmentId)}` +
      `/reschedule-options?date=${encodeURIComponent(date)}`,
    { method: "GET", signal },
  );

  if (resultado.kind === "network-error") return { ok: false, falha: { tipo: "falha_comunicacao" } };
  if (resultado.kind === "http-error") {
    return { ok: false, falha: falhaPorStatus(resultado.status, resultado.data) };
  }

  const corpo = resultado.data as { options?: unknown };
  if (!ehOpcoesDeRemarcacao(corpo?.options)) {
    return { ok: false, falha: { tipo: "indisponivel" } };
  }
  return { ok: true, dados: corpo.options };
}

/** Move SÓ o horário da reserva. O id, o cliente, o profissional, o serviço,
 * o status, o preço e a duração são preservados pelo servidor. */
export function remarcarAgendamento(
  tenantId: string,
  appointmentId: string,
  dados: DadosRemarcacaoReal,
  signal?: AbortSignal,
): Promise<ResultadoAgendamentoReal<AgendamentoReal>> {
  return acaoSobreReserva(tenantId, appointmentId, "reschedule", dados, signal);
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
