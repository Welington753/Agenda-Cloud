import { describe, expect, it } from 'vitest';
import { loginSchema } from './login.dto.js';

const validPayload = {
  email: 'Maria@Example.com',
  password: 'senha-valida-123',
};

describe('loginSchema', () => {
  it('aceita um payload válido', () => {
    const result = loginSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  it('normaliza email para lowercase e aplica trim', () => {
    const result = loginSchema.parse({ ...validPayload, email: '  Maria@Example.com  ' });
    expect(result.email).toBe('maria@example.com');
  });

  it('rejeita email inválido', () => {
    const result = loginSchema.safeParse({ ...validPayload, email: 'não-é-email' });
    expect(result.success).toBe(false);
  });

  it('rejeita senha com menos de 10 caracteres', () => {
    const result = loginSchema.safeParse({ ...validPayload, password: 'curta123' });
    expect(result.success).toBe(false);
  });

  it('rejeita senha com mais de 128 caracteres', () => {
    const result = loginSchema.safeParse({ ...validPayload, password: 'a'.repeat(129) });
    expect(result.success).toBe(false);
  });

  it('rejeita campos desconhecidos', () => {
    const result = loginSchema.safeParse({ ...validPayload, isAdmin: true });
    expect(result.success).toBe(false);
  });

  it('rejeita payload sem password', () => {
    const { password: _password, ...semSenha } = validPayload;
    const result = loginSchema.safeParse(semSenha);
    expect(result.success).toBe(false);
  });

  it('rejeita payload sem email', () => {
    const { email: _email, ...semEmail } = validPayload;
    const result = loginSchema.safeParse(semEmail);
    expect(result.success).toBe(false);
  });

  it('nunca inclui a senha na mensagem de erro de validação', () => {
    const result = loginSchema.safeParse({ ...validPayload, password: 'curta' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const mensagens = JSON.stringify(result.error.issues);
      expect(mensagens).not.toContain('curta');
    }
  });
});
