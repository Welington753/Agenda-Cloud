import { describe, expect, it } from 'vitest';
import { GuardedMigrationError } from './sanitize.js';
import {
  CONFIRMATION_PHRASE,
  REQUIRED_BRANCH,
  assertConfirmationPhrase,
  assertRunningFromBranch,
  assertRoleDistinctness,
  extractEndpointId,
  validateDirectUrl,
} from './connection-guard.js';

const DIRECT_URL = 'postgresql://user:pass@ep-cool-forest-123456.sa-east-1.aws.neon.tech/neondb?sslmode=require';
const POOLED_URL =
  'postgresql://user:pass@ep-cool-forest-123456-pooler.sa-east-1.aws.neon.tech/neondb?sslmode=require';

describe('extractEndpointId', () => {
  it('extrai o Endpoint ID de uma URL direta válida', () => {
    expect(extractEndpointId(DIRECT_URL)).toBe('ep-cool-forest-123456');
  });

  it('lança ERR_ENDPOINT_UNRECOGNIZED para host sem o padrão ep-*', () => {
    expect(() => extractEndpointId('postgresql://user:pass@algum-host.example.com/db')).toThrowError(
      expect.objectContaining({ code: 'ERR_ENDPOINT_UNRECOGNIZED' }),
    );
  });
});

describe('validateDirectUrl', () => {
  it('aceita uma URL direta válida cujo Endpoint ID bate com o esperado', () => {
    const result = validateDirectUrl(DIRECT_URL, 'ep-cool-forest-123456');
    expect(result.endpointId).toBe('ep-cool-forest-123456');
  });

  it('rejeita scheme inválido (não-postgres)', () => {
    expect(() =>
      validateDirectUrl('mysql://user:pass@ep-cool-forest-123456.neon.tech/db', 'ep-cool-forest-123456'),
    ).toThrowError(expect.objectContaining({ code: 'ERR_INVALID_SCHEME' }));
  });

  it('rejeita URL completamente inválida (não parseável)', () => {
    expect(() => validateDirectUrl('isto nao e uma url', 'ep-qualquer')).toThrowError(
      expect.objectContaining({ code: 'ERR_INVALID_SCHEME' }),
    );
  });

  it('rejeita URL com endpoint pooler (proibido para URL direta)', () => {
    expect(() => validateDirectUrl(POOLED_URL, 'ep-cool-forest-123456')).toThrowError(
      expect.objectContaining({ code: 'ERR_POOLER_FORBIDDEN' }),
    );
  });

  it('rejeita quando o Endpoint ID da URL não bate com o Endpoint ID esperado (secret errado)', () => {
    expect(() => validateDirectUrl(DIRECT_URL, 'ep-outro-endpoint-999')).toThrowError(
      expect.objectContaining({ code: 'ERR_ENDPOINT_MISMATCH' }),
    );
  });

  it('mensagem de erro nunca contém a URL/host/senha originais', () => {
    try {
      validateDirectUrl(DIRECT_URL, 'ep-outro-endpoint-999');
      expect.unreachable();
    } catch (error) {
      const message = (error as GuardedMigrationError).message;
      expect(message).not.toContain('pass');
      expect(message).not.toContain('ep-cool-forest-123456');
      expect(message).not.toContain('neon.tech');
    }
  });
});

describe('assertRoleDistinctness', () => {
  const base = { production: 'ep-prod-1', backup: 'ep-backup-1', validation: 'ep-validation-1' };

  it('aceita três endpoints distintos', () => {
    expect(() => assertRoleDistinctness(base)).not.toThrow();
  });

  it('rejeita quando a URL de backup é igual à de production (ERR_BACKUP_AS_PRODUCTION)', () => {
    expect(() =>
      assertRoleDistinctness({ ...base, backup: base.production }),
    ).toThrowError(expect.objectContaining({ code: 'ERR_BACKUP_AS_PRODUCTION' }));
  });

  it('rejeita quando a URL de validação é igual à de production (ERR_VALIDATION_AS_PRODUCTION)', () => {
    expect(() =>
      assertRoleDistinctness({ ...base, validation: base.production }),
    ).toThrowError(expect.objectContaining({ code: 'ERR_VALIDATION_AS_PRODUCTION' }));
  });

  it('rejeita quando backup e validação são o mesmo endpoint (ERR_ENDPOINTS_NOT_DISTINCT)', () => {
    expect(() =>
      assertRoleDistinctness({ ...base, validation: base.backup }),
    ).toThrowError(expect.objectContaining({ code: 'ERR_ENDPOINTS_NOT_DISTINCT' }));
  });
});

describe('assertConfirmationPhrase', () => {
  it('aceita exatamente a frase de confirmação exigida', () => {
    expect(() => assertConfirmationPhrase(CONFIRMATION_PHRASE)).not.toThrow();
    expect(CONFIRMATION_PHRASE).toBe('APLICAR_LOTE_6B2_PRODUCTION');
  });

  it('rejeita confirmação ausente', () => {
    expect(() => assertConfirmationPhrase(undefined)).toThrowError(
      expect.objectContaining({ code: 'ERR_CONFIRMATION_MISMATCH' }),
    );
  });

  it('rejeita confirmação com diferença de maiúscula/minúscula ou espaço', () => {
    expect(() => assertConfirmationPhrase('aplicar_lote_6b2_production')).toThrowError(
      expect.objectContaining({ code: 'ERR_CONFIRMATION_MISMATCH' }),
    );
    expect(() => assertConfirmationPhrase('APLICAR_LOTE_6B2_PRODUCTION ')).toThrowError(
      expect.objectContaining({ code: 'ERR_CONFIRMATION_MISMATCH' }),
    );
  });
});

describe('assertRunningFromBranch', () => {
  it('aceita exatamente a branch exigida', () => {
    expect(() => assertRunningFromBranch(REQUIRED_BRANCH)).not.toThrow();
    expect(REQUIRED_BRANCH).toBe('integration/nestjs-typeorm-frontend');
  });

  it('rejeita qualquer outra branch', () => {
    expect(() => assertRunningFromBranch('feat/qualquer-coisa')).toThrowError(
      expect.objectContaining({ code: 'ERR_WRONG_BRANCH' }),
    );
  });

  it('rejeita branch ausente/indefinida', () => {
    expect(() => assertRunningFromBranch(undefined)).toThrowError(
      expect.objectContaining({ code: 'ERR_WRONG_BRANCH' }),
    );
  });
});
