// Contratos da validade do acesso (assinatura do Agenda Cloud) na ficha do
// estabelecimento, com a conferência do que a API devolve. Separados de
// contratos.ts, que reexporta tudo daqui.

/**
 * - `NO_EXPIRY`: concessão "sem vencimento" em vigor (portal da plataforma).
 *   Não é pagamento nem recurso extra.
 * - `UNTRACKED`: anterior ao controle e sem período: "Validade ainda não
 *   definida". Opera como antes até a regularização individual.
 * - `MISSING`: sem período e sem a marca de anterior: bloqueado.
 */
export type EstadoComercial = "NO_EXPIRY" | "UNTRACKED" | "MISSING" | "TRIAL" | "PAID" | "COURTESY" | "EXPIRED";
export type Ciclo = "MONTHLY" | "QUARTERLY";
/** Origem do valor de um período pago. */
export type OrigemDoValor = "CONTRACT" | "CATALOG" | "ADJUSTED";
export type TipoDePeriodo = "TRIAL" | "PAID" | "COURTESY";
export interface SituacaoComercial {
  state: EstadoComercial;
  /** Marcado como anterior ao controle de validade. Ausente numa API
   * anterior. */
  legacy?: boolean;
  /** Concessão "sem vencimento" em vigor. Ausente numa API anterior. */
  noExpiry?: boolean;
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
  /** `null`: registrado antes do portal, sem origem gravada. Ausente numa API
   * anterior. */
  amountSource?: OrigemDoValor | null;
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

/** Preço de um ciclo para este cliente: o formulário de pagamento sugere
 * `suggestedCents`, com a origem. `PENDING`: nem contrato nem catálogo; nunca
 * vira zero nem gratuidade. */
export interface PrecoDoCiclo {
  cycle: Ciclo;
  catalogCents: number | null;
  contractCents: number | null;
  suggestedCents: number | null;
  source: "CONTRACT" | "CATALOG" | "PENDING";
}
export interface MudancaDePreco {
  id: string;
  planId: string;
  planName: string;
  cycle: Ciclo;
  amountCents: number | null;
  reason: string | null;
  recordedAt: string;
  recordedBy: { id: string; name: string };
}
export interface PrecoDoEstabelecimento {
  planId: string;
  preferredCycle: Ciclo | null;
  cycles: PrecoDoCiclo[];
  contractHistory: MudancaDePreco[];
}
export interface ConcessaoSemVencimento {
  id: string;
  grantedAt: string;
  grantedBy: { id: string; name: string };
  reason: string;
  revoked: { at: string; by: { id: string; name: string }; reason: string } | null;
}
export interface SemVencimento {
  active: ConcessaoSemVencimento | null;
  history: ConcessaoSemVencimento[];
  /** Como fica a validade se a concessão em vigor for retirada agora
   * (calculado no servidor). */
  revokePreview: {
    state: EstadoComercial;
    blocked: boolean;
    validUntil: string | null;
    lastDay: string | null;
    expiredAt: string | null;
  } | null;
}

const ESTADOS_COMERCIAIS = ["NO_EXPIRY", "UNTRACKED", "MISSING", "TRIAL", "PAID", "COURTESY", "EXPIRED"];
const CICLOS_VALIDOS = ["MONTHLY", "QUARTERLY"];
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
    (value.noExpiry === undefined || typeof value.noExpiry === "boolean") &&
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
    (value.amountSource === undefined ||
      value.amountSource === null ||
      ["CONTRACT", "CATALOG", "ADJUSTED"].includes(value.amountSource as string)) &&
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

const pessoa = (value: unknown) => objeto(value) && texto(value.id) && texto(value.name);

export function ehMudancaDePreco(value: unknown): value is MudancaDePreco {
  return (
    objeto(value) &&
    texto(value.id) &&
    texto(value.planId) &&
    texto(value.planName) &&
    CICLOS_VALIDOS.includes(value.cycle as string) &&
    talvez(inteiro)(value.amountCents) &&
    talvez(texto)(value.reason) &&
    data(value.recordedAt) &&
    pessoa(value.recordedBy)
  );
}

function ehPrecoDoCiclo(value: unknown): value is PrecoDoCiclo {
  return (
    objeto(value) &&
    CICLOS_VALIDOS.includes(value.cycle as string) &&
    talvez(inteiro)(value.catalogCents) &&
    talvez(inteiro)(value.contractCents) &&
    talvez(inteiro)(value.suggestedCents) &&
    ["CONTRACT", "CATALOG", "PENDING"].includes(value.source as string) &&
    (value.source === "PENDING") === (value.suggestedCents === null)
  );
}

export function ehPrecoDoEstabelecimento(value: unknown): value is PrecoDoEstabelecimento {
  return (
    objeto(value) &&
    texto(value.planId) &&
    (value.preferredCycle === null || CICLOS_VALIDOS.includes(value.preferredCycle as string)) &&
    Array.isArray(value.cycles) &&
    value.cycles.every(ehPrecoDoCiclo) &&
    Array.isArray(value.contractHistory) &&
    value.contractHistory.every(ehMudancaDePreco)
  );
}

function ehConcessao(value: unknown): value is ConcessaoSemVencimento {
  return (
    objeto(value) &&
    texto(value.id) &&
    data(value.grantedAt) &&
    pessoa(value.grantedBy) &&
    texto(value.reason) &&
    (value.revoked === null ||
      (objeto(value.revoked) && data(value.revoked.at) && pessoa(value.revoked.by) && texto(value.revoked.reason)))
  );
}

export function ehSemVencimento(value: unknown): value is SemVencimento {
  if (!objeto(value) || !(value.active === null || ehConcessao(value.active))) return false;
  if (!Array.isArray(value.history) || !value.history.every(ehConcessao)) return false;
  const p = value.revokePreview;
  return (
    p === null ||
    (objeto(p) &&
      ESTADOS_COMERCIAIS.includes(p.state as string) &&
      typeof p.blocked === "boolean" &&
      talvez(data)(p.validUntil) &&
      talvez(dia)(p.lastDay) &&
      talvez(data)(p.expiredAt))
  );
}

/** Catálogo de preços do portal (`GET /platform/prices`). `current: null`:
 * preço pendente. */
export interface CatalogoDePrecos {
  items: {
    id: string;
    code: string;
    name: string;
    maxProfessionals: number;
    prices: { cycle: Ciclo; current: MudancaDePreco | null }[];
  }[];
  history: MudancaDePreco[];
  canManage: boolean;
}

export function ehCatalogoDePrecos(value: unknown): value is CatalogoDePrecos {
  return (
    objeto(value) &&
    typeof value.canManage === "boolean" &&
    Array.isArray(value.history) &&
    value.history.every(ehMudancaDePreco) &&
    Array.isArray(value.items) &&
    value.items.every(
      (p: unknown) =>
        objeto(p) &&
        texto(p.id) &&
        texto(p.code) &&
        texto(p.name) &&
        inteiro(p.maxProfessionals) &&
        Array.isArray(p.prices) &&
        p.prices.every(
          (c: unknown) =>
            objeto(c) && CICLOS_VALIDOS.includes(c.cycle as string) && (c.current === null || ehMudancaDePreco(c.current)),
        ),
    )
  );
}

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
}

export function ehListaDePagamentos(value: unknown): value is ListaDePagamentos {
  return (
    objeto(value) &&
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
