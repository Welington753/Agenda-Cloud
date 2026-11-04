// Regra e cálculo da comissão de UM serviço da reserva. Funções puras, sem
// Nest e sem banco: a mesma conta vale na conclusão do atendimento
// (commission-accrual.ts) e nos testes.
//
// REPRESENTAÇÃO (tabela `commission_rules`, já existente):
// - "Percentual": `PERCENTAGE`, pontos-base inteiros de 1 a 10000 (12,5% =
//   1250). Nunca número com vírgula.
// - "Valor fixo": `FIXED`, centavos inteiros a partir de 1.
// - "Sem comissão": regra gravada com `PERCENTAGE` 0. É uma escolha
//   explícita do dono e conta como configurada.
// - "Não configurada": nenhuma regra para o profissional e o serviço.
//
// CÁLCULO (centavos inteiros, nunca float):
// - percentual sobre o preço registrado no item da reserva, arredondado ao
//   centavo mais próximo (meio centavo para cima), item a item; o total da
//   reserva é a soma dos itens;
// - valor fixo: o próprio valor, mesmo sem preço registrado;
// - sem regra, ou percentual sobre item sem preço ("sob consulta"): não há
//   valor (NULL), nunca um zero inventado;
// - parte do estabelecimento = preço − comissão, só quando os dois existem e
//   a comissão não passa do preço.
import { CommissionType } from '../entities/enums/commission-type.enum.js';

export const COMMISSION_KINDS = ['NONE', 'PERCENTAGE', 'FIXED'] as const;
export type CommissionKind = (typeof COMMISSION_KINDS)[number];

/** Teto de um valor fixo: R$ 1.000.000,00, o mesmo de um recebimento. */
export const MAIOR_COMISSAO_FIXA_EM_CENTAVOS = 100_000_000;
export const PONTOS_BASE_100_POR_CENTO = 10_000;

export interface StoredRule {
  type: CommissionType | `${CommissionType}`;
  value: number;
}

/** Como a regra aparece para a tela. `value`: pontos-base (percentual) ou
 * centavos (fixo); `null` em "sem comissão". */
export interface RuleView {
  kind: CommissionKind;
  value: number | null;
}

export function ruleToView(rule: StoredRule): RuleView {
  if (rule.type === CommissionType.PERCENTAGE && rule.value === 0) return { kind: 'NONE', value: null };
  return { kind: rule.type === CommissionType.PERCENTAGE ? 'PERCENTAGE' : 'FIXED', value: rule.value };
}

export function viewToRule(view: RuleView): StoredRule {
  if (view.kind === 'NONE') return { type: CommissionType.PERCENTAGE, value: 0 };
  return { type: view.kind === 'PERCENTAGE' ? CommissionType.PERCENTAGE : CommissionType.FIXED, value: view.value ?? 0 };
}

export interface ItemCommission {
  professionalCents: number | null;
  establishmentCents: number | null;
}

export function percentualEmCentavos(precoCentavos: number, pontosBase: number): number {
  // Inteiros não negativos: (p × b + 5000) / 10000, truncado, é o
  // arredondamento ao centavo mais próximo com meio centavo para cima. O
  // produto fica abaixo de 2^53 (preço ≤ int4, pontos-base ≤ 10000).
  return Math.floor((precoCentavos * pontosBase + PONTOS_BASE_100_POR_CENTO / 2) / PONTOS_BASE_100_POR_CENTO);
}

export function calcularComissaoDoItem(precoCentavos: number | null, regra: StoredRule | null): ItemCommission {
  if (!regra) return { professionalCents: null, establishmentCents: null };
  const comissao =
    regra.type === CommissionType.FIXED
      ? regra.value
      : precoCentavos === null
        ? null
        : percentualEmCentavos(precoCentavos, regra.value);
  if (comissao === null) return { professionalCents: null, establishmentCents: null };
  const resto = precoCentavos === null ? null : precoCentavos - comissao;
  return { professionalCents: comissao, establishmentCents: resto !== null && resto >= 0 ? resto : null };
}

/** Situação de um item apurado, para a conferência. `OK` inclui "sem
 * comissão" (zero escolhido pelo dono). */
export type ItemSituation = 'OK' | 'NAO_CONFIGURADA' | 'SEM_PRECO' | 'ACIMA_DO_PRECO';

export function situacaoDoItem(item: {
  appliedType: string | null;
  priceCents: number | null;
  professionalCents: number | null;
}): ItemSituation {
  if (item.appliedType === null) return 'NAO_CONFIGURADA';
  if (item.professionalCents === null) return 'SEM_PRECO';
  if (item.priceCents !== null && item.professionalCents > item.priceCents) return 'ACIMA_DO_PRECO';
  return 'OK';
}
