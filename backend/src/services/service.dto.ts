// DTOs Zod de serviços (Lote 6D.1) — mesma disciplina de register.dto.ts:
// `.strict()` para rejeitar propriedade desconhecida, e o pipe
// (common/zod-validation.pipe.ts) nunca ecoa o valor recebido na mensagem de
// erro.
//
// `.strict()` é também a proteção contra escalonamento por payload: `id`,
// `tenantId`, `active` e `createdAt` NÃO existem em nenhum destes schemas, então
// mandá-los no corpo é 400 — nunca são lidos, nunca são aplicados. O tenant vem
// exclusivamente da autorização feita no servidor, e `active` só muda pelo
// endpoint próprio de desativação.
//
// LIMITES: cada faixa numérica abaixo é o limite da COLUNA real (`INTEGER` do
// Postgres = int4), nunca uma regra de negócio inventada. `name` e
// `shortDescription` são `VARCHAR` sem comprimento no schema, então nenhum
// máximo é inventado aqui — o tamanho do corpo já é limitado pelo parser JSON
// do Express (100 kB por padrão). Também não existe regra de unicidade de
// nome no banco (só `uq_services_tenant_id (tenant_id, id)`, que é alvo de FK
// composta), então nenhuma é imposta aqui.
import { z } from 'zod';
import { ServiceModality } from '../entities/enums/service-modality.enum.js';

/** Limite de `INTEGER` do Postgres (int4) — o da coluna, não um de negócio. */
const PG_INT4_MAX = 2_147_483_647;

const nameSchema = z.string().trim().min(1);
// `short_description` é NOT NULL sem CHECK — string vazia é um valor válido no
// banco, então nunca é obrigatório preencher (mesma decisão de
// `DEFAULT_UNIT_ADDRESS = ''` no cadastro). Default `''` para o INSERT nunca
// mandar `undefined` numa coluna NOT NULL.
const shortDescriptionSchema = z.string().trim();

/** Dinheiro sempre em CENTAVOS inteiros, a unidade da coluna `price_cents` —
 * nunca `float`/`number` decimal em lugar nenhum do caminho. `null` é o valor
 * de domínio "sem preço definido" (sob consulta), diferente de ausente. */
const priceCentsSchema = z.number().int().min(0).max(PG_INT4_MAX).nullable();

const durationMinutesSchema = z.number().int().min(1).max(PG_INT4_MAX);
const bufferAfterMinutesSchema = z.number().int().min(0).max(PG_INT4_MAX);

export const createServiceSchema = z
  .object({
    name: nameSchema,
    shortDescription: shortDescriptionSchema.default(''),
    priceCents: priceCentsSchema.default(null),
    priceVisible: z.boolean().default(true),
    durationMinutes: durationMinutesSchema,
    bufferAfterMinutes: bufferAfterMinutesSchema.default(0),
    modality: z.enum(ServiceModality).default(ServiceModality.IN_PERSON),
    activeInPublicBooking: z.boolean().default(true),
    requiresManualConfirmation: z.boolean().default(false),
  })
  .strict();

export type CreateServiceDto = z.infer<typeof createServiceSchema>;

/** Edição parcial: cada campo é opcional, mas `.strict()` continua valendo e
 * um corpo vazio é recusado (nunca um UPDATE sem nada a mudar). */
export const updateServiceSchema = z
  .object({
    name: nameSchema.optional(),
    shortDescription: shortDescriptionSchema.optional(),
    priceCents: priceCentsSchema.optional(),
    priceVisible: z.boolean().optional(),
    durationMinutes: durationMinutesSchema.optional(),
    bufferAfterMinutes: bufferAfterMinutesSchema.optional(),
    modality: z.enum(ServiceModality).optional(),
    activeInPublicBooking: z.boolean().optional(),
    requiresManualConfirmation: z.boolean().optional(),
  })
  .strict()
  .refine((valor) => Object.keys(valor).length > 0, {
    message: 'Informe ao menos um campo para atualizar.',
    path: ['body'],
  });

export type UpdateServiceDto = z.infer<typeof updateServiceSchema>;
