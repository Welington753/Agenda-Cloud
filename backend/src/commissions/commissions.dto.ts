// Entradas das comissões. `.strict()` em tudo. Percentual em pontos-base
// inteiros (12,5% = 1250), valor fixo em centavos inteiros: nunca número com
// vírgula. "Sem comissão" não leva valor.
import { z } from 'zod';
import { idSchema } from '../accounts/accounts.dto.js';
import { dashboardQuerySchema } from '../dashboard/dashboard.dto.js';
import { BULK_MODES, BULK_TARGETS, MAXIMO_DA_APLICACAO_EM_MASSA } from './commission-bulk.js';
import { MAIOR_COMISSAO_FIXA_EM_CENTAVOS, PONTOS_BASE_100_POR_CENTO } from './commission-calculation.js';
import { EXCEPTION_CHOICES } from './commission-exceptions.js';

export const commissionRuleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('NONE') }).strict(),
  z.object({ kind: z.literal('PERCENTAGE'), value: z.number().int().min(1).max(PONTOS_BASE_100_POR_CENTO) }).strict(),
  z.object({ kind: z.literal('FIXED'), value: z.number().int().min(1).max(MAIOR_COMISSAO_FIXA_EM_CENTAVOS) }).strict(),
]);
export type CommissionRuleDto = z.infer<typeof commissionRuleSchema>;

/** Regra geral: só percentual ou fixo por serviço realizado. */
const defaultRuleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('PERCENTAGE'), value: z.number().int().min(1).max(PONTOS_BASE_100_POR_CENTO) }).strict(),
  z.object({ kind: z.literal('FIXED'), value: z.number().int().min(1).max(MAIOR_COMISSAO_FIXA_EM_CENTAVOS) }).strict(),
]);

const impressaoSchema = z.string().regex(/^[0-9a-f]{64}$/);

/** "Recebe comissão" e a regra geral do profissional. A regra geral é
 * opcional e não tem "sem comissão" (para isso, desligar).
 *
 * Exceções por serviço: sem `exceptions` (ou `KEEP`), ficam como estão.
 * `REMOVE` apaga todas as exceções do profissional na mesma transação, e
 * exige regra geral (é ela que passa a valer em todos os serviços), a
 * confirmação explícita e a impressão das exceções que a tela mostrou
 * (`exceptionsFingerprint` da leitura das regras). */
export const commissionSettingsSchema = z
  .object({
    receivesCommission: z.boolean(),
    defaultRule: defaultRuleSchema.nullable(),
    exceptions: z.enum(EXCEPTION_CHOICES).optional(),
    exceptionsFingerprint: impressaoSchema.optional(),
    confirmRemoveExceptions: z.literal(true).optional(),
  })
  .strict()
  .superRefine((valor, ctx) => {
    if (valor.exceptions === 'REMOVE') {
      if (valor.defaultRule === null) {
        ctx.addIssue({
          code: 'custom',
          path: ['defaultRule'],
          message: 'Para remover as exceções, defina a regra geral que vai valer em todos os serviços.',
        });
      }
      if (valor.confirmRemoveExceptions !== true) {
        ctx.addIssue({ code: 'custom', path: ['confirmRemoveExceptions'], message: 'Confirme a remoção das exceções por serviço.' });
      }
      if (!valor.exceptionsFingerprint) {
        ctx.addIssue({ code: 'custom', path: ['exceptionsFingerprint'], message: 'Informe as exceções revisadas.' });
      }
      return;
    }
    if (valor.confirmRemoveExceptions !== undefined || valor.exceptionsFingerprint !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['exceptions'], message: 'Só a remoção das exceções leva confirmação.' });
    }
  });
export type CommissionSettingsDto = z.infer<typeof commissionSettingsSchema>;

/** Aplicação em massa (docs/plans/comissoes-aplicacao-em-massa.md). "Todos":
 * os profissionais ativos; "Escolher": de 1 a 200 ids, sem repetição. */
const bulkBaseShape = {
  target: z.enum(BULK_TARGETS),
  professionalIds: z.array(idSchema).min(1).max(MAXIMO_DA_APLICACAO_EM_MASSA).optional(),
  defaultRule: defaultRuleSchema,
  mode: z.enum(BULK_MODES),
  /** Sem o campo: `KEEP`. `REMOVE` só em SUBSTITUIR. */
  exceptions: z.enum(EXCEPTION_CHOICES).optional(),
};

function conferirAlcance(
  valor: { target: string; professionalIds?: string[]; mode: string; exceptions?: string },
  ctx: z.RefinementCtx,
) {
  if (valor.exceptions === 'REMOVE' && valor.mode !== 'REPLACE') {
    ctx.addIssue({ code: 'custom', path: ['exceptions'], message: 'A remoção das exceções só existe ao substituir a regra geral.' });
  }
  if (valor.target === 'SELECTED' && !valor.professionalIds) {
    ctx.addIssue({ code: 'custom', path: ['professionalIds'], message: 'Escolha ao menos um profissional.' });
  }
  if (valor.target === 'ALL' && valor.professionalIds) {
    ctx.addIssue({ code: 'custom', path: ['professionalIds'], message: '"Todos" não leva lista de profissionais.' });
  }
  if (valor.professionalIds && new Set(valor.professionalIds).size !== valor.professionalIds.length) {
    ctx.addIssue({ code: 'custom', path: ['professionalIds'], message: 'Profissional repetido na lista.' });
  }
}

export const commissionBulkPreviewSchema = z.object(bulkBaseShape).strict().superRefine(conferirAlcance);
export type CommissionBulkPreviewDto = z.infer<typeof commissionBulkPreviewSchema>;

/** A aplicação leva a impressão da prévia revisada e, em SUBSTITUIR, a
 * confirmação explícita de quem substitui as configurações individuais; com
 * `REMOVE`, também a confirmação da remoção das exceções. */
export const commissionBulkApplySchema = z
  .object({
    ...bulkBaseShape,
    fingerprint: impressaoSchema,
    confirmReplace: z.literal(true).optional(),
    confirmRemoveExceptions: z.literal(true).optional(),
  })
  .strict()
  .superRefine((valor, ctx) => {
    conferirAlcance(valor, ctx);
    if (valor.mode === 'REPLACE' && valor.confirmReplace !== true) {
      ctx.addIssue({ code: 'custom', path: ['confirmReplace'], message: 'Confirme a substituição das configurações gerais.' });
    }
    if (valor.mode === 'PRESERVE' && valor.confirmReplace !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['confirmReplace'], message: 'Só a substituição leva confirmação.' });
    }
    if (valor.exceptions === 'REMOVE' && valor.confirmRemoveExceptions !== true) {
      ctx.addIssue({ code: 'custom', path: ['confirmRemoveExceptions'], message: 'Confirme a remoção das exceções por serviço.' });
    }
    if (valor.exceptions !== 'REMOVE' && valor.confirmRemoveExceptions !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['confirmRemoveExceptions'], message: 'Só a remoção das exceções leva essa confirmação.' });
    }
  });
export type CommissionBulkApplyDto = z.infer<typeof commissionBulkApplySchema>;

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
