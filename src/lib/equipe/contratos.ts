// Contratos de "Equipe e acessos" (dono) e da agenda própria (profissional
// e gerente com profissional ligado),
// espelhando backend/src/team/. Validação de forma em cada resposta: campo
// faltando vira "erro do servidor", nunca um zero ou um vazio inventado.
// Nenhum contrato aqui tem senha, token ou link.

export type PermissaoFuncionario =
  | "ATENDIMENTO_PROPRIO_INICIAR"
  | "ATENDIMENTO_PROPRIO_CONCLUIR"
  | "ATENDIMENTO_PROPRIO_FALTA"
  | "COMISSOES_PROPRIAS_VISUALIZAR";

/** Áreas do estabelecimento que o dono concede a um gerente (espelha
 * backend/src/common/manager-permissions.ts). */
export type PermissaoGerente =
  | "AGENDA_VISUALIZAR"
  | "AGENDA_GERENCIAR"
  | "AGENDAMENTO_CRIAR"
  | "AGENDAMENTO_EDITAR"
  | "AGENDAMENTO_CANCELAR"
  | "SOLICITACOES_VISUALIZAR"
  | "SOLICITACOES_TRATAR"
  | "CONSUMIDORES_VISUALIZAR"
  | "CONSUMIDORES_GERENCIAR"
  | "SERVICOS_VISUALIZAR"
  | "SERVICOS_GERENCIAR"
  | "PROFISSIONAIS_VISUALIZAR"
  | "PROFISSIONAIS_GERENCIAR"
  | "RECEBIMENTOS_VISUALIZAR"
  | "RECEBIMENTOS_REGISTRAR"
  | "RECEBIMENTOS_ESTORNAR"
  | `ESTOQUE_${"VISUALIZAR" | "GERENCIAR"}`
  | `VENDAS_${"REGISTRAR" | "RECEBER" | "ALTERAR_PRECO" | "VISUALIZAR" | "CANCELAR" | "ESTORNAR_RECEBIMENTO"}`;

/** Tudo o que a tela de equipe concede. */
export type PermissaoDaEquipe = PermissaoFuncionario | PermissaoGerente;

export type PerfilDaEquipe = "PROFISSIONAL" | "GERENTE" | "RECEPCIONISTA";

export interface PermissaoDeGerenteNoCatalogo {
  permission: PermissaoGerente;
  area: string;
  areaLabel: string;
  label: string;
  detail: string;
  /** Dependências (já fechadas): entram junto quando esta é marcada. */
  requires: PermissaoGerente[];
  /** Este dono pode conceder (ele próprio pode fazer). */
  grantable: boolean;
  /** A área depende de um adicional não contratado (ex.: Estoque). Ausente
   * numa API anterior. */
  addonMissing?: boolean;
}

export type SituacaoNaEquipe =
  | "OWNER"
  | "ACTIVE"
  | "SUSPENDED"
  | "PROFESSIONAL_INACTIVE"
  | "PERMISSIONS_PENDING"
  | "LEGACY_ROLE"
  | "INVITED"
  | "NO_ACCESS";

export interface Vagas {
  limit: number;
  activeAccesses: number;
  pendingInvites: number;
  suspendedAccesses: number;
  used: number;
  available: number;
}

export interface AcessoDaEquipe {
  membershipId: string;
  role: string;
  isOwner: boolean;
  status: "ACTIVE" | "SUSPENDED";
  statusChangedAt: string | null;
  /** `email`: o e-mail ou, na conta sem e-mail, o login interno. */
  user: { id: string; name: string; email: string; status: string; username?: string | null; hasEmail?: boolean };
  grantedPermissions: PermissaoDaEquipe[];
  /** Conta criada pelo dono com login e senha (sem e-mail, sem papel na
   * plataforma, só este vínculo): o dono pode definir nova senha. */
  canResetTemporaryPassword?: boolean;
  /** O perfil só muda na conta que é só deste estabelecimento (sem papel na
   * plataforma e sem outro vínculo). Ausente numa API anterior. */
  canChangeRole?: boolean;
  /** Gerente de antes da tela nova: nada vale até o dono confirmar. */
  permissionsPending?: boolean;
}

/** Um acesso de equipe (profissional ou gerente), com ou sem profissional. */
export type AcessoNaLista = AcessoDaEquipe & {
  professional: { id: string; name: string; active: boolean; futureAppointments: number } | null;
  situation: SituacaoNaEquipe;
};

export interface MembroDaEquipe {
  professional: { id: string; name: string; active: boolean; futureAppointments: number };
  access: AcessoDaEquipe | null;
  invite: {
    id: string;
    name: string;
    email: string;
    expiresAt: string;
    sendCount: number;
    delivery: { status: string; failure: string | null };
    accountExists: boolean;
  } | null;
  situation: SituacaoNaEquipe;
}

