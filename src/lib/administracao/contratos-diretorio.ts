// Contratos da Visão geral (`GET /platform/overview`) e dos campos comerciais
// da listagem (`GET /platform/establishments`), com a conferência do que a
// API devolve. As regras ficam no servidor (backend/src/platform/
// portal-overview.ts); a tela só apresenta.
import { ehListaEstabelecimentos, type EstabelecimentoAdministrado, type ListaEstabelecimentos } from "./contratos";
import type { Ciclo, EstadoComercial, TipoDePeriodo } from "./contratos-validade";

/** Acesso efetivo agora: situação administrativa e validade, na mesma regra
 * da operação. */
export type AcessoEfetivo = "ALLOWED" | "BLOCKED_STATUS" | "BLOCKED_VALIDITY";

export interface AcessoNaLista {
  state: EstadoComercial;
  legacy: boolean;
  noExpiry: boolean;
  blocked: boolean;
  validUntil: string | null;
  /** Último dia coberto (`YYYY-MM-DD`, fuso do estabelecimento), com as
   * renovações já registradas. */
  lastDay: string | null;
  /** Dias de hoje até o último dia coberto (0: termina hoje). */
  daysLeft: number | null;
  expiredAt: string | null;
  expiredKind: TipoDePeriodo | null;
  operational: "ACTIVE" | "INACTIVE";
  effective: AcessoEfetivo;
}

export interface CondicaoDoCiclo {
  cycle: Ciclo;
  catalogCents: number | null;
  contractCents: number | null;
  suggestedCents: number | null;
  source: "CONTRACT" | "CATALOG" | "PENDING";
}

export interface CondicaoComercial {
  /** Ciclo da última condição registrada para o plano atual; nunca vem do
   * último pagamento. */
  agreedCycle: Ciclo | null;
  cycles: CondicaoDoCiclo[];
  /** Sem valor contratado específico no plano atual, em nenhum ciclo. */
  contractPending: boolean;
}

export interface ItemDoDiretorio extends EstabelecimentoAdministrado {
  operational: "ACTIVE" | "INACTIVE";
  access: AcessoNaLista;
  commercial: CondicaoComercial;
}

/** Alcance pela marca `tenants.is_test`: clientes (padrão do servidor),
 * internos/teste ou todos. */
export const ESCOPOS_DO_DIRETORIO = ["CLIENTS", "INTERNAL", "ALL"] as const;
export type EscopoDoDiretorio = (typeof ESCOPOS_DO_DIRETORIO)[number];
export const ESCOPO_PADRAO: EscopoDoDiretorio = "CLIENTS";

export interface ListaDoDiretorio extends Omit<ListaEstabelecimentos, "items"> {
  items: ItemDoDiretorio[];
  /** Alcance que o servidor aplicou. Ausente numa API anterior ao alcance:
   * a lista então NÃO está confirmada como só de clientes. */
  scope?: EscopoDoDiretorio;
}

export const FILTROS_DO_DIRETORIO = [
  "ACCESS_ALLOWED",
  "ACCESS_BLOCKED",
  "EXPIRING_SOON",
  "VALIDITY_BLOCKED",
  "CONTRACT_PENDING",
] as const;
export type FiltroDoDiretorio = (typeof FILTROS_DO_DIRETORIO)[number];

export type MotivoDeAtencao = "VALIDITY_BLOCKED" | "EXPIRING_SOON";

export interface VisaoGeral {
  generatedAt: string;
  /** Alcance de todos os números. Ausente numa API anterior: os números são
   * de todos os cadastrados, sem confirmação de recorte. */
  scope?: EscopoDoDiretorio;
  establishments: {
    total: number;
    allowed: number;
    blocked: number;
    blockedByStatus: number;
    blockedByValidity: number;
    expiringSoon: number;
    validityBlocked: number;
    suspended: number;
    contractPending: number;
    byState: Record<EstadoComercial, number>;
  };
  payments: {
    timeZone: string;
    month: string;
    from: string;
    to: string;
    currency: "BRL";
    count: number;
    totalCents: number;
    canceledCount: number;
  };
  attention: {
    total: number;
    byReason: Record<MotivoDeAtencao, number>;
    items: {
      tenant: { id: string; name: string; timezone: string };
      reason: MotivoDeAtencao;
      state: EstadoComercial;
      lastDay: string | null;
      daysLeft: number | null;
      expiredAt: string | null;
    }[];
  };
}

