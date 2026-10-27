import { contagemPorSituacao, mesDaData } from './dashboard-period.js';
import { dashboardQuerySchema } from './dashboard.dto.js';
import { appointmentPeriodSchema, ownAgendaPeriodSchema } from '../appointments/appointment.dto.js';
import { consumerPageSchema } from '../consumers/consumer.dto.js';
import { escaparLike, lerCursor } from '../consumers/consumers.service.js';

describe('período do Início', () => {
  it('mês corrente, inclusive fevereiro de ano bissexto', () => {
    expect(mesDaData('2031-06-15')).toEqual({ from: '2031-06-01', to: '2031-06-30' });
    expect(mesDaData('2032-02-03')).toEqual({ from: '2032-02-01', to: '2032-02-29' });
  });

  it('contagem com todas as situações, zero quando não houve', () => {
    expect(contagemPorSituacao([{ status: 'COMPLETED', total: 3 }, { status: 'OUTRA', total: 9 }])).toEqual({
      PENDING: 0,
      CONFIRMED: 0,
      IN_PROGRESS: 0,
      COMPLETED: 3,
      NO_SHOW: 0,
      CANCELED: 0,
    });
  });

  it('período: os dois lados ou nenhum, em ordem, até 366 dias', () => {
    expect(dashboardQuerySchema.safeParse({}).success).toBe(true);
    expect(dashboardQuerySchema.safeParse({ from: '2031-01-01', to: '2031-12-31' }).success).toBe(true);
    expect(dashboardQuerySchema.safeParse({ from: '2031-01-01' }).success).toBe(false);
    expect(dashboardQuerySchema.safeParse({ from: '2031-02-01', to: '2031-01-31' }).success).toBe(false);
    expect(dashboardQuerySchema.safeParse({ from: '2031-01-01', to: '2032-01-02' }).success).toBe(false);
    expect(dashboardQuerySchema.safeParse({ from: '2031-02-30', to: '2031-03-01' }).success).toBe(false);
    expect(dashboardQuerySchema.safeParse({ from: '2031-01-01', to: '2031-01-02', tenantId: 'x' }).success).toBe(false);
  });
});

describe('agenda por período', () => {
  it('no máximo 42 dias, fim depois do início, sem campos estranhos', () => {
    expect(appointmentPeriodSchema.safeParse({ from: '2026-07-26', to: '2026-09-05' }).success).toBe(true);
    expect(appointmentPeriodSchema.safeParse({ from: '2026-07-26', to: '2026-09-06' }).success).toBe(false);
    expect(appointmentPeriodSchema.safeParse({ from: '2026-07-26', to: '2026-07-25' }).success).toBe(false);
    expect(appointmentPeriodSchema.safeParse({ from: '2026-07-26', to: '2026-07-26', professionalId: 'p1' }).success).toBe(
      true,
    );
    // O funcionário nunca escolhe profissional.
    expect(ownAgendaPeriodSchema.safeParse({ from: '2026-07-26', to: '2026-07-26', professionalId: 'p1' }).success).toBe(
      false,
    );
  });
});

describe('listagem de clientes', () => {
  it('página de 1 a 50, termo vazio é "sem filtro", um caractere é recusado', () => {
    expect(consumerPageSchema.parse({})).toEqual({ limit: 20 });
    expect(consumerPageSchema.parse({ q: '', limit: '50' })).toEqual({ limit: 50 });
    expect(consumerPageSchema.safeParse({ limit: '51' }).success).toBe(false);
    expect(consumerPageSchema.safeParse({ q: 'a' }).success).toBe(false);
  });

  it('curingas do LIKE viram texto; cursor adulterado é recusado', () => {
    expect(escaparLike(String.raw`50%_a\b`)).toBe(String.raw`50\%\_a\\b`);
    expect(() => lerCursor('lixo')).toThrow();
    expect(() => lerCursor(Buffer.from('["a"]').toString('base64url'))).toThrow();
    expect(lerCursor(Buffer.from('["ana","c1"]').toString('base64url'))).toEqual({ nome: 'ana', id: 'c1' });
  });
});
