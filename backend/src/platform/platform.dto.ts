import { z } from 'zod';
import { BusinessCategory } from '../entities/enums/business-category.enum.js';
import { TenantStatus } from '../entities/enums/tenant-status.enum.js';
import { requestKeySchema } from '../accounts/accounts.dto.js';
import { MAX_COURTESY_DAYS, MAX_TRIAL_EXTENSION_DAYS } from '../commercial/access-periods.js';
import { ACCESS_PAYMENT_METHODS } from '../migrations/1793232000000-CommercialAccess.js';
import { MAX_PRICE_CENTS } from '../migrations/1793318400000-PlatformPortal.js';
import {
  DEFAULT_ESTABLISHMENT_SCOPE,
  ESTABLISHMENT_FILTERS,
  ESTABLISHMENT_SCOPES,
  type EstablishmentScope,
} from './portal-overview.js';
import { checkDateRange, DATE_RANGE_MESSAGES } from './portal-reports.js';

/** Alcance: clientes (padrão), internos/teste ou todos (portal-overview.ts). */
const scopeSchema = z.enum(ESTABLISHMENT_SCOPES).default(DEFAULT_ESTABLISHMENT_SCOPE);

/** Data de calendário `YYYY-MM-DD`; a existência da data e o tamanho do
 * período são conferidos por `checkDateRange` (portal-reports.ts). */
const calendarDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Período opcional (as duas datas ou nenhuma). Não escolhe padrão: cada rota
 * decide o que a ausência significa. */
function refineDateRange(fromKey: string, toKey: string) {
  return (dto: Record<string, unknown>, ctx: z.RefinementCtx) => {
    const problema = checkDateRange(dto[fromKey] as string | undefined, dto[toKey] as string | undefined);
    if (problema) ctx.addIssue({ code: 'custom', path: [fromKey], message: DATE_RANGE_MESSAGES[problema] });
  };
}

export const establishmentIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,30}$/);

/** `ARCHIVED` é valor novo do enum do banco (migration TeamAccess), fora do
 * enum TypeScript que espelha a migration inicial. */
export const TENANT_STATUS_VALUES = [...Object.values(TenantStatus), 'ARCHIVED'] as const;