const ESTADOS: readonly EstadoComercial[] = ["NO_EXPIRY", "UNTRACKED", "MISSING", "TRIAL", "PAID", "COURTESY", "EXPIRED"];
const objeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const texto = (v: unknown): v is string => typeof v === "string";
const inteiro = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const relativo = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);
const dia = (v: unknown): v is string => texto(v) && /^\d{4}-\d{2}-\d{2}$/.test(v);
const data = (v: unknown): v is string => texto(v) && Number.isFinite(Date.parse(v));
const ou = (teste: (v: unknown) => boolean) => (v: unknown) => v === null || teste(v);
const estado = (v: unknown): v is EstadoComercial => ESTADOS.includes(v as EstadoComercial);

function ehAcessoNaLista(v: unknown): v is AcessoNaLista {
  return (
    objeto(v) &&
    estado(v.state) &&
    typeof v.legacy === "boolean" &&
    typeof v.noExpiry === "boolean" &&
    typeof v.blocked === "boolean" &&
    ou(data)(v.validUntil) &&
    ou(dia)(v.lastDay) &&
    ou(relativo)(v.daysLeft) &&
    ou(data)(v.expiredAt) &&
    (v.expiredKind === null || ["TRIAL", "PAID", "COURTESY"].includes(v.expiredKind as string)) &&
    (v.operational === "ACTIVE" || v.operational === "INACTIVE") &&
    ["ALLOWED", "BLOCKED_STATUS", "BLOCKED_VALIDITY"].includes(v.effective as string)
  );
}

function ehCondicao(v: unknown): v is CondicaoComercial {
  return (
    objeto(v) &&
    (v.agreedCycle === null || v.agreedCycle === "MONTHLY" || v.agreedCycle === "QUARTERLY") &&
    typeof v.contractPending === "boolean" &&
    Array.isArray(v.cycles) &&
    v.cycles.every(
      (c: unknown) =>
        objeto(c) &&
        (c.cycle === "MONTHLY" || c.cycle === "QUARTERLY") &&
        ou(inteiro)(c.catalogCents) &&
        ou(inteiro)(c.contractCents) &&
        ou(inteiro)(c.suggestedCents) &&
        ["CONTRACT", "CATALOG", "PENDING"].includes(c.source as string) &&
        (c.source === "PENDING") === (c.suggestedCents === null),
    )
  );
}

const escopoOuAusente = (v: unknown) => v === undefined || ESCOPOS_DO_DIRETORIO.includes(v as EscopoDoDiretorio);

export function ehListaDoDiretorio(v: unknown): v is ListaDoDiretorio {
  return (
    ehListaEstabelecimentos(v) &&
    escopoOuAusente((v as unknown as Record<string, unknown>).scope) &&
    v.items.every((i) => {
      const item = i as unknown as Record<string, unknown>;
      return (
        (item.operational === "ACTIVE" || item.operational === "INACTIVE") &&
        ehAcessoNaLista(item.access) &&
        ehCondicao(item.commercial)
      );
    })
  );
}

export function ehVisaoGeral(v: unknown): v is VisaoGeral {
  if (!objeto(v) || !data(v.generatedAt) || !escopoOuAusente(v.scope)) return false;
  const e = v.establishments,
    p = v.payments,
    a = v.attention;
  return (
    objeto(e) &&
    [
      e.total,
      e.allowed,
      e.blocked,
      e.blockedByStatus,
      e.blockedByValidity,
      e.expiringSoon,
      e.validityBlocked,
      e.suspended,
      e.contractPending,
    ].every(inteiro) &&
    objeto(e.byState) &&
    ESTADOS.every((s) => inteiro((e.byState as Record<string, unknown>)[s])) &&
    objeto(p) &&
    texto(p.timeZone) &&
    texto(p.month) &&
    /^\d{4}-\d{2}$/.test(p.month) &&
    dia(p.from) &&
    dia(p.to) &&
    p.currency === "BRL" &&
    [p.count, p.totalCents, p.canceledCount].every(inteiro) &&
    objeto(a) &&
    inteiro(a.total) &&
    objeto(a.byReason) &&
    inteiro(a.byReason.VALIDITY_BLOCKED) &&
    inteiro(a.byReason.EXPIRING_SOON) &&
    Array.isArray(a.items) &&
    a.items.every(
      (i: unknown) =>
        objeto(i) &&
        objeto(i.tenant) &&
        texto(i.tenant.id) &&
        texto(i.tenant.name) &&
        texto(i.tenant.timezone) &&
        (i.reason === "VALIDITY_BLOCKED" || i.reason === "EXPIRING_SOON") &&
        estado(i.state) &&
        ou(dia)(i.lastDay) &&
        ou(relativo)(i.daysLeft) &&
        ou(data)(i.expiredAt),
    )
  );
}
