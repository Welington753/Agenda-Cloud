// Estado e regras puras do onboarding demonstrável (`/onboarding`). Extraído
// como funções puras — sem localStorage, sem repositório — para serem testáveis
// sem renderizar a tela, no mesmo espírito de `estabelecimentos/rascunho.ts`. A
// persistência (leitura/escrita da chave de demonstração) e a criação do
// estabelecimento de verdade ficam em `onboarding-persistencia.ts` e
// `onboarding-criar.ts`, que dependem deste módulo — nunca o contrário.

import type { CategoriaNegocio, CodigoPlano } from "@/lib/types";

export type EstruturaNegocio = "unico" | "rede";
export type QuantidadeProfissionais = "1" | "2-5" | "6+";
export type ObjetivoOnboarding =
  | "organizar-agenda"
  | "receber-agendamentos-online"
  | "diminuir-faltas"
  | "cadastrar-clientes"
  | "organizar-profissionais"
  | "acompanhar-negocio";

export interface RespostasOnboarding {
  nomeNegocio: string;
  segmento: CategoriaNegocio | null;
  estrutura: EstruturaNegocio | null;
  quantidadeProfissionais: QuantidadeProfissionais | null;
  objetivo: ObjetivoOnboarding | null;
}

export const RESPOSTAS_ONBOARDING_INICIAIS: RespostasOnboarding = {
  nomeNegocio: "",
  segmento: null,
  estrutura: null,
  quantidadeProfissionais: null,
  objetivo: null,
};

export const ETAPAS_ONBOARDING = [
  "Boas-vindas",
  "Negócio",
  "Segmento",
  "Estrutura",
  "Equipe",
  "Objetivo",
  "Revisão",
  "Painel",
] as const;

export const ETAPA_BOAS_VINDAS = 0;
export const ETAPA_NEGOCIO = 1;
export const ETAPA_SEGMENTO = 2;
export const ETAPA_ESTRUTURA = 3;
export const ETAPA_EQUIPE = 4;
export const ETAPA_OBJETIVO = 5;
export const ETAPA_REVISAO = 6;
export const ETAPA_PAINEL = 7;

export const ULTIMA_ETAPA = ETAPAS_ONBOARDING.length - 1;

export interface OpcaoRotulada<T extends string> {
  valor: T;
  rotulo: string;
  descricao?: string;
}

export const OPCOES_ESTRUTURA: OpcaoRotulada<EstruturaNegocio>[] = [
  { valor: "unico", rotulo: "Estabelecimento único", descricao: "Um endereço só." },
  { valor: "rede", rotulo: "Mais de uma unidade", descricao: "Rede com dois ou mais endereços." },
];

export const OPCOES_QUANTIDADE_PROFISSIONAIS: OpcaoRotulada<QuantidadeProfissionais>[] = [
  { valor: "1", rotulo: "Só eu" },
  { valor: "2-5", rotulo: "De 2 a 5 profissionais" },
  { valor: "6+", rotulo: "6 ou mais profissionais" },
];

export const OPCOES_OBJETIVO: OpcaoRotulada<ObjetivoOnboarding>[] = [
  { valor: "organizar-agenda", rotulo: "Organizar a agenda" },
  { valor: "receber-agendamentos-online", rotulo: "Receber agendamentos online" },
  { valor: "diminuir-faltas", rotulo: "Diminuir faltas" },
  { valor: "cadastrar-clientes", rotulo: "Cadastrar clientes" },
  { valor: "organizar-profissionais", rotulo: "Organizar profissionais" },
  { valor: "acompanhar-negocio", rotulo: "Acompanhar o negócio" },
];

/** Só os passos com uma pergunta obrigatória bloqueiam o avanço — boas-vindas,
 * revisão e a tela final de entrada no painel nunca bloqueiam. */
export function podeAvancar(etapa: number, respostas: RespostasOnboarding): boolean {
  switch (etapa) {
    case ETAPA_NEGOCIO:
      return respostas.nomeNegocio.trim().length > 0;
    case ETAPA_SEGMENTO:
      return respostas.segmento !== null;
    case ETAPA_ESTRUTURA:
      return respostas.estrutura !== null;
    case ETAPA_EQUIPE:
      return respostas.quantidadeProfissionais !== null;
    case ETAPA_OBJETIVO:
      return respostas.objetivo !== null;
    default:
      return true;
  }
}

export function proximaEtapa(etapaAtual: number, respostas: RespostasOnboarding): number {
  if (!podeAvancar(etapaAtual, respostas)) return etapaAtual;
  return Math.min(ULTIMA_ETAPA, etapaAtual + 1);
}

export function etapaAnterior(etapaAtual: number): number {
  return Math.max(0, etapaAtual - 1);
}

/** Plano real sugerido a partir das respostas — nunca inventa um plano à parte:
 * usa os mesmos códigos de `src/lib/planos.ts`. Rede sempre exige "pro" porque
 * só ele inclui a feature `multiplasUnidades`. */
export function planoSugerido(respostas: Pick<RespostasOnboarding, "estrutura" | "quantidadeProfissionais">): CodigoPlano {
  if (respostas.estrutura === "rede") return "pro";
  if (respostas.quantidadeProfissionais === "6+") return "pro";
  if (respostas.quantidadeProfissionais === "2-5") return "equipe";
  return "essencial";
}
