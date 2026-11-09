// Aplicação de uma regra geral a vários profissionais de uma vez. Funções
// puras, sem Nest e sem banco: a prévia e a aplicação (commissions.service.ts)
// decidem com as MESMAS funções, e a aplicação recusa se a impressão da
// prévia não bater com o estado travado.
//
// Modos (docs/plans/comissoes-aplicacao-em-massa.md):
// - SUBSTITUIR (`REPLACE`): regra geral nova e "Recebe comissão" ligado para
//   todo o alcance, mesmo quem estava desligado.
// - PRESERVAR (`PRESERVE`): só quem recebe comissão e não tem regra geral
//   ganha a regra nova; as demais configurações ficam como estão, inclusive
//   "Recebe comissão" desligado.
// Exceções por serviço (`commission_rules`, commission-exceptions.ts): por
// padrão ficam como estão e continuam valendo antes da regra geral
// (`regraEfetiva`). Só em SUBSTITUIR, com a escolha `REMOVE`, as exceções
// dos profissionais do alcance são removidas junto com a troca da regra
// geral. PRESERVAR nunca remove exceção. Nada já apurado é recalculado.
import { createHash } from 'node:crypto';
import type { CommissionSettings, StoredRule } from './commission-calculation.js';
import { canonicoDasExcecoes, type ExceptionChoice, type StoredException } from './commission-exceptions.js';

export const BULK_MODES = ['REPLACE', 'PRESERVE'] as const;
export type BulkMode = (typeof BULK_MODES)[number];
export const BULK_TARGETS = ['ALL', 'SELECTED'] as const;
export type BulkTarget = (typeof BULK_TARGETS)[number];

/** Teto de profissionais numa aplicação (alcance "Todos" ou escolhidos). */
export const MAXIMO_DA_APLICACAO_EM_MASSA = 200;

/** `CHANGE`: grava a configuração nova e/ou remove as exceções. `PRESERVE`:
 * o modo PRESERVAR mantém uma configuração diferente da nova. `UNCHANGED`:
 * já está como ficaria. */
export type BulkOutcome = 'CHANGE' | 'PRESERVE' | 'UNCHANGED';

export interface CurrentSettings {
  /** `false`: sem linha em `professional_commission_settings`. */
  stored: boolean;
  settings: CommissionSettings;
  /** Exceções por serviço gravadas para o profissional. */
  exceptions: readonly StoredException[];
}

export interface BulkPlan {
  outcome: BulkOutcome;
  next: CommissionSettings;
  /** Grava `next` em `professional_commission_settings`. */
  settingsChange: boolean;
  /** Remove todas as exceções do profissional (só SUBSTITUIR com `REMOVE`). */
  removesExceptions: boolean;
}

const mesmaRegra = (a: StoredRule | null, b: StoredRule | null) =>
  a === null || b === null ? a === b : a.type === b.type && Number(a.value) === Number(b.value);

const mantem = (outcome: BulkOutcome, next: CommissionSettings): BulkPlan => ({
  outcome,
  next,
  settingsChange: false,
  removesExceptions: false,
});

/** `excecoes`: `REMOVE` só tem efeito em SUBSTITUIR (o DTO recusa em
 * PRESERVAR) e só em quem tem alguma exceção. */
export function planejarAplicacao(
  mode: BulkMode,
  regra: StoredRule,
  atual: CurrentSettings,
  excecoes: ExceptionChoice = 'KEEP',
): BulkPlan {
  const nova: CommissionSettings = { receivesCommission: true, defaultRule: { type: regra.type, value: regra.value } };
  const { settings } = atual;
  const jaIgual = atual.stored && settings.receivesCommission && mesmaRegra(settings.defaultRule, nova.defaultRule);
  if (mode === 'REPLACE') {
    const removesExceptions = excecoes === 'REMOVE' && atual.exceptions.length > 0;
    return {
      outcome: !jaIgual || removesExceptions ? 'CHANGE' : 'UNCHANGED',
      next: jaIgual ? settings : nova,
      settingsChange: !jaIgual,
      removesExceptions,
    };
  }
  if (!settings.receivesCommission) return mantem('PRESERVE', settings);
  if (settings.defaultRule === null) return { outcome: 'CHANGE', next: nova, settingsChange: true, removesExceptions: false };
  return mantem(mesmaRegra(settings.defaultRule, nova.defaultRule) ? 'UNCHANGED' : 'PRESERVE', settings);
}

export interface FingerprintInput {
  target: BulkTarget;
  mode: BulkMode;
  rule: StoredRule;
  exceptions: ExceptionChoice;
  professionals: readonly { id: string; active: boolean; current: CurrentSettings }[];
}

/** Impressão da prévia: o pedido (inclusive a escolha das exceções) e o
 * estado de cada profissional do alcance, com as exceções por serviço, em
 * ordem de id. Muda se qualquer um desses mudar; nome e datas não entram. */
export function impressaoDaPrevia(entrada: FingerprintInput): string {
  const canonico = JSON.stringify([
    entrada.target,
    entrada.mode,
    entrada.rule.type,
    Number(entrada.rule.value),
    entrada.exceptions,
    [...entrada.professionals]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((p) => [
        p.id,
        p.active,
        p.current.stored,
        p.current.settings.receivesCommission,
        p.current.settings.defaultRule?.type ?? null,
        p.current.settings.defaultRule ? Number(p.current.settings.defaultRule.value) : null,
        canonicoDasExcecoes(p.current.exceptions),
      ]),
  ]);
  return createHash('sha256').update(canonico).digest('hex');
}

/** Contadores da prévia. `exceptionsRemoved`: total de exceções que serão
 * (ou foram) removidas, somando todos os profissionais. */
export function resumirResultados(itens: readonly { outcome: BulkOutcome; exceptionsRemoved: number }[]) {
  return {
    change: itens.filter((r) => r.outcome === 'CHANGE').length,
    preserve: itens.filter((r) => r.outcome === 'PRESERVE').length,
    unchanged: itens.filter((r) => r.outcome === 'UNCHANGED').length,
    total: itens.length,
    exceptionsRemoved: itens.reduce((soma, r) => soma + r.exceptionsRemoved, 0),
  };
}
