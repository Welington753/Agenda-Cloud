import { describe, expect, it } from 'vitest';
import { buildCorsOptions } from './cors.config.js';

describe('buildCorsOptions', () => {
  it('usa a URL exata do frontend como origem, nunca wildcard', () => {
    const opcoes = buildCorsOptions('https://app.agendacloud.com.br');
    expect(opcoes.origin).toBe('https://app.agendacloud.com.br');
    expect(opcoes.origin).not.toBe('*');
  });

  it('habilita credentials sempre junto com uma origem explícita (nunca combina com wildcard)', () => {
    const opcoes = buildCorsOptions('http://localhost:3000');
    expect(opcoes.credentials).toBe(true);
    expect(opcoes.origin).not.toBe('*');
  });
});
