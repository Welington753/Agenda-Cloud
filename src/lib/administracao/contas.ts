// Contratos da gestão de contas (usuários, convites, histórico, papéis).
// Validação de forma em cada resposta: um campo faltando vira "erro do
// servidor", nunca um zero ou um vazio inventado. Nenhum contrato aqui tem
// senha, hash, token ou link. Rótulos em ./rotulos.ts.

import type { PapelPlataforma, SituacaoConta, SituacaoConvite, SituacaoEnvio } from "./rotulos";

export type { PapelPlataforma, SituacaoConta, SituacaoConvite, SituacaoEnvio } from "./rotulos";

export interface Capacidades {
  viewDirectory: boolean;
  manageEstablishments: boolean;
  managePlatformAccess: boolean;
  /** Suspender, reativar, arquivar e trocar plano (só MASTER_OWNER). Ausente
   * numa API anterior: conta como não. */
  manageEstablishmentLifecycle?: boolean;
}

export interface Convite {
  id: string;
  type: "ESTABLISHMENT" | "PLATFORM";
  status: SituacaoConvite;
  targetName: string;
  targetEmail: string;
  targetUser: { id: string; status: string; hasCredential: boolean } | null;
  tenant: { id: string; name: string } | null;
  role: string | null;
  platformRole: string | null;
  platformPermissions: string[];
  delivery: { status: SituacaoEnvio; attempts: number; lastAt: string | null; failure: string | null };
  sendCount: number;
  maxSends: number;
  createdBy: { id: string; name: string };
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
}

export interface UsuarioResumo {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  status: SituacaoConta;
  emailVerified: boolean;
  platformRole: PapelPlataforma | null;
  platformPermissions: string[];
  createdAt: string;
  updatedAt: string;
  hasPassword: boolean;
  memberships: { tenantId: string; tenantName: string; role: string; tenantStatus: string }[];
}

export interface ListaUsuarios {
  items: UsuarioResumo[];
  total: number;
  page: number;
  pageSize: number;
  summary: {
    total: number;
    active: number;
    invited: number;
    suspended: number;
    platformAccounts: number;
    withoutEstablishment: number;
  };
}

export interface Vinculo {
  id: string;
  tenant: { id: string; name: string; slug: string; status: string };
  role: string;
  /** `SUSPENDED`: o dono suspendeu este acesso (API anterior: ausente). */
  status?: "ACTIVE" | "SUSPENDED";
  professional?: { id: string; name: string; active: boolean } | null;
  roleHasAccess: boolean;
  createdAt: string;
  deniedPermissions: string[];
  ineffectiveOverrides: string[];
  effectiveAccess: { key: string; label: string; allowed: boolean }[];
}

export interface RedefinicaoSenha {
  id: string;
  status: "PENDING" | "USED" | "REVOKED" | "EXPIRED";
  delivery: { status: SituacaoEnvio; attempts: number; lastAt: string | null; failure: string | null };
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  requestedBy: { id: string; name: string };
}

export interface FichaUsuario extends Omit<UsuarioResumo, "memberships"> {
  lastSeenAt: string | null;
  activeSessions: number;
  platformCapabilities: Capacidades;
  ineffectivePlatformPermissions: string[];
  memberships: Vinculo[];
  invites: Convite[];
  latestPasswordReset: RedefinicaoSenha | null;
  allowedActions: {
    edit: boolean;
    block: boolean;
    reactivate: boolean;
    resetPassword: boolean;
    changePlatformAccess: boolean;
    manageMemberships: boolean;
  };
}

export interface ListaConvites {
  items: Convite[];
  total: number;
  page: number;
  pageSize: number;
  summary: { total: number; pending: number; accepted: number; expired: number; revoked: number; deliveryProblems: number };
}

export interface RegistroHistorico {
  id: string;
  occurredAt: string;
  action: string;
  summary: string;
  actor: { id: string; name: string };
  target: { id: string; name: string; email: string } | null;
  tenant: { id: string; name: string } | null;
  previousData: Record<string, unknown> | null;
  newData: Record<string, unknown> | null;
}

export interface ListaHistorico {
  items: RegistroHistorico[];
  total: number;
  page: number;
  pageSize: number;
}

export interface MembrosEstabelecimento {
  members: (Vinculo & { user: { id: string; name: string; email: string; status: string }; canManage: boolean })[];
  pendingInvites: Convite[];
  canInvite: boolean;
}

export interface Plano {
  id: string;
  code: string;
  name: string;
  catalogPriceCents: number | null;
  maxProfessionals: number;
  maxUnits: number;
}

