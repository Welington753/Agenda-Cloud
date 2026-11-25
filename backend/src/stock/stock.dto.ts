// Entradas do estoque. `.strict()` em tudo: estabelecimento, saldo, autor,
// data ou qualquer campo a mais é recusado. Quantidades em milésimos
// INTEIROS; as casas permitidas pela unidade são conferidas aqui quando a
// unidade vem no corpo e, no serviço, contra a unidade gravada do produto.
import { z } from 'zod';
import { idSchema, requestKeySchema } from '../accounts/accounts.dto.js';
import { MAX_UNIT_PRICE_CENTS } from '../migrations/1794614400000-SalesModule.js';
import {
  MANUAL_MOVEMENT_KINDS,
  MAX_BALANCE_MILLI,
  MAX_MOVEMENT_MILLI,
  STOCK_MOVEMENT_KINDS,
  STOCK_PURPOSES,
  STOCK_UNITS,
  quantidadeValidaNaUnidade,
  type StockUnit,
} from './stock-quantity.js';

export const MAX_COUNT_ITEMS = 200;

const nome = (max: number) => z.string().trim().min(1).max(max);
const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v.replace(/\s+/g, ' ')))
    .nullable()
    .optional()
    .transform((v) => v ?? null);
const motivo = z.string().trim().min(3).max(300);
const unidade = z.enum(STOCK_UNITS);
const quantidadeDeMovimento = z.number().int().positive().max(MAX_MOVEMENT_MILLI);
const quantidadeDeSaldo = z.number().int().min(0).max(MAX_BALANCE_MILLI);
const expectedUpdatedAt = z.iso.datetime({ offset: true });
/** Preço sugerido de venda em centavos inteiros (docs/plans/vendas-v1.md).
 * `null` = sem preço sugerido, nunca zero nem gratuito. */
const precoSugerido = z.number().int().positive().max(MAX_UNIT_PRICE_CENTS);

export const stockIdSchema = idSchema;

function casasDaUnidade<T extends { unit: StockUnit }>(campos: (keyof T)[]) {
  return (valor: T, ctx: z.RefinementCtx) => {
    for (const campo of campos) {
      const q = valor[campo];
      if (typeof q === 'number' && !quantidadeValidaNaUnidade(q, valor.unit)) {
        ctx.addIssue({ code: 'custom', path: [campo as string], message: 'Quantidade com casas que a unidade não aceita.' });
      }
    }
  };
}

export const categoryNameSchema = z.object({ name: nome(60) }).strict();
export type CategoryNameDto = z.infer<typeof categoryNameSchema>;

export const categoryListQuerySchema = z
  .object({ status: z.enum(['ACTIVE', 'ARCHIVED', 'ALL']).optional().default('ALL') })
  .strict();
export type CategoryListQueryDto = z.infer<typeof categoryListQuerySchema>;

const camposDoProduto = {
  name: nome(80),
  description: textoOpcional(500),
  internalCode: textoOpcional(40),
  categoryId: idSchema,
  subcategoryId: idSchema.nullable().optional().transform((v) => v ?? null),
  purpose: z.enum(STOCK_PURPOSES),
  unit: unidade,
  minQuantityMilli: quantidadeDeSaldo,
};

export const createProductSchema = z
  .object({
    requestKey: requestKeySchema,
    ...camposDoProduto,
    initialQuantityMilli: quantidadeDeMovimento.nullable().optional().transform((v) => v ?? null),
    salePriceCents: precoSugerido.nullable().optional().transform((v) => v ?? null),
  })
  .strict()
  .superRefine(casasDaUnidade(['minQuantityMilli', 'initialQuantityMilli']));
/** O preço sugerido é opcional também para quem chama o serviço direto
 * (testes e rotinas anteriores ao campo): ausente = sem preço sugerido. */
export type CreateProductDto = Omit<z.infer<typeof createProductSchema>, 'salePriceCents'> & { salePriceCents?: number | null };

export const updateProductSchema = z
  // `salePriceCents` omitido mantém o preço gravado (a tela anterior não
  // conhece o campo e não pode apagá-lo); `null` tira o preço sugerido.
  .object({ ...camposDoProduto, expectedUpdatedAt, salePriceCents: precoSugerido.nullable().optional() })
  .strict()
  .superRefine(casasDaUnidade(['minQuantityMilli']));
export type UpdateProductDto = z.infer<typeof updateProductSchema>;

const booleanoDaQuery = z.enum(['true', 'false']).transform((v) => v === 'true');

export const productListQuerySchema = z
  .object({
    q: z.string().trim().max(80).optional(),
    categoryId: idSchema.optional(),
    subcategoryId: idSchema.optional(),
    status: z.enum(['ACTIVE', 'ARCHIVED', 'ALL']).optional().default('ACTIVE'),
    low: booleanoDaQuery.optional(),
    cursor: z.string().max(200).optional(),
  })
  .strict();
export type ProductListQueryDto = z.infer<typeof productListQuerySchema>;

export const createMovementSchema = z
  .object({
    requestKey: requestKeySchema,
    productId: idSchema,
    kind: z.enum(MANUAL_MOVEMENT_KINDS),
    quantityMilli: quantidadeDeMovimento,
    expectedUnit: unidade,
    reason: textoOpcional(300),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (!quantidadeValidaNaUnidade(v.quantityMilli, v.expectedUnit)) {
      ctx.addIssue({ code: 'custom', path: ['quantityMilli'], message: 'Quantidade com casas que a unidade não aceita.' });
    }
    if (v.kind === 'SAIDA_PERDA' && (v.reason === null || v.reason.length < 3)) {
      ctx.addIssue({ code: 'custom', path: ['reason'], message: 'Informe o motivo da perda.' });
    }
  });
export type CreateMovementDto = z.infer<typeof createMovementSchema>;

export const reverseMovementSchema = z.object({ requestKey: requestKeySchema, reason: motivo }).strict();
export type ReverseMovementDto = z.infer<typeof reverseMovementSchema>;

const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const movementListQuerySchema = z
  .object({
    productId: idSchema.optional(),
    kind: z.enum(STOCK_MOVEMENT_KINDS).optional(),
    from: data.optional(),
    to: data.optional(),
    cursor: z.string().max(200).optional(),
  })
  .strict();
export type MovementListQueryDto = z.infer<typeof movementListQuerySchema>;

export const createCountSchema = z
  .object({
    requestKey: requestKeySchema,
    note: textoOpcional(300),
    items: z
      .array(
        z
          .object({
            productId: idSchema,
            expectedBalanceVersion: z.number().int().min(0),
            expectedUnit: unidade,
            countedMilli: quantidadeDeSaldo,
          })
          .strict()
          .superRefine((i, ctx) => {
            if (!quantidadeValidaNaUnidade(i.countedMilli, i.expectedUnit)) {
              ctx.addIssue({ code: 'custom', path: ['countedMilli'], message: 'Quantidade com casas que a unidade não aceita.' });
            }
          }),
      )
      .min(1)
      .max(MAX_COUNT_ITEMS),
  })
  .strict()
  .superRefine((v, ctx) => {
    const ids = v.items.map((i) => i.productId);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: 'custom', path: ['items'], message: 'Produto repetido na conferência.' });
    }
  });
export type CreateCountDto = z.infer<typeof createCountSchema>;

export const countListQuerySchema = z.object({ cursor: z.string().max(200).optional() }).strict();
export type CountListQueryDto = z.infer<typeof countListQuerySchema>;
