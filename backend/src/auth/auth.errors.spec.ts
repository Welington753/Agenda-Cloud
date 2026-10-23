import { describe, expect, it } from 'vitest';
import { InvalidCredentialsError } from './auth.errors.js';

describe('InvalidCredentialsError', () => {
  it('é uma instância de Error com mensagem própria e genérica', () => {
    const error = new InvalidCredentialsError();
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('InvalidCredentialsError');
    expect(error.message.length).toBeGreaterThan(0);
  });

  it('a mensagem nunca menciona qual etapa falhou (e-mail, senha, status)', () => {
    const error = new InvalidCredentialsError();
    const mensagem = error.message.toLowerCase();
    expect(mensagem).not.toContain('e-mail');
    expect(mensagem).not.toContain('email');
    expect(mensagem).not.toContain('senha');
    expect(mensagem).not.toContain('inativ');
    expect(mensagem).not.toContain('suspens');
  });
});
