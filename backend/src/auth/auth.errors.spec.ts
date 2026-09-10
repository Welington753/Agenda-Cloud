import { describe, expect, it } from 'vitest';
import { EmailAlreadyInUseError, PlanUnavailableError } from './auth.errors.js';

describe('EmailAlreadyInUseError', () => {
  it('é uma instância de Error com mensagem própria', () => {
    const error = new EmailAlreadyInUseError();
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('EmailAlreadyInUseError');
    expect(error.message.length).toBeGreaterThan(0);
  });
});

describe('PlanUnavailableError', () => {
  it('é uma instância de Error com mensagem própria', () => {
    const error = new PlanUnavailableError();
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('PlanUnavailableError');
    expect(error.message.length).toBeGreaterThan(0);
  });
});
