// Corpos das rotas do segundo fator: estritos, sem campo extra. O código vai
// como texto (quem cola pode trazer espaço ou hífen); a forma exata é
// conferida no serviço, que conta a tentativa.
import { z } from 'zod';
import { requestKeySchema } from '../accounts/accounts.dto.js';

const codigo = z.string().min(1).max(64);

export const codeSchema = z.object({ code: codigo }).strict();
export type CodeDto = z.infer<typeof codeSchema>;

/** Cadastro: sem código quando a sessão pode cadastrar (convite, liberação ou
 * fase opcional sem fator); com o código atual (ou de recuperação) para
 * trocar o autenticador. */
export const enrollmentStartSchema = z.object({ code: codigo.optional() }).strict();
export type EnrollmentStartDto = z.infer<typeof enrollmentStartSchema>;

export const grantRedeemSchema = z.object({ token: z.string().min(1).max(128) }).strict();
export type GrantRedeemDto = z.infer<typeof grantRedeemSchema>;

export const grantIssueSchema = z
  .object({ reason: z.string().trim().min(3).max(300), requestKey: requestKeySchema })
  .strict();
export type GrantIssueDto = z.infer<typeof grantIssueSchema>;
