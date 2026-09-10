import { describe, expect, it } from 'vitest';
import { registerSchema } from './register.dto.js';

const validPayload = {
  ownerName: 'Maria Souza',
  businessName: 'Studio Bela',
  email: 'Maria@Example.com',
  phone: '(11) 98765-4321',
  password: 'senha-valida-123',
};

describe('registerSchema', () => {
  it('aceita um payload válido', () => {
    const result = registerSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  it('normaliza email para lowercase', () => {
    const result = registerSchema.parse(validPayload);
    expect(result.email).toBe('maria@example.com');
  });

  it('aplica trim em ownerName e businessName', () => {
    const result = registerSchema.parse({
      ...validPayload,
      ownerName: '  Maria Souza  ',
      businessName: '  Studio Bela  ',
    });
    expect(result.ownerName).toBe('Maria Souza');
    expect(result.businessName).toBe('Studio Bela');
  });

  it('rejeita email inválido', () => {
    const result = registerSchema.safeParse({ ...validPayload, email: 'não-é-email' });
    expect(result.success).toBe(false);
  });

  it('rejeita ownerName com menos de 2 caracteres', () => {
    const result = registerSchema.safeParse({ ...validPayload, ownerName: 'M' });
    expect(result.success).toBe(false);
  });

  it('rejeita businessName com menos de 2 caracteres', () => {
    const result = registerSchema.safeParse({ ...validPayload, businessName: 'S' });
    expect(result.success).toBe(false);
  });

  it('rejeita senha com menos de 10 caracteres', () => {
    const result = registerSchema.safeParse({ ...validPayload, password: 'curta123' });
    expect(result.success).toBe(false);
  });

  it('rejeita senha com mais de 128 caracteres', () => {
    const result = registerSchema.safeParse({
      ...validPayload,
      password: 'a'.repeat(129),
    });
    expect(result.success).toBe(false);
  });

  it('aceita senha simples sem exigir símbolo ou maiúscula', () => {
    const result = registerSchema.safeParse({
      ...validPayload,
      password: 'todaminuscula',
    });
    expect(result.success).toBe(true);
  });

  it('rejeita telefone inválido', () => {
    const result = registerSchema.safeParse({ ...validPayload, phone: '123' });
    expect(result.success).toBe(false);
  });

  it('rejeita campos desconhecidos', () => {
    const result = registerSchema.safeParse({
      ...validPayload,
      isAdmin: true,
    });
    expect(result.success).toBe(false);
  });

  it('rejeita payload sem password', () => {
    const { password: _password, ...semSenha } = validPayload;
    const result = registerSchema.safeParse(semSenha);
    expect(result.success).toBe(false);
  });

  it('nunca inclui a senha na mensagem de erro de validação', () => {
    const result = registerSchema.safeParse({ ...validPayload, password: 'curta' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const mensagens = JSON.stringify(result.error.issues);
      expect(mensagens).not.toContain('curta');
    }
  });
});
