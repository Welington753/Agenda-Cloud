import { describe, expect, it } from 'vitest';
import type { StoredPeriod } from '../commercial/access-periods.js';
import {
  attentionReason,
  commercialSummary,
  compareAttention,
  daysBetween,
  directoryCounts,
  expiringSoon,
  matchesFilter,
  monthRange,
  tenantAccessView,
  type TenantAccessInput,
} from './portal-overview.js';

const SP = 'America/Sao_Paulo';
/** Meia-noite em São Paulo (UTC−3, sem horário de verão desde 2019). */
const meiaNoite = (iso: string) => new Date(`${iso}T03:00:00.000Z`);
const AGORA = new Date('2027-03-10T15:00:00.000Z'); // 10/03/2027, 12:00 em SP
const NOVO = { legacy: false, noExpiry: false };

const periodo = (kind: StoredPeriod['kind'], inicio: string, fim: string): StoredPeriod => ({
  kind,
  startsAt: meiaNoite(inicio),
  endsAt: meiaNoite(fim),
  anchorDay: kind === 'PAID' ? Number(inicio.slice(8)) : null,
});

const entrada = (over: Partial<TenantAccessInput> = {}): TenantAccessInput => ({
  status: 'ACTIVE',
  timezone: SP,
  periods: [],
  flags: NOVO,
  ...over,
});

const semContrato = commercialSummary(new Map(), new Map(), null);

describe('tenantAccessView: acesso efetivo pela regra central', () => {
  it('teste em curso é modalidade TRIAL, com acesso liberado (não é conta inativa)', () => {
    const v = tenantAccessView(entrada({ status: 'TRIAL', periods: [periodo('TRIAL', '2027-03-01', '2027-03-16')] }), AGORA);
    expect(v).toMatchObject({
      state: 'TRIAL',
      operational: 'ACTIVE',
      effective: 'ALLOWED',
      lastDay: '2027-03-15',
      daysLeft: 5,
    });
  });

  it('suspenso e arquivado bloqueiam pela situação, mesmo com período pago em curso', () => {
    const pago = [periodo('PAID', '2027-03-01', '2027-04-01')];
    for (const status of ['SUSPENDED', 'ARCHIVED', 'CANCELED', 'PAST_DUE']) {
      const v = tenantAccessView(entrada({ status, periods: pago }), AGORA);
      expect(v).toMatchObject({ state: 'PAID', blocked: false, operational: 'INACTIVE', effective: 'BLOCKED_STATUS' });
    }
  });

  it('vencido e sem período (sem marca de anterior) bloqueiam pela validade', () => {
    const vencido = tenantAccessView(entrada({ periods: [periodo('TRIAL', '2027-02-01', '2027-02-16')] }), AGORA);
    expect(vencido).toMatchObject({ state: 'EXPIRED', blocked: true, effective: 'BLOCKED_VALIDITY', daysLeft: null });
    expect(vencido.expiredAt).toBe(meiaNoite('2027-02-16').toISOString());
    const ausente = tenantAccessView(entrada(), AGORA);
    expect(ausente).toMatchObject({ state: 'MISSING', blocked: true, effective: 'BLOCKED_VALIDITY' });
  });

  it('legado e "sem vencimento" liberam sem data de fim', () => {
    const legado = tenantAccessView(entrada({ flags: { legacy: true, noExpiry: false } }), AGORA);
    expect(legado).toMatchObject({ state: 'UNTRACKED', effective: 'ALLOWED', validUntil: null, lastDay: null, daysLeft: null });
    const semVencimento = tenantAccessView(
      entrada({ flags: { legacy: false, noExpiry: true }, periods: [periodo('TRIAL', '2027-01-01', '2027-01-16')] }),
      AGORA,
    );
    expect(semVencimento).toMatchObject({ state: 'NO_EXPIRY', effective: 'ALLOWED', daysLeft: null });
    expect(expiringSoon(semVencimento)).toBe(false);
  });

  it('cortesia em curso conta como modalidade própria', () => {
    const v = tenantAccessView(entrada({ periods: [periodo('COURTESY', '2027-03-01', '2027-03-31')] }), AGORA);
    expect(v).toMatchObject({ state: 'COURTESY', effective: 'ALLOWED', lastDay: '2027-03-30', daysLeft: 20 });
  });
});

