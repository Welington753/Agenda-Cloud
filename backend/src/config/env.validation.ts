// Validação obrigatória de variáveis de ambiente na inicialização — a aplicação
// nunca sobe com env incompleta/inválida (ver docs/plans/migracao-nestjs-typeorm-neon.md,
// Lote 2). A mensagem de erro nunca inclui o valor recebido (nem de campos não
// sensíveis) — só o nome dos campos com problema — para nunca vazar credencial
// em log de inicialização.

import { z } from 'zod';

import { CLIENT_IP_SOURCES, DEFAULT_CLIENT_IP_SOURCE, MIN_PROXY_SECRET_LENGTH } from './client-ip.js';

const POSTGRES_URL_PATTERN = /^postgres(ql)?:\/\/.+/;

// Parâmetros da URL que o driver `pg` aplica POR CIMA do `ssl: {
// rejectUnauthorized: true }` do código (pg-connection-string mescla a URL
// sobre as opções): `sslmode=disable` desliga o TLS, `no-verify` desliga a
// verificação do certificado, e `uselibpqcompat` muda `require` para "TLS
// sem verificar". Qualquer um deles na URL anula a validação de certificado
// sem nenhuma mudança de código, então a aplicação recusa subir.
const SSLMODES_SEM_VERIFICACAO = new Set(['disable', 'allow', 'no-verify']);

/** `true` quando a URL não desliga nem afrouxa a verificação TLS. URL
 * impossível de interpretar conta como insegura. */
export function keepsTlsVerification(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const params = url.searchParams;
  const sslmode = params.get('sslmode');
  if (sslmode !== null && SSLMODES_SEM_VERIFICACAO.has(sslmode.toLowerCase())) return false;
  if (params.has('uselibpqcompat')) return false;
  const ssl = params.get('ssl');
  if (ssl !== null && ['0', 'false'].includes(ssl.toLowerCase())) return false;
  return true;
}

const postgresUrl = z
  .string()
  .min(1)
  .refine((value) => POSTGRES_URL_PATTERN.test(value))
  .refine(keepsTlsVerification);

/** Origem exata (`https://host[:porta]`), sem caminho, query, fragmento nem
 * barra final: é comparada caractere a caractere com o cabeçalho `Origin` no
 * CORS, então `https://app.exemplo.com/` nunca casaria. */
function isHttpsOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.origin === value;
  } catch {
    return false;
  }
}

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  // 3001, não 3000 — o frontend Next.js já ocupa 3000 em desenvolvimento.
  PORT: z.coerce.number().int().positive().default(3001),
  // Endereço de escuta. Ausente: `app.listen(PORT)` como antes (todas as
  // interfaces). A hospedagem (Render) exige `0.0.0.0` explícito, definido
  // em render.yaml. Só endereço IP literal, nunca nome de host.
  HOST: z.union([z.ipv4(), z.ipv6()]).optional(),
  // Pooled — consumida pela aplicação em runtime (ver runtime-data-source.ts).
  DATABASE_URL: postgresUrl,
  // Direta (sem pooler) — reservada para o TypeORM CLI de migrations (Lote 4+),
  // nunca usada pela aplicação em runtime.
  DIRECT_URL: postgresUrl,
  // Origem exata liberada no CORS (Lote 6B.2) — nunca wildcard, porque o
  // backend usa `credentials: true` (cookie de sessão) e o CORS nunca pode
  // combinar as duas coisas com `*`. Em production, só origem HTTPS exata
  // (checado abaixo).
  FRONTEND_URL: z.string().url(),
  // De onde vem o IP do cliente no rate limit (ver config/client-ip.ts).
  CLIENT_IP_SOURCE: z.enum(CLIENT_IP_SOURCES).default(DEFAULT_CLIENT_IP_SOURCE),
  // Segredo compartilhado com o proxy do frontend (ver config/client-ip.ts).
  // Opcional: ausente, `X-Agenda-Client-IP` nunca é lido. Presente, precisa
  // ter o tamanho mínimo; um valor curto derruba a inicialização em vez de
  // ser ignorado em silêncio.
  API_PROXY_SECRET: z.string().min(MIN_PROXY_SECRET_LENGTH).optional(),
}).superRefine((env, ctx) => {
  if (env.NODE_ENV === 'production' && !isHttpsOrigin(env.FRONTEND_URL)) {
    ctx.addIssue({ code: 'custom', path: ['FRONTEND_URL'], message: 'origem HTTPS exata' });
  }
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
