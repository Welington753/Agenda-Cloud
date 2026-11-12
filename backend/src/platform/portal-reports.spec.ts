import {
  checkDateRange,
  fullMonth,
  inclusiveDays,
  isCalendarDate,
  MAX_REPORT_DAYS,
  resolveReportPeriod,
  timestampInRangeSql,
} from './portal-reports.js';
import { establishmentQuerySchema, reportQuerySchema, subscriptionPaymentsQuerySchema } from './platform.dto.js';

describe('período dos relatórios do portal', () => {
  it('data de calendário real, com ano bissexto', () => {
    expect(isCalendarDate('2028-02-29')).toBe(true);
    expect(isCalendarDate('2026-02-29')).toBe(false);
    expect(isCalendarDate('2026-02-30')).toBe(false);
    expect(isCalendarDate('2026-04-31')).toBe(false);
    expect(isCalendarDate('2026-13-01')).toBe(false);
    expect(isCalendarDate('2026-00-10')).toBe(false);
    expect(isCalendarDate('2026-1-01')).toBe(false);
    expect(isCalendarDate('2026-10-31')).toBe(true);
  });

  it('limite de 366 dias contando os dois extremos', () => {
    expect(MAX_REPORT_DAYS).toBe(366);
    expect(inclusiveDays('2026-10-31', '2026-10-31')).toBe(1);
    expect(inclusiveDays('2026-10-01', '2026-10-31')).toBe(31);
    // Ano bissexto inteiro: 366 dias, aceito.
    expect(inclusiveDays('2028-01-01', '2028-12-31')).toBe(366);
    expect(checkDateRange('2028-01-01', '2028-12-31')).toBeNull();
    // 366 dias sem bissexto: de 01/01/2026 a 01/01/2027, aceito.
    expect(checkDateRange('2026-01-01', '2027-01-01')).toBeNull();
    // 367 dias: recusado.
    expect(inclusiveDays('2026-01-01', '2027-01-02')).toBe(367);
    expect(checkDateRange('2026-01-01', '2027-01-02')).toBe('TOO_LONG');
    expect(checkDateRange('2028-01-01', '2029-01-01')).toBe('TOO_LONG');
  });

  it('sem datas é válido e não escolhe padrão; uma só, invertidas ou inexistentes são recusadas', () => {
    expect(checkDateRange(undefined, undefined)).toBeNull();
    expect(checkDateRange('2026-10-01', undefined)).toBe('INCOMPLETE');
    expect(checkDateRange(undefined, '2026-10-01')).toBe('INCOMPLETE');
    expect(checkDateRange('2026-10-02', '2026-10-01')).toBe('INVERTED');
    expect(checkDateRange('2026-02-29', '2026-03-01')).toBe('INVALID_DATE');
  });

  it('mês inteiro só quando cobre do dia 1 ao último dia', () => {
    expect(fullMonth('2026-10-01', '2026-10-31')).toBe('2026-10');
    expect(fullMonth('2028-02-01', '2028-02-29')).toBe('2028-02');
    expect(fullMonth('2026-02-01', '2026-02-28')).toBe('2026-02');
    expect(fullMonth('2026-10-01', '2026-10-30')).toBeNull();
    expect(fullMonth('2026-10-02', '2026-10-31')).toBeNull();
    expect(fullMonth('2026-10-01', '2026-11-30')).toBeNull();
  });

  it('sem datas: mês atual em São Paulo pelo relógio recebido, na virada do mês e do ano', () => {
    // 01/11 02:30 UTC = 31/10 23:30 em São Paulo: ainda outubro.
    expect(resolveReportPeriod({}, new Date('2026-11-01T02:30:00Z'))).toEqual({
      from: '2026-10-01',
      to: '2026-10-31',
      month: '2026-10',
      days: 31,
    });
    expect(resolveReportPeriod({}, new Date('2026-11-01T03:00:00Z')).month).toBe('2026-11');
    // 01/01/2027 01:00 UTC = 31/12/2026 22:00 em São Paulo.
    expect(resolveReportPeriod({}, new Date('2027-01-01T01:00:00Z')).month).toBe('2026-12');
    expect(resolveReportPeriod({}, new Date('2028-02-10T12:00:00Z'))).toMatchObject({ to: '2028-02-29', days: 29 });
  });

  it('período pedido é devolvido como foi pedido', () => {
    expect(resolveReportPeriod({ from: '2026-10-15', to: '2026-11-14' }, new Date('2030-01-01T00:00:00Z'))).toEqual({
      from: '2026-10-15',
      to: '2026-11-14',
      month: null,
      days: 31,
    });
  });

  it('timestamp: intervalo semiaberto em São Paulo, sem offset fixo', () => {
    const sql = timestampInRangeSql('t.created_at', '$1', '$2');
    expect(sql).toContain(`t.created_at >= ($1::date)::timestamp AT TIME ZONE 'America/Sao_Paulo'`);
    expect(sql).toContain(`t.created_at < (($2::date + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo')`);
    expect(sql).not.toMatch(/-03/);
  });
});