export const establishmentQuerySchema = z
  .object({
    q: z.string().trim().min(2).max(120).optional(),
    status: z.enum(TENANT_STATUS_VALUES as unknown as [string, ...string[]]).optional(),
    planId: establishmentIdSchema.optional(),
    /** Filtro de acesso ou de condição contratada (portal-overview.ts). */
    filter: z.enum(ESTABLISHMENT_FILTERS).optional(),
    scope: scopeSchema,
    /** Data de cadastro (`tenants.created_at`) no fuso da plataforma, as duas
     * inclusas. Ausentes: sem restrição por cadastro. */
    createdFrom: calendarDateSchema.optional(),
    createdTo: calendarDateSchema.optional(),
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
  .strict()
  .superRefine(refineDateRange('createdFrom', 'createdTo'));
/** `scope` ausente (chamada direta ao serviço) vale o padrão, como na rota. */
export type EstablishmentQuery = Omit<z.infer<typeof establishmentQuerySchema>, 'scope'> & {
  scope?: EstablishmentScope;
};

/** Visão geral: só o alcance dos indicadores. */
export const overviewQuerySchema = z.object({ scope: scopeSchema }).strict();
export type OverviewQuery = z.infer<typeof overviewQuerySchema>;

/** Relatório por período: datas ausentes valem o mês atual em São Paulo,
 * decidido no serviço (que devolve o período aplicado). */
export const reportQuerySchema = z
  .object({ from: calendarDateSchema.optional(), to: calendarDateSchema.optional(), scope: scopeSchema })
  .strict()
  .superRefine(refineDateRange('from', 'to'));
export type ReportQuery = z.infer<typeof reportQuerySchema>;

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

/** Marca de estabelecimento de teste: fora da busca, página pública ligada. */
export const setTestFlagSchema = z
  .object({ expectedUpdatedAt: expectedUpdatedAtSchema, isTest: z.boolean() })
  .strict();
export type SetTestFlagDto = z.infer<typeof setTestFlagSchema>;

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

// ------------------------------------------------- validade do acesso
// Assinatura do TimVix, registrada à mão pela administração. Nada
// aqui é recebimento de atendimento (`payments/`).

/** Chave do formulário: repetir a mesma requisição nunca grava duas vezes. */
const accessRequestKeySchema = requestKeySchema;

export const recordPaidPeriodSchema = z
  .object({
    expectedUpdatedAt: expectedUpdatedAtSchema,
    requestKey: accessRequestKeySchema,
    cycle: z.enum(['MONTHLY', 'QUARTERLY']),
    /** Valor contratado do período, em centavos. */
    amountCents: z.number().int().min(1).max(100_000_000),
    paymentMethod: z.enum(ACCESS_PAYMENT_METHODS),
    /** Data em que o pagamento foi recebido (data local, `YYYY-MM-DD`). */
    receivedOn: z.iso.date(),
    reference: z.string().trim().min(1).max(120).optional(),
    notes: z.string().trim().min(3).max(300).optional(),
    /** A pessoa declara que conferiu o pagamento à mão: o registro nunca
     * afirma confirmação automática por banco ou operadora. */
    manualConfirmation: z.literal(true),
    /** `true`: o valor digitado passa a ser o contratado deste cliente para
     * as próximas renovações deste ciclo. Ausente ou `false`: ajusta só este
     * pagamento. A origem do valor é decidida no servidor. */
    updateContract: z.boolean().optional(),
  })
  .strict();
export type RecordPaidPeriodDto = z.infer<typeof recordPaidPeriodSchema>;

export const extendTrialSchema = z
  .object({
    expectedUpdatedAt: expectedUpdatedAtSchema,
    requestKey: accessRequestKeySchema,
    days: z.number().int().min(1).max(MAX_TRIAL_EXTENSION_DAYS),
    reason: reasonSchema,
  })
  .strict();
export type ExtendTrialDto = z.infer<typeof extendTrialSchema>;

export const grantCourtesySchema = z
  .object({
    expectedUpdatedAt: expectedUpdatedAtSchema,
    requestKey: accessRequestKeySchema,
    days: z.number().int().min(1).max(MAX_COURTESY_DAYS),
    reason: reasonSchema,
  })
  .strict();
export type GrantCourtesyDto = z.infer<typeof grantCourtesySchema>;

/** Anula um período registrado por engano. Não devolve nem movimenta
 * dinheiro: só corrige o registro. */
export const correctAccessPeriodSchema = z
  .object({
    expectedUpdatedAt: expectedUpdatedAtSchema,
    requestKey: accessRequestKeySchema,
    reason: reasonSchema,
  })
  .strict();
export type CorrectAccessPeriodDto = z.infer<typeof correctAccessPeriodSchema>;

// ------------------------------------------------------- preços e acesso
// Portal da plataforma (docs/plans/portal-da-plataforma.md).

export const billingCycleSchema = z.enum(['MONTHLY', 'QUARTERLY']);
const priceCentsSchema = z.number().int().min(1).max(MAX_PRICE_CENTS);

/** Novo preço do catálogo. `expectedCurrentCents` é o preço que a tela leu
 * (`null`: pendente): se outra tela mudou antes, 409. */
export const catalogPriceSchema = z
  .object({
    requestKey: accessRequestKeySchema,
    expectedCurrentCents: priceCentsSchema.nullable(),
    amountCents: priceCentsSchema,
    reason: reasonSchema.optional(),
  })
  .strict();
export type CatalogPriceDto = z.infer<typeof catalogPriceSchema>;

/** Valor contratado com o cliente para o plano atual dele. `null` volta a
 * seguir o catálogo. */
export const contractPriceSchema = z
  .object({
    expectedUpdatedAt: expectedUpdatedAtSchema,
    requestKey: accessRequestKeySchema,
    cycle: billingCycleSchema,
    amountCents: priceCentsSchema.nullable(),
    reason: reasonSchema,
  })
  .strict();
export type ContractPriceDto = z.infer<typeof contractPriceSchema>;

/** Situação do registro no extrato: não anulado ou anulado. */
export const SUBSCRIPTION_PAYMENT_STATUSES = ['RECEIVED', 'CANCELED'] as const;
export type SubscriptionPaymentStatus = (typeof SUBSCRIPTION_PAYMENT_STATUSES)[number];

/** Extrato. Tudo opcional, e a ausência mantém o comportamento anterior: todo
 * o histórico (sem datas), todos os estabelecimentos (`scope` ausente vale
 * `ALL` aqui, para não mudar quem já chamava a rota, inclusive com
 * `tenantId`) e as duas situações. */
export const subscriptionPaymentsQuerySchema = z
  .object({
    tenantId: establishmentIdSchema.optional(),
    /** Data de recebimento (`payment_received_on`), as duas inclusas. */
    from: calendarDateSchema.optional(),
    to: calendarDateSchema.optional(),
    scope: z.enum(ESTABLISHMENT_SCOPES).default('ALL'),
    status: z.enum(SUBSCRIPTION_PAYMENT_STATUSES).optional(),
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
      .default(30),
  })
  .strict()
  .superRefine(refineDateRange('from', 'to'));
export type SubscriptionPaymentsQuery = z.infer<typeof subscriptionPaymentsQuerySchema>;

/** Conceder "sem vencimento": motivo e confirmação explícita. */
export const grantNoExpirySchema = z
  .object({
    expectedUpdatedAt: expectedUpdatedAtSchema,
    requestKey: accessRequestKeySchema,
    reason: reasonSchema,
    confirm: z.literal(true),
  })
  .strict();
export type GrantNoExpiryDto = z.infer<typeof grantNoExpirySchema>;

/** Retirar "sem vencimento": motivo e confirmação de que a pessoa viu a
 * consequência calculada pelo servidor. */
export const revokeNoExpirySchema = grantNoExpirySchema;
export type RevokeNoExpiryDto = z.infer<typeof revokeNoExpirySchema>;
