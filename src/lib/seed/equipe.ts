// Dados simulados dos profissionais de cada tenant.

import type { DiaSemana, Profissional } from "../types";
import {
  DIAS_SEG_A_SAB,
  DIAS_SEG_A_SEX,
  DIAS_TER_A_SAB,
  TENANT_BARBEARIA_JR,
  TENANT_BARBEIRO_BASTIAO,
  TENANT_CLINICA_SORRISO_LEVE,
  TENANT_DOM_NAVALHA,
} from "./shared";

function horarioSemanal(
  dias: DiaSemana[],
  base: { inicio: string; fim: string; almocoInicio?: string; almocoFim?: string },
  extra?: Partial<Record<number, Partial<{ inicio: string; fim: string }>>>
) {
  return dias.map((dia) => ({
    diaSemana: dia,
    ativo: true,
    inicio: extra?.[dia]?.inicio ?? base.inicio,
    fim: extra?.[dia]?.fim ?? base.fim,
    almocoInicio: base.almocoInicio,
    almocoFim: base.almocoFim,
  }));
}

export function gerarProfissionaisSeed(): Profissional[] {
  return [
    {
      id: "prof-joao-silva",
      tenantId: TENANT_DOM_NAVALHA,
      unidadeId: "unidade-dom-navalha",
      nome: "João Silva",
      avatarIniciais: "JS",
      corAvatar: "#B5651D",
      servicosIds: ["serv-corte-tradicional", "serv-corte-degrade", "serv-barba", "serv-corte-barba", "serv-corte-infantil"],
      horarios: horarioSemanal(DIAS_TER_A_SAB, { inicio: "09:00", fim: "19:00", almocoInicio: "12:00", almocoFim: "13:00" }),
      agendamentoOnlineAtivo: true,
      ativo: true,
    },
    {
      id: "prof-pedro-martins",
      tenantId: TENANT_DOM_NAVALHA,
      unidadeId: "unidade-dom-navalha",
      nome: "Pedro Martins",
      avatarIniciais: "PM",
      corAvatar: "#3B5A6B",
      servicosIds: ["serv-corte-tradicional", "serv-corte-degrade", "serv-barba", "serv-corte-barba"],
      horarios: horarioSemanal(
        DIAS_TER_A_SAB,
        { inicio: "09:00", fim: "19:00", almocoInicio: "12:00", almocoFim: "13:00" },
        { 6: { fim: "14:00" } }
      ),
      agendamentoOnlineAtivo: true,
      ativo: true,
    },
    {
      id: "prof-rafael-costa",
      tenantId: TENANT_DOM_NAVALHA,
      unidadeId: "unidade-dom-navalha",
      nome: "Rafael Costa",
      avatarIniciais: "RC",
      corAvatar: "#6B4226",
      servicosIds: ["serv-corte-degrade", "serv-barba", "serv-corte-barba"],
      horarios: horarioSemanal([3, 4, 5, 6], { inicio: "10:00", fim: "19:00", almocoInicio: "13:00", almocoFim: "14:00" }),
      agendamentoOnlineAtivo: true,
      ativo: true,
    },
    {
      id: "prof-mariana-alves",
      tenantId: TENANT_CLINICA_SORRISO_LEVE,
      unidadeId: "unidade-clinica-sorriso-leve",
      nome: "Dra. Mariana Alves",
      avatarIniciais: "MA",
      corAvatar: "#1C6E8C",
      servicosIds: ["serv-avaliacao-inicial", "serv-limpeza", "serv-clareamento"],
      horarios: horarioSemanal(DIAS_SEG_A_SEX, { inicio: "08:00", fim: "18:00", almocoInicio: "12:00", almocoFim: "13:00" }),
      agendamentoOnlineAtivo: true,
      ativo: true,
    },
    {
      id: "prof-lucas-ferreira",
      tenantId: TENANT_CLINICA_SORRISO_LEVE,
      unidadeId: "unidade-clinica-sorriso-leve",
      nome: "Dr. Lucas Ferreira",
      avatarIniciais: "LF",
      corAvatar: "#3E7C59",
      servicosIds: ["serv-avaliacao-inicial", "serv-limpeza"],
      horarios: horarioSemanal([2, 3, 4, 5], { inicio: "08:30", fim: "17:30", almocoInicio: "12:30", almocoFim: "13:30" }),
      agendamentoOnlineAtivo: true,
      ativo: true,
    },
    {
      id: "prof-jonas-ribeiro",
      tenantId: TENANT_BARBEARIA_JR,
      unidadeId: "unidade-barbearia-jr",
      nome: "Jonas Ribeiro",
      avatarIniciais: "JR",
      corAvatar: "#D4A017",
      servicosIds: ["serv-jr-corte", "serv-jr-barba", "serv-jr-combo"],
      horarios: horarioSemanal(DIAS_SEG_A_SAB, { inicio: "10:00", fim: "21:00", almocoInicio: "13:00", almocoFim: "14:00" }),
      agendamentoOnlineAtivo: true,
      ativo: true,
    },
    {
      id: "prof-kayky-souza",
      tenantId: TENANT_BARBEARIA_JR,
      unidadeId: "unidade-barbearia-jr",
      nome: "Kayky Souza",
      avatarIniciais: "KS",
      corAvatar: "#8A6D3B",
      servicosIds: ["serv-jr-corte", "serv-jr-combo"],
      horarios: horarioSemanal(
        DIAS_SEG_A_SAB,
        { inicio: "12:00", fim: "21:00", almocoInicio: "16:00", almocoFim: "16:30" },
        { 6: { inicio: "10:00", fim: "18:00" } }
      ),
      agendamentoOnlineAtivo: true,
      ativo: true,
    },
    {
      id: "prof-bastiao-nunes",
      tenantId: TENANT_BARBEIRO_BASTIAO,
      unidadeId: "unidade-barbeiro-bastiao",
      nome: "Bastião Nunes",
      avatarIniciais: "BN",
      corAvatar: "#6B4226",
      servicosIds: ["serv-bast-corte", "serv-bast-barba"],
      horarios: horarioSemanal(DIAS_TER_A_SAB, { inicio: "09:00", fim: "18:00", almocoInicio: "12:00", almocoFim: "13:30" }),
      agendamentoOnlineAtivo: true,
      ativo: true,
    },
  ];
}
