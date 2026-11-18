// Cliente das rotas do estoque (backend/src/stock/*.controller.ts). Valida a
// forma de cada resposta, classifica a recusa pelo status e pelo `code` (nunca
// pelo texto) e devolve o `message` da API para a tela mostrar.
//
// Quantidades sempre em milésimos inteiros (ver lib/estoque/quantidade.ts).
// Nada é reenviado sozinho: um envio que falhou na rede fica "incerto" e a
// pessoa decide repetir, com a MESMA chave (a API devolve o original).
import { apiRequest, mensagemDoBackend, type ApiRequestInit } from "./http-client";
import type { UnidadeEstoque } from "@/lib/estoque/quantidade";
import type { FinalidadeEstoque, TipoManual, TipoMovimentacao } from "@/lib/estoque/rotulos";

export interface SubcategoriaEstoque {
  id: string;
  categoryId: string;
  name: string;
  archived: boolean;
  activeProducts: number;
}

export interface CategoriaEstoque {
  id: string;
  name: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  activeProducts: number;
  subcategories: SubcategoriaEstoque[];
}

export interface ProdutoEstoque {
  id: string;
  name: string;
  description: string | null;
  internalCode: string | null;
  categoryId: string;
  categoryName: string;
  subcategoryId: string | null;
  subcategoryName: string | null;
  purpose: FinalidadeEstoque;
  unit: UnidadeEstoque;
  minQuantityMilli: number;
  balanceMilli: number;
  balanceVersion: number;
  low: boolean;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MovimentacaoEstoque {
  id: string;
  productId: string;
  productName: string;
  kind: TipoMovimentacao;
  quantityMilli: number;
  deltaMilli: number;
  balanceBeforeMilli: number;
  balanceAfterMilli: number;
  unit: UnidadeEstoque;
  reason: string | null;
  reversesMovementId: string | null;
  reversedByMovementId: string | null;
  countId: string | null;
  recordedBy: { id: string; name: string };
  recordedAt: string;
}

export interface ItemDaConferencia {
  productId: string;
  productName: string;
  expectedUnit: UnidadeEstoque;
  expectedMilli: number;
  countedMilli: number;
  differenceMilli: number;
  movementId: string | null;
}

export interface ConferenciaEstoque {
  id: string;
  note: string | null;
  recordedBy: { id: string; name: string };
  recordedAt: string;
  itemCount: number;
  adjustedCount: number;
  items?: ItemDaConferencia[];
}

export interface ItemDesatualizado {
  productId: string;
  balanceMilli: number;
  balanceVersion: number;
  unit: UnidadeEstoque;
  archived: boolean;
}

export type FalhaEstoque =
  | { tipo: "nao_autenticado" }
  /** 404: sem vínculo com o estabelecimento, ou o item não é dele. */
  | { tipo: "nao_encontrado"; mensagem: string | null }
  | { tipo: "nao_contratado" }
  | { tipo: "acesso_vencido" }
  | { tipo: "sem_permissao"; mensagem: string | null }
  | { tipo: "dados_invalidos"; mensagem: string | null }
  | { tipo: "conflito"; code: string | null; mensagem: string | null; dados: Record<string, unknown> }
  | { tipo: "falha_comunicacao" }
  | { tipo: "indisponivel" };

export type ResultadoEstoque<T> = { ok: true; dados: T } | { ok: false; falha: FalhaEstoque };

const objeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const texto = (v: unknown): v is string => typeof v === "string";
const inteiro = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);
const talvez = <T>(guarda: (v: unknown) => v is T) => (v: unknown): v is T | null => v === null || guarda(v);

export function ehCategoria(v: unknown): v is CategoriaEstoque {
  return (
    objeto(v) &&
    texto(v.id) &&
    texto(v.name) &&
    typeof v.archived === "boolean" &&
    inteiro(v.activeProducts) &&
    Array.isArray(v.subcategories) &&
    v.subcategories.every((s) => objeto(s) && texto(s.id) && texto(s.name) && typeof s.archived === "boolean" && inteiro(s.activeProducts))
  );
}

export function ehProduto(v: unknown): v is ProdutoEstoque {
  return (
    objeto(v) &&
    texto(v.id) &&
    texto(v.name) &&
    talvez(texto)(v.description) &&
    talvez(texto)(v.internalCode) &&
    texto(v.categoryId) &&
    texto(v.categoryName) &&
    talvez(texto)(v.subcategoryId) &&
    texto(v.purpose) &&
    texto(v.unit) &&
    inteiro(v.minQuantityMilli) &&
    inteiro(v.balanceMilli) &&
    inteiro(v.balanceVersion) &&
    typeof v.low === "boolean" &&
    typeof v.archived === "boolean" &&
    texto(v.updatedAt)
  );
}

