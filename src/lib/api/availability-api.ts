// Cliente tipado da consulta real de disponibilidade (Lote 6D.4) — espelha
// backend/src/availability/availability.controller.ts e availability.dto.ts.
// Nenhum campo inventado.
//
// É SÓ CONSULTA: não existe aqui nenhuma função de gravar, reservar ou
// confirmar — o backend deste lote também não tem rota para isso.
//
// Reutiliza `apiRequest` (http-client.ts), como todos os outros clientes.
// O vocabulário de falhas é PRÓPRIO (e não o de profissionais) por um motivo
// concreto: o 403 desta rota fala de consultar a AGENDA, não de gerenciar
// profissionais, e reaproveitar o outro tipo obrigaria a mentir na redação.
import { apiRequest } from "./http-client";

/** Motivos de lista vazia devolvidos pelo backend (`emptyReason`). Lista
 * fechada: qualquer valor fora dela é tratado como resposta inesperada. */
export const MOTIVOS_SEM_HORARIO = [
  "sem_jornada",
  "fora_da_janela_futura",
  "sem_horario_livre",
] as const;

export type MotivoSemHorario = (typeof MOTIVOS_SEM_HORARIO)[number];

export interface HorarioReal {
  /** Instante inequívoco (ISO 8601 em UTC). */
  startAt: string;
  endAt: string;
  /** Hora de relógio no fuso do ESTABELECIMENTO — a tela exibe estas, nunca
   * converte `startAt` com o relógio do navegador. */
  localStart: string;
  localEnd: string;
  /** Distingue dois horários com a mesma hora local no dia em que o relógio
   * volta (fim do horário de verão). */
  offsetMinutes: number;
  offsetLabel: string;
}

export interface DisponibilidadeReal {
  professionalId: string;
  serviceId: string;
  /** Data consultada (`YYYY-MM-DD`), no fuso abaixo. */
  date: string;
  timezone: string;
  durationMinutes: number;
  bufferAfterMinutes: number;
  slotStepMinutes: number;
  /** `null` quando o estabelecimento não tem política gravada — e então
   * nenhuma antecedência/limite é inventada pela tela. */
  minLeadMinutes: number | null;
  maxFutureDays: number | null;
  slots: HorarioReal[];
  /** Preenchido só quando `slots` está vazio. Lista vazia legítima nunca se
   * confunde com falha. */
  emptyReason: MotivoSemHorario | null;
}

export type FalhaDisponibilidadeReal =
  | { tipo: "nao_autenticado" }
  | { tipo: "sem_acesso" }
  | { tipo: "sem_permissao" }
  /** 400 do backend: profissional/serviço desativado, vínculo ausente,
   * duração inválida, fuso do estabelecimento inválido. A mensagem vem do
   * servidor porque cada caso tem uma orientação diferente. */
  | { tipo: "nao_consultavel"; mensagem: string | null }
  | { tipo: "falha_comunicacao" }
  | { tipo: "indisponivel" };

export type ResultadoDisponibilidadeReal<T> =
  | { ok: true; dados: T }
  | { ok: false; falha: FalhaDisponibilidadeReal };

function ehMotivo(valor: unknown): valor is MotivoSemHorario {
  return MOTIVOS_SEM_HORARIO.includes(valor as MotivoSemHorario);
}

function ehHorario(valor: unknown): valor is HorarioReal {
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

function ehDisponibilidade(valor: unknown): valor is DisponibilidadeReal {
  if (typeof valor !== "object" || valor === null) return false;
  const v = valor as Record<string, unknown>;
  const numeroOuNulo = (x: unknown) => x === null || typeof x === "number";
  return (
    typeof v.professionalId === "string" &&
    typeof v.serviceId === "string" &&
    typeof v.date === "string" &&
    typeof v.timezone === "string" &&
    typeof v.durationMinutes === "number" &&
    typeof v.bufferAfterMinutes === "number" &&
    typeof v.slotStepMinutes === "number" &&
    numeroOuNulo(v.minLeadMinutes) &&
    numeroOuNulo(v.maxFutureDays) &&
    Array.isArray(v.slots) &&
    v.slots.every(ehHorario) &&
    (v.emptyReason === null || ehMotivo(v.emptyReason))
  );
}

function mensagemDeErroDoBackend(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const mensagem = (data as Record<string, unknown>).message;
  return typeof mensagem === "string" ? mensagem : null;
}

function falhaPorStatus(status: number, data: unknown): FalhaDisponibilidadeReal {
  if (status === 401) return { tipo: "nao_autenticado" };
  if (status === 403) return { tipo: "sem_permissao" };
  if (status === 404) return { tipo: "sem_acesso" };
  if (status === 400) return { tipo: "nao_consultavel", mensagem: mensagemDeErroDoBackend(data) };
  return { tipo: "indisponivel" };
}

/**
 * Consulta os horários livres de um profissional para um serviço e uma data.
 *
 * `serviceId` e `date` vão na query string (contrato do backend); `tenantId`
 * e `professionalId` vão no caminho. Todos passam por `encodeURIComponent` —
 * um id com caractere especial nunca pode escapar para outro caminho.
 */
export async function consultarDisponibilidade(
  tenantId: string,
  professionalId: string,
  serviceId: string,
  date: string,
  signal?: AbortSignal,
): Promise<ResultadoDisponibilidadeReal<DisponibilidadeReal>> {
  const caminho =
    `/tenants/${encodeURIComponent(tenantId)}` +
    `/professionals/${encodeURIComponent(professionalId)}/availability` +
    `?serviceId=${encodeURIComponent(serviceId)}&date=${encodeURIComponent(date)}`;

  const resultado = await apiRequest<unknown>(caminho, { method: "GET", signal });

  if (resultado.kind === "network-error") return { ok: false, falha: { tipo: "falha_comunicacao" } };
  if (resultado.kind === "http-error") {
    return { ok: false, falha: falhaPorStatus(resultado.status, resultado.data) };
  }

  const corpo = resultado.data as { availability?: unknown };
  if (!ehDisponibilidade(corpo?.availability)) return { ok: false, falha: { tipo: "indisponivel" } };
  return { ok: true, dados: corpo.availability };
}
