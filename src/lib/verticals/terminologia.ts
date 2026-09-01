// Terminologia por categoria de negócio. Este é o ÚNICO lugar do projeto que deve
// conhecer palavras específicas de nicho fora dos dados simulados de cada tenant.
// Componentes compartilhados nunca devem escrever "barbeiro", "paciente" etc.
// diretamente — sempre devem receber a `Terminologia` resolvida a partir da
// categoria do estabelecimento (via `useTenant()` no painel/agenda do profissional,
// ou calculada a partir do `estabelecimento` já carregado nas páginas públicas).

import type { CategoriaNegocio } from "@/lib/types";

export interface TermoGenero {
  singular: string;
  plural: string;
  artigo: "o" | "a";
}

export interface Terminologia {
  estabelecimento: TermoGenero;
  profissional: TermoGenero;
  consumidor: TermoGenero;
  servico: TermoGenero;
  agendamento: TermoGenero;
  /** Rótulo curto para seções/menus que se referem à equipe (ex.: nav do painel). */
  equipe: string;
}

const GENERICA: Terminologia = {
  estabelecimento: { singular: "Estabelecimento", plural: "Estabelecimentos", artigo: "o" },
  profissional: { singular: "Profissional", plural: "Profissionais", artigo: "o" },
  consumidor: { singular: "Cliente", plural: "Clientes", artigo: "o" },
  servico: { singular: "Serviço", plural: "Serviços", artigo: "o" },
  agendamento: { singular: "Agendamento", plural: "Agendamentos", artigo: "o" },
  equipe: "Profissionais",
};

const TERMINOLOGIA_POR_CATEGORIA: Record<CategoriaNegocio, Terminologia> = {
  barbearia: {
    estabelecimento: { singular: "Barbearia", plural: "Barbearias", artigo: "a" },
    profissional: { singular: "Barbeiro", plural: "Barbeiros", artigo: "o" },
    consumidor: { singular: "Cliente", plural: "Clientes", artigo: "o" },
    servico: { singular: "Serviço", plural: "Serviços", artigo: "o" },
    agendamento: { singular: "Horário", plural: "Horários", artigo: "o" },
    equipe: "Barbeiros",
  },
  salao_beleza: {
    estabelecimento: { singular: "Salão", plural: "Salões", artigo: "o" },
    profissional: { singular: "Profissional", plural: "Profissionais", artigo: "o" },
    consumidor: { singular: "Cliente", plural: "Clientes", artigo: "o" },
    servico: { singular: "Serviço", plural: "Serviços", artigo: "o" },
    agendamento: { singular: "Horário", plural: "Horários", artigo: "o" },
    equipe: "Profissionais",
  },
  clinica: {
    estabelecimento: { singular: "Clínica", plural: "Clínicas", artigo: "a" },
    profissional: { singular: "Especialista", plural: "Especialistas", artigo: "o" },
    consumidor: { singular: "Paciente", plural: "Pacientes", artigo: "o" },
    servico: { singular: "Procedimento", plural: "Procedimentos", artigo: "o" },
    agendamento: { singular: "Consulta", plural: "Consultas", artigo: "a" },
    equipe: "Especialistas",
  },
  clinica_odontologica: {
    estabelecimento: { singular: "Clínica", plural: "Clínicas", artigo: "a" },
    profissional: { singular: "Dentista", plural: "Dentistas", artigo: "o" },
    consumidor: { singular: "Paciente", plural: "Pacientes", artigo: "o" },
    servico: { singular: "Procedimento", plural: "Procedimentos", artigo: "o" },
    agendamento: { singular: "Consulta", plural: "Consultas", artigo: "a" },
    equipe: "Dentistas",
  },
  estetica: {
    estabelecimento: { singular: "Clínica de estética", plural: "Clínicas de estética", artigo: "a" },
    profissional: { singular: "Esteticista", plural: "Esteticistas", artigo: "a" },
    consumidor: { singular: "Cliente", plural: "Clientes", artigo: "o" },
    servico: { singular: "Procedimento", plural: "Procedimentos", artigo: "o" },
    agendamento: { singular: "Sessão", plural: "Sessões", artigo: "a" },
    equipe: "Esteticistas",
  },
  tatuagem: {
    estabelecimento: { singular: "Estúdio", plural: "Estúdios", artigo: "o" },
    profissional: { singular: "Tatuador", plural: "Tatuadores", artigo: "o" },
    consumidor: { singular: "Cliente", plural: "Clientes", artigo: "o" },
    servico: { singular: "Serviço", plural: "Serviços", artigo: "o" },
    agendamento: { singular: "Sessão", plural: "Sessões", artigo: "a" },
    equipe: "Tatuadores",
  },
  petshop: {
    estabelecimento: { singular: "Pet shop", plural: "Pet shops", artigo: "o" },
    profissional: { singular: "Groomer", plural: "Groomers", artigo: "o" },
    consumidor: { singular: "Tutor", plural: "Tutores", artigo: "o" },
    servico: { singular: "Serviço", plural: "Serviços", artigo: "o" },
    agendamento: { singular: "Agendamento", plural: "Agendamentos", artigo: "o" },
    equipe: "Groomers",
  },
  outro: GENERICA,
};

export function obterTerminologia(categoria: CategoriaNegocio | undefined): Terminologia {
  if (!categoria) return GENERICA;
  return TERMINOLOGIA_POR_CATEGORIA[categoria] ?? GENERICA;
}

export const CATEGORIAS_NEGOCIO: { valor: CategoriaNegocio; rotulo: string }[] = [
  { valor: "barbearia", rotulo: "Barbearia" },
  { valor: "salao_beleza", rotulo: "Salão de beleza" },
  { valor: "clinica", rotulo: "Clínica" },
  { valor: "clinica_odontologica", rotulo: "Clínica odontológica" },
  { valor: "estetica", rotulo: "Estética" },
  { valor: "tatuagem", rotulo: "Tatuagem" },
  { valor: "petshop", rotulo: "Pet shop" },
  { valor: "outro", rotulo: "Outro" },
];
