// Contrato do extrato dos pagamentos das assinaturas
// (`GET /platform/subscription-payments`), com a conferência do que a API
// devolve. Reexportado por contratos-validade.ts (e por contratos.ts).
import type { Ciclo, OrigemDoValor } from "./contratos-validade";

const CICLOS_VALIDOS = ["MONTHLY", "QUARTERLY"];
const objeto = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const texto = (value: unknown): value is string => typeof value === "string";
const inteiro = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const data = (value: unknown): value is string => texto(value) && Number.isFinite(Date.parse(value));
const dia = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
const talvez =
  <T,>(teste: (v: unknown) => v is T) =>
  (value: unknown): value is T | null =>
    value === null || teste(value);
const pessoa = (value: unknown) => objeto(value) && texto(value.id) && texto(value.name);

/** Pagamento de assinatura na lista do portal. */
export interface PagamentoDeAssinatura {
  id: string;
  tenant: { id: string; name: string };
  planName: string;
  cycle: Ciclo;
  amountCents: number;
  amountSource: OrigemDoValor | null;
  paymentMethod: string;
  receivedOn: string;
  reference: string | null;
  startsAt: string;
  endsAt: string;
  recordedAt: string;
  recordedBy: string;
  canceled: { at: string; reason: string | null } | null;
}
export interface ListaDePagamentos {
  items: PagamentoDeAssinatura[];
  total: number;
  page: number;
  pageSize: number;
  /** Filtros aplicados, ecoados pela API (`null`: sem restrição). Ausentes
   * numa API anterior: a tela não afirma filtro nenhum. */
  from?: string | null;
  to?: string | null;
  scope?: "CLIENTS" | "INTERNAL" | "ALL";
  status?: "RECEIVED" | "CANCELED" | null;
}

export function ehListaDePagamentos(value: unknown): value is ListaDePagamentos {
  return (
    objeto(value) &&
    [value.from, value.to].every((d) => d === undefined || d === null || dia(d)) &&
    [undefined, "CLIENTS", "INTERNAL", "ALL"].includes(value.scope as string) &&
    [undefined, null, "RECEIVED", "CANCELED"].includes(value.status as string) &&
    inteiro(value.total) &&
    inteiro(value.page) &&
    inteiro(value.pageSize) &&
    Array.isArray(value.items) &&
    value.items.every(
      (i: unknown) =>
        objeto(i) &&
        texto(i.id) &&
        pessoa(i.tenant) &&
        texto(i.planName) &&
        CICLOS_VALIDOS.includes(i.cycle as string) &&
        inteiro(i.amountCents) &&
        (i.amountSource === null || ["CONTRACT", "CATALOG", "ADJUSTED"].includes(i.amountSource as string)) &&
        texto(i.paymentMethod) &&
        dia(i.receivedOn) &&
        talvez(texto)(i.reference) &&
        data(i.startsAt) &&
        data(i.endsAt) &&
        data(i.recordedAt) &&
        texto(i.recordedBy) &&
        (i.canceled === null || (objeto(i.canceled) && data(i.canceled.at))),
    )
  );
}
