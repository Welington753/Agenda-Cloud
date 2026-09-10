// Sanitização usada em TODA a saída dos scripts de migration guardada
// (backend/scripts/) — nunca deixar host, connection string, Endpoint ID ou
// stack bruto de erro de conexão alcançar stdout/stderr (e, por
// consequência, o log do GitHub Actions). Duas camadas: erros do próprio
// guard já nascem com mensagem estática e segura (`GuardedMigrationError`);
// qualquer erro de terceiro (pg, child_process) passa por `redactSecrets`
// como última linha de defesa antes de qualquer `console.error`.

// Connection string completa: `postgresql://...` ou `postgres://...` até o
// primeiro espaço/aspas/fim de string.
const CONNECTION_STRING_PATTERN = /postgres(?:ql)?:\/\/[^\s"'`]+/gi;
// Endpoint ID do Neon isolado (fora de uma URL), formato `ep-<slug>-<dígitos>`
// — cobre tanto o caso com sufixo numérico quanto sem.
const ENDPOINT_ID_PATTERN = /\bep-[a-z0-9]+(?:-[a-z0-9]+)*\b/gi;
// Hostname Neon isolado (fora de uma URL), ex. em mensagens de erro de rede
// do driver `pg` (`connect ETIMEDOUT <host>:<porta>`).
const NEON_HOST_PATTERN = /\b[a-z0-9.-]+\.neon\.tech\b/gi;

export function redactSecrets(text: string): string {
  return text
    .replace(CONNECTION_STRING_PATTERN, '[connection-string-redacted]')
    .replace(NEON_HOST_PATTERN, '[host-redacted]')
    .replace(ENDPOINT_ID_PATTERN, '[endpoint-redacted]');
}

/** Códigos internos estáveis — nunca o texto de erro do driver/CLI. Ver
 * `docs/runbooks/migrations-production.md` para a lista completa e o
 * significado de cada um. */
export type SanitizedErrorCode =
  | 'ERR_INVALID_SCHEME'
  | 'ERR_ENDPOINT_UNRECOGNIZED'
  | 'ERR_POOLER_FORBIDDEN'
  | 'ERR_ENDPOINT_MISMATCH'
  | 'ERR_ENDPOINTS_NOT_DISTINCT'
  | 'ERR_BACKUP_AS_PRODUCTION'
  | 'ERR_VALIDATION_AS_PRODUCTION'
  | 'ERR_CONFIRMATION_MISMATCH'
  | 'ERR_WRONG_BRANCH'
  | 'ERR_MISSING_SECRET'
  | 'ERR_BASELINE_MISMATCH'
  | 'ERR_AMBIGUOUS_RESULT'
  | 'ERR_UNEXPECTED';

/** Erro de domínio dos scripts de migration guardada — mensagem SEMPRE uma
 * string estática escrita no código-fonte, nunca construída interpolando
 * dado do ambiente (URL, host, endpoint). Isso é o que garante que ela é
 * segura para aparecer no log do workflow sem sanitização adicional. */
export class GuardedMigrationError extends Error {
  constructor(
    public readonly code: SanitizedErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'GuardedMigrationError';
  }
}

export interface SanitizedFailure {
  code: SanitizedErrorCode;
  message: string;
}

/** Converte qualquer coisa lançada (`GuardedMigrationError`, `Error` de
 * terceiro, ou até um valor não-Error) numa falha segura para logar. Nunca
 * propaga o `.message` bruto de um erro desconhecido sem passar por
 * `redactSecrets` primeiro. */
export function toSanitizedFailure(error: unknown): SanitizedFailure {
  if (error instanceof GuardedMigrationError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof Error) {
    return { code: 'ERR_UNEXPECTED', message: redactSecrets(error.message) };
  }
  return { code: 'ERR_UNEXPECTED', message: 'Falha inesperada (sem detalhe — tipo de erro não reconhecido).' };
}
