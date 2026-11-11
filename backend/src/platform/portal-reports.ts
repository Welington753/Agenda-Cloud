// Relatórios por período do portal da plataforma (docs/plans/
// portal-relatorios-por-periodo.md). Funções puras: sem Nest, sem banco e sem
// relógio do processo.
//
// Período: duas datas de calendário `YYYY-MM-DD`, as duas inclusas, no fuso
// da plataforma (`PLATFORM_TIME_ZONE`). `checkDateRange` só valida: quem
// decide o que a AUSÊNCIA de datas significa é cada rota (relatório: mês
// atual; extrato e lista: sem restrição).
import { daysBetween, isoDate, monthRange, PLATFORM_TIME_ZONE } from './portal-overview.js';

/** Período máximo, contando os dois dias extremos. */
export const MAX_REPORT_DAYS = 366;

const DATA = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Data de calendário que existe (`2026-02-29` não existe). */
export function isCalendarDate(value: string): boolean {
  const m = DATA.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1900 || mo < 1 || mo > 12 || d < 1) return false;
  const data = new Date(Date.UTC(y, mo - 1, d));
  return data.getUTCFullYear() === y && data.getUTCMonth() === mo - 1 && data.getUTCDate() === d;
}

const local = (value: string) => {
  const [year, month, day] = value.split('-').map(Number);
  return { year, month, day };
};

/** Dias de `from` a `to`, contando os dois. */
export function inclusiveDays(from: string, to: string): number {
  return daysBetween(local(from), local(to)) + 1;
}

export type DateRangeProblem = 'INCOMPLETE' | 'INVALID_DATE' | 'INVERTED' | 'TOO_LONG';

/** `null`: as duas ausentes (sem período) ou um período válido. */
export function checkDateRange(from: string | undefined, to: string | undefined): DateRangeProblem | null {
  if (from === undefined && to === undefined) return null;
  if (from === undefined || to === undefined) return 'INCOMPLETE';
  if (!isCalendarDate(from) || !isCalendarDate(to)) return 'INVALID_DATE';
  if (from > to) return 'INVERTED';
  if (inclusiveDays(from, to) > MAX_REPORT_DAYS) return 'TOO_LONG';
  return null;
}

export const DATE_RANGE_MESSAGES: Record<DateRangeProblem, string> = {
  INCOMPLETE: 'Informe a data inicial e a data final.',
  INVALID_DATE: 'Data inválida. Use AAAA-MM-DD.',
  INVERTED: 'A data inicial deve ser anterior ou igual à final.',
  TOO_LONG: `O período pode ter no máximo ${MAX_REPORT_DAYS} dias, contando o primeiro e o último.`,
};

export interface ReportPeriod {
  from: string;
  to: string;
  /** `YYYY-MM` quando o período é exatamente um mês de calendário. */
  month: string | null;
  days: number;
}

/** `YYYY-MM` se `from`..`to` cobre exatamente um mês inteiro. */
export function fullMonth(from: string, to: string): string | null {
  if (!from.endsWith('-01') || from.slice(0, 7) !== to.slice(0, 7)) return null;
  const { year, month } = local(from);
  const ultimo = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return to === isoDate({ year, month, day: ultimo }) ? from.slice(0, 7) : null;
}

/** Período do relatório: o pedido (já validado) ou o mês atual em São Paulo
 * pelo relógio recebido. */
export function resolveReportPeriod(range: { from?: string; to?: string }, now: Date): ReportPeriod {
  const { from, to } =
    range.from !== undefined && range.to !== undefined ? { from: range.from, to: range.to } : monthRange(now, PLATFORM_TIME_ZONE);
  return { from, to, month: fullMonth(from, to), days: inclusiveDays(from, to) };
}

/**
 * Condição SQL de um `timestamptz` dentro do período, no fuso da plataforma:
 * semiaberta, de `from` 00:00 até antes de `to + 1` 00:00 em São Paulo. Nada
 * do último dia fica de fora, e nenhum offset fixo é usado (o fuso é um
 * literal fixo; as datas vão como parâmetros).
 */
export function timestampInRangeSql(column: string, fromParam: string, toParam: string): string {
  const tz = `'${PLATFORM_TIME_ZONE}'`;
  return `(${column} >= (${fromParam}::date)::timestamp AT TIME ZONE ${tz}
    AND ${column} < ((${toParam}::date + 1)::timestamp AT TIME ZONE ${tz}))`;
}
