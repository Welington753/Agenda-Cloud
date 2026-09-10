// DTO Zod de POST /auth/login — mesma disciplina de register.dto.ts:
// `.strict()` rejeita propriedade desconhecida; erro de validação nunca ecoa
// o valor recebido. Limites de senha (10-128) são os mesmos de
// registerSchema — política global de toda a base, nunca por conta
// específica, então rejeitar fora dessa faixa aqui não é um oráculo de
// e-mail existente (todo mundo passa pela mesma regra).
import { z } from 'zod';

export const loginSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    password: z.string().min(10).max(128),
  })
  .strict();

export type LoginDto = z.infer<typeof loginSchema>;