export interface ReferenciaPapeis {
  platformRoles: { role: PapelPlataforma; withoutPermissions: Capacidades; withEffectivePermissions: Capacidades }[];
  effectivePlatformPermissions: string[];
  tenantAreas: { key: string; label: string }[];
  effectiveTenantRoles: string[];
  effectiveTenantPermissions: string[];
  tenantRoleAccess: { role: string; areas: string[] }[];
  maxInviteSends: number;
}

export interface ResultadoCriacao {
  created: boolean;
  tenant: { id: string; name: string } | null;
  invite: Convite;
  delivery: { status: string; failure?: string } | null;
}

// ---------------------------------------------------------------- validação

const objeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const texto = (v: unknown): v is string => typeof v === "string";
const inteiro = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const lista = (v: unknown): v is unknown[] => Array.isArray(v);

function pagina(v: unknown, item: (x: unknown) => boolean): boolean {
  return objeto(v) && lista(v.items) && v.items.every(item) && inteiro(v.total) && inteiro(v.page) && inteiro(v.pageSize);
}

export function ehConvite(v: unknown): v is Convite {
  return (
    objeto(v) &&
    [v.id, v.type, v.status, v.targetName, v.targetEmail, v.createdAt, v.expiresAt].every(texto) &&
    objeto(v.delivery) &&
    texto(v.delivery.status) &&
    inteiro(v.sendCount) &&
    inteiro(v.maxSends) &&
    objeto(v.createdBy)
  );
}

function ehUsuarioResumo(v: unknown): boolean {
  return (
    objeto(v) &&
    [v.id, v.name, v.email, v.status, v.createdAt, v.updatedAt].every(texto) &&
    typeof v.emailVerified === "boolean" &&
    typeof v.hasPassword === "boolean" &&
    lista(v.memberships) &&
    lista(v.platformPermissions)
  );
}

export function ehListaUsuarios(v: unknown): v is ListaUsuarios {
  return (
    pagina(v, ehUsuarioResumo) &&
    objeto((v as Record<string, unknown>).summary) &&
    ["total", "active", "invited", "suspended", "platformAccounts", "withoutEstablishment"].every((k) =>
      inteiro(((v as Record<string, unknown>).summary as Record<string, unknown>)[k]),
    )
  );
}

function ehVinculo(v: unknown): boolean {
  return (
    objeto(v) &&
    texto(v.id) &&
    objeto(v.tenant) &&
    texto(v.role) &&
    lista(v.deniedPermissions) &&
    lista(v.effectiveAccess) &&
    v.effectiveAccess.every((a) => objeto(a) && texto(a.key) && typeof a.allowed === "boolean")
  );
}

export function ehFichaUsuario(v: unknown): v is FichaUsuario {
  return (
    objeto(v) &&
    [v.id, v.name, v.email, v.status, v.updatedAt].every(texto) &&
    inteiro(v.activeSessions) &&
    objeto(v.platformCapabilities) &&
    lista(v.memberships) &&
    v.memberships.every(ehVinculo) &&
    lista(v.invites) &&
    v.invites.every(ehConvite) &&
    objeto(v.allowedActions)
  );
}

export function ehListaConvites(v: unknown): v is ListaConvites {
  return pagina(v, ehConvite) && objeto((v as Record<string, unknown>).summary);
}

export function ehListaHistorico(v: unknown): v is ListaHistorico {
  return pagina(v, (r) => objeto(r) && texto(r.id) && texto(r.action) && texto(r.summary) && objeto(r.actor));
}

export function ehMembros(v: unknown): v is MembrosEstabelecimento {
  return (
    objeto(v) &&
    lista(v.members) &&
    v.members.every((m) => ehVinculo(m) && objeto((m as Record<string, unknown>).user)) &&
    lista(v.pendingInvites) &&
    v.pendingInvites.every(ehConvite) &&
    typeof v.canInvite === "boolean"
  );
}

export function ehPlanos(v: unknown): v is Plano[] {
  return lista(v) && v.every((p) => objeto(p) && texto(p.id) && texto(p.name) && inteiro(p.maxProfessionals));
}

export function ehOpcoesEstabelecimento(v: unknown): v is { items: { id: string; name: string }[]; truncated: boolean } {
  return objeto(v) && lista(v.items) && v.items.every((i) => objeto(i) && texto(i.id) && texto(i.name)) && typeof v.truncated === "boolean";
}

export function ehReferenciaPapeis(v: unknown): v is ReferenciaPapeis {
  return objeto(v) && lista(v.platformRoles) && lista(v.tenantAreas) && lista(v.effectiveTenantPermissions);
}

export function ehResultadoCriacao(v: unknown): v is ResultadoCriacao {
  return objeto(v) && typeof v.created === "boolean" && ehConvite(v.invite);
}
