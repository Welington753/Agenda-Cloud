// Entradas das rotas de vendas (docs/plans/vendas-v1.md, seção 4).
// `.strict()` em tudo: estabelecimento, total, linha, autor, situação ou
// qualquer campo a mais é recusado. A tela nunca manda total nem linha: o
// servidor calcula (sale-math.ts). Quantidades em milésimos inteiros, com as
// casas da unidade; preços em centavos inteiros.
import { z } from 'zod';
import { idSchema, requestKeySchema } from '../accounts/accounts.dto.js';
import { dateSchema } from '../appointments/appointment.dto.js';
import { MAIOR_PERIODO_DO_PAINEL_EM_DIAS } from '../dashboard/dashboard.dto.js';
import { PAYMENT_METHODS } from '../migrations/1793059200000-AppointmentPayments.js';
import { STOCK_UNITS, MAX_MOVEMENT_MILLI, quantidadeValidaNaUnidade } from '../stock/stock-quantity.js';
import { MAX_SALE_ITEMS, MAX_SALE_TOTAL_CENTS, MAX_UNIT_PRICE_CENTS, totalDaVenda } from './sale-math.js';

export const saleIdSchema = idSchema;

const preco = z.number().int().positive().max(MAX_UNIT_PRICE_CENTS);
const motivo = z.string().trim().min(3).max(300).transform((v) => v.replace(/\s+/g, ' '));
const observacao = z
  .string()
  .trim()
  .max(300)
  .transform((v) => (v === '' ? null : v.replace(/\s+/g, ' ')))
  .nullable()
  .optional()
  .transform((v) => v ?? null);

const itemDaVenda = z
  .object({
    productId: idSchema,
    quantityMilli: z.number().int().positive().max(MAX_MOVEMENT_MILLI),
    /** Unidade que a tela mostrou: mudou no cadastro, 409 `UNIDADE_ALTERADA`. */
    expectedUnit: z.enum(STOCK_UNITS),
    /** Preço sugerido que a tela mostrou (`null` = sem sugerido). Mudou no
     * cadastro, 409 `PRECO_ALTERADO` sem gravar. */
    expectedSuggestedPriceCents: preco.nullable(),
    /** Preço aplicado. Diferente do sugerido (ou sem sugerido) exige
     * `VENDAS_ALTERAR_PRECO`. */
    unitPriceCents: preco,
  })
  .strict()
  .superRefine((i, ctx) => {
    if (!quantidadeValidaNaUnidade(i.quantityMilli, i.expectedUnit)) {
      ctx.addIssue({ code: 'custom', path: ['quantityMilli'], message: 'Quantidade com casas que a unidade não aceita.' });
    }
  });

export const createSaleSchema = z
  .object({
    requestKey: requestKeySchema,
    /** Cliente escolhido por toque num resultado da busca; `null` = balcão. */
    consumerId: idSchema.nullable(),
    items: z.array(itemDaVenda).min(1).max(MAX_SALE_ITEMS),
  })
  .strict()
  .superRefine((v, ctx) => {
    const ids = v.items.map((i) => i.productId);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: 'custom', path: ['items'], message: 'Produto repetido na venda: use uma linha por produto.' });
      return;
    }
    // O zod v4 roda este refinamento mesmo com item inválido (já recusado
    // acima): sem preço e quantidade válidos não há total a conferir.
    let total: number;
    try {
      total = totalDaVenda(v.items);
    } catch {
      return;
    }
    if (total < 1) ctx.addIssue({ code: 'custom', path: ['items'], message: 'O total da venda precisa ser de pelo menos R$ 0,01.' });
    if (total > MAX_SALE_TOTAL_CENTS) ctx.addIssue({ code: 'custom', path: ['items'], message: 'O total passa do limite de uma venda.' });
  });
export type CreateSaleDto = z.infer<typeof createSaleSchema>;

export const cancelSaleSchema = z.object({ reason: motivo }).strict();
export type CancelSaleDto = z.infer<typeof cancelSaleSchema>;

export const recordSalePaymentSchema = z
  .object({
    requestKey: requestKeySchema,
    method: z.enum(PAYMENT_METHODS),
    receivedOn: dateSchema,
    notes: observacao,
  })
  .strict();
export type RecordSalePaymentDto = z.infer<typeof recordSalePaymentSchema>;

export const refundSalePaymentSchema = z.object({ reason: motivo }).strict();
export type RefundSalePaymentDto = z.infer<typeof refundSalePaymentSchema>;

/** Escopo das consultas: `mine` (o que a pessoa registrou) ou `all`
 * (consulta geral, só com `VENDAS_VISUALIZAR`). */
export const SALES_SCOPES = ['mine', 'all'] as const;
export type SalesScope = (typeof SALES_SCOPES)[number];

const diaUtc = (data: string) => {
  const [ano, mes, dia] = data.split('-').map(Number);
  return Date.UTC(ano, mes - 1, dia) / 86_400_000;
};

/** O mesmo período do Início: datas locais inclusivas, as duas ou nenhuma
 * (mês corrente no fuso do estabelecimento), no máximo 366 dias. */
function conferirPeriodo(v: { from?: string; to?: string }, ctx: z.RefinementCtx) {
  if (!v.from && !v.to) return;
  if (!v.from || !v.to) {
    ctx.addIssue({ code: 'custom', path: ['from'], message: 'Informe o início e o fim do período.' });
    return;
  }
  const dias = diaUtc(v.to) - diaUtc(v.from) + 1;
  if (dias < 1) ctx.addIssue({ code: 'custom', path: ['to'], message: 'O fim do período vem antes do início.' });
  else if (dias > MAIOR_PERIODO_DO_PAINEL_EM_DIAS) {
    ctx.addIssue({ code: 'custom', path: ['to'], message: `O período pode ter no máximo ${MAIOR_PERIODO_DO_PAINEL_EM_DIAS} dias.` });
  }
}

export const saleListQuerySchema = z
  .object({
    scope: z.enum(SALES_SCOPES).optional().default('mine'),
    status: z.enum(['ATIVA', 'CANCELADA']).optional(),
    from: dateSchema.optional(),
    to: dateSchema.optional(),
    cursor: z.string().max(200).optional(),
  })
  .strict()
  .superRefine(conferirPeriodo);
export type SaleListQueryDto = z.infer<typeof saleListQuerySchema>;

export const salePaymentListQuerySchema = z
  .object({
    scope: z.enum(SALES_SCOPES).optional().default('mine'),
    from: dateSchema.optional(),
    to: dateSchema.optional(),
  })
  .strict()
  .superRefine(conferirPeriodo);
export type SalePaymentListQueryDto = z.infer<typeof salePaymentListQuerySchema>;

export const saleCatalogQuerySchema = z
  .object({
    q: z.string().trim().max(80).optional(),
    cursor: z.string().max(200).optional(),
  })
  .strict();
export type SaleCatalogQueryDto = z.infer<typeof saleCatalogQuerySchema>;

/** Busca limitada de clientes para a venda: pelo menos 2 caracteres. */
export const saleConsumerSearchSchema = z.object({ q: z.string().trim().min(2).max(80) }).strict();
export type SaleConsumerSearchDto = z.infer<typeof saleConsumerSearchSchema>;

export const purchaseListQuerySchema = z.object({ cursor: z.string().max(200).optional() }).strict();
export type PurchaseListQueryDto = z.infer<typeof purchaseListQuerySchema>;
