import { describe, expect, it } from 'vitest';
import {
  accessSituation,
  addMonths,
  correctionImpact,
  coverageEnd,
  firstTrial,
  nextCourtesyPeriod,
  nextPaidPeriod,
  trialExtension,
  type StoredPeriod,
} from './access-periods.js';

const SP = 'America/Sao_Paulo';
/** Meia-noite em São Paulo (UTC−3, sem horário de verão desde 2019). */
const meiaNoite = (iso: string) => new Date(`${iso}T03:00:00.000Z`);
const as = (iso: string) => new Date(iso);
const LEGADO = { legacy: true };
const NOVO = { legacy: false };

const pago = (inicio: string, fim: string, anchorDay: number): StoredPeriod => ({
  kind: 'PAID',
  startsAt: meiaNoite(inicio),
  endsAt: meiaNoite(fim),
  anchorDay,
});
const teste = (inicio: Date, fim: string): StoredPeriod => ({
  kind: 'TRIAL',
  startsAt: inicio,
  endsAt: meiaNoite(fim),
  anchorDay: null,
});

describe('addMonths', () => {
  it('soma meses de calendário e prende ao último dia do mês', () => {
    expect(addMonths({ year: 2027, month: 1, day: 31 }, 1, 31)).toEqual({ year: 2027, month: 2, day: 28 });
    expect(addMonths({ year: 2027, month: 2, day: 28 }, 1, 31)).toEqual({ year: 2027, month: 3, day: 31 });
    expect(addMonths({ year: 2027, month: 3, day: 31 }, 1, 31)).toEqual({ year: 2027, month: 4, day: 30 });
    expect(addMonths({ year: 2027, month: 11, day: 30 }, 3, 30)).toEqual({ year: 2028, month: 2, day: 29 });
    expect(addMonths({ year: 2027, month: 12, day: 15 }, 1, 15)).toEqual({ year: 2028, month: 1, day: 15 });
    expect(addMonths({ year: 2027, month: 5, day: 15 }, 3, 15)).toEqual({ year: 2027, month: 8, day: 15 });
  });
});

describe('primeiro teste', () => {
  it('vai até a meia-noite local do dia do cadastro + 15', () => {
    // 23:30 de 10/03 em São Paulo é 02:30 UTC de 11/03: o dia local é 10/03.
    const r = firstTrial(as('2027-03-11T02:30:00.000Z'), SP);
    expect(r.endsAt).toEqual(meiaNoite('2027-03-25'));
    expect(r.startsAt).toEqual(as('2027-03-11T02:30:00.000Z'));
  });
});

describe('situação comercial', () => {
  it('sem período e marcado como anterior ao controle: validade ainda não definida, não bloqueia', () => {
    expect(accessSituation([], as('2027-01-01T12:00:00Z'), LEGADO)).toMatchObject({ state: 'UNTRACKED', blocked: false });
  });

  it('sem período e sem a marca: bloqueia (a falta do teste nunca vira acesso indefinido)', () => {
    expect(accessSituation([], as('2027-01-01T12:00:00Z'), NOVO)).toMatchObject({
      state: 'MISSING',
      blocked: true,
      validUntil: null,
    });
  });

  it('com período, a marca de anterior não muda nada: o período decide', () => {
    const p = [pago('2027-01-10', '2027-02-10', 10)];
    expect(accessSituation(p, as('2027-03-01T12:00:00Z'), LEGADO)).toMatchObject({ state: 'EXPIRED', blocked: true });
  });

  it('o pago vale sobre o teste antigo, e a validade segue as renovações', () => {
    const periodos = [
      teste(as('2027-01-01T15:00:00Z'), '2027-01-16'),
      pago('2027-01-16', '2027-02-16', 16),
      pago('2027-02-16', '2027-03-16', 16),
    ];
    const s = accessSituation(periodos, as('2027-01-20T12:00:00Z'), NOVO);
    expect(s).toMatchObject({ state: 'PAID', blocked: false });
    expect(s.validUntil).toEqual(meiaNoite('2027-03-16'));
  });

  it('vencido: bloqueia, com a data e o tipo do último período', () => {
    const s = accessSituation([teste(as('2027-01-01T15:00:00Z'), '2027-01-16')], meiaNoite('2027-01-16'), NOVO);
    expect(s).toMatchObject({ state: 'EXPIRED', blocked: true, expiredKind: 'TRIAL' });
    expect(s.expiredAt).toEqual(meiaNoite('2027-01-16'));
  });

  it('o fim é exclusivo: um milissegundo antes ainda vale', () => {
    const p = [pago('2027-01-31', '2027-02-28', 31)];
    expect(accessSituation(p, new Date(meiaNoite('2027-02-28').getTime() - 1), NOVO).blocked).toBe(false);
    expect(accessSituation(p, meiaNoite('2027-02-28'), NOVO).blocked).toBe(true);
  });
});

