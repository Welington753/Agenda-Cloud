import { describe, expect, it } from 'vitest';
import { QueryFailedError } from 'typeorm';
import { isExclusionViolation } from './exclusion-violation.js';

const CONSTRAINT = 'appointments_no_overlap_excl';

function erroDeBanco(code: string, constraint?: string): QueryFailedError {
  const erro = new QueryFailedError('INSERT ...', [], new Error('falhou'));
  (erro as unknown as { driverError: unknown }).driverError = { code, constraint };
  return erro;
}

describe('isExclusionViolation', () => {
  it('reconhece 23P01 na constraint nomeada', () => {
    expect(isExclusionViolation(erroDeBanco('23P01', CONSTRAINT), CONSTRAINT)).toBe(true);
  });

  it('23P01 de OUTRA exclusion constraint não é conflito de horário', () => {
    expect(isExclusionViolation(erroDeBanco('23P01', 'outra_excl'), CONSTRAINT)).toBe(false);
  });

  it.each([
    ['23505', 'unique violation'],
    ['23503', 'foreign key violation'],
    ['40P01', 'deadlock'],
    ['23514', 'check violation'],
  ])('código %s (%s) nunca vira conflito de horário', (code) => {
    expect(isExclusionViolation(erroDeBanco(code, CONSTRAINT), CONSTRAINT)).toBe(false);
  });

  it('erro que não é QueryFailedError nunca vira conflito', () => {
    expect(isExclusionViolation(new Error('timeout'), CONSTRAINT)).toBe(false);
    expect(isExclusionViolation({ code: '23P01', constraint: CONSTRAINT }, CONSTRAINT)).toBe(false);
    expect(isExclusionViolation(null, CONSTRAINT)).toBe(false);
  });

  it('23P01 sem nome de constraint não vira conflito', () => {
    expect(isExclusionViolation(erroDeBanco('23P01'), CONSTRAINT)).toBe(false);
  });
});