export function ehMovimentacao(v: unknown): v is MovimentacaoEstoque {
  return (
    objeto(v) &&
    texto(v.id) &&
    texto(v.productId) &&
    texto(v.productName) &&
    texto(v.kind) &&
    inteiro(v.quantityMilli) &&
    inteiro(v.deltaMilli) &&
    inteiro(v.balanceBeforeMilli) &&
    inteiro(v.balanceAfterMilli) &&
    texto(v.unit) &&
    talvez(texto)(v.reason) &&
    talvez(texto)(v.reversesMovementId) &&
    talvez(texto)(v.reversedByMovementId) &&
    objeto(v.recordedBy) &&
    texto(v.recordedBy.name) &&
    texto(v.recordedAt)
  );
}

export function ehConferencia(v: unknown): v is ConferenciaEstoque {
  return (
    objeto(v) &&
    texto(v.id) &&
    talvez(texto)(v.note) &&
    objeto(v.recordedBy) &&
    texto(v.recordedBy.name) &&
    texto(v.recordedAt) &&
    inteiro(v.itemCount) &&
    inteiro(v.adjustedCount) &&
    (v.items === undefined ||
      (Array.isArray(v.items) &&
        v.items.every((i) => objeto(i) && texto(i.productId) && texto(i.productName) && inteiro(i.expectedMilli) && inteiro(i.countedMilli) && inteiro(i.differenceMilli))))
  );
}

/** Classificação única das recusas: o status decide; o `code` separa as do
 * mesmo status. */
export function falhaDaResposta(status: number, data: unknown): FalhaEstoque {
  const code = objeto(data) && texto(data.code) ? data.code : null;
  const mensagem = mensagemDoBackend(data);
  if (status === 401) return { tipo: "nao_autenticado" };
  if (status === 404) return { tipo: "nao_encontrado", mensagem };
  if (status === 403 && code === "RECURSO_NAO_CONTRATADO") return { tipo: "nao_contratado" };
  if (status === 403 && code === "ACESSO_VENCIDO") return { tipo: "acesso_vencido" };
  if (status === 403) return { tipo: "sem_permissao", mensagem };
  if (status === 400) return { tipo: "dados_invalidos", mensagem };
  if (status === 409) return { tipo: "conflito", code, mensagem, dados: objeto(data) ? data : {} };
  return { tipo: "indisponivel" };
}

async function pedir<T>(
  caminho: string,
  init: ApiRequestInit,
  extrair: (corpo: unknown) => T | undefined,
): Promise<ResultadoEstoque<T>> {
  const r = await apiRequest<unknown>(caminho, init);
  if (r.kind === "network-error") return { ok: false, falha: { tipo: "falha_comunicacao" } };
  if (r.kind === "http-error") return { ok: false, falha: falhaDaResposta(r.status, r.data) };
  const dados = extrair(r.data);
  return dados === undefined ? { ok: false, falha: { tipo: "indisponivel" } } : { ok: true, dados };
}

const base = (tenantId: string) => `/tenants/${encodeURIComponent(tenantId)}/stock`;
const id = encodeURIComponent;
const campo = <T>(nome: string, guarda: (v: unknown) => v is T) => (corpo: unknown): T | undefined =>
  objeto(corpo) && guarda(corpo[nome]) ? (corpo[nome] as T) : undefined;
const lista = <T>(nome: string, guarda: (v: unknown) => v is T) => (corpo: unknown): { itens: T[]; proximo: string | null } | undefined => {
  if (!objeto(corpo) || !Array.isArray(corpo[nome]) || !(corpo[nome] as unknown[]).every(guarda)) return undefined;
  const proximo = corpo.nextCursor;
  return { itens: corpo[nome] as T[], proximo: texto(proximo) ? proximo : null };
};
const direto = <T>(guarda: (v: unknown) => v is T) => (corpo: unknown): T | undefined => (guarda(corpo) ? corpo : undefined);

// Categorias

export function listarCategorias(tenantId: string, signal?: AbortSignal) {
  return pedir(`${base(tenantId)}/categories?status=ALL`, { signal }, (c) => lista("categories", ehCategoria)(c)?.itens);
}

export function criarCategoria(tenantId: string, name: string) {
  return pedir(`${base(tenantId)}/categories`, { method: "POST", body: { name } }, direto(ehCategoria));
}

export function renomearCategoria(tenantId: string, categoryId: string, name: string) {
  return pedir(`${base(tenantId)}/categories/${id(categoryId)}`, { method: "PATCH", body: { name } }, direto(ehCategoria));
}

export function situacaoDaCategoria(tenantId: string, categoryId: string, acao: "archive" | "reactivate") {
  return pedir(`${base(tenantId)}/categories/${id(categoryId)}/${acao}`, { method: "POST" }, direto(ehCategoria));
}

