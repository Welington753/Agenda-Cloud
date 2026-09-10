// DTO Zod de POST /auth/register — mesmo padrão de config/env.validation.ts
// (validação nunca ecoa o valor recebido na mensagem de erro; ver
// common/zod-validation.pipe.ts, que só usa `issue.path`). `.strict()` rejeita
// propriedade desconhecida, mesma disciplina do resto do projeto.
import { z } from 'zod';
import { normalizePhone } from './phone-normalizer.js';

export const registerSchema = z
  .object({
    ownerName: z.string().trim().min(2).max(120),
    businessName: z.string().trim().min(2).max(120),
    email: z.string().trim().toLowerCase().email().max(254),
    phone: z.string().trim().transform((value, ctx) => {
      try {
        return normalizePhone(value);
      } catch {
        ctx.addIssue({ code: 'custom', message: 'Telefone inválido.' });
        return z.NEVER;
      }
    }),
    // Sem regra de símbolo/maiúscula — só comprimento (ver decisão do Lote
    // 6B.3, evita senhas previsíveis por regra confusa sem melhorar entropia
    // real).
    password: z.string().min(10).max(128),
  })
  .strict();

export type RegisterDto = z.infer<typeof registerSchema>;