export interface VisaoDaEquipe {
  tenant: { id: string; name: string; slug?: string };
  /** `maxProfessionals: null`: sem limite contratual de profissionais. */
  plan: { name: string; maxProfessionals: number | null };
  seats: Vagas;
  professionals: { active: number; limit: number | null };
  grantablePermissions: { permission: PermissaoFuncionario; label: string }[];
  permissionLabels: { permission: PermissaoFuncionario; label: string }[];
  maxInviteSends: number;
  /** Ausentes numa API anterior: a tela trata como lista vazia. */
  managerPermissions?: PermissaoDeGerenteNoCatalogo[];
  receptionistPermissions?: PermissaoGerente[]; // áreas da Recepcionista; ausente numa API anterior
  accesses?: AcessoNaLista[];
  members: MembroDaEquipe[];
}

export type AcaoDoFuncionario = "start" | "complete" | "no-show";

export interface AtendimentoProprio {
  id: string;
  startAt: string;
  localDate: string;
  localStart: string;
  localServiceEnd: string;
  durationMinutes: number;
  status: "PENDING" | "CONFIRMED" | "IN_PROGRESS" | "COMPLETED" | "CANCELED" | "NO_SHOW";
  service: { name: string };
  consumer: { name: string };
  actions: AcaoDoFuncionario[];
}

export interface MinhaAgenda {
  professional: { id: string; name: string };
  timezone: string;
  date: string;
  permissions: Record<AcaoDoFuncionario, boolean>;
  appointments: AtendimentoProprio[];
  complete: boolean;
}

/** Calendário do funcionário (GET /tenants/:id/my-agenda/range). */
export interface MinhaAgendaDoPeriodo {
  professional: { id: string; name: string };
  timezone: string;
  from: string;
  to: string;
  appointments: AtendimentoProprio[];
  complete: boolean;
}

// ---------------------------------------------------------------- validação

const objeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const texto = (v: unknown): v is string => typeof v === "string";
const inteiro = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const lista = (v: unknown): v is unknown[] => Array.isArray(v);
const ACOES: readonly AcaoDoFuncionario[] = ["start", "complete", "no-show"];
const SITUACOES: readonly SituacaoNaEquipe[] = [
  "OWNER",
  "ACTIVE",
  "SUSPENDED",
  "PROFESSIONAL_INACTIVE",
  "PERMISSIONS_PENDING",
  "LEGACY_ROLE",
  "INVITED",
  "NO_ACCESS",
];

function ehVagas(v: unknown): v is Vagas {
  return objeto(v) && ["limit", "activeAccesses", "pendingInvites", "suspendedAccesses", "used", "available"].every((k) => inteiro(v[k]));
}

function ehAcesso(a: unknown): a is AcessoDaEquipe {
  return (
    objeto(a) &&
    texto(a.membershipId) &&
    texto(a.role) &&
    texto(a.status) &&
    objeto(a.user) &&
    lista(a.grantedPermissions) &&
    typeof a.isOwner === "boolean" &&
    texto(a.user.email) &&
    texto(a.user.status)
  );
}

function ehAcessoNaLista(v: unknown): v is AcessoNaLista {
  if (!ehAcesso(v)) return false;
  const a = v as unknown as Record<string, unknown>;
  if (!texto(a.situation) || !SITUACOES.includes(a.situation as SituacaoNaEquipe)) return false;
  const p = a.professional;
  return p === null || (objeto(p) && texto(p.id) && texto(p.name) && typeof p.active === "boolean");
}

function ehPermissaoDoCatalogo(v: unknown): v is PermissaoDeGerenteNoCatalogo {
  return (
    objeto(v) &&
    [v.permission, v.area, v.areaLabel, v.label, v.detail].every(texto) &&
    lista(v.requires) &&
    typeof v.grantable === "boolean" &&
    (v.addonMissing === undefined || typeof v.addonMissing === "boolean")
  );
}

function ehMembro(v: unknown): v is MembroDaEquipe {
  if (!objeto(v) || !objeto(v.professional) || !texto(v.situation) || !SITUACOES.includes(v.situation as SituacaoNaEquipe)) {
    return false;
  }
  const p = v.professional;
  if (!texto(p.id) || !texto(p.name) || typeof p.active !== "boolean" || !inteiro(p.futureAppointments)) return false;
  if (v.access !== null && !ehAcesso(v.access)) return false;
  const c = v.invite;
  if (c !== null) {
    if (!objeto(c) || ![c.id, c.name, c.email, c.expiresAt].every(texto) || !inteiro(c.sendCount) || !objeto(c.delivery)) return false;
  }
  return true;
}