export function criarSubcategoria(tenantId: string, categoryId: string, name: string) {
  return pedir(`${base(tenantId)}/categories/${id(categoryId)}/subcategories`, { method: "POST", body: { name } }, direto(ehCategoria));
}

export function renomearSubcategoria(tenantId: string, subcategoryId: string, name: string) {
  return pedir(`${base(tenantId)}/subcategories/${id(subcategoryId)}`, { method: "PATCH", body: { name } }, direto(ehCategoria));
}

export function situacaoDaSubcategoria(tenantId: string, subcategoryId: string, acao: "archive" | "reactivate") {
  return pedir(`${base(tenantId)}/subcategories/${id(subcategoryId)}/${acao}`, { method: "POST" }, direto(ehCategoria));
}

// Produtos

export interface DadosDoProduto {
  name: string;
  description: string | null;
  internalCode: string | null;
  categoryId: string;
  subcategoryId: string | null;
  purpose: FinalidadeEstoque;
  unit: UnidadeEstoque;
  minQuantityMilli: number;
}

export function listarProdutos(tenantId: string, consulta: string, signal?: AbortSignal) {
  return pedir(`${base(tenantId)}/products?${consulta}`, { signal }, lista("products", ehProduto));
}

export function buscarProduto(tenantId: string, productId: string, signal?: AbortSignal) {
  return pedir(`${base(tenantId)}/products/${id(productId)}`, { signal }, direto(ehProduto));
}

export function criarProduto(tenantId: string, dados: DadosDoProduto & { requestKey: string; initialQuantityMilli: number | null }) {
  return pedir(`${base(tenantId)}/products`, { method: "POST", body: dados }, campo("product", ehProduto));
}

export function editarProduto(tenantId: string, productId: string, dados: DadosDoProduto & { expectedUpdatedAt: string }) {
  return pedir(`${base(tenantId)}/products/${id(productId)}`, { method: "PATCH", body: dados }, direto(ehProduto));
}

export function situacaoDoProduto(tenantId: string, productId: string, acao: "archive" | "reactivate") {
  return pedir(`${base(tenantId)}/products/${id(productId)}/${acao}`, { method: "POST" }, direto(ehProduto));
}

// Movimentações

export function listarMovimentacoes(tenantId: string, consulta: string, signal?: AbortSignal) {
  return pedir(`${base(tenantId)}/movements?${consulta}`, { signal }, lista("movements", ehMovimentacao));
}

export function registrarMovimentacao(
  tenantId: string,
  dados: { requestKey: string; productId: string; kind: TipoManual; quantityMilli: number; expectedUnit: UnidadeEstoque; reason: string | null },
) {
  return pedir(`${base(tenantId)}/movements`, { method: "POST", body: dados }, campo("movement", ehMovimentacao));
}

export function estornarMovimentacao(tenantId: string, movementId: string, dados: { requestKey: string; reason: string }) {
  return pedir(`${base(tenantId)}/movements/${id(movementId)}/reversal`, { method: "POST", body: dados }, campo("movement", ehMovimentacao));
}

// Conferências

export function listarConferencias(tenantId: string, cursor: string | null, signal?: AbortSignal) {
  const consulta = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return pedir(`${base(tenantId)}/counts${consulta}`, { signal }, lista("counts", ehConferencia));
}

export function buscarConferencia(tenantId: string, countId: string, signal?: AbortSignal) {
  return pedir(`${base(tenantId)}/counts/${id(countId)}`, { signal }, direto(ehConferencia));
}

export function confirmarConferencia(
  tenantId: string,
  dados: {
    requestKey: string;
    note: string | null;
    items: { productId: string; expectedBalanceVersion: number; expectedUnit: UnidadeEstoque; countedMilli: number }[];
  },
) {
  return pedir(`${base(tenantId)}/counts`, { method: "POST", body: dados }, campo("count", ehConferencia));
}

/** Itens do 409 `CONFERENCIA_DESATUALIZADA`, já validados. */
export function itensDesatualizados(falha: FalhaEstoque): ItemDesatualizado[] | null {
  if (falha.tipo !== "conflito" || falha.code !== "CONFERENCIA_DESATUALIZADA" || !Array.isArray(falha.dados.items)) return null;
  const itens = falha.dados.items.filter(
    (i): i is ItemDesatualizado =>
      objeto(i) && texto(i.productId) && inteiro(i.balanceMilli) && inteiro(i.balanceVersion) && texto(i.unit) && typeof i.archived === "boolean",
  );
  return itens.length ? itens : null;
}

/** Chave de cada formulário aberto (a API aceita 16 a 64 caracteres). */
export function novaChaveDeEnvio(): string {
  return crypto.randomUUID().replace(/-/g, "");
}
