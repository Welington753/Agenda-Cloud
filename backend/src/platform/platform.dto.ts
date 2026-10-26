import { z } from 'zod';
import { BusinessCategory } from '../entities/enums/business-category.enum.js';
import { TenantStatus } from '../entities/enums/tenant-status.enum.js';

export const establishmentIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,30}$/);

/** `ARCHIVED` é valor novo do enum do banco (migration TeamAccess), fora do
 * enum TypeScript que espelha a migration inicial. */
export const TENANT_STATUS_VALUES = [...Object.values(TenantStatus), 'ARCHIVED'] as const;

export const establishmentQuerySchema = z
  .object({
    q: z.string().trim().min(2).max(120).optional(),
    status: z.enum(TENANT_STATUS_VALUES as unknown as [string, ...string[]]).optional(),
    planId: establishmentIdSchema.optional(),
    page: z
      .string()
      .regex(/^[1-9]\d{0,5}$/)
      .transform(Number)
      .default(1),
    pageSize: z
      .string()
      .regex(/^\d{1,3}$/)
      .transform(Number)
      .pipe(z.number().int().min(1).max(100))
      .default(20),
  })
  .strict();
export type EstablishmentQuery = z.infer<typeof establishmentQuerySchema>;

/** `updated_at` que a tela leu: se outra tela mudou o estabelecimento, 409. */
const expectedUpdatedAtSchema = z.iso.datetime({ offset: true });
const reasonSchema = z.string().trim().min(3).max(300);

/** Sem `slug`: o endereço público não muda neste fluxo. */
export const updateEstablishmentSchema = z
  .object({
    expectedUpdatedAt: expectedUpdatedAtSchema,
    name: z.string().trim().min(2).max(120).optional(),
    category: z.enum(BusinessCategory).optional(),
    /** CPF ou CNPJ, só dígitos (11 ou 14); `null` apaga. */
    taxDocument: z
      .union([
        z
          .string()
          .trim()
          .transform((v) => v.replace(/[.\-/\s]/g, ''))
          .pipe(z.string().regex(/^(\d{11}|\d{14})$/)),
        z.null(),
      ])
      .optional(),
  })
  .strict()
  .refine((dto) => dto.name !== undefined || dto.category !== undefined || dto.taxDocument !== undefined);
export type UpdateEstablishmentDto = z.infer<typeof updateEstablishmentSchema>;

export const suspendEstablishmentSchema = z
  .object({ expectedUpdatedAt: expectedUpdatedAtSchema, reason: reasonSchema })
  .strict();
export type SuspendEstablishmentDto = z.infer<typeof suspendEstablishmentSchema>;

export const archiveEstablishmentSchema = z
  .object({
    expectedUpdatedAt: expectedUpdatedAtSchema,
    reason: reasonSchema,
    /** O endereço do estabelecimento digitado pela pessoa, como confirmação. */
    confirmSlug: z.string().trim().min(1).max(120),
  })
  .strict();
export type ArchiveEstablishmentDto = z.infer<typeof archiveEstablishmentSchema>;

export const reactivateEstablishmentSchema = z.object({ expectedUpdatedAt: expectedUpdatedAtSchema }).strict();
export type ReactivateEstablishmentDto = z.infer<typeof reactivateEstablishmentSchema>;

export const changePlanSchema = z
  .object({ expectedUpdatedAt: expectedUpdatedAtSchema, planId: establishmentIdSchema })
  .strict();
export type ChangePlanDto = z.infer<typeof changePlanSchema>;
