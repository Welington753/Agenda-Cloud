// Entradas dos recebimentos manuais. `.strict()` em tudo: tenant, autor,
// situação ou qualquer campo a mais é recusado. Valor em centavos INTEIROS
// (nunca número com vírgula), data local `YYYY-MM-DD` do estabelecimento.
import { z } from 'zod';
import { requestKeySchema, idSchema } from '../accounts/accounts.dto.js';
import { dateSchema } from '../appointments/appointment.dto.js';
import { dashboardQuerySchema, type DashboardQueryDto } from '../dashboard/dashboard.dto.js';
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

/** O mesmo período do Início: datas locais inclusivas, no máximo 366 dias;
 * sem nenhuma das duas, o mês corrente no fuso do estabelecimento. */
export const paymentPeriodSchema = dashboardQuerySchema;
export type PaymentPeriodDto = DashboardQueryDto;

export const paymentIdSchema = idSchema;
