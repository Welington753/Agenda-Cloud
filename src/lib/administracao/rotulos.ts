// Rótulos em português da gestão de contas e o texto honesto sobre o envio
// de e-mail ("aceito pelo provedor" nunca vira "recebido").

export type SituacaoConta = "ACTIVE" | "INVITED" | "SUSPENDED";
export type PapelPlataforma = "MASTER_OWNER" | "MASTER_ADMIN" | "MASTER_SUPPORT";
export type SituacaoConvite = "PENDING" | "ACCEPTED" | "EXPIRED" | "REVOKED";
export type SituacaoEnvio = "PENDING" | "SENT" | "FAILED" | "NOT_CONFIGURED";

export const SITUACOES_CONTA: Record<SituacaoConta, string> = {
  ACTIVE: "Ativa",
  INVITED: "Aguardando ativação",
  SUSPENDED: "Bloqueada",
};

export const PAPEIS_PLATAFORMA: Record<PapelPlataforma, string> = {
  MASTER_OWNER: "Responsável pela plataforma (MASTER_OWNER)",
  MASTER_ADMIN: "Administração delegada (MASTER_ADMIN)",
  MASTER_SUPPORT: "Suporte, só consulta (MASTER_SUPPORT)",
};

export const PAPEIS_ESTABELECIMENTO: Record<string, string> = {
  DONO: "Dono(a)",
  GERENTE: "Gerente",
  RECEPCIONISTA: "Recepção",
  PROFISSIONAL: "Funcionário(a)",
};

export const SITUACOES_CONVITE: Record<SituacaoConvite, string> = {
  PENDING: "Pendente",
  ACCEPTED: "Aceito",
  EXPIRED: "Expirado",
  REVOKED: "Revogado",
};

export const PERMISSOES_PLATAFORMA: Record<string, string> = {
  ESTABLISHMENTS_MANAGE: "Estabelecimentos e contas (ESTABLISHMENTS_MANAGE)",
  ADMINISTRATORS_MANAGE: "ADMINISTRATORS_MANAGE (sem efeito nesta versão)",
  PLANS_MANAGE: "PLANS_MANAGE (sem efeito nesta versão)",
  SUPPORT_ACCESS: "SUPPORT_ACCESS (sem efeito nesta versão)",
};

export const PERMISSOES_ESTABELECIMENTO: Record<string, string> = {
  AGENDA_VISUALIZAR: "Ver a agenda",
  AGENDA_GERENCIAR: "Operar a agenda (confirmar, iniciar, concluir)",
  AGENDAMENTO_CRIAR: "Criar agendamentos",
  AGENDAMENTO_EDITAR: "Remarcar agendamentos",
  AGENDAMENTO_CANCELAR: "Cancelar agendamentos",
  CONSUMIDORES_VISUALIZAR: "Ver clientes",
  CONSUMIDORES_GERENCIAR: "Cadastrar clientes",
  SERVICOS_VISUALIZAR: "Ver serviços",
  SERVICOS_GERENCIAR: "Gerenciar serviços",
  PROFISSIONAIS_VISUALIZAR: "Ver profissionais",
  PROFISSIONAIS_GERENCIAR: "Gerenciar profissionais e horários",
  CONFIGURACOES_GERENCIAR: "Configurar o agendamento online",
  EQUIPE_GERENCIAR: "Gerenciar equipe e acessos",
};

export const ACOES_HISTORICO: Record<string, string> = {
  TENANT_CREATED: "Estabelecimento criado",
  USER_INVITED: "Convite criado",
  INVITE_RESENT: "Convite reenviado",
  INVITE_REVOKED: "Convite revogado",
  INVITE_ACCEPTED: "Convite aceito",
  USER_UPDATED: "Dados da conta alterados",
  USER_BLOCKED: "Conta bloqueada",
  USER_REACTIVATED: "Conta reativada",
  USER_PERMISSION_CHANGED: "Permissões alteradas",
  MEMBERSHIP_REMOVED: "Vínculo removido",
  PASSWORD_RESET_REQUESTED: "Redefinição de senha enviada",
  PASSWORD_RESET_COMPLETED: "Senha redefinida pelo link",
  PLATFORM_ACCESS_CHANGED: "Acesso de plataforma alterado",
  TENANT_UPDATED: "Dados do estabelecimento alterados",
  TENANT_SUSPENDED: "Estabelecimento suspenso",
  TENANT_ARCHIVED: "Estabelecimento arquivado",
  TENANT_REACTIVATED: "Estabelecimento reativado",
  TENANT_PLAN_CHANGED: "Plano trocado",
  MEMBERSHIP_SUSPENDED: "Acesso de funcionário suspenso",
  MEMBERSHIP_REACTIVATED: "Acesso de funcionário reativado",
};

/** O que dizer sobre o envio do e-mail. "Enviado" é só "o provedor aceitou". */
export function textoEnvio(envio: { status: SituacaoEnvio | string; failure?: string | null }): string {
  switch (envio.status) {
    case "SENT":
      return "E-mail aceito pelo provedor de envio (isso não confirma que a pessoa recebeu).";
    case "FAILED":
      return envio.failure === "SEM_RESPOSTA"
        ? "O provedor de e-mail não respondeu. O envio não foi confirmado; reenvie para emitir outro link."
        : "O provedor de e-mail recusou o envio. Reenvie depois de conferir a configuração.";
    case "NOT_CONFIGURED":
      return "Envio de e-mail não configurado no servidor. O convite existe, mas ninguém recebeu o link; a conta continua sem ativação.";
    default:
      return "Envio ainda não confirmado.";
  }
}

export function corEnvio(status: string): "sucesso" | "erro" | "aviso" | "neutro" {
  if (status === "SENT") return "sucesso";
  if (status === "FAILED") return "erro";
  if (status === "NOT_CONFIGURED") return "aviso";
  return "neutro";
}

export function corConta(status: string): "sucesso" | "aviso" | "erro" {
  if (status === "ACTIVE") return "sucesso";
  if (status === "INVITED") return "aviso";
  return "erro";
}

export function dataHora(instante: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(instante));
}
