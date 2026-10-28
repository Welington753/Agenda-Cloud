// Entradas de "Equipe e acessos" e da agenda do funcionário. `.strict()` em
// tudo: papel, estabelecimento, permissão fora da lista ou qualquer campo a
// mais é recusado em vez de ignorado.
import { z } from 'zod';
import { emailSchema, passwordSchema, usernameSchema } from '../auth/login.dto.js';
import { idSchema, requestKeySchema } from '../accounts/accounts.dto.js';
import { appointmentStatusActionSchema, rescheduleOptionsSchema } from '../appointments/appointment.dto.js';
import { STAFF_PERMISSIONS } from './staff-access.js';
import { MANAGER_PERMISSIONS } from '../common/manager-permissions.js';

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

/** Tudo o que a tela de equipe concede: as três ações sobre os próprios
 * atendimentos e as áreas do gerente. Quem pode receber o quê (papel,
 * profissional ligado, o que o dono tem) é conferido no serviço. */
export const TEAM_PERMISSIONS = [...STAFF_PERMISSIONS, ...MANAGER_PERMISSIONS] as const;
export type TeamPermission = (typeof TEAM_PERMISSIONS)[number];

const staffPermissionsSchema = z
  .array(z.enum(TEAM_PERMISSIONS))
  .max(TEAM_PERMISSIONS.length)
  .refine((lista) => new Set(lista).size === lista.length);

export const staffPermissionsChangeSchema = z
  .object({
    /** As liberações que a tela mostrava: se outra tela mudou, 409. */
    expectedGranted: staffPermissionsSchema,
    granted: staffPermissionsSchema,
  })
  .strict();
export type StaffPermissionsChangeDto = z.infer<typeof staffPermissionsChangeSchema>;

/** Acesso de equipe com login interno, sem e-mail. `password` é a senha
 * escolhida pelo dono, com a mesma política das outras senhas, e definitiva:
 * a pessoa entra com ela, sem troca obrigatória. Sem `password` (o corpo da
 * tela anterior), o servidor gera uma senha temporária, devolvida só nesta
 * resposta, com troca no primeiro acesso.
 *
 * `role` ausente é `PROFISSIONAL` (o corpo da tela anterior). Profissional
 * sempre tem profissional ligado; gerente pode não ter. */
export const staffAccountSchema = z
  .object({
    requestKey: requestKeySchema,
    role: z.enum(['PROFISSIONAL', 'GERENTE']).default('PROFISSIONAL'),
    professionalId: idSchema.nullable().optional(),
    name: nameSchema,
    username: usernameSchema,
    permissions: staffPermissionsSchema,
    password: passwordSchema.optional(),
  })
  .strict()
  .refine((v) => v.role === 'GERENTE' || !!v.professionalId, {
    path: ['professionalId'],
    message: 'Escolha o profissional deste acesso.',
  });
export type StaffAccountDto = z.infer<typeof staffAccountSchema>;

/** Nova senha definida pelo dono para um acesso interno: definitiva. */
export const staffPasswordSchema = z.object({ password: passwordSchema }).strict();
export type StaffPasswordDto = z.infer<typeof staffPasswordSchema>;

/** Mesmo formato (e mesma validação de data) da agenda do dono. */
export const myAgendaQuerySchema = rescheduleOptionsSchema;
export type MyAgendaQuery = z.infer<typeof myAgendaQuerySchema>;

/** Mesmo controle otimista das ações de andamento do dono. */
export const ownStatusActionSchema = appointmentStatusActionSchema;
export type OwnStatusActionDto = z.infer<typeof ownStatusActionSchema>;