describe('consultas com período', () => {
  it('relatório: datas e alcance opcionais, padrão de alcance clientes, sem padrão de datas no esquema', () => {
    expect(reportQuerySchema.parse({})).toEqual({ scope: 'CLIENTS' });
    expect(reportQuerySchema.parse({ from: '2026-10-01', to: '2026-10-31', scope: 'ALL' })).toEqual({
      from: '2026-10-01',
      to: '2026-10-31',
      scope: 'ALL',
    });
  });

  it('relatório: recusa período incompleto, invertido, inexistente, longo e parâmetro desconhecido', () => {
    for (const q of [
      { from: '2026-10-01' },
      { to: '2026-10-01' },
      { from: '2026-10-02', to: '2026-10-01' },
      { from: '2026-02-29', to: '2026-03-01' },
      { from: '2026-01-01', to: '2027-01-02' },
      { from: '01/10/2026', to: '31/10/2026' },
      { from: '2026-10-01', to: '2026-10-31', month: '2026-10' },
      { scope: 'TESTE' },
    ]) {
      expect(reportQuerySchema.safeParse(q).success, JSON.stringify(q)).toBe(false);
    }
    expect(reportQuerySchema.safeParse({ from: '2026-01-01', to: '2027-01-01' }).success).toBe(true);
  });

  it('extrato: ausência mantém o comportamento anterior (todo o histórico, todos, as duas situações)', () => {
    expect(subscriptionPaymentsQuerySchema.parse({})).toEqual({ scope: 'ALL', page: 1, pageSize: 30 });
    expect(
      subscriptionPaymentsQuerySchema.parse({ from: '2026-10-01', to: '2026-10-31', scope: 'CLIENTS', status: 'CANCELED' }),
    ).toMatchObject({ from: '2026-10-01', to: '2026-10-31', scope: 'CLIENTS', status: 'CANCELED' });
    for (const q of [{ from: '2026-10-01' }, { status: 'PENDING' }, { from: '2026-10-31', to: '2026-10-01' }]) {
      expect(subscriptionPaymentsQuerySchema.safeParse(q).success, JSON.stringify(q)).toBe(false);
    }
  });

  it('lista: sem datas de cadastro não restringe; com datas valida como o relatório', () => {
    expect(establishmentQuerySchema.parse({})).not.toHaveProperty('createdFrom');
    expect(establishmentQuerySchema.parse({ createdFrom: '2026-10-01', createdTo: '2026-10-31' })).toMatchObject({
      createdFrom: '2026-10-01',
      createdTo: '2026-10-31',
    });
    expect(establishmentQuerySchema.safeParse({ createdFrom: '2026-10-01' }).success).toBe(false);
    expect(establishmentQuerySchema.safeParse({ createdFrom: '2026-01-01', createdTo: '2027-01-02' }).success).toBe(false);
  });
});
