// Quantidades do estoque: inteiros em milésimos da unidade do produto
// (1 UN = 1000; 1,5 KG = 1500). Nunca número com vírgula: a tela converte o
// texto digitado em milésimos, e a API só confere o inteiro. Sem conversão
// entre unidades.
import {
  MAX_BALANCE_MILLI,
  MAX_MOVEMENT_MILLI,
  MILLI,
  STOCK_DECIMAL_UNITS,
  STOCK_MOVEMENT_KINDS,
  STOCK_PURPOSES,
  STOCK_UNITS,
} from '../migrations/1794096000000-StockModule.js';

export { MAX_BALANCE_MILLI, MAX_MOVEMENT_MILLI, MILLI, STOCK_MOVEMENT_KINDS, STOCK_PURPOSES, STOCK_UNITS };

export type StockUnit = (typeof STOCK_UNITS)[number];
export type StockPurpose = (typeof STOCK_PURPOSES)[number];
export type StockMovementKind = (typeof STOCK_MOVEMENT_KINDS)[number];

/** Tipos que a tela registra à mão (saldo inicial nasce com o produto;
 * ajuste, da conferência; estorno, da rota própria). */
export const MANUAL_MOVEMENT_KINDS = ['ENTRADA_COMPRA', 'SAIDA_VENDA', 'SAIDA_CONSUMO', 'SAIDA_PERDA'] as const;
export type ManualMovementKind = (typeof MANUAL_MOVEMENT_KINDS)[number];

/** Tipos que exigem motivo (mínimo de 3 caracteres). */
export const KINDS_WITH_REQUIRED_REASON: readonly StockMovementKind[] = ['SAIDA_PERDA', 'AJUSTE_CONFERENCIA', 'ESTORNO'];

/** Tipos que podem ser estornados (ajuste e estorno se corrigem com nova
 * conferência). */
export const REVERSIBLE_KINDS: readonly StockMovementKind[] = [
  'SALDO_INICIAL',
  'ENTRADA_COMPRA',
  'SAIDA_VENDA',
  'SAIDA_CONSUMO',
  'SAIDA_PERDA',
];

export function aceitaDecimais(unit: StockUnit): boolean {
  return (STOCK_DECIMAL_UNITS as readonly string[]).includes(unit);
}

/** A quantidade respeita as casas da unidade (UN, CX… só inteiras). */
export function quantidadeValidaNaUnidade(milli: number, unit: StockUnit): boolean {
  return Number.isSafeInteger(milli) && (aceitaDecimais(unit) || milli % MILLI === 0);
}

/** Sinal do movimento: entrada soma, saída tira. */
export function deltaDoTipo(kind: ManualMovementKind, quantidadeMilli: number): number {
  return kind === 'ENTRADA_COMPRA' ? quantidadeMilli : -quantidadeMilli;
}

/** Saída por venda só para produto de venda; por consumo, só de consumo. */
export function tipoCombinaComFinalidade(kind: ManualMovementKind, purpose: StockPurpose): boolean {
  if (kind === 'SAIDA_VENDA') return purpose === 'VENDA' || purpose === 'AMBOS';
  if (kind === 'SAIDA_CONSUMO') return purpose === 'CONSUMO_INTERNO' || purpose === 'AMBOS';
  return true;
}

/** Estoque baixo: saldo no mínimo ou abaixo, com mínimo definido. */
export function estoqueBaixo(saldoMilli: number, minimoMilli: number): boolean {
  return minimoMilli > 0 && saldoMilli <= minimoMilli;
}
