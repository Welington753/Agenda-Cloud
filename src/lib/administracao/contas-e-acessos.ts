// "Contas e acessos" do portal: duas abas, cada uma um conjunto separado no
// servidor (`GET /platform/users?scope=`). A de estabelecimentos traz só os
// responsáveis (vínculo de dono ou convite de dono pendente), uma linha por
// conta; a de administradores traz as contas com papel de plataforma e só
// existe para quem cuida dos acessos da plataforma (`managePlatformAccess`).
// Esconder a aba é só apresentação: quem recusa é a API. Regras puras, sem
// React.

import type { PapelPlataforma, SituacaoConta } from "./rotulos";
import { PAPEIS_PLATAFORMA } from "./rotulos";

export type AbaContas = "estabelecimentos" | "administradores";

const ESCOPO: Record<AbaContas, "ESTABLISHMENTS" | "ADMINS"> = {
  estabelecimentos: "ESTABLISHMENTS",
  administradores: "ADMINS",
};

/** Aba pedida na URL (`?aba=`). Sem permissão confirmada, ou valor
 * desconhecido, fica a de estabelecimentos. */
export function abaDaUrl(valor: string | null, podeVerAdministradores: boolean): AbaContas {
  return valor === "administradores" && podeVerAdministradores ? "administradores" : "estabelecimentos";
}

export interface FiltroContas {
  q: string;
  status: "" | SituacaoConta;
  page: number;
}

export const FILTRO_VAZIO: FiltroContas = { q: "", status: "", page: 1 };

/** Busca da lista no servidor: a aba vai sempre, junto da busca, da situação
 * e da página. */
export function buscaDaLista(aba: AbaContas, filtro: FiltroContas, pageSize = 20): string {
  const params = new URLSearchParams({ scope: ESCOPO[aba], page: String(filtro.page), pageSize: String(pageSize) });
  if (filtro.q) params.set("q", filtro.q);
  if (filtro.status) params.set("status", filtro.status);
  return `/platform/users?${params}`;
}

/** Texto da busca: vazio ou ao menos 2 caracteres (o servidor recusa 1). */
export function erroDaBusca(q: string): string {
  return q.trim().length === 1 ? "Digite ao menos 2 caracteres ou deixe a busca vazia." : "";
}

/** Situação da conta nesta tela (a conta pendente é a que recebeu convite e
 * ainda não ativou). */
export const SITUACOES_NA_LISTA: Record<SituacaoConta, string> = {
  ACTIVE: "Ativa",
  INVITED: "Convite pendente",
  SUSPENDED: "Bloqueada",
};

export interface EstabelecimentoDoResponsavel {
  tenantId: string;
  tenantName: string;
  tenantStatus: string;
  /** `OWNER`: vínculo de dono; `PENDING_INVITE`: convite de dono pendente. */
  relation: "OWNER" | "PENDING_INVITE";
  membershipStatus: string | null;
}

interface ContaBase {
  id: string;
  name: string;
  email: string;
  status: SituacaoConta;
  emailVerified: boolean;
  hasPassword: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ContaResponsavel extends ContaBase {
  establishments: EstabelecimentoDoResponsavel[];
}

export interface ContaAdministrativa extends ContaBase {
  platformRole: PapelPlataforma;
}

export interface ResumoContas {
  total: number;
  active: number;
  invited: number;
  suspended: number;
}

export interface ListaContas<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  summary: ResumoContas;
}

const objeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const texto = (v: unknown): v is string => typeof v === "string";
const inteiro = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const SITUACOES = Object.keys(SITUACOES_NA_LISTA);

function ehContaBase(v: unknown): v is Record<string, unknown> {
  return (
    objeto(v) &&
    [v.id, v.name, v.email, v.createdAt, v.updatedAt].every(texto) &&
    SITUACOES.includes(v.status as string) &&
    typeof v.emailVerified === "boolean" &&
    typeof v.hasPassword === "boolean"
  );
}

function ehEstabelecimento(v: unknown): boolean {
  return (
    objeto(v) &&
    [v.tenantId, v.tenantName, v.tenantStatus].every(texto) &&
    (v.relation === "OWNER" || v.relation === "PENDING_INVITE")
  );
}

function ehLista(v: unknown, escopo: string, item: (x: unknown) => boolean): boolean {
  if (!objeto(v) || v.scope !== escopo || !Array.isArray(v.items) || !v.items.every(item)) return false;
  if (![v.total, v.page, v.pageSize].every(inteiro) || !objeto(v.summary)) return false;
  const resumo = v.summary;
  return ["total", "active", "invited", "suspended"].every((k) => inteiro(resumo[k]));
}

/** Aba de estabelecimentos: nunca aceita uma resposta com dado de plataforma
 * (uma API que o mandasse por engano vira erro, não dado na tela). */
export function ehListaResponsaveis(v: unknown): v is ListaContas<ContaResponsavel> {
  return ehLista(
    v,
    "ESTABLISHMENTS",
    (c) =>
      ehContaBase(c) &&
      !("platformRole" in c) &&
      Array.isArray(c.establishments) &&
      c.establishments.length > 0 &&
      c.establishments.every(ehEstabelecimento),
  );
}

export function ehListaAdministradores(v: unknown): v is ListaContas<ContaAdministrativa> {
  return ehLista(v, "ADMINS", (c) => ehContaBase(c) && texto(c.platformRole) && c.platformRole in PAPEIS_PLATAFORMA);
}

/** Perfil administrativo na lista (o rótulo técnico fica na ficha). */
export function perfilAdministrativo(papel: PapelPlataforma): string {
  return papel === "MASTER_OWNER" ? "Proprietário da plataforma" : PAPEIS_PLATAFORMA[papel];
}

export function tituloDaLista(aba: AbaContas, total: number): string {
  if (aba === "administradores") return total === 1 ? "1 administrador" : `${total} administradores`;
  return total === 1 ? "1 conta de estabelecimento" : `${total} contas de estabelecimentos`;
}

/** Ação da linha: a conta que ainda não ativou abre a ficha pelo convite. */
export function rotuloDaAcao(status: SituacaoConta): string {
  return status === "INVITED" ? "Ver convite" : "Ver conta";
}
