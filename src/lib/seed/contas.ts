// Dados simulados de contas: administradores de plataforma, equipe dos
// estabelecimentos, memberships, convites e auditoria.

import { addDays } from "date-fns";
import type { Convite, Feature, Membership, RegistroAuditoria, UsuarioEstabelecimento, UsuarioPlataforma } from "../types";
import { TENANT_BARBEARIA_JR, TENANT_BARBEARIA_VINTAGE, TENANT_BARBEIRO_BASTIAO, TENANT_CLINICA_SORRISO_LEVE, TENANT_DOM_NAVALHA } from "./shared";

export function gerarUsuariosPlataformaSeed(): UsuarioPlataforma[] {
  return [
    {
      id: "mstr-ana-beatriz",
      nome: "Ana Beatriz Ferreira",
      email: "ana.ferreira@agendabarber.com",
      papel: "MASTER_OWNER",
      status: "ativo",
      permissoesExtras: [],
      criadoEm: addDays(new Date(), -600).toISOString(),
      ultimoAcessoSimuladoEm: addDays(new Date(), -1).toISOString(),
    },
    {
      id: "mstr-rodrigo-salles",
      nome: "Rodrigo Salles",
      email: "rodrigo.salles@agendabarber.com",
      papel: "MASTER_ADMIN",
      status: "ativo",
      // Pode gerenciar estabelecimentos, mas não administradores nem planos —
      // demonstra permissão configurável por administrador.
      permissoesExtras: ["estabelecimentos.gerenciar"],
      criadoEm: addDays(new Date(), -200).toISOString(),
      ultimoAcessoSimuladoEm: addDays(new Date(), -3).toISOString(),
    },
    {
      id: "mstr-camila-duarte",
      nome: "Camila Duarte",
      email: "camila.duarte@agendabarber.com",
      papel: "MASTER_SUPPORT",
      status: "ativo",
      permissoesExtras: [],
      criadoEm: addDays(new Date(), -90).toISOString(),
      ultimoAcessoSimuladoEm: addDays(new Date(), -7).toISOString(),
    },
  ];
}

export function gerarUsuariosEstabelecimentoSeed(): UsuarioEstabelecimento[] {
  return [
    { id: "user-marcelo-nogueira", nome: "Marcelo Nogueira", email: "marcelo@domnavalha.com.br", telefone: "(11) 98888-1111", status: "ativo", criadoEm: addDays(new Date(), -220).toISOString(), ultimoAcessoSimuladoEm: addDays(new Date(), -1).toISOString() },
    { id: "user-juliana-prado", nome: "Juliana Prado", email: "juliana@domnavalha.com.br", telefone: "(11) 98888-2222", status: "ativo", criadoEm: addDays(new Date(), -180).toISOString(), ultimoAcessoSimuladoEm: addDays(new Date(), -2).toISOString() },
    { id: "user-debora-alves", nome: "Débora Alves", email: "debora@domnavalha.com.br", telefone: "(11) 98888-3333", status: "ativo", criadoEm: addDays(new Date(), -150).toISOString(), ultimoAcessoSimuladoEm: addDays(new Date(), -5).toISOString() },
    { id: "user-joao-silva", nome: "João Silva", email: "joao.silva@domnavalha.com.br", telefone: "(11) 98888-4444", status: "ativo", criadoEm: addDays(new Date(), -220).toISOString(), ultimoAcessoSimuladoEm: addDays(new Date(), -1).toISOString() },
    { id: "user-mariana-alves", nome: "Dra. Mariana Alves", email: "mariana@sorrisoleve.com.br", telefone: "(11) 97777-1111", status: "ativo", criadoEm: addDays(new Date(), -60).toISOString(), ultimoAcessoSimuladoEm: addDays(new Date(), -1).toISOString() },
    { id: "user-lucas-ferreira", nome: "Dr. Lucas Ferreira", email: "lucas@sorrisoleve.com.br", telefone: "(11) 97777-2222", status: "ativo", criadoEm: addDays(new Date(), -60).toISOString(), ultimoAcessoSimuladoEm: addDays(new Date(), -4).toISOString() },
    { id: "user-renata-ribeiro", nome: "Renata Ribeiro", email: "renata@barbeariajr.com.br", telefone: "(11) 96222-1111", status: "ativo", criadoEm: addDays(new Date(), -45).toISOString(), ultimoAcessoSimuladoEm: addDays(new Date(), -1).toISOString() },
    { id: "user-jonas-ribeiro", nome: "Jonas Ribeiro", email: "jonas@barbeariajr.com.br", telefone: "(11) 96222-2222", status: "ativo", criadoEm: addDays(new Date(), -45).toISOString(), ultimoAcessoSimuladoEm: addDays(new Date(), -2).toISOString() },
    { id: "user-bastiao-nunes", nome: "Bastião Nunes", email: "bastiao@barbeirobastiao.com.br", telefone: "(11) 95111-1111", status: "ativo", criadoEm: addDays(new Date(), -90).toISOString(), ultimoAcessoSimuladoEm: addDays(new Date(), -3).toISOString() },
    // Convite ainda pendente (ver gerarConvitesSeed) — a conta já existe com
    // status "convidado" porque, na simulação, o registro é criado no convite e
    // só vira "ativo" quando a pessoa "aceita".
    { id: "user-felipe-cardoso", nome: "Felipe Cardoso", email: "felipe.cardoso@barbeariajr.com.br", telefone: "(11) 96222-3333", status: "convidado", criadoEm: addDays(new Date(), -2).toISOString() },
  ];
}

