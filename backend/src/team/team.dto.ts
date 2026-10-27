// Entradas de "Equipe e acessos" e da agenda do funcionário. `.strict()` em
// tudo: papel, estabelecimento, permissão fora da lista ou qualquer campo a
// mais é recusado em vez de ignorado.
import { z } from 'zod';
import { emailSchema, usernameSchema } from '../auth/login.dto.js';
import { idSchema, requestKeySchema } from '../accounts/accounts.dto.js';
import { appointmentStatusActionSchema, rescheduleOptionsSchema } from '../appointments/appointment.dto.js';
import { STAFF_PERMISSIONS } from './staff-access.js';

const nameSchema = z.string().trim().min(2).max(120);

export const staffInviteSchema = z
  .object({
    requestKey: requestKeySchema,
    professionalId: idSchema,
    name: nameSchema,
    email: emailSchema,
  })
  .strict();
export type StaffInviteDto = z.infer<typeof staffInviteSchema>;

const staffPermissionsSchema = z
  .array(z.enum(STAFF_PERMISSIONS))
  .max(STAFF_PERMISSIONS.length)
  .refine((lista) => new Set(lista).size === lista.length);

export const staffPermissionsChangeSchema = z
  .object({
    /** As liberações que a tela mostrava: se outra tela mudou, 409. */
    expectedGranted: staffPermissionsSchema,
    granted: staffPermissionsSchema,
  })
  .strict();
export type StaffPermissionsChangeDto = z.infer<typeof staffPermissionsChangeSchema>;

/** Acesso de funcionário com nome de usuário e senha temporária, sem e-mail.
 * A senha é gerada pelo servidor e devolvida só nesta resposta: o navegador
 * nunca a escolhe nem a envia. */
export const staffAccountSchema = z
  .object({
    requestKey: requestKeySchema,
    professionalId: idSchema,
    name: nameSchema,
    username: usernameSchema,
    permissions: staffPermissionsSchema,
  })
  .strict();
export type StaffAccountDto = z.infer<typeof staffAccountSchema>;

/** Mesmo formato (e mesma validação de data) da agenda do dono. */
export const myAgendaQuerySchema = rescheduleOptionsSchema;
export type MyAgendaQuery = z.infer<typeof myAgendaQuerySchema>;

/** Mesmo controle otimista das ações de andamento do dono. */
export const ownStatusActionSchema = appointmentStatusActionSchema;
export type OwnStatusActionDto = z.infer<typeof ownStatusActionSchema>;
