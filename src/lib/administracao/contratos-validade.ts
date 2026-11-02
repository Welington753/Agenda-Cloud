// Contratos da validade do acesso (assinatura do Agenda Cloud) na ficha do
// estabelecimento, com a conferência do que a API devolve. Separados de
// contratos.ts, que reexporta tudo daqui.

/**
 * - `UNTRACKED`: anterior ao controle e sem período: "Validade ainda não
 *   definida". Opera como antes até a regularização individual.
 * - `MISSING`: sem período e sem a marca de anterior: bloqueado.
 */
export type EstadoComercial = "UNTRACKED" | "MISSING" | "TRIAL" | "PAID" | "COURTESY" | "EXPIRED";
export type TipoDePeriodo = "TRIAL" | "PAID" | "COURTESY";
export interface SituacaoComercial {
  state: EstadoComercial;
  /** Marcado como anterior ao controle de validade. Ausente numa API
   * anterior. */
  legacy?: boolean;
  blocked: boolean;
  /** Fim (exclusivo) da validade contínua, com as renovações registradas. */
  validUntil: string | null;
  /** Último dia coberto, `YYYY-MM-DD` na data local do estabelecimento. */
  lastDay: string | null;
  expiredAt: string | null;
  expiredKind: TipoDePeriodo | null;
}

/** Como fica a validade se o registro for anulado (calculado no servidor). */
export type PreviaDaCorrecao =
  | { allowed: true; after: { state: EstadoComercial; blocked: boolean; validUntil: string | null } }
  | { allowed: false; blockedByPeriodId: string };

export interface PeriodoDeAcesso {
  id: string;
  kind: TipoDePeriodo;
  plan: { id: string; name: string };
  startsAt: string;
  endsAt: string;
  firstDay: string;
  lastDay: string;
  cycle: "MONTHLY" | "QUARTERLY" | null;
  amountCents: number | null;
  currency: string | null;
  paymentMethod: string | null;
  receivedOn: string | null;
  reference: string | null;
  confirmationSource: "MANUAL" | null;
  reason: string | null;
  recordedAt: string;
  recordedBy: { id: string; name: string };
  /** Anulado por correção: o registro continua no histórico, marcado. */
  canceled?: { at: string; by: { id: string; name: string }; reason: string } | null;
  /** Só para quem pode corrigir; `null` num registro já anulado. */
  correction?: PreviaDaCorrecao | null;
}

const ESTADOS_COMERCIAIS = ["UNTRACKED", "MISSING", "TRIAL", "PAID", "COURTESY", "EXPIRED"];
const TIPOS_DE_PERIODO = ["TRIAL", "PAID", "COURTESY"];

const objeto = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const texto = (value: unknown): value is string => typeof value === "string";
const inteiro = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const data = (value: unknown): value is string => texto(value) && Number.isFinite(Date.parse(value));
const dia = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
const talvez =
  <T,>(teste: (v: unknown) => v is T) =>
  (value: unknown): value is T | null =>
    value === null || teste(value);

export function ehSituacaoComercial(value: unknown): value is SituacaoComercial {
  return (
    objeto(value) &&
    ESTADOS_COMERCIAIS.includes(value.state as string) &&
    (value.legacy === undefined || typeof value.legacy === "boolean") &&
    typeof value.blocked === "boolean" &&
    talvez(data)(value.validUntil) &&
    talvez(dia)(value.lastDay) &&
    talvez(data)(value.expiredAt) &&
    (value.expiredKind === null || TIPOS_DE_PERIODO.includes(value.expiredKind as string))
  );
}

function ehAnulacao(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (objeto(value) && data(value.at) && objeto(value.by) && texto(value.by.id) && texto(value.by.name) && texto(value.reason))
  );
}

function ehPrevia(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (!objeto(value)) return false;
  if (value.allowed === false) return texto(value.blockedByPeriodId);
  return (
    value.allowed === true &&
    objeto(value.after) &&
    ESTADOS_COMERCIAIS.includes(value.after.state as string) &&
    typeof value.after.blocked === "boolean" &&
    talvez(data)(value.after.validUntil)
  );
}

export function ehPeriodoDeAcesso(value: unknown): value is PeriodoDeAcesso {
  return (
    objeto(value) &&
    texto(value.id) &&
    TIPOS_DE_PERIODO.includes(value.kind as string) &&
    objeto(value.plan) &&
    texto(value.plan.id) &&
    texto(value.plan.name) &&
    data(value.startsAt) &&
    data(value.endsAt) &&
    dia(value.firstDay) &&
    dia(value.lastDay) &&
    (value.cycle === null || value.cycle === "MONTHLY" || value.cycle === "QUARTERLY") &&
    talvez(inteiro)(value.amountCents) &&
    talvez(texto)(value.currency) &&
    talvez(texto)(value.paymentMethod) &&
    talvez(dia)(value.receivedOn) &&
    talvez(texto)(value.reference) &&
    (value.confirmationSource === null || value.confirmationSource === "MANUAL") &&
    talvez(texto)(value.reason) &&
    data(value.recordedAt) &&
    objeto(value.recordedBy) &&
    texto(value.recordedBy.id) &&
    texto(value.recordedBy.name) &&
    ehAnulacao(value.canceled) &&
    ehPrevia(value.correction)
  );
}
