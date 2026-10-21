import { describe, expect, it } from 'vitest';
import { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { Permission } from '../entities/enums/permission.enum.js';
import { PermissionMode } from '../entities/enums/permission-mode.enum.js';
import { canManagePublicBooking } from './public-booking-access.js';
import { publicBookingRequestSchema, publicSlugSchema } from './public-booking.dto.js';
import {
  PUBLIC_READ_RATE_LIMIT_MAX,
  PUBLIC_REQUEST_RATE_LIMIT_MAX,
  PUBLIC_REQUEST_RATE_LIMIT_WINDOW_MS,
} from './public-booking-rate-limit.js';
import { LOGIN_RATE_LIMIT_MAX } from '../auth/login-rate-limit.js';
import { REGISTER_RATE_LIMIT_MAX } from '../auth/register-rate-limit.js';

describe('canManagePublicBooking', () => {
  it('só DONO, e DENIED pertinente restringe', () => {
    expect(canManagePublicBooking(EstablishmentRole.DONO)).toBe(true);
    for (const role of Object.values(EstablishmentRole).filter((r) => r !== EstablishmentRole.DONO)) {
      expect(canManagePublicBooking(role)).toBe(false);
    }
    for (const permission of [Permission.CONFIGURACOES_GERENCIAR, Permission.AGENDA_GERENCIAR]) {
      expect(
        canManagePublicBooking(EstablishmentRole.DONO, [{ permission, mode: PermissionMode.DENIED }]),
      ).toBe(false);
    }
    // GRANTED não amplia para outro papel.
    expect(
      canManagePublicBooking(EstablishmentRole.GERENTE, [
        { permission: Permission.CONFIGURACOES_GERENCIAR, mode: PermissionMode.GRANTED },
      ]),
    ).toBe(false);
  });
});

describe('contrato do pedido público', () => {
  const valido = {
    serviceId: 's1',
    professionalId: 'p1',
    startAt: '2027-03-07T13:00:00.000Z',
    name: 'Joana',
    whatsapp: '(11) 98765-4321',
    idempotencyKey: 'abcdefghij0123456789',
  };

  it('aceita o mínimo e recusa campos que o público não decide', () => {
    expect(publicBookingRequestSchema.safeParse(valido).success).toBe(true);
    for (const extra of ['status', 'email', 'tenantId', 'notes', 'priceCents', 'consumerId', 'whatsappOptIn']) {
      expect(publicBookingRequestSchema.safeParse({ ...valido, [extra]: 'x' }).success).toBe(false);
    }
    expect(publicBookingRequestSchema.safeParse({ ...valido, name: 'J' }).success).toBe(false);
    expect(publicBookingRequestSchema.safeParse({ ...valido, whatsapp: '9999' }).success).toBe(false);
    expect(publicBookingRequestSchema.safeParse({ ...valido, idempotencyKey: 'a b' }).success).toBe(false);
  });

  it('slug só no alfabeto do cadastro', () => {
    expect(publicSlugSchema.parse('Clinica-Ana')).toBe('clinica-ana');
    for (const ruim of ['', '-a', 'a-', '../x', 'a b', 'á']) {
      expect(publicSlugSchema.safeParse(ruim).success).toBe(false);
    }
  });
});

describe('limites explícitos', () => {
  it('valores do plano, sem mexer nos de login e cadastro', () => {
    expect(PUBLIC_REQUEST_RATE_LIMIT_MAX).toBe(10);
    expect(PUBLIC_REQUEST_RATE_LIMIT_WINDOW_MS).toBe(60 * 60 * 1000);
    expect(PUBLIC_READ_RATE_LIMIT_MAX).toBe(120);
    expect(LOGIN_RATE_LIMIT_MAX).toBe(5);
    expect(REGISTER_RATE_LIMIT_MAX).toBe(5);
  });
});
