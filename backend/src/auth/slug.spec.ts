import { describe, expect, it } from 'vitest';
import { MAX_SLUG_COLLISION_ATTEMPTS, resolveSlug, slugify } from './slug.js';

describe('slugify', () => {
  it('converte para minúsculo, troca espaços por hífen', () => {
    expect(slugify('Dom Navalha Barbearia')).toBe('dom-navalha-barbearia');
  });

  it('remove acentos', () => {
    expect(slugify('Salão José & Cia')).toBe('salao-jose-cia');
  });

  it('remove caracteres inválidos', () => {
    expect(slugify('Café #1 @Studio!')).toBe('cafe-1-studio');
  });

  it('remove hífens duplicados', () => {
    expect(slugify('Bela   --  Barbearia')).toBe('bela-barbearia');
  });

  it('remove hífen nas pontas', () => {
    expect(slugify('-Studio-')).toBe('studio');
  });

  it('respeita limite de tamanho', () => {
    const nomeLongo = 'a'.repeat(100);
    expect(slugify(nomeLongo, 30).length).toBeLessThanOrEqual(30);
  });

  it('lança erro se o resultado ficar vazio', () => {
    expect(() => slugify('@@@ !!! ###')).toThrow();
  });
});

describe('resolveSlug', () => {
  it('retorna o slug simples quando não há colisão', async () => {
    const slug = await resolveSlug('dom-navalha', async () => false);
    expect(slug).toBe('dom-navalha');
  });

  it('adiciona sufixo determinístico quando o slug simples já existe', async () => {
    const existentes = new Set(['dom-navalha']);
    const slug = await resolveSlug('dom-navalha', async (candidate) =>
      existentes.has(candidate),
    );
    expect(slug).toBe('dom-navalha-2');
  });

  it('incrementa o sufixo até achar um slug livre', async () => {
    const existentes = new Set(['studio', 'studio-2', 'studio-3']);
    const slug = await resolveSlug('studio', async (candidate) =>
      existentes.has(candidate),
    );
    expect(slug).toBe('studio-4');
  });

  it('desiste após o limite de tentativas para nunca entrar em loop infinito', async () => {
    await expect(
      resolveSlug('sempre-ocupado', async () => true),
    ).rejects.toThrow();
  });

  it('o limite de tentativas é finito e positivo', () => {
    expect(MAX_SLUG_COLLISION_ATTEMPTS).toBeGreaterThan(0);
    expect(Number.isFinite(MAX_SLUG_COLLISION_ATTEMPTS)).toBe(true);
  });
});
