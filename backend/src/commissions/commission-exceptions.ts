// Exceções por serviço (`commission_rules`) diante de uma regra geral nova.
// Funções puras, sem Nest e sem banco.
//
// Manter (`KEEP`, o padrão) deixa as exceções valendo antes da regra geral
// (`regraEfetiva`). Remover (`REMOVE`) apaga TODAS as exceções do profissional,
// inclusive "sem comissão" e as de serviços que ele não atende mais, para que
// a regra geral valha em todos os serviços. Remover só acontece com escolha e
// confirmação explícitas e com a impressão das exceções que a tela mostrou:
// "Substituir a regra geral" sozinho nunca remove exceção. Ver
// docs/plans/comissoes-aplicacao-em-massa.md.
import { createHash } from 'node:crypto';
import type { StoredRule } from './commission-calculation.js';

export const EXCEPTION_CHOICES = ['KEEP', 'REMOVE'] as const;
export type ExceptionChoice = (typeof EXCEPTION_CHOICES)[number];

export interface StoredException {
  serviceId: string;
  rule: StoredRule;
}

/** Forma canônica: em ordem de serviço, só id, tipo e valor (nome e datas
 * não entram). */
export function canonicoDasExcecoes(excecoes: readonly StoredException[]): [string, string, number][] {
  return [...excecoes]
    .sort((a, b) => (a.serviceId < b.serviceId ? -1 : a.serviceId > b.serviceId ? 1 : 0))
    .map((e) => [e.serviceId, e.rule.type, Number(e.rule.value)]);
}

/** Impressão das exceções de UM profissional, que a tela devolve ao pedir a
 * remoção: muda se alguma exceção for criada, alterada ou apagada. */
export function impressaoDasExcecoes(excecoes: readonly StoredException[]): string {
  return createHash('sha256').update(JSON.stringify(canonicoDasExcecoes(excecoes))).digest('hex');
}
