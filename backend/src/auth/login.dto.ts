// DTO Zod de POST /auth/login — mesma disciplina de register.dto.ts:
// `.strict()` rejeita propriedade desconhecida; erro de validação nunca ecoa
// o valor recebido. Limites de senha (10-128) são os mesmos de
// registerSchema — política global de toda a base, nunca por conta
// específica, então rejeitar fora dessa faixa aqui não é um oráculo de
// e-mail existente (todo mundo passa pela mesma regra).
//
// "E-mail ou login": o corpo novo traz `login`. Desde a migration
// TeamManagerAccess, o login interno criado pelo dono pode ter a aparência de
// um e-mail (`maria@salao`), então a presença de `@` não decide mais nada: o
// identificador normalizado é procurado nos dois campos, e o banco garante
// que o mesmo texto nunca é o e-mail de uma conta e o login de outra
// (`uq_users_login_identifier`). O corpo antigo (`email`) continua aceito,
// então a tela anterior segue entrando enquanto as duas versões convivem.
import { z } from 'zod';
import {
  LOGIN_USERNAME_MAX,
  LOGIN_USERNAME_MIN,
  LOGIN_USERNAME_PATTERN,
} from '../migrations/1793145600000-TeamManagerAccess.js';

/** Mesma normalização do login (aparar e minúsculas) e o banco compara com
 * `citext`: a administração nunca cria uma segunda conta para o mesmo
 * endereço escrito com outra caixa. */
export const emailSchema = z.string().trim().toLowerCase().email().max(254);

const USERNAME_REGEX = new RegExp(LOGIN_USERNAME_PATTERN);

/** Login interno: minúsculo, 3 a 80 caracteres, letras sem acento, números,
 * ponto, hífen, sublinhado e `+`, começando por letra ou número; pode ter uma
 * `@` seguida de um domínio (`maria@salao`). Não precisa ser um e-mail real
 * e nunca é tratado como um: não vai para `users.email`, não é verificado e
 * não recebe mensagem. Único na plataforma inteira, também contra os e-mails. */
export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(LOGIN_USERNAME_MIN, 'Use de 3 a 80 caracteres.')
  .max(LOGIN_USERNAME_MAX, 'Use de 3 a 80 caracteres.')
  .regex(
    USERNAME_REGEX,
    'Use letras sem acento, números, ponto, hífen, sublinhado ou +, começando por letra ou número. Uma @ é aceita se vier seguida de um domínio, como maria@salao.',
  );

export const passwordSchema = z.string().min(10).max(128);

const LOGIN_INVALIDO = 'Informe um e-mail ou um login válido.';

export const loginSchema = z
  .union([
    // Corpo antigo: o web anterior manda `email` sempre que o texto tem `@`,
    // inclusive um login interno como `maria@salao` (sem domínio de e-mail
    // real). O texto é conferido abaixo como e-mail OU login, igual a `login`.
    z
      .object({ email: z.string().trim().min(1).max(254).refine((v) => v.includes('@')), password: passwordSchema })
      .strict(),
    z.object({ login: z.string().trim().min(1).max(254), password: passwordSchema }).strict(),
  ])
  .transform((valor, ctx): { identifier: string; password: string } => {
    const texto = 'email' in valor ? valor.email : valor.login;
    const comoEmail = emailSchema.safeParse(texto);
    const comoUsuario = usernameSchema.safeParse(texto);
    if (comoEmail.success || comoUsuario.success) {
      // As duas normalizações são a mesma (aparar e minúsculas).
      return { identifier: comoEmail.success ? comoEmail.data : comoUsuario.data!, password: valor.password };
    }
    ctx.addIssue({ code: 'custom', path: ['login'], message: LOGIN_INVALIDO });
    return z.NEVER;
  });

export type LoginDto = z.output<typeof loginSchema>;

export const changePasswordSchema = z
  .object({ currentPassword: passwordSchema, newPassword: passwordSchema })
  .strict()
  .refine((v) => v.currentPassword !== v.newPassword, {
    path: ['newPassword'],
    message: 'A senha nova precisa ser diferente da atual.',
  });

export type ChangePasswordDto = z.infer<typeof changePasswordSchema>;