describe('período pago', () => {
  it('vencido ou sem registro: começa hoje, no dia de hoje como âncora', () => {
    const agora = as('2027-01-31T18:00:00Z');
    expect(nextPaidPeriod([], agora, SP, 'MONTHLY')).toEqual({
      startsAt: meiaNoite('2027-01-31'),
      endsAt: meiaNoite('2027-02-28'),
      anchorDay: 31,
    });
    const vencido = [pago('2026-11-10', '2026-12-10', 10)];
    expect(nextPaidPeriod(vencido, agora, SP, 'MONTHLY')).toEqual({
      startsAt: meiaNoite('2027-01-31'),
      endsAt: meiaNoite('2027-02-28'),
      anchorDay: 31,
    });
  });

  it('renovação antecipada encosta no fim e mantém a âncora do dia 31', () => {
    const p1 = pago('2027-01-31', '2027-02-28', 31);
    const r2 = nextPaidPeriod([p1], as('2027-02-10T12:00:00Z'), SP, 'MONTHLY');
    expect(r2).toEqual({ startsAt: meiaNoite('2027-02-28'), endsAt: meiaNoite('2027-03-31'), anchorDay: 31 });
    const p2 = pago('2027-02-28', '2027-03-31', 31);
    const r3 = nextPaidPeriod([p1, p2], as('2027-02-10T12:00:00Z'), SP, 'MONTHLY');
    expect(r3).toEqual({ startsAt: meiaNoite('2027-03-31'), endsAt: meiaNoite('2027-04-30'), anchorDay: 31 });
  });

  it('trimestral de 30/11 termina no 29/02 do ano bissexto', () => {
    expect(nextPaidPeriod([], as('2027-11-30T15:00:00Z'), SP, 'QUARTERLY')).toEqual({
      startsAt: meiaNoite('2027-11-30'),
      endsAt: meiaNoite('2028-02-29'),
      anchorDay: 30,
    });
  });

  it('pago durante o teste começa no fim do teste, sem encurtá-lo', () => {
    const t = teste(as('2027-03-11T02:30:00.000Z'), '2027-03-25');
    expect(nextPaidPeriod([t], as('2027-03-15T12:00:00Z'), SP, 'MONTHLY')).toEqual({
      startsAt: meiaNoite('2027-03-25'),
      endsAt: meiaNoite('2027-04-25'),
      anchorDay: 25,
    });
  });

  it('usa a data local do estabelecimento, não a UTC', () => {
    // 01:00 UTC de 01/02 ainda é 31/01 em São Paulo.
    expect(nextPaidPeriod([], as('2027-02-01T01:00:00Z'), SP, 'MONTHLY').startsAt).toEqual(meiaNoite('2027-01-31'));
    // Em Tóquio já é 01/02.
    const tokyo = nextPaidPeriod([], as('2027-02-01T01:00:00Z'), 'Asia/Tokyo', 'MONTHLY');
    expect(tokyo.startsAt).toEqual(as('2027-01-31T15:00:00Z'));
    expect(tokyo.anchorDay).toBe(1);
  });
});

describe('cortesia e prorrogação do teste', () => {
  it('cortesia encosta na validade em curso', () => {
    const p = [pago('2027-01-10', '2027-02-10', 10)];
    expect(nextCourtesyPeriod(p, as('2027-01-20T12:00:00Z'), SP, 15)).toEqual({
      startsAt: meiaNoite('2027-02-10'),
      endsAt: meiaNoite('2027-02-25'),
      anchorDay: null,
    });
  });

  it('um pago depois de uma cortesia começa nela e ganha âncora própria', () => {
    const p = [pago('2027-01-10', '2027-02-10', 10), { ...pago('2027-02-10', '2027-02-25', 10), kind: 'COURTESY' as const, anchorDay: null }];
    expect(nextPaidPeriod(p, as('2027-01-20T12:00:00Z'), SP, 'MONTHLY')).toEqual({
      startsAt: meiaNoite('2027-02-25'),
      endsAt: meiaNoite('2027-03-25'),
      anchorDay: 25,
    });
  });

  it('teste em curso: acrescenta a partir do fim', () => {
    const t = [teste(as('2027-03-11T02:30:00.000Z'), '2027-03-25')];
    expect(trialExtension(t, as('2027-03-20T12:00:00Z'), SP, 7, as('2027-03-11T02:30:00.000Z'))).toEqual({
      startsAt: meiaNoite('2027-03-25'),
      endsAt: meiaNoite('2027-04-01'),
      anchorDay: null,
    });
  });

  it('teste vencido: começa hoje', () => {
    const t = [teste(as('2027-03-11T02:30:00.000Z'), '2027-03-25')];
    expect(trialExtension(t, as('2027-04-10T12:00:00Z'), SP, 5, as('2027-03-11T02:30:00.000Z'))).toEqual({
      startsAt: meiaNoite('2027-04-10'),
      endsAt: meiaNoite('2027-04-15'),
      anchorDay: null,
    });
  });

  it('sem registro e teste derivado vencido: hoje + dias, sem reiniciar 14 dias', () => {
    const criado = as('2026-08-01T15:00:00Z');
    expect(trialExtension([], as('2027-04-10T12:00:00Z'), SP, 5, criado)).toEqual({
      startsAt: meiaNoite('2027-04-10'),
      endsAt: meiaNoite('2027-04-15'),
      anchorDay: null,
    });
  });

  it('sem registro e teste derivado ainda em curso: cobre desde hoje até o fim derivado + dias', () => {
    const criado = as('2027-04-05T15:00:00Z');
    expect(trialExtension([], as('2027-04-10T12:00:00Z'), SP, 5, criado)).toEqual({
      startsAt: meiaNoite('2027-04-10'),
      endsAt: meiaNoite('2027-04-25'),
      anchorDay: null,
    });
  });
});

