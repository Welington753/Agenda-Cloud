import { describe, expect, it } from 'vitest';
import { normalizePhone } from './phone-normalizer.js';

describe('normalizePhone', () => {
  it('normaliza celular brasileiro com DDD e código do país para E.164', () => {
    expect(normalizePhone('(11) 98765-4321')).toBe('+5511987654321');
  });

  it('normaliza número já em E.164 mantendo o formato', () => {
    expect(normalizePhone('+5511987654321')).toBe('+5511987654321');
  });

  it('normaliza número sem +55 assumindo Brasil', () => {
    expect(normalizePhone('11987654321')).toBe('+5511987654321');
  });

  it('remove espaços, parênteses e hífens antes de normalizar', () => {
    expect(normalizePhone('  (21) 3456-7890  ')).toBe('+552134567890');
  });

  it('rejeita telefone com poucos dígitos', () => {
    expect(() => normalizePhone('123')).toThrow();
  });

  it('rejeita telefone com letras', () => {
    expect(() => normalizePhone('11abc654321')).toThrow();
  });

  it('rejeita string vazia', () => {
    expect(() => normalizePhone('')).toThrow();
  });
});
