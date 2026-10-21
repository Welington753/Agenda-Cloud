// Cliente das rotas PÚBLICAS do agendamento online — espelha
// backend/src/public-booking/public-booking.controller.ts. Sem sessão: o
// estabelecimento vem do slug.
//
// O ENVIO distingue com cuidado o que se sabe do resultado:
// - 201/200: o pedido está gravado (200 = era o MESMO envio, repetido);
// - 4xx com mensagem: o servidor respondeu e RECUSOU — nada foi gravado;
// - sem resposta, 5xx ou resposta ilegível: `incerto`. O pedido PODE ter
//   sido gravado. A tela nunca afirma que não foi, e nunca reenvia sozinha:
//   quem decide "verificar o envio" é a pessoa, com a MESMA chave, e o
//   servidor devolve o pedido já gravado em vez de criar outro.
import { apiRequest } from "./http-client";

export interface PaginaPublica {
  establishment: { name: string; slug: string; timezone: string };
  services: {
    id: string;
    name: string;
    description: string;
    durationMinutes: number;
    priceCents: number | null;
    priceVisible: boolean;
  }[];
  professionals: { id: string; name: string; initials: string; serviceIds: string[] }[];
}

export interface HorariosPublicos {
  date: string;
  timezone: string;
  slots: { startAt: string; localStart: string; offsetLabel: string }[];
  emptyReason: string | null;
}

export interface ReciboPedido {
  status: "PENDING" | "CONFIRMED" | "CANCELED" | "IN_PROGRESS" | "COMPLETED" | "NO_SHOW";
  startAt: string;
  localDate: string;
  localStart: string;
  timezone: string;
  serviceName: string;
  professionalName: string;
  establishmentName: string;
  replayed: boolean;
}

export interface DadosPedidoPublico {
  serviceId: string;
  professionalId: string;
  startAt: string;
  name: string;
  whatsapp: string;
  idempotencyKey: string;
}

export type FalhaPublica =
  /** 404: página inexistente, desligada ou estabelecimento inativo. */
  | { tipo: "nao_encontrada" }
  /** 400: opção indisponível ou dado recusado. */
  | { tipo: "recusado"; mensagem: string | null }
  /** 409: horário ocupado, ou chave de envio usada com outros dados. */
  | { tipo: "conflito"; mensagem: string | null }
  /** 429: limite de tentativas. */
  | { tipo: "limite"; mensagem: string | null }
  /** Leitura: sem resposta ou resposta ilegível. */
  | { tipo: "falha_comunicacao" }
  /** Envio: não dá para saber se foi gravado. */
  | { tipo: "incerto" };

export type ResultadoPublico<T> = { ok: true; dados: T } | { ok: false; falha: FalhaPublica };

function mensagemDe(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const m = (data as Record<string, unknown>).message;
  return typeof m === "string" ? m : null;
}

function falhaHttp(status: number, data: unknown): FalhaPublica | null {
  if (status === 404) return { tipo: "nao_encontrada" };
  if (status === 400) return { tipo: "recusado", mensagem: mensagemDe(data) };
  if (status === 409) return { tipo: "conflito", mensagem: mensagemDe(data) };
  if (status === 429) return { tipo: "limite", mensagem: mensagemDe(data) };
  return null;
}

const base = (slug: string) => `/public/${encodeURIComponent(slug)}`;

function ehPagina(v: unknown): v is PaginaPublica {
  if (typeof v !== "object" || v === null) return false;
  const p = v as Record<string, unknown>;
  const e = p.establishment as Record<string, unknown> | undefined;
  return (
    typeof e?.name === "string" &&
    typeof e?.timezone === "string" &&
    Array.isArray(p.services) &&
    Array.isArray(p.professionals)
  );
}

function ehHorarios(v: unknown): v is HorariosPublicos {
  if (typeof v !== "object" || v === null) return false;
  const h = v as Record<string, unknown>;
  return (
    typeof h.date === "string" &&
    typeof h.timezone === "string" &&
    Array.isArray(h.slots) &&
    h.slots.every(
      (s) =>
        typeof s === "object" &&
        s !== null &&
        typeof (s as Record<string, unknown>).startAt === "string" &&
        typeof (s as Record<string, unknown>).localStart === "string",
    )
  );
}

function ehRecibo(v: unknown): v is ReciboPedido {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.status === "string" &&
    typeof r.localDate === "string" &&
    typeof r.localStart === "string" &&
    typeof r.establishmentName === "string" &&
    typeof r.replayed === "boolean"
  );
}

export async function obterPaginaPublica(
  slug: string,
  signal?: AbortSignal,
): Promise<ResultadoPublico<PaginaPublica>> {
  const r = await apiRequest<unknown>(base(slug), { signal });
  if (r.kind === "network-error") return { ok: false, falha: { tipo: "falha_comunicacao" } };
  if (r.kind === "http-error") {
    return { ok: false, falha: falhaHttp(r.status, r.data) ?? { tipo: "falha_comunicacao" } };
  }
  const corpo = r.data as { profile?: unknown };
  if (!ehPagina(corpo?.profile)) return { ok: false, falha: { tipo: "falha_comunicacao" } };
  return { ok: true, dados: corpo.profile };
}

export async function consultarHorariosPublicos(
  slug: string,
  consulta: { serviceId: string; professionalId: string; date: string },
  signal?: AbortSignal,
): Promise<ResultadoPublico<HorariosPublicos>> {
  const q = new URLSearchParams(consulta).toString();
  const r = await apiRequest<unknown>(`${base(slug)}/availability?${q}`, { signal });
  if (r.kind === "network-error") return { ok: false, falha: { tipo: "falha_comunicacao" } };
  if (r.kind === "http-error") {
    return { ok: false, falha: falhaHttp(r.status, r.data) ?? { tipo: "falha_comunicacao" } };
  }
  const corpo = r.data as { availability?: unknown };
  if (!ehHorarios(corpo?.availability)) return { ok: false, falha: { tipo: "falha_comunicacao" } };
  return { ok: true, dados: corpo.availability };
}

export async function enviarPedidoPublico(
  slug: string,
  dados: DadosPedidoPublico,
): Promise<ResultadoPublico<ReciboPedido>> {
  const r = await apiRequest<unknown>(`${base(slug)}/booking-requests`, {
    method: "POST",
    body: dados,
  });
  if (r.kind === "network-error") return { ok: false, falha: { tipo: "incerto" } };
  if (r.kind === "http-error") {
    return { ok: false, falha: falhaHttp(r.status, r.data) ?? { tipo: "incerto" } };
  }
  const corpo = r.data as { request?: unknown };
  // Resposta 2xx ilegível: o servidor aceitou algo, mas não sabemos o quê.
  if (!ehRecibo(corpo?.request)) return { ok: false, falha: { tipo: "incerto" } };
  return { ok: true, dados: corpo.request };
}
