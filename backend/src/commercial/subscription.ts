// Regras puras da assinatura modular: total do catálogo, valor negociado e o
// que muda entre duas versões. Sem banco; quem grava é
// platform/subscription.service.ts.
//
// - Total do catálogo = preço base + preço de cada adicional selecionado.
//   Centavos inteiros, nunca float.
// - Só entra adicional DISPONÍVEL e com preço; "em desenvolvimento" e
//   "planejado" nunca são contratados nem somados.
// - Adicional que depende de outro (`ADDON_REQUIRES`: VENDAS exige ESTOQUE)
//   só entra junto dele. Vale para contratar e para retirar: uma versão com
//   VENDAS e sem ESTOQUE é recusada (`MODULO_DEPENDENTE`), e tirar os dois
//   juntos é permitido.
// - Preço ausente nunca é gratuito: o adicional sem preço é recusado
//   (`PRECO_PENDENTE`).
// - Valor contratado diferente do catálogo exige motivo.
// - Vigência imediata, sem cobrança retroativa nem proporcional: a versão só
//   define o valor recorrente dos PRÓXIMOS períodos registrados.
import { MODULAR_PLAN_NAME, type AddonModule } from './modular-plan.js';

export class SubscriptionRuleError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/** Adicionais que só entram junto de outros (código do catálogo). */
export const ADDON_REQUIRES: Readonly<Record<string, readonly string[]>> = {
  VENDAS: ['ESTOQUE'],
};

export interface SubscriptionChoice {
  addons: readonly string[];
  /** Valor mensal combinado; ausente ou `null`: o total do catálogo. */
  contractedTotalCents?: number | null;
  reason?: string | null;
  teamUserLimit: number;
}

export interface SubscriptionQuote {
  baseCents: number;
  items: { code: string; name: string; priceCents: number }[];
  catalogTotalCents: number;
  contractedTotalCents: number;
  negotiated: boolean;
  reason: string | null;
  teamUserLimit: number;
}

export function quoteSubscription(
  baseCents: number | null,
  catalog: readonly AddonModule[],
  choice: SubscriptionChoice,
  /** Nome atual do essencial no catálogo (só para a mensagem). */
  baseName: string = MODULAR_PLAN_NAME,
): SubscriptionQuote {
  if (baseCents === null) {
    throw new SubscriptionRuleError(
      'PRECO_BASE_PENDENTE',
      `O preço de ${baseName} ainda não foi definido. Defina em Planos e adicionais antes de contratar.`,
    );
  }
  const codigos = [...new Set(choice.addons)].sort();
  for (const code of codigos) {
    const faltam = (ADDON_REQUIRES[code] ?? []).filter((exigido) => !codigos.includes(exigido));
    if (faltam.length) {
      const nome = (c: string) => catalog.find((m) => m.code === c)?.name ?? c;
      throw new SubscriptionRuleError(
        'MODULO_DEPENDENTE',
        `${nome(code)} exige ${faltam.map(nome).join(', ')} na mesma assinatura. ` +
          'Para retirar o que é exigido, retire também o que depende dele.',
        { module: code, requires: faltam },
      );
    }
  }
  const items: SubscriptionQuote['items'] = [];
  for (const code of codigos) {
    const modulo = catalog.find((m) => m.code === code);
    if (!modulo) throw new SubscriptionRuleError('MODULO_DESCONHECIDO', `Adicional ${code} não existe no catálogo.`);
    if (modulo.availability !== 'AVAILABLE' || modulo.featureKey === null) {
      throw new SubscriptionRuleError(
        'MODULO_INDISPONIVEL',
        `${modulo.name} ainda não está disponível para contratação.`,
        { module: code },
      );
    }
    if (modulo.priceCents === null) {
      throw new SubscriptionRuleError(
        'PRECO_PENDENTE',
        `O preço de ${modulo.name} ainda não foi definido. Defina em Planos e adicionais antes de contratar.`,
        { module: code },
      );
    }
    items.push({ code, name: modulo.name, priceCents: modulo.priceCents });
  }
  const catalogTotalCents = items.reduce((soma, i) => soma + i.priceCents, baseCents);
  const contratado = choice.contractedTotalCents ?? catalogTotalCents;
  const negotiated = contratado !== catalogTotalCents;
  const reason = choice.reason?.trim() ? choice.reason.trim() : null;
  if (negotiated && (reason === null || reason.length < 3)) {
    throw new SubscriptionRuleError(
      'MOTIVO_OBRIGATORIO',
      'Informe o motivo do valor negociado (diferente do total do catálogo).',
    );
  }
  return {
    baseCents,
    items,
    catalogTotalCents,
    contractedTotalCents: contratado,
    negotiated,
    reason,
    teamUserLimit: choice.teamUserLimit,
  };
}

export interface SubscriptionSnapshot {
  addons: readonly string[];
  contractedTotalCents: number;
  teamUserLimit: number;
}

export interface SubscriptionDiff {
  added: string[];
  removed: string[];
  previousTotalCents: number | null;
  newTotalCents: number;
  previousTeamUserLimit: number | null;
  newTeamUserLimit: number;
  changed: boolean;
}

export function subscriptionDiff(anterior: SubscriptionSnapshot | null, nova: SubscriptionSnapshot): SubscriptionDiff {
  const antes = new Set(anterior?.addons ?? []);
  const depois = new Set(nova.addons);
  const added = [...depois].filter((c) => !antes.has(c)).sort();
  const removed = [...antes].filter((c) => !depois.has(c)).sort();
  const changed =
    anterior === null ||
    added.length > 0 ||
    removed.length > 0 ||
    anterior.contractedTotalCents !== nova.contractedTotalCents ||
    anterior.teamUserLimit !== nova.teamUserLimit;
  return {
    added,
    removed,
    previousTotalCents: anterior?.contractedTotalCents ?? null,
    newTotalCents: nova.contractedTotalCents,
    previousTeamUserLimit: anterior?.teamUserLimit ?? null,
    newTeamUserLimit: nova.teamUserLimit,
    changed,
  };
}

export interface SeatUsageForLimit {
  used: number;
  activeAccesses: number;
  pendingInvites: number;
}

/** Recusa reduzir o limite abaixo do que está ocupado ou reservado. Nunca
 * suspende nem remove ninguém para caber. */
export function assertLimitCoversUsage(limit: number, usage: SeatUsageForLimit): void {
  if (limit < usage.used) {
    throw new SubscriptionRuleError(
      'LIMITE_ABAIXO_DO_USO',
      `O limite de ${limit} usuário(s) é menor que o uso atual: ${usage.activeAccesses} acesso(s) ativo(s) e ` +
        `${usage.pendingInvites} reservado(s) por convite (${usage.used} no total). ` +
        'Revogue convites ou suspenda acessos antes de reduzir; nada é desativado automaticamente.',
      { used: usage.used, activeAccesses: usage.activeAccesses, pendingInvites: usage.pendingInvites, limit },
    );
  }
}
