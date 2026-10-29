// Validade do acesso de um estabelecimento à plataforma (assinatura do
// Agenda Cloud). Funções puras: sem Nest, sem banco e sem relógio do
// processo. Nada aqui tem relação com os recebimentos dos atendimentos
// (`payments/`), que são o dinheiro que o cliente paga ao estabelecimento.
//
// REGRAS (docs/plans/planos-e-validade-do-acesso.md, seção 2.5):
// - cada período cobre de meia-noite local do dia de início até meia-noite
//   local do dia de fim (fim exclusivo), no fuso do estabelecimento;
// - mensal e trimestral somam meses de calendário, nunca 30 ou 90 dias. O
//   dia de referência (`anchorDay`) é o do primeiro pago da sequência e é
//   mantido nas renovações; num mês sem esse dia, vale o último dia do mês;
// - um período novo começa no fim da validade em curso (renovação
//   antecipada) ou hoje, se não há validade em curso;
// - sem nenhum período gravado, a validade não é conferida (estabelecimento
//   anterior a este controle).
import { TRIAL_DURATION_DAYS } from '../auth/trial-policy.js';
import { partesLocais, resolverHoraLocal, type DataLocal } from '../availability/time-zone.js';

export type AccessPeriodKind = 'TRIAL' | 'PAID' | 'COURTESY';
export type BillingCycle = 'MONTHLY' | 'QUARTERLY';

export const CYCLE_MONTHS: Readonly<Record<BillingCycle, number>> = { MONTHLY: 1, QUARTERLY: 3 };

/** Limites dos pedidos da administração. */
export const MAX_TRIAL_EXTENSION_DAYS = 30;
export const MAX_COURTESY_DAYS = 180;

export interface StoredPeriod {
  kind: AccessPeriodKind;
  startsAt: Date;
  endsAt: Date;
  anchorDay: number | null;
}

export interface NewPeriodDates {
  startsAt: Date;
  endsAt: Date;
  anchorDay: number | null;
}

/**
 * - `UNTRACKED`: nenhum período gravado; opera como antes deste controle.
 * - `TRIAL`, `PAID`, `COURTESY`: há período cobrindo agora (o pago vence a
 *   cortesia, que vence o teste, quando se sobrepõem).
 * - `EXPIRED`: há períodos, mas nenhum cobre agora.
 */
export type AccessState = 'UNTRACKED' | 'TRIAL' | 'PAID' | 'COURTESY' | 'EXPIRED';

export interface AccessSituation {
  state: AccessState;
  blocked: boolean;
  /** Fim (exclusivo) da validade contínua a partir de agora: inclui as
   * renovações já registradas. `null` sem validade em curso. */
  validUntil: Date | null;
  /** Só em `EXPIRED`: quando acabou e qual período acabou por último. */
  expiredAt: Date | null;
  expiredKind: AccessPeriodKind | null;
}

const PRIORIDADE: Readonly<Record<AccessPeriodKind, number>> = { PAID: 3, COURTESY: 2, TRIAL: 1 };

const cobre = (p: StoredPeriod, instante: Date) =>
  p.startsAt.getTime() <= instante.getTime() && instante.getTime() < p.endsAt.getTime();

/** Fim da validade contínua que cobre `agora`: segue os períodos encostados
 * (ou sobrepostos) a partir do que cobre agora. `null` se nada cobre. */
export function coverageEnd(periods: readonly StoredPeriod[], now: Date): Date | null {
  let fim: Date | null = null;
  for (const p of periods) if (cobre(p, now) && (!fim || p.endsAt > fim)) fim = p.endsAt;
  if (!fim) return null;
  for (let avancou = true; avancou; ) {
    avancou = false;
    for (const p of periods) {
      if (p.startsAt.getTime() <= fim.getTime() && p.endsAt.getTime() > fim.getTime()) {
        fim = p.endsAt;
        avancou = true;
      }
    }
  }
  return fim;
}

export function accessSituation(periods: readonly StoredPeriod[], now: Date): AccessSituation {
  if (periods.length === 0) {
    return { state: 'UNTRACKED', blocked: false, validUntil: null, expiredAt: null, expiredKind: null };
  }
  const atuais = periods.filter((p) => cobre(p, now));
  if (atuais.length) {
    const principal = atuais.reduce((a, b) => (PRIORIDADE[b.kind] > PRIORIDADE[a.kind] ? b : a));
    return {
      state: principal.kind,
      blocked: false,
      validUntil: coverageEnd(periods, now),
      expiredAt: null,
      expiredKind: null,
    };
  }
  const passados = periods.filter((p) => p.endsAt.getTime() <= now.getTime());
  const ultimo = passados.reduce<StoredPeriod | null>(
    (a, b) => (!a || b.endsAt > a.endsAt || (b.endsAt.getTime() === a.endsAt.getTime() && PRIORIDADE[b.kind] > PRIORIDADE[a.kind]) ? b : a),
    null,
  );
  return {
    state: 'EXPIRED',
    blocked: true,
    validUntil: null,
    expiredAt: ultimo?.endsAt ?? null,
    expiredKind: ultimo?.kind ?? null,
  };
}

// ------------------------------------------------------------------ datas

export function localDate(instante: Date, timeZone: string): DataLocal {
  const { year, month, day } = partesLocais(instante, timeZone);
  return { year, month, day };
}

const diasNoMes = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** `data` + `meses` meses de calendário, no dia `ancora` (ou no último dia
 * do mês, quando ele não tem esse dia). */
