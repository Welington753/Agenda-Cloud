// Guardas de conexão do workflow de migration guardada (Lote 6B.7) — cada
// função aqui é uma checagem que, se falhar, PARA a execução antes de tocar
// qualquer banco. Nenhuma mensagem de erro aqui interpola URL/host/senha —
// só texto estático (ver GuardedMigrationError em sanitize.ts). Repetidas
// imediatamente antes de qualquer escrita real (ver runbook) — nunca
// confiar só na checagem do início do processo.
import { GuardedMigrationError } from './sanitize.js';

/** Confirmação manual exigida pelo `workflow_dispatch` — precisa bater
 * caractere por caractere (nunca case-insensitive, nunca com espaço extra):
 * digitar qualquer outra coisa é tratado como "usuário não tem certeza",
 * nunca como "quase certo, deixa passar". */
export const CONFIRMATION_PHRASE = 'APLICAR_LOTE_6B2_PRODUCTION';

/** Única branch de onde este workflow pode ser disparado — nunca uma
 * feature branch em andamento, nunca `main` direto. */
export const REQUIRED_BRANCH = 'integration/nestjs-typeorm-frontend';

const ALLOWED_SCHEMES = new Set(['postgres:', 'postgresql:']);
const POOLER_MARKER = '-pooler';
// Endpoint ID do Neon: primeiro rótulo do host, sempre começando com `ep-`.
const ENDPOINT_ID_PATTERN = /^(ep-[a-z0-9]+(?:-[a-z0-9]+)*)/i;

/** Extrai o Endpoint ID (`ep-...`) do host de uma URL Postgres — não valida
 * scheme nem pooler, só o formato do host (ver `validateDirectUrl` para a
 * checagem completa). */
export function extractEndpointId(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new GuardedMigrationError('ERR_INVALID_SCHEME', 'URL de conexão não é uma URL válida.');
  }
  const match = ENDPOINT_ID_PATTERN.exec(parsed.hostname);
  if (!match) {
    throw new GuardedMigrationError(
      'ERR_ENDPOINT_UNRECOGNIZED',
      'Host da URL de conexão não tem formato de endpoint Neon reconhecível.',
    );
  }
  // Remove um sufixo `-pooler` do meio do Endpoint ID extraído, se vier
  // colado nele (ex.: `ep-foo-pooler` -> `ep-foo`) — a checagem de pooler em
  // si acontece separadamente em `validateDirectUrl`, isto só normaliza o id
  // para comparação.
  return match[1].replace(new RegExp(`${POOLER_MARKER}$`), '');
}

/** Checagem completa de uma URL direta (nunca pooler) contra o Endpoint ID
 * esperado (vindo de um GitHub Environment Secret) — usada para as três
 * URLs (production/backup/validation), sempre com o secret de endpoint
 * correspondente. */
export function validateDirectUrl(
  rawUrl: string,
  expectedEndpointId: string,
): { endpointId: string } {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new GuardedMigrationError('ERR_INVALID_SCHEME', 'URL de conexão não é uma URL válida.');
  }
  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    throw new GuardedMigrationError('ERR_INVALID_SCHEME', 'URL de conexão precisa usar o scheme postgresql://.');
  }
  if (parsed.hostname.toLowerCase().includes(POOLER_MARKER)) {
    throw new GuardedMigrationError(
      'ERR_POOLER_FORBIDDEN',
      'URL de conexão aponta para um endpoint pooler — só URL direta é permitida aqui.',
    );
  }

  const endpointId = extractEndpointId(rawUrl);
  if (endpointId !== expectedEndpointId) {
    throw new GuardedMigrationError(
      'ERR_ENDPOINT_MISMATCH',
      'Endpoint ID da URL de conexão não bate com o Endpoint ID esperado para este papel.',
    );
  }

  return { endpointId };
}

/** Os três Endpoint IDs (production/backup/validation) precisam ser
 * distintos entre si — nunca a mesma URL sendo usada para dois papéis
 * diferentes (a causa mais provável de aplicar migration no lugar errado,
 * ou de "validar" contra o próprio banco que se está prestes a alterar). */
export function assertRoleDistinctness(ids: {
  production: string;
  backup: string;
  validation: string;
}): void {
  if (ids.production === ids.backup) {
    throw new GuardedMigrationError(
      'ERR_BACKUP_AS_PRODUCTION',
      'O endpoint de backup não pode ser igual ao endpoint de production.',
    );
  }
  if (ids.production === ids.validation) {
    throw new GuardedMigrationError(
      'ERR_VALIDATION_AS_PRODUCTION',
      'O endpoint de validação não pode ser igual ao endpoint de production.',
    );
  }
  if (ids.backup === ids.validation) {
    throw new GuardedMigrationError(
      'ERR_ENDPOINTS_NOT_DISTINCT',
      'Os endpoints de production, backup e validação precisam ser todos distintos entre si.',
    );
  }
}

export function assertConfirmationPhrase(input: string | undefined): void {
  if (input !== CONFIRMATION_PHRASE) {
    throw new GuardedMigrationError(
      'ERR_CONFIRMATION_MISMATCH',
      'Confirmação manual não bate com a frase exigida.',
    );
  }
}

export function assertRunningFromBranch(currentBranch: string | undefined): void {
  if (currentBranch !== REQUIRED_BRANCH) {
    throw new GuardedMigrationError(
      'ERR_WRONG_BRANCH',
      'Este workflow só pode ser executado a partir da branch de integração esperada.',
    );
  }
}
