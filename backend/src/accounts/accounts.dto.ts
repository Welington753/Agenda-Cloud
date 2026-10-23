// Entradas da gestão de contas. `.strict()` em tudo: propriedade
// desconhecida é recusada (ninguém consegue mandar `platformRole` num campo
// que não o aceita). E-mail com a mesma normalização do login.
import { z } from 'zod';
import { emailSchema } from '../auth/login.dto.js';
import { normalizePhone } from '../auth/phone-normalizer.js';
import { BusinessCategory } from '../entities/enums/business-category.enum.js';
import { PlatformRole } from '../entities/enums/platform-role.enum.js';
import { UserStatus } from '../entities/enums/user-status.enum.js';
import { EFFECTIVE_PLATFORM_PERMISSIONS } from '../platform/platform-access.js';
import { EFFECTIVE_TENANT_PERMISSIONS } from './tenant-effective-access.js';
import { isValidAccountTokenFormat } from './account-token.js';

export const idSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,30}$/);

/** Chave de idempotência gerada pela tela a cada formulário aberto. */
export const requestKeySchema = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);

/** `updated_at` que a tela leu: se outra tela mudou a conta depois, 409. */
const expectedUpdatedAtSchema = z.iso.datetime({ offset: true });

const nameSchema = z.string().trim().min(2).max(120);
const phoneSchema = z
  .string()
  .trim()
  .transform((value, ctx) => {
    try {
      return normalizePhone(value);
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Telefone inválido.' });
      return z.NEVER;
    }
  });

function fusoValido(valor: string): boolean {
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone: valor });
    return /^[A-Za-z_]+\/[A-Za-z_]+(\/[A-Za-z_]+)?$/.test(valor);
  } catch {
    return false;
  }
}

const passwordSchema = z.string().min(10).max(128);
const tokenSchema = z.string().refine(isValidAccountTokenFormat);

const page = z.string().regex(/^[1-9]\d{0,5}$/).transform(Number).default(1);
const pageSize = z
  .string()
  .regex(/^\d{1,3}$/)
  .transform(Number)
  .pipe(z.number().int().min(1).max(100))
  .default(20);
const q = z.string().trim().min(2).max(120).optional();

export const createEstablishmentSchema = z
  .object({
    requestKey: requestKeySchema,
    businessName: nameSchema,
    category: z.enum(BusinessCategory),
    timezone: z.string().refine(fusoValido).default('America/Sao_Paulo'),
    planId: idSchema,
    owner: z
      .object({ name: nameSchema, email: emailSchema, phone: phoneSchema.optional() })
      .strict(),
  })
  .strict();
export type CreateEstablishmentDto = z.infer<typeof createEstablishmentSchema>;

/** Só DONO: é o único papel que alguma rota de estabelecimento libera. */
export const inviteMemberSchema = z
  .object({
    requestKey: requestKeySchema,
    name: nameSchema,
    email: emailSchema,
    role: z.literal('DONO'),
  })
  .strict();
export type InviteMemberDto = z.infer<typeof inviteMemberSchema>;

const platformPermissionsSchema = z
  .array(z.enum(EFFECTIVE_PLATFORM_PERMISSIONS as [string, ...string[]]))
  .max(EFFECTIVE_PLATFORM_PERMISSIONS.length)
  .refine((lista) => new Set(lista).size === lista.length);

export const platformInviteSchema = z
  .object({
    requestKey: requestKeySchema,
    name: nameSchema,
    email: emailSchema,
    platformRole: z.enum(PlatformRole),
    permissions: platformPermissionsSchema,
  })
  .strict();
export type PlatformInviteDto = z.infer<typeof platformInviteSchema>;

export const usersQuerySchema = z
  .object({
    q,
    status: z.enum(UserStatus).optional(),
    tenantId: idSchema.optional(),
    platformRole: z.enum([...Object.values(PlatformRole), 'NONE'] as unknown as [string, ...string[]]).optional(),
    page,
    pageSize,
  })
  .strict();
export type UsersQuery = z.infer<typeof usersQuerySchema>;

export const INVITE_VIEW_STATUSES = ['PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED'] as const;
export const invitesQuerySchema = z
  .object({
    q,
    status: z.enum(INVITE_VIEW_STATUSES).optional(),
    tenantId: idSchema.optional(),
    page,
    pageSize,
  })
  .strict();
export type InvitesQuery = z.infer<typeof invitesQuerySchema>;

export const auditQuerySchema = z
  .object({
    action: z.string().regex(/^[A-Z_]{3,40}$/).optional(),
    tenantId: idSchema.optional(),
    targetUserId: idSchema.optional(),
    page,
    pageSize,
  })
  .strict();
export type AuditQuery = z.infer<typeof auditQuerySchema>;

export const updateUserSchema = z
  .object({
    expectedUpdatedAt: expectedUpdatedAtSchema,
    name: nameSchema.optional(),
    phone: z.union([phoneSchema, z.null()]).optional(),
  })
  .strict()
  .refine((dto) => dto.name !== undefined || dto.phone !== undefined);
export type UpdateUserDto = z.infer<typeof updateUserSchema>;

export const statusChangeSchema = z.object({ expectedUpdatedAt: expectedUpdatedAtSchema }).strict();
export type StatusChangeDto = z.infer<typeof statusChangeSchema>;

export const platformAccessSchema = z
  .object({
    expectedUpdatedAt: expectedUpdatedAtSchema,
    role: z.enum(PlatformRole).nullable(),
    permissions: platformPermissionsSchema,
  })
  .strict();
export type PlatformAccessDto = z.infer<typeof platformAccessSchema>;

const tenantPermissionsSchema = z
  .array(z.enum(EFFECTIVE_TENANT_PERMISSIONS as [string, ...string[]]))
  .max(EFFECTIVE_TENANT_PERMISSIONS.length)
  .refine((lista) => new Set(lista).size === lista.length);

export const deniedPermissionsSchema = z
  .object({
    /** As restrições que a tela mostrava: se outra tela mudou, 409. */
    expectedDenied: tenantPermissionsSchema,
    denied: tenantPermissionsSchema,
  })
  .strict();
export type DeniedPermissionsDto = z.infer<typeof deniedPermissionsSchema>;

export const requestOnlySchema = z.object({ requestKey: requestKeySchema }).strict();
export const reauthSchema = z.object({ password: passwordSchema }).strict();
export const tokenOnlySchema = z.object({ token: tokenSchema }).strict();
export const acceptInviteSchema = z.object({ token: tokenSchema, password: passwordSchema }).strict();
export const completeResetSchema = z.object({ token: tokenSchema, password: passwordSchema }).strict();
