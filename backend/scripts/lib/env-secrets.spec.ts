import { describe, expect, it } from 'vitest';
import { GuardedMigrationError } from './sanitize.js';
import { readRequiredSecrets } from './env-secrets.js';

const FULL_ENV = {
  L6B2_PRODUCTION_DIRECT_URL: 'postgresql://u:p@ep-prod-1.neon.tech/db',
  L6B2_BACKUP_DIRECT_URL: 'postgresql://u:p@ep-backup-1.neon.tech/db',
  L6B2_PRODUCTION_ENDPOINT_ID: 'ep-prod-1',
  L6B2_BACKUP_ENDPOINT_ID: 'ep-backup-1',
  L6B2_VALIDATION_ENDPOINT_ID: 'ep-validation-1',
  L6B2_BACKUP_BRANCH_NAME: 'backup-lote-6b2',
};

describe('readRequiredSecrets', () => {
  it('lê todos os seis valores de process.env (nunca de arquivo/dotenv)', () => {
    const secrets = readRequiredSecrets(FULL_ENV);
    expect(secrets).toEqual({
      productionDirectUrl: FULL_ENV.L6B2_PRODUCTION_DIRECT_URL,
      backupDirectUrl: FULL_ENV.L6B2_BACKUP_DIRECT_URL,
      productionEndpointId: FULL_ENV.L6B2_PRODUCTION_ENDPOINT_ID,
      backupEndpointId: FULL_ENV.L6B2_BACKUP_ENDPOINT_ID,
      validationEndpointId: FULL_ENV.L6B2_VALIDATION_ENDPOINT_ID,
      backupBranchName: FULL_ENV.L6B2_BACKUP_BRANCH_NAME,
    });
  });

  it('lança ERR_MISSING_SECRET quando falta L6B2_PRODUCTION_DIRECT_URL', () => {
    const { L6B2_PRODUCTION_DIRECT_URL: _omit, ...semProducao } = FULL_ENV;
    expect(() => readRequiredSecrets(semProducao)).toThrowError(
      expect.objectContaining({ code: 'ERR_MISSING_SECRET' }),
    );
  });

  it('lança ERR_MISSING_SECRET quando falta qualquer um dos seis (varredura completa)', () => {
    for (const key of Object.keys(FULL_ENV)) {
      const parcial = { ...FULL_ENV };
      delete (parcial as Record<string, string>)[key];
      expect(() => readRequiredSecrets(parcial), `faltando ${key}`).toThrowError(
        expect.objectContaining({ code: 'ERR_MISSING_SECRET' }),
      );
    }
  });

  it('a mensagem de erro nunca inclui valor nenhum de secret, só o nome da variável ausente', () => {
    const { L6B2_PRODUCTION_DIRECT_URL: _omit, ...semProducao } = FULL_ENV;
    try {
      readRequiredSecrets(semProducao);
      expect.unreachable();
    } catch (error) {
      const message = (error as GuardedMigrationError).message;
      expect(message).toContain('L6B2_PRODUCTION_DIRECT_URL');
      expect(message).not.toContain('ep-backup-1');
      expect(message).not.toContain('postgresql://');
    }
  });

  it('string vazia conta como ausente (nunca aceita valor vazio como configurado)', () => {
    expect(() =>
      readRequiredSecrets({ ...FULL_ENV, L6B2_BACKUP_BRANCH_NAME: '' }),
    ).toThrowError(expect.objectContaining({ code: 'ERR_MISSING_SECRET' }));
  });
});
