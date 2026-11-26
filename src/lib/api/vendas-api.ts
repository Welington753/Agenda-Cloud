// Cliente das rotas de vendas (backend/src/sales/sales.controller.ts). Só
// tipos, validação da forma de cada resposta, caminhos e corpos: as leituras
// passam por useLeituraPlataforma e as escritas por acaoAdministrativa
// (lib/administracao/api-contas.ts), que classifica a recusa pelo status e
// pelo `code`, nunca pelo texto.
//
// Valores em centavos inteiros e quantidades em milésimos. Venda e
// recebimento são operações separadas: o valor vendido (`totalCents`) não é
// dinheiro recebido (`payments`). Nada aqui reenvia sozinho.
import type { UnidadeEstoque } from "@/lib/estoque/quantidade";
import { FORMAS_DE_PAGAMENTO, type FormaDePagamento } from "./recebimentos-api";

export type SituacaoDaVenda = "ATIVA" | "CANCELADA";
export type EscopoDeVendas = "mine" | "all";

export interface Pessoa {
  id: string;
  name: string;
}

export interface ProdutoParaVenda {
  id: string;
  name: string;
  unit: UnidadeEstoque;
  /** `null`: sem preço sugerido (só quem pode alterar o preço vende). */
  salePriceCents: number | null;
  available: boolean;
  /** Só para quem vê o estoque (`showsBalance`). */
  balanceMilli?: number;
}

export interface CatalogoDeVenda {
  products: ProdutoParaVenda[];
  showsBalance: boolean;
  nextCursor: string | null;
}

/** Resultado da busca limitada: nunca e-mail nem telefone inteiro. */
export interface ClienteDaBusca {
  id: string;
  name: string;
  phoneLast4: string | null;
}

export interface ItemDaVenda {
  position: number;
  productId: string;
  productName: string;
  unit: UnidadeEstoque;
  quantityMilli: number;
  unitPriceCents: number;
  suggestedPriceCents: number | null;
  lineTotalCents: number;
}

export interface RecebimentoDeVenda {
  id: string;
  saleId: string;
  amountCents: number;
  method: FormaDePagamento;
  receivedOn: string;
  recordedAt: string;
  recordedBy: Pessoa;
  notes: string | null;
  refund: { refundedOn: string; refundedAt: string; reason: string; refundedBy: Pessoa } | null;
}

export interface Venda {
  id: string;
  status: SituacaoDaVenda;
  totalCents: number;
  recordedAt: string;
  localDate: string;
  recordedBy: Pessoa;
  consumer: Pessoa | null;
  items: ItemDaVenda[];
  payments: RecebimentoDeVenda[];
  activePaymentId: string | null;
  cancellation: { cancelledAt: string; reason: string; cancelledBy: Pessoa } | null;
}

export interface ResumoDeVenda {
  id: string;
  status: SituacaoDaVenda;
  totalCents: number;
  recordedAt: string;
  localDate: string;
  recordedBy: Pessoa;
  consumer: Pessoa | null;
  items: { productName: string; quantityMilli: number; unit: UnidadeEstoque }[];
  /** O recebimento ativo ou, sem ativo, o último estornado. */
  payment: { id: string; amountCents: number; method: FormaDePagamento; receivedOn: string; refunded: boolean } | null;
}

export interface ListaDeVendas {
  scope: EscopoDeVendas;
  timezone: string;
  period: { from: string; to: string };
  /** Valor vendido do período (vendas ativas): não é dinheiro recebido. */
  summary: { activeSales: number; soldCents: number; cancelledSales: number };
  sales: ResumoDeVenda[];
  nextCursor: string | null;
}

export interface ListaDeRecebimentosDeVendas {
  scope: EscopoDeVendas;
  timezone: string;
  period: { from: string; to: string };
  summary: { receivedCents: number; refundedCents: number; netCents: number };
  payments: RecebimentoDeVenda[];
  complete: boolean;
}

export interface ComprasDoCliente {
  purchases: ResumoDeVenda[];
  nextCursor: string | null;
}

// ---------------------------------------------------------------- validação

const objeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const texto = (v: unknown): v is string => typeof v === "string";
const inteiro = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);
const talvez = <T>(guarda: (v: unknown) => v is T) => (v: unknown): v is T | null => v === null || guarda(v);
const SITUACOES: readonly unknown[] = ["ATIVA", "CANCELADA"];
const UNIDADES: readonly unknown[] = ["UN", "CX", "PCT", "FR", "G", "ML", "KG", "L"];
const ehForma = (v: unknown): v is FormaDePagamento => (FORMAS_DE_PAGAMENTO as readonly unknown[]).includes(v);
const ehPessoa = (v: unknown): v is Pessoa => objeto(v) && texto(v.id) && texto(v.name);
const ehPeriodo = (v: unknown): v is { from: string; to: string } => objeto(v) && texto(v.from) && texto(v.to);
const ehEscopo = (v: unknown): v is EscopoDeVendas => v === "mine" || v === "all";

