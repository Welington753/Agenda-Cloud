// Única fonte de segredos dos scripts de migration guardada: `process.env`.
// NUNCA `dotenv`, NUNCA leitura de arquivo (`backend/.env` incluso) — o
// workflow injeta os cinco GitHub Environment Secrets + a variável de nome
// do backup como variáveis de ambiente do processo, nada mais. Ver
// docs/runbooks/migrations-production.md para como configurar cada um pela
// interface do GitHub.
import { GuardedMigrationError } from './sanitize.js';

export interface RequiredSecrets {
  productionDirectUrl: string;
  backupDirectUrl: string;
  productionEndpointId: string;
  backupEndpointId: string;
  validationEndpointId: string;
  backupBranchName: string;
}

interface EnvLike {
  [key: string]: string | undefined;
}

function readRequired(env: EnvLike, name: string): string {
  const value = env[name];
  if (!value) {
    // O NOME da variável (literal fixo escrito aqui, nunca lido
    // dinamicamente do ambiente) não é segredo nenhum — só o VALOR é. Nunca
    // interpolar `value` nesta mensagem.
    throw new GuardedMigrationError('ERR_MISSING_SECRET', `Variável obrigatória ausente: ${name}`);
  }
  return value;
}

/** Lê os seis valores exigidos (cinco GitHub Environment Secrets + a
 * variável de nome do branch de backup) de `env` — por padrão
 * `process.env`, mas aceita um objeto injetado para teste, nunca lê arquivo
 * nenhum. Falta de qualquer um dos seis interrompe aqui, antes de qualquer
 * tentativa de conexão. */
export function readRequiredSecrets(env: EnvLike = process.env): RequiredSecrets {
  return {
    productionDirectUrl: readRequired(env, 'L6B2_PRODUCTION_DIRECT_URL'),
    backupDirectUrl: readRequired(env, 'L6B2_BACKUP_DIRECT_URL'),
    productionEndpointId: readRequired(env, 'L6B2_PRODUCTION_ENDPOINT_ID'),
    backupEndpointId: readRequired(env, 'L6B2_BACKUP_ENDPOINT_ID'),
    validationEndpointId: readRequired(env, 'L6B2_VALIDATION_ENDPOINT_ID'),
    backupBranchName: readRequired(env, 'L6B2_BACKUP_BRANCH_NAME'),
  };
}
