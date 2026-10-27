// Cliente tipado dos recebimentos manuais — espelha
// backend/src/payments. Valores sempre em centavos inteiros; datas locais
// `YYYY-MM-DD` do estabelecimento.
import { apiRequest } from "./http-client";

export const FORMAS_DE_PAGAMENTO = ["PIX", "DINHEIRO", "CARTAO_DEBITO", "CARTAO_CREDITO", "TRANSFERENCIA", "OUTRO"] as const;
export type FormaDePagamento = (typeof FORMAS_DE_PAGAMENTO)[number];

export const ROTULO_FORMA: Record<FormaDePagamento, string> = {
  PIX: "Pix",
  DINHEIRO: "Dinheiro",
  CARTAO_DEBITO: "Cartão de débito",
  CARTAO_CREDITO: "Cartão de crédito",
  TRANSFERENCIA: "Transferência",
  OUTRO: "Outra",
};

/** Mesmo teto do servidor (`MAIOR_VALOR_EM_CENTAVOS`). */
export const MAIOR_VALOR_EM_CENTAVOS = 100_000_000;

export interface ResumoFinanceiro {
  receivedCents: number;
  refundedCents: number;
  netCents: number;
  paidAppointments: number;
  paidTotalCents: number;
  averageTicketCents: number | null;
}

export interface Recebimento {
  id: string;
  appointmentId: string;
  amountCents: number;
  method: FormaDePagamento;
  receivedOn: string;
  recordedAt: string;
  recordedBy: { id: string; name: string };
  notes: string | null;
  refund: { refundedOn: string; refundedAt: string; reason: string; refundedBy: { id: string; name: string } } | null;
  appointment: {
    localDate: string;
    localStart: string;
    status: string;
    consumerName: string;
    serviceName: string;
    professionalName: string;
  };
}

export interface AtendimentoAQuitar {
  id: string;
  startAt: string;
  localDate: string;
  status: string;
  consumerName: string;
  serviceName: string;
  professionalName: string;
  /** Preço da reserva: só sugestão, não é dinheiro recebido. */
  bookedPriceCents: number | null;
}

export interface Recebimentos {
  timezone: string;
  period: { from: string; to: string };
  summary: ResumoFinanceiro;
  payments: Recebimento[];
  paymentsComplete: boolean;
  awaitingPayment: AtendimentoAQuitar[];
  awaitingComplete: boolean;
}

const objeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const texto = (v: unknown): v is string => typeof v === "string";
const numero = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function ehResumoFinanceiro(v: unknown): v is ResumoFinanceiro {
  return (
    objeto(v) &&
    ["receivedCents", "refundedCents", "netCents", "paidAppointments", "paidTotalCents"].every((k) => numero(v[k])) &&
    (v.averageTicketCents === null || numero(v.averageTicketCents))
  );
}

export function ehRecebimento(v: unknown): v is Recebimento {
  if (!objeto(v) || !objeto(v.appointment) || !objeto(v.recordedBy)) return false;
  if (![v.id, v.appointmentId, v.receivedOn, v.recordedAt].every(texto) || !numero(v.amountCents)) return false;
  if (!(FORMAS_DE_PAGAMENTO as readonly unknown[]).includes(v.method)) return false;
  if (v.refund !== null && !(objeto(v.refund) && texto(v.refund.refundedOn) && texto(v.refund.reason))) return false;
  return texto(v.appointment.localDate) && texto(v.appointment.consumerName);
}

function ehAQuitar(v: unknown): v is AtendimentoAQuitar {
  return (
    objeto(v) &&
    [v.id, v.startAt, v.localDate, v.status, v.consumerName, v.serviceName, v.professionalName].every(texto) &&
    (v.bookedPriceCents === null || numero(v.bookedPriceCents))
  );
}

export function ehRecebimentos(v: unknown): v is Recebimentos {
  return (
    objeto(v) &&
    texto(v.timezone) &&
    objeto(v.period) &&
    ehResumoFinanceiro(v.summary) &&
    Array.isArray(v.payments) &&
    v.payments.every(ehRecebimento) &&
    typeof v.paymentsComplete === "boolean" &&
    Array.isArray(v.awaitingPayment) &&
    v.awaitingPayment.every(ehAQuitar) &&
    typeof v.awaitingComplete === "boolean"
  );
}

export function ehRegistroDeRecebimento(v: unknown): v is { created: boolean; payment: Recebimento } {
  return objeto(v) && typeof v.created === "boolean" && ehRecebimento(v.payment);
}

export const caminhoRecebimentos = (tenantId: string) => `/tenants/${encodeURIComponent(tenantId)}/payments`;

export function lerRecebimentos(tenantId: string, periodo: { from: string; to: string }) {
  return apiRequest<unknown>(`${caminhoRecebimentos(tenantId)}?from=${periodo.from}&to=${periodo.to}`, { method: "GET" });
}