export function addMonths(data: DataLocal, meses: number, ancora: number): DataLocal {
  const indice = data.year * 12 + (data.month - 1) + meses;
  const year = Math.floor(indice / 12);
  const month = (indice % 12) + 1;
  return { year, month, day: Math.min(ancora, diasNoMes(year, month)) };
}

export function addDays(data: DataLocal, dias: number): DataLocal {
  const d = new Date(Date.UTC(data.year, data.month - 1, data.day + dias));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** Meia-noite local daquele dia. Num fuso em que a meia-noite não existe
 * (horário de verão começando às 00:00), o primeiro instante do dia. */
export function startOfLocalDay(data: DataLocal, timeZone: string): Date {
  const r = resolverHoraLocal(data, 0, 0, timeZone);
  if (r.instantes.length) return r.instantes[0];
  if (r.aposLacuna) return r.aposLacuna;
  throw new Error(`Meia-noite não resolvida em ${timeZone}.`);
}

const maior = (a: Date, b: Date) => (a.getTime() >= b.getTime() ? a : b);

// ------------------------------------------------------- períodos novos

/** Teste de um estabelecimento novo: do cadastro até o fim do 14º dia
 * depois do dia do cadastro (meia-noite local do dia + 15). */
export function firstTrial(createdAt: Date, timeZone: string): NewPeriodDates {
  const fim = startOfLocalDay(addDays(localDate(createdAt, timeZone), TRIAL_DURATION_DAYS + 1), timeZone);
  return { startsAt: createdAt, endsAt: fim, anchorDay: null };
}

/** Fim mais recente entre os períodos destes tipos (todos já acabados
 * quando não há validade em curso). */
function ultimoFim(periods: readonly StoredPeriod[], tipos: readonly AccessPeriodKind[]): Date | null {
  let fim: Date | null = null;
  for (const p of periods) if (tipos.includes(p.kind) && (!fim || p.endsAt > fim)) fim = p.endsAt;
  return fim;
}

/** Sem validade em curso, o novo período começa à meia-noite de hoje, ou no
 * fim do último período do mesmo grupo se ele acabou depois dessa meia-noite
 * (fim fora da meia-noite, por exemplo depois de uma troca de fuso): nunca
 * se sobrepõe a ele. */
function inicioSemValidade(
  periods: readonly StoredPeriod[],
  now: Date,
  timeZone: string,
  tipos: readonly AccessPeriodKind[],
): Date {
  const hoje = startOfLocalDay(localDate(now, timeZone), timeZone);
  const fim = ultimoFim(periods, tipos);
  return fim && fim > hoje ? fim : hoje;
}

/** Início de um período pago ou cortesia: fim da validade em curso, ou hoje. */
function inicioEncadeado(periods: readonly StoredPeriod[], now: Date, timeZone: string): Date {
  return coverageEnd(periods, now) ?? inicioSemValidade(periods, now, timeZone, ['PAID', 'COURTESY']);
}

export function nextPaidPeriod(
  periods: readonly StoredPeriod[],
  now: Date,
  timeZone: string,
  cycle: BillingCycle,
): NewPeriodDates {
  const startsAt = inicioEncadeado(periods, now, timeZone);
  const inicio = localDate(startsAt, timeZone);
  // A âncora segue a do pago que termina exatamente onde este começa.
  const anterior = periods.find((p) => p.kind === 'PAID' && p.endsAt.getTime() === startsAt.getTime() && p.anchorDay);
  const anchorDay = anterior?.anchorDay ?? inicio.day;
  const endsAt = startOfLocalDay(addMonths(inicio, CYCLE_MONTHS[cycle], anchorDay), timeZone);
  return { startsAt, endsAt, anchorDay };
}

export function nextCourtesyPeriod(
  periods: readonly StoredPeriod[],
  now: Date,
  timeZone: string,
  days: number,
): NewPeriodDates {
  const startsAt = inicioEncadeado(periods, now, timeZone);
  const endsAt = startOfLocalDay(addDays(localDate(startsAt, timeZone), days), timeZone);
  return { startsAt, endsAt, anchorDay: null };
}

/**
 * Prorrogação do teste. Quem chama garante que nunca houve pago nem
 * cortesia.
 *
 * - Com teste em curso: começa no fim dele e acrescenta `days`.
 * - Teste vencido: começa hoje e vai até hoje + `days`.
 * - Sem nenhum período (anterior a este controle): o teste derivado do
 *   cadastro conta como base. Começa hoje (para cobrir já) e termina no
 *   maior entre hoje e o fim derivado, mais `days`. Nunca reinicia o teste.
 */
export function trialExtension(
  periods: readonly StoredPeriod[],
  now: Date,
  timeZone: string,
  days: number,
  tenantCreatedAt: Date,
): NewPeriodDates {
  const hoje = startOfLocalDay(localDate(now, timeZone), timeZone);
  if (periods.length === 0) {
    const derivado = firstTrial(tenantCreatedAt, timeZone).endsAt;
    const base = maior(hoje, derivado);
    return { startsAt: hoje, endsAt: startOfLocalDay(addDays(localDate(base, timeZone), days), timeZone), anchorDay: null };
  }
  const startsAt = coverageEnd(periods, now) ?? inicioSemValidade(periods, now, timeZone, ['TRIAL']);
  return { startsAt, endsAt: startOfLocalDay(addDays(localDate(startsAt, timeZone), days), timeZone), anchorDay: null };
}
