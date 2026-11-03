import { describe, expect, it } from 'vitest';
import { createAppointmentSchema } from './appointment.dto.js';
import { availabilityQuerySchema } from '../availability/availability.dto.js';
import { publicBookingRequestSchema } from '../public-booking/public-booking.dto.js';
import { MAX_SERVICOS_POR_AGENDAMENTO, servicosDaEscolha } from './service-selection.js';
import { nomeDosServicos, precoTotal } from './appointments.service.js';

const base = {
  professionalId: 'prof_1',
  startAt: '2027-03-10T12:00:00.000Z',
  consumer: { mode: 'existing', consumerId: 'cli_1' },
};

describe('escolha de serviços de um agendamento', () => {
  it('aceita um serviço (forma antiga) ou vários, na ordem do atendimento', () => {
    const um = createAppointmentSchema.parse({ ...base, serviceId: 'corte' });
    expect(servicosDaEscolha(um)).toEqual(['corte']);
    const varios = createAppointmentSchema.parse({ ...base, serviceIds: ['corte', 'barba'] });
    expect(servicosDaEscolha(varios)).toEqual(['corte', 'barba']);
  });

  it('recusa as duas formas juntas, nenhuma, lista vazia, repetida ou longa demais', () => {
    expect(createAppointmentSchema.safeParse({ ...base, serviceId: 'corte', serviceIds: ['corte'] }).success).toBe(false);
    expect(createAppointmentSchema.safeParse(base).success).toBe(false);
    expect(createAppointmentSchema.safeParse({ ...base, serviceIds: [] }).success).toBe(false);
    expect(createAppointmentSchema.safeParse({ ...base, serviceIds: ['corte', 'corte'] }).success).toBe(false);
    const demais = Array.from({ length: MAX_SERVICOS_POR_AGENDAMENTO + 1 }, (_, i) => `s${i}`);
    expect(createAppointmentSchema.safeParse({ ...base, serviceIds: demais }).success).toBe(false);
  });

  it('o navegador não manda total, preço nem duração', () => {
    expect(createAppointmentSchema.safeParse({ ...base, serviceIds: ['corte'], totalPriceCents: 1 }).success).toBe(false);
    expect(createAppointmentSchema.safeParse({ ...base, serviceIds: ['corte'], durationMinutes: 5 }).success).toBe(false);
  });

  it('consulta de horários e pedido público aceitam a lista', () => {
    const consulta = availabilityQuerySchema.parse({ serviceIds: 'corte,barba', date: '2027-03-10' });
    expect(servicosDaEscolha(consulta)).toEqual(['corte', 'barba']);
    expect(availabilityQuerySchema.safeParse({ serviceIds: 'corte,corte', date: '2027-03-10' }).success).toBe(false);
    expect(availabilityQuerySchema.parse({ serviceId: 'corte', date: '2027-03-10' })).toMatchObject({ serviceId: 'corte' });
    const pedido = publicBookingRequestSchema.parse({
      serviceIds: ['corte', 'barba'],
      professionalId: 'prof_1',
      startAt: '2027-03-10T12:00:00.000Z',
      name: 'Cliente Fictício',
      whatsapp: '11999998888',
      idempotencyKey: 'chave-ficticia-0001',
    });
    expect(servicosDaEscolha(pedido)).toEqual(['corte', 'barba']);
  });
});

describe('totais da reserva', () => {
  it('Corte R$ 42,50 + Barba R$ 25,00 = R$ 67,50; nome com os dois', () => {
    expect(precoTotal([{ priceCents: 4250 }, { priceCents: 2500 }])).toBe(6750);
    expect(nomeDosServicos(['Corte', 'Barba'])).toBe('Corte + Barba');
  });

  it('um item sob consulta deixa o total sob consulta (nunca soma parcial nem zero)', () => {
    expect(precoTotal([{ priceCents: 4250 }, { priceCents: null }])).toBeNull();
    expect(precoTotal([])).toBeNull();
  });
});