describe('expiringSoon: últimos dias contados no fuso do estabelecimento', () => {
  const ate = (fim: string) => tenantAccessView(entrada({ periods: [periodo('PAID', '2027-02-10', fim)] }), AGORA);

  it('limites: último dia hoje (0) e hoje + 6 entram; hoje + 7 não', () => {
    expect(ate('2027-03-11')).toMatchObject({ lastDay: '2027-03-10', daysLeft: 0 });
    expect(expiringSoon(ate('2027-03-11'))).toBe(true);
    expect(ate('2027-03-17')).toMatchObject({ lastDay: '2027-03-16', daysLeft: 6 });
    expect(expiringSoon(ate('2027-03-17'))).toBe(true);
    expect(ate('2027-03-18')).toMatchObject({ lastDay: '2027-03-17', daysLeft: 7 });
    expect(expiringSoon(ate('2027-03-18'))).toBe(false);
  });

  it('a renovação já registrada (encostada) estende a validade e tira da janela', () => {
    const renovado = tenantAccessView(
      entrada({ periods: [periodo('PAID', '2027-02-12', '2027-03-12'), periodo('PAID', '2027-03-12', '2027-04-12')] }),
      AGORA,
    );
    expect(renovado).toMatchObject({ state: 'PAID', lastDay: '2027-04-11', daysLeft: 32 });
    expect(expiringSoon(renovado)).toBe(false);
  });

  it('teste que termina em 3 dias seguido de pago futuro conta pela cobertura contínua', () => {
    const v = tenantAccessView(
      entrada({ periods: [periodo('TRIAL', '2027-02-27', '2027-03-14'), periodo('PAID', '2027-03-14', '2027-06-14')] }),
      AGORA,
    );
    expect(v).toMatchObject({ state: 'TRIAL', lastDay: '2027-06-13' });
    expect(expiringSoon(v)).toBe(false);
  });

  it('o dia local vale: 23:30 em SP ainda é o dia anterior em relação a UTC', () => {
    const quaseMeiaNoite = new Date('2027-03-11T02:30:00.000Z'); // 10/03, 23:30 em SP
    const v = tenantAccessView(entrada({ periods: [periodo('PAID', '2027-02-10', '2027-03-11')] }), quaseMeiaNoite);
    expect(v).toMatchObject({ lastDay: '2027-03-10', daysLeft: 0 });
  });

  it('daysBetween atravessa meses e anos', () => {
    expect(daysBetween({ year: 2027, month: 2, day: 27 }, { year: 2027, month: 3, day: 2 })).toBe(3);
    expect(daysBetween({ year: 2027, month: 12, day: 31 }, { year: 2028, month: 1, day: 1 })).toBe(1);
    expect(daysBetween({ year: 2027, month: 3, day: 2 }, { year: 2027, month: 3, day: 1 })).toBe(-1);
  });
});

describe('commercialSummary: contrato separado do catálogo', () => {
  it('mensal e trimestral contratados ao mesmo tempo aparecem os dois, sem ciclo único inventado', () => {
    const r = commercialSummary(
      new Map([
        ['MONTHLY', 9900],
        ['QUARTERLY', 27900],
      ]),
      new Map([
        ['MONTHLY', 8900],
        ['QUARTERLY', 24900],
      ]),
      'QUARTERLY',
    );
    expect(r.contractPending).toBe(false);
    expect(r.agreedCycle).toBe('QUARTERLY');
    expect(r.cycles).toEqual([
      { cycle: 'MONTHLY', catalogCents: 9900, contractCents: 8900, suggestedCents: 8900, source: 'CONTRACT' },
      { cycle: 'QUARTERLY', catalogCents: 27900, contractCents: 24900, suggestedCents: 24900, source: 'CONTRACT' },
    ]);
  });

  it('sem contrato: segue o catálogo onde há catálogo e fica pendente onde não há (nunca zero)', () => {
    const r = commercialSummary(new Map([['MONTHLY', 9900]]), new Map(), null);
    expect(r.contractPending).toBe(true);
    expect(r.cycles[0]).toMatchObject({ source: 'CATALOG', suggestedCents: 9900, contractCents: null });
    expect(r.cycles[1]).toMatchObject({ source: 'PENDING', suggestedCents: null, catalogCents: null });
  });

  it('contrato só num ciclo já não é condição pendente; contrato "segue o catálogo" (null) continua pendente', () => {
    expect(commercialSummary(new Map(), new Map([['QUARTERLY', 24900]]), 'QUARTERLY').contractPending).toBe(false);
    expect(commercialSummary(new Map(), new Map([['MONTHLY', null]]), 'MONTHLY').contractPending).toBe(true);
  });
});

