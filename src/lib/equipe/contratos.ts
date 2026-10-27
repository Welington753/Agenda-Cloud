// Contratos de "Equipe e acessos" (dono) e da agenda do funcionário,
// espelhando backend/src/team/. Validação de forma em cada resposta: campo
// faltando vira "erro do servidor", nunca um zero ou um vazio inventado.
// Nenhum contrato aqui tem senha, token ou link.

export type PermissaoFuncionario =
  | "ATENDIMENTO_PROPRIO_INICIAR"
  | "ATENDIMENTO_PROPRIO_CONCLUIR"
  | "ATENDIMENTO_PROPRIO_FALTA";

export type SituacaoNaEquipe =
  | "OWNER"
  | "ACTIVE"
  | "SUSPENDED"
  | "PROFESSIONAL_INACTIVE"
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

export interface MembroDaEquipe {
  professional: { id: string; name: string; active: boolean; futureAppointments: number };
  access: {
    membershipId: string;
    role: string;
    isOwner: boolean;
    status: "ACTIVE" | "SUSPENDED";
    statusChangedAt: string | null;
    /** `email`: o e-mail ou, na conta sem e-mail, o nome de usuário. */
    user: { id: string; name: string; email: string; status: string; username?: string | null; hasEmail?: boolean };
    grantedPermissions: PermissaoFuncionario[];
    /** Conta criada pelo dono com usuário e senha (sem e-mail, sem papel na
     * plataforma, só este vínculo): pode receber nova senha temporária. */
    canResetTemporaryPassword?: boolean;
  } | null;
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
  tenant: { id: string; name: string };
  plan: { name: string; maxProfessionals: number };
  seats: Vagas;
  professionals: { active: number; limit: number };
  grantablePermissions: { permission: PermissaoFuncionario; label: string }[];
  permissionLabels: { permission: PermissaoFuncionario; label: string }[];
  maxInviteSends: number;
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
const SITUACOES: readonly SituacaoNaEquipe[] = ["OWNER", "ACTIVE", "SUSPENDED", "PROFESSIONAL_INACTIVE", "INVITED", "NO_ACCESS"];

function ehVagas(v: unknown): v is Vagas {
  return objeto(v) && ["limit", "activeAccesses", "pendingInvites", "suspendedAccesses", "used", "available"].every((k) => inteiro(v[k]));
}

function ehMembro(v: unknown): v is MembroDaEquipe {
  if (!objeto(v) || !objeto(v.professional) || !texto(v.situation) || !SITUACOES.includes(v.situation as SituacaoNaEquipe)) {
    return false;
  }
  const p = v.professional;
  if (!texto(p.id) || !texto(p.name) || typeof p.active !== "boolean" || !inteiro(p.futureAppointments)) return false;
  const a = v.access;
  if (a !== null) {
    if (!objeto(a) || !texto(a.membershipId) || !texto(a.status) || !objeto(a.user) || !lista(a.grantedPermissions)) return false;
    if (typeof a.isOwner !== "boolean" || !texto(a.user.email) || !texto(a.user.status)) return false;
  }
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
    inteiro(v.plan.maxProfessionals) &&
    ehVagas(v.seats) &&
    objeto(v.professionals) &&
    inteiro(v.professionals.active) &&
    lista(v.grantablePermissions) &&
    lista(v.permissionLabels) &&
    inteiro(v.maxInviteSends) &&
    lista(v.members) &&
    v.members.every(ehMembro)
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
  INVITED: "Convite pendente",
  NO_ACCESS: "Sem acesso",
};

/** Texto das vagas, sempre com os números que o servidor contou. */
export function textoDasVagas(vagas: Vagas): string {
  const partes = [`${vagas.activeAccesses} ativo${vagas.activeAccesses === 1 ? "" : "s"}`];
  partes.push(`${vagas.pendingInvites} convite${vagas.pendingInvites === 1 ? "" : "s"} pendente${vagas.pendingInvites === 1 ? "" : "s"}`);
  return `${vagas.used} de ${vagas.limit} em uso (${partes.join(", ")})`;
}

/** Confirmação de cada ação, com o horário e o cliente da reserva. */
export function perguntaDaAcao(acao: AcaoDoFuncionario, atendimento: AtendimentoProprio): string {
  const quem = `${atendimento.consumer.name}, ${atendimento.localStart}`;
  if (acao === "start") return `Iniciar o atendimento de ${quem}?`;
  if (acao === "complete") return `Concluir o atendimento de ${quem}?`;
  return `Marcar falta de ${quem}? A reserva fica registrada como "Não compareceu".`;
}