describe('período anterior terminado fora da meia-noite (troca de fuso)', () => {
  it('o novo pago começa no fim dele, sem sobrepor, e termina numa meia-noite', () => {
    const anterior: StoredPeriod = {
      kind: 'PAID',
      startsAt: as('2027-01-10T05:00:00Z'),
      endsAt: as('2027-02-10T05:00:00Z'),
      anchorDay: 10,
    };
    const r = nextPaidPeriod([anterior], as('2027-02-10T12:00:00Z'), SP, 'MONTHLY');
    expect(r.startsAt).toEqual(as('2027-02-10T05:00:00Z'));
    expect(r.endsAt).toEqual(meiaNoite('2027-03-10'));
  });

  it('vencido há dias: começa hoje, à meia-noite', () => {
    const anterior: StoredPeriod = { kind: 'PAID', startsAt: as('2027-01-10T05:00:00Z'), endsAt: as('2027-02-10T05:00:00Z'), anchorDay: 10 };
    expect(nextPaidPeriod([anterior], as('2027-02-20T12:00:00Z'), SP, 'MONTHLY').startsAt).toEqual(meiaNoite('2027-02-20'));
  });
});

describe('coverageEnd', () => {
  it('não atravessa lacunas', () => {
    const p = [pago('2027-01-10', '2027-02-10', 10), pago('2027-03-01', '2027-04-01', 1)];
    expect(coverageEnd(p, as('2027-01-20T12:00:00Z'))).toEqual(meiaNoite('2027-02-10'));
    expect(coverageEnd(p, as('2027-02-20T12:00:00Z'))).toBeNull();
  });
});

describe('correção de um registro feito por engano', () => {
  const comId = (id: string, p: StoredPeriod) => ({ ...p, id });
  const teste1 = comId('t1', teste(as('2027-01-01T15:00:00Z'), '2027-01-16'));
  const pago1 = comId('p1', pago('2027-01-16', '2027-02-16', 16));
  const pago2 = comId('p2', pago('2027-02-16', '2027-03-16', 16));
  const agora = as('2027-01-20T12:00:00Z');

  it('o último da cadeia pode ser anulado; a validade encurta até o anterior', () => {
    const r = correctionImpact([teste1, pago1, pago2], 'p2', agora, NOVO);
    expect(r.allowed).toBe(true);
    if (!r.allowed) return;
    expect(r.before.validUntil).toEqual(meiaNoite('2027-03-16'));
    expect(r.after.validUntil).toEqual(meiaNoite('2027-02-16'));
  });

  it('um registro com outro depois dele é recusado e aponta o mais recente', () => {
    expect(correctionImpact([teste1, pago1, pago2], 'p1', agora, NOVO)).toEqual({ allowed: false, blockedBy: 'p2' });
    expect(correctionImpact([teste1, pago1, pago2], 't1', agora, NOVO)).toEqual({ allowed: false, blockedBy: 'p2' });
  });

  it('anular nunca acrescenta validade: sem o pago, o teste já acabado não cobre hoje', () => {
    const r = correctionImpact([teste1, pago1], 'p1', agora, NOVO);
    expect(r.allowed && r.after).toMatchObject({ state: 'EXPIRED', blocked: true, validUntil: null });
  });

  it('anular o único registro de um estabelecimento novo bloqueia; de um anterior ao controle, volta a "não definida"', () => {
    const so = [comId('c1', { ...pago('2027-01-10', '2027-02-10', 10), kind: 'COURTESY' as const, anchorDay: null })];
    const novo = correctionImpact(so, 'c1', agora, NOVO);
    expect(novo.allowed && novo.after).toMatchObject({ state: 'MISSING', blocked: true });
    const antigo = correctionImpact(so, 'c1', agora, LEGADO);
    expect(antigo.allowed && antigo.after).toMatchObject({ state: 'UNTRACKED', blocked: false });
  });
});
