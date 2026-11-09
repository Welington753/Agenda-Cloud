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
// Nos dois, as exceções por serviço (`commission_rules`) não mudam e
// continuam valendo antes da regra geral (`regraEfetiva`), e nada já apurado
// é recalculado.
import { createHash } from 'node:crypto';
import type { CommissionSettings, StoredRule } from './commission-calculation.js';

export const BULK_MODES = ['REPLACE', 'PRESERVE'] as const;
export type BulkMode = (typeof BULK_MODES)[number];
export const BULK_TARGETS = ['ALL', 'SELECTED'] as const;
export type BulkTarget = (typeof BULK_TARGETS)[number];

/** Teto de profissionais numa aplicação (alcance "Todos" ou escolhidos). */
export const MAXIMO_DA_APLICACAO_EM_MASSA = 200;

/** `CHANGE`: grava a configuração nova. `PRESERVE`: o modo PRESERVAR mantém
 * uma configuração diferente da nova. `UNCHANGED`: já está como ficaria. */
export type BulkOutcome = 'CHANGE' | 'PRESERVE' | 'UNCHANGED';

export interface CurrentSettings {
  /** `false`: sem linha em `professional_commission_settings`. */
  stored: boolean;
  settings: CommissionSettings;
}

export interface BulkPlan {
  outcome: BulkOutcome;
  next: CommissionSettings;
}

const mesmaRegra = (a: StoredRule | null, b: StoredRule | null) =>
  a === null || b === null ? a === b : a.type === b.type && Number(a.value) === Number(b.value);

export function planejarAplicacao(mode: BulkMode, regra: StoredRule, atual: CurrentSettings): BulkPlan {
  const nova: CommissionSettings = { receivesCommission: true, defaultRule: { type: regra.type, value: regra.value } };
  const { settings } = atual;
  const jaIgual = atual.stored && settings.receivesCommission && mesmaRegra(settings.defaultRule, nova.defaultRule);
  if (mode === 'REPLACE') return jaIgual ? { outcome: 'UNCHANGED', next: settings } : { outcome: 'CHANGE', next: nova };
  if (!settings.receivesCommission) return { outcome: 'PRESERVE', next: settings };
  if (settings.defaultRule === null) return { outcome: 'CHANGE', next: nova };
  return mesmaRegra(settings.defaultRule, nova.defaultRule)
    ? { outcome: 'UNCHANGED', next: settings }
    : { outcome: 'PRESERVE', next: settings };
}

export interface FingerprintInput {
  target: BulkTarget;
  mode: BulkMode;
  rule: StoredRule;
  professionals: readonly { id: string; active: boolean; current: CurrentSettings }[];
}

/** Impressão da prévia: o pedido e o estado de cada profissional do alcance,
 * em ordem de id. Muda se qualquer um desses mudar; nome e datas não entram. */
export function impressaoDaPrevia(entrada: FingerprintInput): string {
  const canonico = JSON.stringify([
    entrada.target,
    entrada.mode,
    entrada.rule.type,
    Number(entrada.rule.value),
    [...entrada.professionals]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((p) => [
        p.id,
        p.active,
        p.current.stored,
        p.current.settings.receivesCommission,
        p.current.settings.defaultRule?.type ?? null,
        p.current.settings.defaultRule ? Number(p.current.settings.defaultRule.value) : null,
      ]),
  ]);
  return createHash('sha256').update(canonico).digest('hex');
}

export function resumirResultados(resultados: readonly BulkOutcome[]) {
  return {
    change: resultados.filter((r) => r === 'CHANGE').length,
    preserve: resultados.filter((r) => r === 'PRESERVE').length,
    unchanged: resultados.filter((r) => r === 'UNCHANGED').length,
    total: resultados.length,
  };
}
