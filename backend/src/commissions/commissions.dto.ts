// Entradas das comissões. `.strict()` em tudo. Percentual em pontos-base
// inteiros (12,5% = 1250), valor fixo em centavos inteiros: nunca número com
// vírgula. "Sem comissão" não leva valor.
import { z } from 'zod';
import { idSchema } from '../accounts/accounts.dto.js';
import { dashboardQuerySchema } from '../dashboard/dashboard.dto.js';
import { MAIOR_COMISSAO_FIXA_EM_CENTAVOS, PONTOS_BASE_100_POR_CENTO } from './commission-calculation.js';

export const commissionRuleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('NONE') }).strict(),
  z.object({ kind: z.literal('PERCENTAGE'), value: z.number().int().min(1).max(PONTOS_BASE_100_POR_CENTO) }).strict(),
  z.object({ kind: z.literal('FIXED'), value: z.number().int().min(1).max(MAIOR_COMISSAO_FIXA_EM_CENTAVOS) }).strict(),
]);
export type CommissionRuleDto = z.infer<typeof commissionRuleSchema>;

/** "Recebe comissão" e a regra geral do profissional. A regra geral é
 * opcional e não tem "sem comissão" (para isso, desligar). */
export const commissionSettingsSchema = z
  .object({
    receivesCommission: z.boolean(),
    defaultRule: z
      .discriminatedUnion('kind', [
        z.object({ kind: z.literal('PERCENTAGE'), value: z.number().int().min(1).max(PONTOS_BASE_100_POR_CENTO) }).strict(),
        z.object({ kind: z.literal('FIXED'), value: z.number().int().min(1).max(MAIOR_COMISSAO_FIXA_EM_CENTAVOS) }).strict(),
      ])
      .nullable(),
  })
  .strict();
export type CommissionSettingsDto = z.infer<typeof commissionSettingsSchema>;

/** O período do Início (datas locais inclusivas, no máximo 366 dias; sem as
 * duas, o mês corrente) e, opcional, um profissional. */
export const commissionReportQuerySchema = z
  .object({ from: z.string().optional(), to: z.string().optional(), professionalId: idSchema.optional() })
  .strict()
  .transform((valor, ctx): { from?: string; to?: string; professionalId?: string } => {
    const periodo = dashboardQuerySchema.safeParse({
      ...(valor.from === undefined ? {} : { from: valor.from }),
      ...(valor.to === undefined ? {} : { to: valor.to }),
    });
    if (!periodo.success) {
      for (const issue of periodo.error.issues) ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message });
      return z.NEVER;
    }
    return { ...periodo.data, ...(valor.professionalId ? { professionalId: valor.professionalId } : {}) };
  });
export type CommissionReportQuery = z.infer<typeof commissionReportQuerySchema>;

export const ownCommissionsQuerySchema = dashboardQuerySchema;

export const professionalIdSchema = idSchema;
export const serviceIdSchema = idSchema;