export function gerarMembershipsSeed(): Membership[] {
  return [
    { id: "memb-marcelo-dn", usuarioId: "user-marcelo-nogueira", tenantId: TENANT_DOM_NAVALHA, papel: "dono", permissoesLiberadas: [], permissoesNegadas: [], criadoEm: addDays(new Date(), -220).toISOString() },
    { id: "memb-juliana-dn", usuarioId: "user-juliana-prado", tenantId: TENANT_DOM_NAVALHA, papel: "gerente", permissoesLiberadas: [], permissoesNegadas: [], criadoEm: addDays(new Date(), -180).toISOString() },
    { id: "memb-debora-dn", usuarioId: "user-debora-alves", tenantId: TENANT_DOM_NAVALHA, papel: "recepcionista", permissoesLiberadas: [], permissoesNegadas: [], criadoEm: addDays(new Date(), -150).toISOString() },
    { id: "memb-joao-dn", usuarioId: "user-joao-silva", tenantId: TENANT_DOM_NAVALHA, papel: "profissional", profissionalId: "prof-joao-silva", permissoesLiberadas: [], permissoesNegadas: [], criadoEm: addDays(new Date(), -220).toISOString() },
    { id: "memb-mariana-cl", usuarioId: "user-mariana-alves", tenantId: TENANT_CLINICA_SORRISO_LEVE, papel: "dono", permissoesLiberadas: [], permissoesNegadas: [], criadoEm: addDays(new Date(), -60).toISOString() },
    { id: "memb-lucas-cl", usuarioId: "user-lucas-ferreira", tenantId: TENANT_CLINICA_SORRISO_LEVE, papel: "profissional", profissionalId: "prof-lucas-ferreira", permissoesLiberadas: [], permissoesNegadas: [], criadoEm: addDays(new Date(), -60).toISOString() },
    { id: "memb-renata-jr", usuarioId: "user-renata-ribeiro", tenantId: TENANT_BARBEARIA_JR, papel: "dono", permissoesLiberadas: [], permissoesNegadas: [], criadoEm: addDays(new Date(), -45).toISOString() },
    // Exemplo de ajuste individual: Jonas é profissional, mas ganhou acesso a
    // relatórios (permissoesLiberadas) mesmo essa feature estando desativada
    // pelo master neste tenant (o cálculo de acesso bloquearia de qualquer forma
    // pela feature — este registro mostra que "liberação de papel" e "feature
    // ligada" são checagens independentes).
    { id: "memb-jonas-jr", usuarioId: "user-jonas-ribeiro", tenantId: TENANT_BARBEARIA_JR, papel: "profissional", profissionalId: "prof-jonas-ribeiro", permissoesLiberadas: ["relatorios.visualizar"], permissoesNegadas: [], criadoEm: addDays(new Date(), -45).toISOString() },
    { id: "memb-bastiao-bb", usuarioId: "user-bastiao-nunes", tenantId: TENANT_BARBEIRO_BASTIAO, papel: "dono", profissionalId: "prof-bastiao-nunes", permissoesLiberadas: [], permissoesNegadas: [], criadoEm: addDays(new Date(), -90).toISOString() },
  ];
}

