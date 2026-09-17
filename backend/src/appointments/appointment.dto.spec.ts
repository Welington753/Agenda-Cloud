// Contrato de criação e listagem de agendamentos (Lote 6D.5).
import { describe, expect, it } from 'vitest';
import { createAppointmentSchema, listAppointmentsSchema } from './appointment.dto.js';

const VALIDO = {
  professionalId: 'professional_1',
  serviceId: 'service_1',
  startAt: '2026-09-20T12:00:00.000Z',
  consumer: { mode: 'existing' as const, consumerId: 'consumer_1' },
};

describe('createAppointmentSchema', () => {
  it('aceita o corpo mínimo com cliente existente', () => {
    expect(createAppointmentSchema.safeParse(VALIDO).success).toBe(true);
  });

  it('aceita cliente novo com nome e whatsapp', () => {
    const resultado = createAppointmentSchema.safeParse({
      ...VALIDO,
      consumer: { mode: 'new', data: { name: 'Maria', whatsapp: '(11) 90000-0000' } },
    });
    expect(resultado.success).toBe(true);
  });

  it.each([
    ['preço', { priceCents: 5000 }],
    ['duração', { durationMinutes: 30 }],
    ['fim', { endAt: '2026-09-20T13:00:00.000Z' }],
    ['status', { status: 'CONFIRMED' }],
    ['unidade', { unitId: 'unit_1' }],
    ['tenant', { tenantId: 'tenant_outro' }],
  ])('recusa %s vindo do navegador — é o servidor que decide', (_rotulo, extra) => {
    expect(createAppointmentSchema.safeParse({ ...VALIDO, ...extra }).success).toBe(false);
  });

  it.each([
    ['sem fuso', '2026-09-20T09:00:00'],
    ['só data', '2026-09-20'],
    ['hora local solta', '09:00'],
    ['texto', 'amanhã de manhã'],
    ['vazio', ''],
  ])('recusa início %s — o instante precisa ser inequívoco', (_rotulo, startAt) => {
    expect(createAppointmentSchema.safeParse({ ...VALIDO, startAt }).success).toBe(false);
  });

  it.each([
    '2026-09-20T12:00:00.000Z',
    '2026-09-20T12:00:00Z',
    '2026-09-20T09:00-03:00',
    '2026-09-20T09:00:00-03:00',
  ])('aceita instante ISO 8601 com fuso: %s', (startAt) => {
    expect(createAppointmentSchema.safeParse({ ...VALIDO, startAt }).success).toBe(true);
  });

  it('recusa instante com formato válido mas data impossível', () => {
    expect(
      createAppointmentSchema.safeParse({ ...VALIDO, startAt: '2026-02-30T12:00:00.000Z' }).success,
    ).toBe(false);
  });

  it('recusa cliente sem modo, com os dois modos, ou sem dado nenhum', () => {
    expect(createAppointmentSchema.safeParse({ ...VALIDO, consumer: {} }).success).toBe(false);
    expect(
      createAppointmentSchema.safeParse({
        ...VALIDO,
        consumer: { mode: 'existing', consumerId: 'c1', data: { name: 'X', whatsapp: '11900000000' } },
      }).success,
    ).toBe(false);
    expect(
      createAppointmentSchema.safeParse({ ...VALIDO, consumer: { mode: 'new' } }).success,
    ).toBe(false);
  });

  it('recusa telefone inválido no cliente novo', () => {
    expect(
      createAppointmentSchema.safeParse({
        ...VALIDO,
        consumer: { mode: 'new', data: { name: 'Maria', whatsapp: '123' } },
      }).success,
    ).toBe(false);
  });

  it('observação vazia vira ausência, nunca string em branco gravada', () => {
    const resultado = createAppointmentSchema.parse({ ...VALIDO, notes: '' });
    expect(resultado.notes).toBeUndefined();
  });

  it.each([['professionalId'], ['serviceId'], ['startAt'], ['consumer']])(
    'recusa corpo sem %s',
    (campo) => {
      const corpo = { ...VALIDO } as Record<string, unknown>;
      delete corpo[campo];
      expect(createAppointmentSchema.safeParse(corpo).success).toBe(false);
    },
  );
});

describe('listAppointmentsSchema', () => {
  it('aceita só a data', () => {
    expect(listAppointmentsSchema.safeParse({ date: '2026-09-20' }).success).toBe(true);
  });

  it('aceita filtro opcional por profissional', () => {
    expect(
      listAppointmentsSchema.safeParse({ date: '2026-09-20', professionalId: 'p1' }).success,
    ).toBe(true);
  });

  it('exige a data — nunca existe "liste tudo"', () => {
    expect(listAppointmentsSchema.safeParse({}).success).toBe(false);
  });

  it.each(['2026-02-30', '20/09/2026', '2026-13-01', '2026-9-20'])(
    'recusa data inválida: %s',
    (date) => {
      expect(listAppointmentsSchema.safeParse({ date }).success).toBe(false);
    },
  );

  it('recusa propriedade desconhecida', () => {
    expect(
      listAppointmentsSchema.safeParse({ date: '2026-09-20', tenantId: 'outro' }).success,
    ).toBe(false);
  });
});
