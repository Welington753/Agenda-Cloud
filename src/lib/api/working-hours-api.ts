// Cliente tipado das rotas reais de horários semanais (Lote 6D.3) — espelha
// backend/src/professionals/working-hours.controller.ts e working-hours.dto.ts.
// Nenhum campo inventado.
//
// Reutiliza `apiRequest` (http-client.ts) e o mesmo vocabulário de falhas de
// profissionais (`FalhaProfissionaisReal`), porque é o mesmo domínio e as
// mensagens já existem em lib/profissionais/mensagens.ts — nenhuma redação
// duplicada.
import { apiRequest } from "./http-client";
import type { FalhaProfissionaisReal, ResultadoProfissionaisReal } from "./professionals-api";

export interface IntervaloReal {
  /** "HH:MM", hora LOCAL do estabelecimento (ver `timezone`). */
  start: string;
  end: string;
}

export interface DiaDeTrabalhoReal {
  /** 0 = domingo, igual à coluna `weekday`. */
  weekday: number;
  intervals: IntervaloReal[];
}

export interface HorariosReais {
  /** Fuso do estabelecimento (`tenants.timezone`) — a tela exibe, nunca
   * converte usando o fuso do navegador. */
  timezone: string;
  /** Só os dias COM atendimento. Dia ausente = não atende. */
  days: DiaDeTrabalhoReal[];
}

export type { FalhaProfissionaisReal };

function ehIntervalo(valor: unknown): valor is IntervaloReal {
  if (typeof valor !== "object" || valor === null) return false;
  const v = valor as Record<string, unknown>;
  return typeof v.start === "string" && typeof v.end === "string";
}

function ehHorariosReais(valor: unknown): valor is HorariosReais {
  if (typeof valor !== "object" || valor === null) return false;
  const v = valor as Record<string, unknown>;
  if (typeof v.timezone !== "string" || !Array.isArray(v.days)) return false;
  return v.days.every((dia) => {
    if (typeof dia !== "object" || dia === null) return false;
    const d = dia as Record<string, unknown>;
    return typeof d.weekday === "number" && Array.isArray(d.intervals) && d.intervals.every(ehIntervalo);
  });
}

function mensagemDeErroDoBackend(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const mensagem = (data as Record<string, unknown>).message;
  return typeof mensagem === "string" ? mensagem : null;
}

function falhaPorStatus(status: number, data: unknown): FalhaProfissionaisReal {
  if (status === 401) return { tipo: "nao_autenticado" };
  if (status === 403) return { tipo: "sem_permissao" };
  if (status === 404) return { tipo: "sem_acesso" };
  if (status === 409) return { tipo: "conflito" };
  if (status === 400) return { tipo: "dados_invalidos", mensagem: mensagemDeErroDoBackend(data) };
  return { tipo: "indisponivel" };
}

function caminho(tenantId: string, professionalId: string): string {
  return `/tenants/${encodeURIComponent(tenantId)}/professionals/${encodeURIComponent(
    professionalId,
  )}/schedule`;
}

async function pedir(
  url: string,
  method: "GET" | "PUT",
  body: unknown,
  signal?: AbortSignal,
): Promise<ResultadoProfissionaisReal<HorariosReais>> {
  const resultado = await apiRequest<unknown>(url, { method, body, signal });

  if (resultado.kind === "network-error") return { ok: false, falha: { tipo: "falha_comunicacao" } };
  if (resultado.kind === "http-error") {
    return { ok: false, falha: falhaPorStatus(resultado.status, resultado.data) };
  }

  const corpo = resultado.data as { schedule?: unknown };
  if (!ehHorariosReais(corpo?.schedule)) return { ok: false, falha: { tipo: "indisponivel" } };
  return { ok: true, dados: corpo.schedule };
}

export function buscarHorarios(
  tenantId: string,
  professionalId: string,
  signal?: AbortSignal,
): Promise<ResultadoProfissionaisReal<HorariosReais>> {
  return pedir(caminho(tenantId, professionalId), "GET", undefined, signal);
}

/** Substitui a SEMANA INTEIRA — dia que não for enviado deixa de existir
 * (contrato do backend, ver working-hours.service.ts). */
export function salvarHorarios(
  tenantId: string,
  professionalId: string,
  days: DiaDeTrabalhoReal[],
  signal?: AbortSignal,
): Promise<ResultadoProfissionaisReal<HorariosReais>> {
  return pedir(caminho(tenantId, professionalId), "PUT", { days }, signal);
}
