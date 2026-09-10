import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe.js';

const schema = z.object({
  email: z.string().email(),
  senha: z.string().min(8),
});

describe('ZodValidationPipe', () => {
  it('devolve o dado já validado/tipado quando o schema aceita', () => {
    const pipe = new ZodValidationPipe(schema);
    const resultado = pipe.transform({
      email: 'pessoa@exemplo.com',
      senha: 'senha-segura',
    });
    expect(resultado).toEqual({
      email: 'pessoa@exemplo.com',
      senha: 'senha-segura',
    });
  });

  it('lança BadRequestException quando o schema rejeita', () => {
    const pipe = new ZodValidationPipe(schema);
    expect(() => pipe.transform({ email: 'nao-e-email', senha: '123' })).toThrow(
      BadRequestException,
    );
  });

  it('nunca inclui o valor recebido na mensagem de erro (nunca ecoa senha em log)', () => {
    const pipe = new ZodValidationPipe(schema);
    try {
      pipe.transform({ email: 'nao-e-email', senha: 'curta' });
      throw new Error('deveria ter lançado');
    } catch (erro) {
      const mensagem = (erro as Error).message;
      expect(mensagem).not.toContain('curta');
      expect(mensagem).not.toContain('nao-e-email');
      expect(mensagem).toContain('email');
      expect(mensagem).toContain('senha');
    }
  });
});