describe('filtros, atenção e totais', () => {
  const ativo = tenantAccessView(entrada({ periods: [periodo('PAID', '2027-03-01', '2027-04-01')] }), AGORA);
  const vencendo = tenantAccessView(entrada({ periods: [periodo('PAID', '2027-02-14', '2027-03-14')] }), AGORA);
  const vencido = tenantAccessView(entrada({ periods: [periodo('PAID', '2027-01-01', '2027-02-01')] }), AGORA);
  const suspenso = tenantAccessView(entrada({ status: 'SUSPENDED', periods: [periodo('PAID', '2027-02-14', '2027-03-14')] }), AGORA);
  const suspensoVencido = tenantAccessView(entrada({ status: 'SUSPENDED' }), AGORA);

  it('cada filtro tem um significado só', () => {
    expect(matchesFilter('ACCESS_ALLOWED', ativo, semContrato)).toBe(true);
    expect(matchesFilter('ACCESS_BLOCKED', suspenso, semContrato)).toBe(true);
    expect(matchesFilter('ACCESS_BLOCKED', vencido, semContrato)).toBe(true);
    expect(matchesFilter('EXPIRING_SOON', vencendo, semContrato)).toBe(true);
    // Vencendo, mas suspenso: está na janela de validade; o acesso é que está bloqueado.
    expect(matchesFilter('EXPIRING_SOON', suspenso, semContrato)).toBe(true);
    expect(matchesFilter('VALIDITY_BLOCKED', vencido, semContrato)).toBe(true);
    expect(matchesFilter('VALIDITY_BLOCKED', suspenso, semContrato)).toBe(false);
    expect(matchesFilter('VALIDITY_BLOCKED', suspensoVencido, semContrato)).toBe(true);
    expect(matchesFilter('CONTRACT_PENDING', ativo, semContrato)).toBe(true);
    expect(matchesFilter('CONTRACT_PENDING', ativo, commercialSummary(new Map(), new Map([['MONTHLY', 100]]), 'MONTHLY'))).toBe(
      false,
    );
  });

  it('"Precisa de atenção" só traz quem está em operação, bloqueados primeiro', () => {
    expect(attentionReason(ativo)).toBeNull();
    expect(attentionReason(suspenso)).toBeNull();
    expect(attentionReason(suspensoVencido)).toBeNull();
    expect(attentionReason(vencendo)).toBe('EXPIRING_SOON');
    expect(attentionReason(vencido)).toBe('VALIDITY_BLOCKED');
    const lista = [
      { id: 'b', reason: 'EXPIRING_SOON' as const, view: vencendo },
      { id: 'a', reason: 'VALIDITY_BLOCKED' as const, view: vencido },
    ].sort(compareAttention);
    expect(lista.map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('totais contam cada estabelecimento uma vez, por mais períodos que tenha', () => {
    const renovado = tenantAccessView(
      entrada({
        periods: [
          periodo('TRIAL', '2027-01-01', '2027-01-16'),
          periodo('PAID', '2027-01-16', '2027-02-16'),
          periodo('PAID', '2027-02-16', '2027-03-16'),
          periodo('PAID', '2027-03-16', '2027-04-16'),
        ],
      }),
      AGORA,
    );
    const c = directoryCounts(
      [
        { status: 'ACTIVE', access: renovado },
        { status: 'ACTIVE', access: vencendo },
        { status: 'ACTIVE', access: vencido },
        { status: 'SUSPENDED', access: suspenso },
        { status: 'TRIAL', access: tenantAccessView(entrada({ status: 'TRIAL', flags: { legacy: true, noExpiry: false } }), AGORA) },
      ].map((e) => ({ ...e, commercial: semContrato })),
    );
    expect(c).toMatchObject({
      total: 5,
      allowed: 3,
      blocked: 2,
      blockedByStatus: 1,
      blockedByValidity: 1,
      expiringSoon: 2,
      validityBlocked: 1,
      suspended: 1,
      contractPending: 5,
    });
    expect(c.byState).toMatchObject({ PAID: 3, EXPIRED: 1, UNTRACKED: 1, TRIAL: 0 });
  });
});

describe('monthRange: mês corrente em America/Sao_Paulo', () => {
  it('do dia 1 ao último dia, inclusive', () => {
    expect(monthRange(AGORA)).toEqual({ month: '2027-03', from: '2027-03-01', to: '2027-03-31' });
    expect(monthRange(new Date('2028-02-15T12:00:00Z'))).toEqual({ month: '2028-02', from: '2028-02-01', to: '2028-02-29' });
  });

  it('a virada do mês segue o relógio de São Paulo, não o UTC', () => {
    // 01/04 01:00 UTC ainda é 31/03 22:00 em São Paulo.
    expect(monthRange(new Date('2027-04-01T01:00:00Z')).month).toBe('2027-03');
    expect(monthRange(new Date('2027-04-01T03:00:00Z')).month).toBe('2027-04');
  });
});