export function gerarConvitesSeed(): Convite[] {
  return [
    {
      id: "conv-jonas-jr",
      tipo: "estabelecimento",
      nome: "Jonas Ribeiro",
      email: "jonas@barbeariajr.com.br",
      tenantId: TENANT_BARBEARIA_JR,
      papel: "profissional",
      status: "aceito",
      token: "tok-conv-jonas-jr",
      criadoEm: addDays(new Date(), -46).toISOString(),
      expiraEm: addDays(new Date(), -39).toISOString(),
      aceitoEm: addDays(new Date(), -45).toISOString(),
      usuarioIdGerado: "user-jonas-ribeiro",
    },
    {
      id: "conv-felipe-jr",
      tipo: "estabelecimento",
      nome: "Felipe Cardoso",
      email: "felipe.cardoso@barbeariajr.com.br",
      tenantId: TENANT_BARBEARIA_JR,
      papel: "recepcionista",
      status: "pendente",
      token: "tok-conv-felipe-jr",
      criadoEm: addDays(new Date(), -2).toISOString(),
      expiraEm: addDays(new Date(), 5).toISOString(),
    },
    {
      id: "conv-antigo-vintage",
      tipo: "estabelecimento",
      nome: "Sérgio Matos",
      email: "sergio@barbeariavintage.com.br",
      tenantId: TENANT_BARBEARIA_VINTAGE,
      papel: "dono",
      status: "expirado",
      token: "tok-conv-antigo-vintage",
      criadoEm: addDays(new Date(), -410).toISOString(),
      expiraEm: addDays(new Date(), -403).toISOString(),
    },
    {
      id: "conv-rodrigo-master",
      tipo: "plataforma",
      nome: "Rodrigo Salles",
      email: "rodrigo.salles@agendabarber.com",
      papel: "MASTER_ADMIN",
      status: "aceito",
      token: "tok-conv-rodrigo-master",
      criadoEm: addDays(new Date(), -201).toISOString(),
      expiraEm: addDays(new Date(), -194).toISOString(),
      aceitoEm: addDays(new Date(), -200).toISOString(),
      usuarioIdGerado: "mstr-rodrigo-salles",
    },
  ];
}

export function gerarAuditoriaSeed(): RegistroAuditoria[] {
  const feature: Feature = "relatorios";
  return [
    {
      id: "audit-001",
      em: addDays(new Date(), -220).toISOString(),
      acao: "tenant.criado",
      usuarioResponsavelId: "mstr-ana-beatriz",
      usuarioResponsavelNome: "Ana Beatriz Ferreira",
      tenantId: TENANT_DOM_NAVALHA,
      resumo: "Estabelecimento Barbearia Dom Navalha criado com plano Pro.",
    },
    {
      id: "audit-002",
      em: addDays(new Date(), -60).toISOString(),
      acao: "tenant.criado",
      usuarioResponsavelId: "mstr-ana-beatriz",
      usuarioResponsavelNome: "Ana Beatriz Ferreira",
      tenantId: TENANT_CLINICA_SORRISO_LEVE,
      resumo: "Estabelecimento Clínica Sorriso Leve criado com plano Equipe.",
    },
    {
      id: "audit-003",
      em: addDays(new Date(), -45).toISOString(),
      acao: "tenant.criado",
      usuarioResponsavelId: "mstr-rodrigo-salles",
      usuarioResponsavelNome: "Rodrigo Salles",
      tenantId: TENANT_BARBEARIA_JR,
      resumo: "Estabelecimento Barbearia JR criado com plano Equipe.",
    },
    {
      id: "audit-004",
      em: addDays(new Date(), -44).toISOString(),
      acao: "tenant.feature_alterada",
      usuarioResponsavelId: "mstr-rodrigo-salles",
      usuarioResponsavelNome: "Rodrigo Salles",
      tenantId: TENANT_BARBEARIA_JR,
      resumo: "Módulo de relatórios desativado por exceção.",
      dadosAnteriores: { featuresDesativadas: [] },
      dadosPosteriores: { featuresDesativadas: [feature] },
    },
    {
      id: "audit-005",
      em: addDays(new Date(), -30).toISOString(),
      acao: "tenant.suspenso",
      usuarioResponsavelId: "mstr-ana-beatriz",
      usuarioResponsavelNome: "Ana Beatriz Ferreira",
      tenantId: TENANT_BARBEARIA_VINTAGE,
      resumo: "Estabelecimento suspenso por inadimplência.",
      dadosAnteriores: { status: "inadimplente" },
      dadosPosteriores: { status: "suspenso", motivoSuspensao: "Pagamento em atraso há mais de 30 dias." },
    },
    {
      id: "audit-006",
      em: addDays(new Date(), -7).toISOString(),
      acao: "suporte.acessado",
      usuarioResponsavelId: "mstr-camila-duarte",
      usuarioResponsavelNome: "Camila Duarte",
      tenantId: TENANT_DOM_NAVALHA,
      resumo: "Acesso de suporte para investigar dúvida sobre remarcação.",
    },
    {
      id: "audit-007",
      em: addDays(new Date(), -2).toISOString(),
      acao: "usuario.convidado",
      usuarioResponsavelId: "user-renata-ribeiro",
      usuarioResponsavelNome: "Renata Ribeiro",
      tenantId: TENANT_BARBEARIA_JR,
      resumo: "Convite de recepcionista enviado para Felipe Cardoso.",
    },
  ];
}
