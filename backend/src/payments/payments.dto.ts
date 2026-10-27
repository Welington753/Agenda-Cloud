// Entradas dos recebimentos manuais. `.strict()` em tudo: tenant, autor,
// situação ou qualquer campo a mais é recusado. Valor em centavos INTEIROS
// (nunca número com vírgula), data local `YYYY-MM-DD` do estabelecimento.
import { z } from 'zod';
import { requestKeySchema, idSchema } from '../accounts/accounts.dto.js';
import { dateSchema } from '../appointments/appointment.dto.js';
import { PAYMENT_METHODS } from '../migrations/1793059200000-AppointmentPayments.js';

/** Teto por recebimento: R$ 1.000.000,00 (o mesmo do banco). */
export const MAIOR_VALOR_EM_CENTAVOS = 100_000_000;

export const recordPaymentSchema = z
  .object({
    requestKey: requestKeySchema,
    appointmentId: idSchema,
    amountCents: z.number().int().positive().max(MAIOR_VALOR_EM_CENTAVOS),
    method: z.enum(PAYMENT_METHODS),
    receivedOn: dateSchema,
    notes: z
      .string()
      .trim()
      .max(300)
      .transform((v) => (v === '' ? undefined : v))
      .optional(),
  })
  .strict();
export type RecordPaymentDto = z.infer<typeof recordPaymentSchema>;

export const refundPaymentSchema = z.object({ reason: z.string().trim().min(3).max(300) }).strict();
export type RefundPaymentDto = z.infer<typeof refundPaymentSchema>;

function diaUtc(data: string): number {
  const [ano, mes, dia] = data.split('-').map(Number);
  return Date.UTC(ano, mes - 1, dia) / 86_400_000;
}

export const paymentPeriodSchema = z
  .object({ from: dateSchema, to: dateSchema })
  .strict()
  .superRefine((v, ctx) => {
    const dias = diaUtc(v.to) - diaUtc(v.from) + 1;
    if (dias < 1) ctx.addIssue({ code: 'custom', path: ['to'], message: 'O fim do período vem antes do início.' });
    else if (dias > 366) ctx.addIssue({ code: 'custom', path: ['to'], message: 'O período pode ter no máximo 366 dias.' });
  });
export type PaymentPeriodDto = z.infer<typeof paymentPeriodSchema>;

export const paymentIdSchema = idSchema;
