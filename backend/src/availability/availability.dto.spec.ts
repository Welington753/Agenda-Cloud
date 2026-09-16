// Contrato da query de disponibilidade (Lote 6D.4).
import { describe, expect, it } from 'vitest';
import { availabilityQuerySchema } from './availability.dto.js';

const valida = { serviceId: 'service_1', date: '2026-09-20' };

describe('availabilityQuerySchema', () => {
  it('aceita serviço e data', () => {
    expect(availabilityQuerySchema.parse(valida)).toEqual(valida);
  });

  it('recusa propriedade desconhecida — nada de tenantId ou de reserva pela query', () => {
    for (const extra of [
      { tenantId: 'tenant_outro' },
      { professionalId: 'prof_outro' },
      { consumerId: 'consumidor' },
      { confirm: true },
    ]) {
      expect(availabilityQuerySchema.safeParse({ ...valida, ...extra }).success).toBe(false);
    }
  });

  it.each(['20/09/2026', '2026-9-20', '2026-09-20T10:00:00Z', 'hoje', ''])(
    'recusa a data %s',
    (date) => {
      expect(availabilityQuerySchema.safeParse({ ...valida, date }).success).toBe(false);
    },
  );

  it.each(['2026-02-30', '2026-13-01', '2026-04-31', '2026-00-10'])(
    'recusa a data inexistente %s em vez de rolar para o mês seguinte',
    (date) => {
      expect(availabilityQuerySchema.safeParse({ ...valida, date }).success).toBe(false);
    },
  );

  it('aceita 29 de fevereiro em ano bissexto', () => {
    expect(availabilityQuerySchema.safeParse({ ...valida, date: '2028-02-29' }).success).toBe(true);
    expect(availabilityQuerySchema.safeParse({ ...valida, date: '2027-02-29' }).success).toBe(false);
  });

  it('recusa serviço vazio e campo ausente', () => {
    expect(availabilityQuerySchema.safeParse({ ...valida, serviceId: '   ' }).success).toBe(false);
    expect(availabilityQuerySchema.safeParse({ date: valida.date }).success).toBe(false);
    expect(availabilityQuerySchema.safeParse({ serviceId: valida.serviceId }).success).toBe(false);
  });
});