export function ehProdutoParaVenda(v: unknown): v is ProdutoParaVenda {
  return (
    objeto(v) &&
    texto(v.id) &&
    texto(v.name) &&
    UNIDADES.includes(v.unit) &&
    talvez(inteiro)(v.salePriceCents) &&
    typeof v.available === "boolean" &&
    (v.balanceMilli === undefined || inteiro(v.balanceMilli))
  );
}

export function ehCatalogoDeVenda(v: unknown): v is CatalogoDeVenda {
  return (
    objeto(v) &&
    Array.isArray(v.products) &&
    v.products.every(ehProdutoParaVenda) &&
    typeof v.showsBalance === "boolean" &&
    talvez(texto)(v.nextCursor)
  );
}

export function ehClienteDaBusca(v: unknown): v is ClienteDaBusca {
  return objeto(v) && texto(v.id) && texto(v.name) && (v.phoneLast4 === null || (texto(v.phoneLast4) && /^\d{4}$/.test(v.phoneLast4)));
}

export function ehBuscaDeClientes(v: unknown): v is { consumers: ClienteDaBusca[] } {
  return objeto(v) && Array.isArray(v.consumers) && v.consumers.every(ehClienteDaBusca);
}

export function ehRecebimentoDeVenda(v: unknown): v is RecebimentoDeVenda {
  return (
    objeto(v) &&
    texto(v.id) &&
    texto(v.saleId) &&
    inteiro(v.amountCents) &&
    ehForma(v.method) &&
    texto(v.receivedOn) &&
    texto(v.recordedAt) &&
    ehPessoa(v.recordedBy) &&
    talvez(texto)(v.notes) &&
    (v.refund === null ||
      (objeto(v.refund) && texto(v.refund.refundedOn) && texto(v.refund.reason) && ehPessoa(v.refund.refundedBy)))
  );
}

function ehItemDaVenda(v: unknown): v is ItemDaVenda {
  return (
    objeto(v) &&
    inteiro(v.position) &&
    texto(v.productId) &&
    texto(v.productName) &&
    UNIDADES.includes(v.unit) &&
    inteiro(v.quantityMilli) &&
    inteiro(v.unitPriceCents) &&
    talvez(inteiro)(v.suggestedPriceCents) &&
    inteiro(v.lineTotalCents)
  );
}

export function ehVenda(v: unknown): v is Venda {
  return (
    objeto(v) &&
    texto(v.id) &&
    SITUACOES.includes(v.status) &&
    inteiro(v.totalCents) &&
    texto(v.recordedAt) &&
    texto(v.localDate) &&
    ehPessoa(v.recordedBy) &&
    talvez(ehPessoa)(v.consumer) &&
    Array.isArray(v.items) &&
    v.items.every(ehItemDaVenda) &&
    Array.isArray(v.payments) &&
    v.payments.every(ehRecebimentoDeVenda) &&
    talvez(texto)(v.activePaymentId) &&
    (v.cancellation === null || (objeto(v.cancellation) && texto(v.cancellation.reason) && ehPessoa(v.cancellation.cancelledBy)))
  );
}

export function ehResumoDeVenda(v: unknown): v is ResumoDeVenda {
  return (
    objeto(v) &&
    texto(v.id) &&
    SITUACOES.includes(v.status) &&
    inteiro(v.totalCents) &&
    texto(v.recordedAt) &&
    texto(v.localDate) &&
    ehPessoa(v.recordedBy) &&
    talvez(ehPessoa)(v.consumer) &&
    Array.isArray(v.items) &&
    v.items.every((i) => objeto(i) && texto(i.productName) && inteiro(i.quantityMilli) && UNIDADES.includes(i.unit)) &&
    (v.payment === null ||
      (objeto(v.payment) &&
        texto(v.payment.id) &&
        inteiro(v.payment.amountCents) &&
        ehForma(v.payment.method) &&
        texto(v.payment.receivedOn) &&
        typeof v.payment.refunded === "boolean"))
  );
}

