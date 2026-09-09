// Registro de planos — a única fonte de verdade sobre o que cada plano inclui
// por padrão. `access-control.ts` cruza isto com `Estabelecimento.featuresDesativadas`
// para decidir o que um tenant específico realmente tem habilitado.

import type { CodigoPlano, Feature } from "./types";

export interface DefinicaoPlano {
  codigo: CodigoPlano;
  nome: string;
  /** `null` = preço ainda não aprovado comercialmente ("não definido").
   * Nunca usar 0 para representar isso — todo consumidor que formata ou faz
   * conta com este campo precisa tratar o `null` explicitamente. */
  precoCentavos: number | null;
  descricaoCurta: string;
  limites: { maxProfissionais: number; maxUnidades: number };
  features: Feature[];
}

export const DEFINICOES_PLANO: Record<CodigoPlano, DefinicaoPlano> = {
  essencial: {
    codigo: "essencial",
    nome: "Essencial",
    precoCentavos: null,
    descricaoCurta: "Agenda, agendamento público e serviços para um profissional só ou uma equipe pequena.",
    limites: { maxProfissionais: 2, maxUnidades: 1 },
    features: ["agenda", "agendamentoPublico", "profissionais"],
  },
  equipe: {
    codigo: "equipe",
    nome: "Gestão",
    precoCentavos: null,
    descricaoCurta: "Tudo do Essencial, mais consumidores, relatórios básicos e gestão de equipe.",
    limites: { maxProfissionais: 5, maxUnidades: 1 },
    features: ["agenda", "agendamentoPublico", "profissionais", "consumidores", "relatorios", "equipe"],
  },
  pro: {
    codigo: "pro",
    nome: "Rede",
    precoCentavos: null,
    descricaoCurta: "Tudo do Gestão, mais unidades extras e personalização avançada. Alguns módulos aparecem como \"em breve\".",
    limites: { maxProfissionais: 20, maxUnidades: 5 },
    features: [
      "agenda",
      "agendamentoPublico",
      "profissionais",
      "consumidores",
      "relatorios",
      "equipe",
      "personalizacaoAvancada",
      "multiplasUnidades",
      // Incluídas contratualmente no Pro, mas SEM implementação real ainda — a
      // interface mostra "Em breve" em vez de fingir que funcionam.
      "listaDeEspera",
      "comissoes",
      "pagamentos",
      "assinaturas",
      "dominioProprio",
    ],
  },
};

/** Features que existem no modelo/plano mas não têm implementação funcional
 * nesta fase — usado só para decidir se mostramos "Em breve" em vez do toggle
 * normal. Nunca finja que uma dessas funciona. */
export const FEATURES_AINDA_NAO_IMPLEMENTADAS: readonly Feature[] = [
  "listaDeEspera",
  "pagamentos",
  "assinaturas",
  "dominioProprio",
];

export const ROTULO_FEATURE: Record<Feature, string> = {
  agenda: "Agenda",
  agendamentoPublico: "Agendamento público",
  profissionais: "Cadastro de profissionais",
  consumidores: "Cadastro de consumidores",
  relatorios: "Relatórios",
  equipe: "Gestão de equipe",
  personalizacaoAvancada: "Personalização avançada",
  multiplasUnidades: "Múltiplas unidades",
  dominioProprio: "Domínio próprio",
  listaDeEspera: "Lista de espera",
  comissoes: "Comissões",
  pagamentos: "Pagamentos",
  assinaturas: "Assinaturas",
};

export function obterDefinicaoPlano(codigo: CodigoPlano): DefinicaoPlano {
  return DEFINICOES_PLANO[codigo];
}
