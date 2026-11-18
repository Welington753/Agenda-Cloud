// Regras puras da edição do catálogo modular (Agendamento essencial e
// adicionais) em Planos e adicionais. Sem banco; quem grava é
// platform/modular-catalog.service.ts.
//
// - Nome, descrição e preço mensal padrão mudam juntos, numa transação.
// - Repetir o mesmo pedido (rede caiu) não grava de novo: se o estado atual
//   já é o pedido, nada muda (idempotente pelo estado).
// - A tela manda o que leu (`expected`); se outra tela mudou antes, 409.
// - Um preço definido nunca volta a ficar pendente.
// - Dois itens do catálogo não ficam com o mesmo nome (sem diferença de
//   maiúsculas, acentos ou espaços), para ninguém contratar o item errado.
// - Código, recurso, disponibilidade e vínculos nunca entram aqui.
import { SubscriptionRuleError } from './subscription.js';

export interface CatalogItemState {
  name: string;
  description: string;
  /** Preço mensal padrão em vigor; `null`: pendente. */
  priceCents: number | null;
}

export type CatalogEditPlan =
  | { kind: 'UNCHANGED' }
  | { kind: 'CHANGE'; name: boolean; description: boolean; price: boolean };

const igual = (a: CatalogItemState, b: CatalogItemState) =>
  a.name === b.name && a.description === b.description && a.priceCents === b.priceCents;

/** O que muda entre o estado atual e o pedido, ou por que recusar. */
export function planCatalogEdit(
  current: CatalogItemState,
  expected: CatalogItemState,
  desired: CatalogItemState,
): CatalogEditPlan {
  if (igual(current, desired)) return { kind: 'UNCHANGED' };
  if (!igual(current, expected)) {
    throw new SubscriptionRuleError(
      'ALTERADO_POR_OUTRA_TELA',
      'O catálogo mudou desde que você abriu a tela. Recarregue e confira antes de salvar.',
    );
  }
  if (desired.priceCents === null && current.priceCents !== null) {
    throw new SubscriptionRuleError(
      'PRECO_OBRIGATORIO',
      'Informe o preço mensal padrão: um preço já definido não volta a ficar pendente.',
    );
  }
  return {
    kind: 'CHANGE',
    name: current.name !== desired.name,
    description: current.description !== desired.description,
    price: current.priceCents !== desired.priceCents,
  };
}

/** Chave de comparação de nomes: sem acentos, maiúsculas ou espaços extras. */
export function catalogNameKey(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Recusa nome igual ao de outro item do catálogo. */
export function assertUniqueCatalogName(nome: string, outros: readonly { name: string }[]): void {
  const chave = catalogNameKey(nome);
  const repetido = outros.find((o) => catalogNameKey(o.name) === chave);
  if (repetido) {
    throw new SubscriptionRuleError(
      'NOME_REPETIDO',
      `Já existe um item do catálogo chamado "${repetido.name}". Escolha outro nome.`,
    );
  }
}