export function ehListaDeVendas(v: unknown): v is ListaDeVendas {
  return (
    objeto(v) &&
    ehEscopo(v.scope) &&
    texto(v.timezone) &&
    ehPeriodo(v.period) &&
    objeto(v.summary) &&
    inteiro(v.summary.activeSales) &&
    inteiro(v.summary.soldCents) &&
    inteiro(v.summary.cancelledSales) &&
    Array.isArray(v.sales) &&
    v.sales.every(ehResumoDeVenda) &&
    talvez(texto)(v.nextCursor)
  );
}

export function ehListaDeRecebimentosDeVendas(v: unknown): v is ListaDeRecebimentosDeVendas {
  return (
    objeto(v) &&
    ehEscopo(v.scope) &&
    texto(v.timezone) &&
    ehPeriodo(v.period) &&
    objeto(v.summary) &&
    inteiro(v.summary.receivedCents) &&
    inteiro(v.summary.refundedCents) &&
    inteiro(v.summary.netCents) &&
    Array.isArray(v.payments) &&
    v.payments.every(ehRecebimentoDeVenda) &&
    typeof v.complete === "boolean"
  );
}

export function ehComprasDoCliente(v: unknown): v is ComprasDoCliente {
  return objeto(v) && Array.isArray(v.purchases) && v.purchases.every(ehResumoDeVenda) && talvez(texto)(v.nextCursor);
}

/** `{ created, sale }` de criar e cancelar. */
export function ehVendaGravada(v: unknown): v is { created: boolean; sale: Venda } {
  return objeto(v) && typeof v.created === "boolean" && ehVenda(v.sale);
}

/** `{ created, payment }` de receber e estornar. */
export function ehRecebimentoGravado(v: unknown): v is { created: boolean; payment: RecebimentoDeVenda } {
  return objeto(v) && typeof v.created === "boolean" && ehRecebimentoDeVenda(v.payment);
}

// ------------------------------------------------------------ caminhos

const id = encodeURIComponent;
export const caminhoVendas = (tenantId: string) => `/tenants/${id(tenantId)}/sales`;

function consulta(parametros: Record<string, string | null | undefined>): string {
  const busca = new URLSearchParams();
  for (const [chave, valor] of Object.entries(parametros)) if (valor) busca.set(chave, valor);
  const s = busca.toString();
  return s ? `?${s}` : "";
}

export const caminhoCatalogo = (tenantId: string, q: string, cursor: string | null = null) =>
  `${caminhoVendas(tenantId)}/catalog${consulta({ q: q.trim() || null, cursor })}`;

export const caminhoBuscaDeClientes = (tenantId: string, q: string) =>
  `${caminhoVendas(tenantId)}/consumers${consulta({ q: q.trim() })}`;

export const caminhoListaDeVendas = (
  tenantId: string,
  filtro: { scope: EscopoDeVendas; periodo?: { from: string; to: string } | null; status?: SituacaoDaVenda | null; cursor?: string | null },
) =>
  `${caminhoVendas(tenantId)}${consulta({
    scope: filtro.scope,
    from: filtro.periodo?.from,
    to: filtro.periodo?.to,
    status: filtro.status,
    cursor: filtro.cursor,
  })}`;

export const caminhoRecebimentosDeVendas = (tenantId: string, filtro: { scope: EscopoDeVendas; periodo?: { from: string; to: string } | null }) =>
  `${caminhoVendas(tenantId)}/payments${consulta({ scope: filtro.scope, from: filtro.periodo?.from, to: filtro.periodo?.to })}`;

export const caminhoDaVenda = (tenantId: string, saleId: string) => `${caminhoVendas(tenantId)}/${id(saleId)}`;
export const caminhoCancelarVenda = (tenantId: string, saleId: string) => `${caminhoDaVenda(tenantId, saleId)}/cancel`;
export const caminhoReceberVenda = (tenantId: string, saleId: string) => `${caminhoDaVenda(tenantId, saleId)}/payments`;
export const caminhoEstornarRecebimento = (tenantId: string, paymentId: string) =>
  `${caminhoVendas(tenantId)}/payments/${id(paymentId)}/refund`;
export const caminhoComprasDoCliente = (tenantId: string, consumerId: string, cursor: string | null = null) =>
  `/tenants/${id(tenantId)}/consumers/${id(consumerId)}/purchases${consulta({ cursor })}`;

// ------------------------------------------------------------ corpos

export interface CorpoDaVenda {
  requestKey: string;
  consumerId: string | null;
  items: {
    productId: string;
    quantityMilli: number;
    expectedUnit: UnidadeEstoque;
    expectedSuggestedPriceCents: number | null;
    unitPriceCents: number;
  }[];
}

export interface CorpoDoRecebimento {
  requestKey: string;
  method: FormaDePagamento;
  receivedOn: string;
  notes?: string;
}
