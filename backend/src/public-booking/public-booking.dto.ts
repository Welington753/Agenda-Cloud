// Contratos do agendamento público e da configuração pelo DONO. Mesma
// disciplina dos outros DTOs: `.strict()` recusa campo desconhecido e o pipe
// nunca ecoa o valor recebido.
//
// O pedido público leva SÓ escolhas, o instante, nome, WhatsApp e a chave do
// envio. Não existe campo de status, preço, e-mail, observação, unidade,
// tenant ou autorização de contato: nada disso é decidido por quem preenche
// um formulário anônimo.
import { z } from 'zod';
import { normalizePhone } from '../auth/phone-normalizer.js';
import { availabilityQueryShape } from '../availability/availability.dto.js';
import { createAppointmentSchema } from '../appointments/appointment.dto.js';
import { conferirEscolha, serviceSelectionShape } from '../appointments/service-selection.js';

const idSchema = z.string().trim().min(1).max(30);

/** Slug do caminho: mesmo alfabeto de `auth/slug.ts`, com folga de tamanho. */
export const publicSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/);

export const publicAvailabilityQuerySchema = z
  .object({ ...availabilityQueryShape, professionalId: idSchema })
  .strict()
  .superRefine(conferirEscolha);

export type PublicAvailabilityQueryDto = z.infer<typeof publicAvailabilityQuerySchema>;

export const publicBookingRequestSchema = z
  .object({
    ...serviceSelectionShape,
    professionalId: idSchema,
    startAt: createAppointmentSchema.shape.startAt,
    name: z.string().trim().min(2, 'Informe seu nome.').max(80),
    whatsapp: z.string().trim().min(1).max(30),
    /** Gerada pelo navegador UMA vez por envio. Repetir o envio com a mesma
     * chave devolve o mesmo pedido em vez de criar outro. */
    idempotencyKey: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_-]{16,64}$/),
  })
  .strict()
  .superRefine((valor, ctx) => {
    conferirEscolha(valor, ctx);
    try {
      normalizePhone(valor.whatsapp);
    } catch {
      ctx.addIssue({
        code: 'custom',
        path: ['whatsapp'],
        message: 'Informe um WhatsApp válido com DDD.',
      });
    }
  });

export type PublicBookingRequestDto = z.infer<typeof publicBookingRequestSchema>;

export const publicBookingSettingsSchema = z.object({ enabled: z.boolean() }).strict();

export type PublicBookingSettingsDto = z.infer<typeof publicBookingSettingsSchema>;
