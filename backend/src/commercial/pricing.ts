// Preço da assinatura do TimVix: catálogo por plano e ciclo, e o valor
// contratado com cada cliente. Funções puras, sem banco (ver
// docs/plans/portal-da-plataforma.md, seção 4).
//
// - O valor sugerido para registrar um pagamento é o contratado em vigor
//   para aquele cliente, plano e ciclo; sem ele, o do catálogo; sem nenhum,
//   PENDENTE. Pendente nunca vira zero nem gratuidade.
// - Escolher plano e preço não registra pagamento: só o registro manual do
//   pagamento (access-validity.service.ts) cria período.
// - Mudar catálogo ou contrato nunca recalcula o que já foi registrado: o
//   valor de cada período pago fica na linha do período.
// - Nada aqui tem relação com os recebimentos dos atendimentos (`payments/`).
import type { BillingCycle } from './access-periods.js';

export const BILLING_CYCLES: readonly BillingCycle[] = ['MONTHLY', 'QUARTERLY'];

/** De onde veio o valor de um período pago. */
export type AmountSource = 'CONTRACT' | 'CATALOG' | 'ADJUSTED';

/** De onde vem a sugestão do formulário. */
export type SuggestionSource = 'CONTRACT' | 'CATALOG' | 'PENDING';

export interface CyclePricing {
  cycle: BillingCycle;
  /** Preço do catálogo em vigor; `null`: pendente. */
  catalogCents: number | null;
  /** Valor contratado específico em vigor; `null`: segue o catálogo. */
  contractCents: number | null;
  suggestedCents: number | null;
  source: SuggestionSource;
}

export function cyclePricing(cycle: BillingCycle, catalogCents: number | null, contractCents: number | null): CyclePricing {
  if (contractCents !== null) return { cycle, catalogCents, contractCents, suggestedCents: contractCents, source: 'CONTRACT' };
  if (catalogCents !== null) return { cycle, catalogCents, contractCents, suggestedCents: catalogCents, source: 'CATALOG' };
  return { cycle, catalogCents, contractCents, suggestedCents: null, source: 'PENDING' };
}

/** Origem do valor efetivamente registrado: igual ao contratado, igual ao
 * catálogo (sem contrato específico) ou ajustado só neste pagamento. */
export function amountSource(amountCents: number, pricing: CyclePricing): AmountSource {
  if (pricing.contractCents !== null) return amountCents === pricing.contractCents ? 'CONTRACT' : 'ADJUSTED';
  if (pricing.catalogCents !== null && amountCents === pricing.catalogCents) return 'CATALOG';
  return 'ADJUSTED';
}