export function ehVisaoDaEquipe(v: unknown): v is VisaoDaEquipe {
  return (
    objeto(v) &&
    objeto(v.tenant) &&
    objeto(v.plan) &&
    (v.plan.maxProfessionals === null || inteiro(v.plan.maxProfessionals)) &&
    ehVagas(v.seats) &&
    objeto(v.professionals) &&
    inteiro(v.professionals.active) &&
    lista(v.grantablePermissions) &&
    lista(v.permissionLabels) &&
    inteiro(v.maxInviteSends) &&
    lista(v.members) &&
    v.members.every(ehMembro) &&
    (v.accesses === undefined || (lista(v.accesses) && v.accesses.every(ehAcessoNaLista))) &&
    (v.managerPermissions === undefined || (lista(v.managerPermissions) && v.managerPermissions.every(ehPermissaoDoCatalogo))) &&
    (v.receptionistPermissions === undefined || (lista(v.receptionistPermissions) && v.receptionistPermissions.every(texto)))
  );
}

function ehAtendimento(v: unknown): v is AtendimentoProprio {
  return (
    objeto(v) &&
    [v.id, v.startAt, v.localDate, v.localStart, v.localServiceEnd, v.status].every(texto) &&
    inteiro(v.durationMinutes) &&
    objeto(v.service) &&
    texto(v.service.name) &&
    objeto(v.consumer) &&
    texto(v.consumer.name) &&
    lista(v.actions) &&
    v.actions.every((a) => ACOES.includes(a as AcaoDoFuncionario))
  );
}

export function ehMinhaAgenda(v: unknown): v is MinhaAgenda {
  return (
    objeto(v) &&
    objeto(v.professional) &&
    texto(v.professional.id) &&
    texto(v.professional.name) &&
    texto(v.timezone) &&
    texto(v.date) &&
    objeto(v.permissions) &&
    ACOES.every((a) => typeof (v.permissions as Record<string, unknown>)[a] === "boolean") &&
    lista(v.appointments) &&
    v.appointments.every(ehAtendimento) &&
    typeof v.complete === "boolean"
  );
}

export function ehMinhaAgendaDoPeriodo(v: unknown): v is MinhaAgendaDoPeriodo {
  return (
    objeto(v) &&
    objeto(v.professional) &&
    texto(v.professional.id) &&
    texto(v.professional.name) &&
    texto(v.timezone) &&
    texto(v.from) &&
    texto(v.to) &&
    lista(v.appointments) &&
    v.appointments.every(ehAtendimento) &&
    typeof v.complete === "boolean"
  );
}

export function ehAtendimentoAlterado(v: unknown): v is { appointment: AtendimentoProprio } {
  return objeto(v) && ehAtendimento(v.appointment);
}

// ------------------------------------------------------------- apresentação

export const ROTULO_ACAO: Record<AcaoDoFuncionario, string> = {
  start: "Iniciar atendimento",
  complete: "Concluir atendimento",
  "no-show": "Marcar falta",
};

export const ROTULO_SITUACAO: Record<SituacaoNaEquipe, string> = {
  OWNER: "Dono(a)",
  ACTIVE: "Acesso ativo",
  SUSPENDED: "Acesso suspenso",
  PROFESSIONAL_INACTIVE: "Profissional desativado",
  PERMISSIONS_PENDING: "Permissões a confirmar",
  LEGACY_ROLE: "Papel antigo, sem área",
  INVITED: "Convite pendente",
  NO_ACCESS: "Sem acesso",
};

export const ROTULO_PERFIL: Record<string, string> = {
  DONO: "Dono(a)",
  GERENTE: "Gerente",
  PROFISSIONAL: "Profissional",
  RECEPCIONISTA: "Recepcionista",
};

/** Texto das vagas ("3 de 5 acessos utilizados"), sempre com os números que o
 * servidor contou. Reservas por convite só aparecem quando existem. Usado
 * também pelo portal (aba "Plano e adicionais"). */
export function textoDasVagas(vagas: Pick<Vagas, "used" | "limit" | "pendingInvites">): string {
  const base = `${vagas.used} de ${vagas.limit} ${vagas.limit === 1 ? "acesso utilizado" : "acessos utilizados"}`;
  if (vagas.pendingInvites <= 0) return base;
  const reservas = `${vagas.pendingInvites} ${vagas.pendingInvites === 1 ? "reservado" : "reservados"} por convite`;
  return `${base} (${reservas})`;
}

/** Acima do limite contratado (contagem nova ou limite reduzido antes desta
 * regra): ninguém perde acesso, só não entra ninguém novo. */
export function acimaDoLimite(vagas: Pick<Vagas, "used" | "limit">): boolean {
  return vagas.used > vagas.limit;
}

/** Confirmação de cada ação, com o horário e o cliente da reserva. */
export function perguntaDaAcao(acao: AcaoDoFuncionario, atendimento: AtendimentoProprio): string {
  const quem = `${atendimento.consumer.name}, ${atendimento.localStart}`;
  if (acao === "start") return `Iniciar o atendimento de ${quem}?`;
  if (acao === "complete") return `Concluir o atendimento de ${quem}?`;
  return `Marcar falta de ${quem}? A reserva fica registrada como "Não compareceu".`;
}
