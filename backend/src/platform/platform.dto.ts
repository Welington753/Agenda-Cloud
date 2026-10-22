import { z } from 'zod';
import { TenantStatus } from '../entities/enums/tenant-status.enum.js';

export const establishmentIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,30}$/);
export const establishmentQuerySchema = z
  .object({
    q: z.string().trim().min(2).max(120).optional(),
    status: z.enum(TenantStatus).optional(),
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
