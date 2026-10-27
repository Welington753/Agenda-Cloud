// DTO Zod de POST /auth/login — mesma disciplina de register.dto.ts:
// `.strict()` rejeita propriedade desconhecida; erro de validação nunca ecoa
// o valor recebido. Limites de senha (10-128) são os mesmos de
// registerSchema — política global de toda a base, nunca por conta
// específica, então rejeitar fora dessa faixa aqui não é um oráculo de
// e-mail existente (todo mundo passa pela mesma regra).
//
// "E-mail ou usuário": o corpo novo traz `login`; com `@` ele é um e-mail,
// sem `@` é um nome de usuário (que nunca tem `@`, ver USERNAME_PATTERN na
// migration StaffLogin). O corpo antigo (`email`) continua aceito, então a
// tela anterior segue entrando enquanto as duas versões convivem.
import { z } from 'zod';

/** Mesma normalização do login (aparar e minúsculas) e o banco compara com
 * `citext`: a administração nunca cria uma segunda conta para o mesmo
 * endereço escrito com outra caixa. */
export const emailSchema = z.string().trim().toLowerCase().email().max(254);

/** Nome de usuário de login: minúsculo, 3 a 40 caracteres, letras sem acento,
 * números, ponto, hífen e sublinhado, começando por letra ou número. Único
 * na plataforma inteira. */
export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9._-]{2,39}$/, 'Use de 3 a 40 letras sem acento, números, ponto, hífen ou sublinhado.');

export const passwordSchema = z.string().min(10).max(128);

const LOGIN_INVALIDO = 'Informe um e-mail ou um nome de usuário válido.';

export const loginSchema = z
  .union([
    z.object({ email: emailSchema, password: passwordSchema }).strict(),
    z.object({ login: z.string().trim().min(1).max(254), password: passwordSchema }).strict(),
  ])
  .transform((valor, ctx): { email?: string; username?: string; password: string } => {
    if ('email' in valor) return { email: valor.email, password: valor.password };
    if (valor.login.includes('@')) {
      const comoEmail = emailSchema.safeParse(valor.login);
      if (comoEmail.success) return { email: comoEmail.data, password: valor.password };
    } else {
      const comoUsuario = usernameSchema.safeParse(valor.login);
      if (comoUsuario.success) return { username: comoUsuario.data, password: valor.password };
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
