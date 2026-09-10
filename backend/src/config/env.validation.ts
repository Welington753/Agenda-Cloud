// Validação obrigatória de variáveis de ambiente na inicialização — a aplicação
// nunca sobe com env incompleta/inválida (ver docs/plans/migracao-nestjs-typeorm-neon.md,
// Lote 2). A mensagem de erro nunca inclui o valor recebido (nem de campos não
// sensíveis) — só o nome dos campos com problema — para nunca vazar credencial
// em log de inicialização.

import { z } from 'zod';

const POSTGRES_URL_PATTERN = /^postgres(ql)?:\/\/.+/;

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  // 3001, não 3000 — o frontend Next.js já ocupa 3000 em desenvolvimento.
  PORT: z.coerce.number().int().positive().default(3001),
  // Pooled — consumida pela aplicação em runtime (ver runtime-data-source.ts).
  DATABASE_URL: z
    .string()
    .min(1)
    .refine((value) => POSTGRES_URL_PATTERN.test(value)),
  // Direta (sem pooler) — reservada para o TypeORM CLI de migrations (Lote 4+),
  // nunca usada pela aplicação em runtime.
  DIRECT_URL: z
    .string()
    .min(1)
    .refine((value) => POSTGRES_URL_PATTERN.test(value)),
  // Origem exata liberada no CORS (Lote 6B.2) — nunca wildcard, porque o
  // backend usa `credentials: true` (cookie de sessão) e o CORS nunca pode
  // combinar as duas coisas com `*`.
  FRONTEND_URL: z.string().url(),
});

export type EnvConfig = z.infer<typeof envSchema>;

/** Usado como `validate` do `ConfigModule.forRoot` (ver config.module.ts) — o
 * Nest chama isto uma vez na inicialização com `process.env` inteiro; qualquer
 * falha aqui impede a aplicação de subir. Nunca reconstruir a mensagem de erro
 * a partir de `issue.message`/`issue.received` do Zod — só o caminho do campo,
 * para a mensagem nunca ecoar um valor (mesmo um NODE_ENV inválido, que não é
 * segredo, mas mantém a regra simples e sempre segura). */
export function validateEnv(config: Record<string, unknown>): EnvConfig {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    const camposComProblema = [
      ...new Set(result.error.issues.map((issue) => issue.path.join('.'))),
    ];
    throw new Error(
      `Configuração de ambiente inválida ou incompleta. Campos com problema: ${camposComProblema.join(', ')}.`,
    );
  }
  return result.data;
}
