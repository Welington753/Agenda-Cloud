import { QueryFailedError } from 'typeorm';
import { describe, expect, it } from 'vitest';
import { isUniqueViolation } from './unique-violation.js';

function buildQueryFailedError(constraint: string): QueryFailedError {
  const driverError = { code: '23505', constraint } as unknown as Error;
  return new QueryFailedError('INSERT ...', [], driverError);
}

describe('isUniqueViolation', () => {
  it('reconhece violação da constraint informada', () => {
    const error = buildQueryFailedError('uq_users_email');
    expect(isUniqueViolation(error, 'uq_users_email')).toBe(true);
  });

  it('rejeita quando a constraint é de outra tabela', () => {
    const error = buildQueryFailedError('uq_tenants_slug');
    expect(isUniqueViolation(error, 'uq_users_email')).toBe(false);
  });

  it('rejeita erro que não é QueryFailedError', () => {
    expect(isUniqueViolation(new Error('qualquer coisa'), 'uq_users_email')).toBe(false);
  });

  it('rejeita QueryFailedError que não é violação de unicidade (código diferente)', () => {
    const driverError = { code: '23503', constraint: 'uq_users_email' } as unknown as Error;
    const error = new QueryFailedError('INSERT ...', [], driverError);
    expect(isUniqueViolation(error, 'uq_users_email')).toBe(false);
  });
});
