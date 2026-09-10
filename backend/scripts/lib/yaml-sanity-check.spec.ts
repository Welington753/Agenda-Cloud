import { describe, expect, it } from 'vitest';
import { checkYamlSanity } from './yaml-sanity-check.js';

describe('checkYamlSanity', () => {
  it('aceita um YAML simples bem formado (indentação em espaços, múltiplos de 2)', () => {
    const yaml = [
      'name: exemplo',
      'on:',
      '  workflow_dispatch:',
      '    inputs:',
      '      confirmation:',
      '        required: true',
      'jobs:',
      '  apply:',
      '    steps:',
      '      - name: um passo',
      '        run: echo ok',
    ].join('\n');

    const result = checkYamlSanity(yaml);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejeita indentação com tab', () => {
    const yaml = 'name: exemplo\non:\n\tworkflow_dispatch:';
    const result = checkYamlSanity(yaml);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /tab/i.test(e))).toBe(true);
  });

  it('rejeita indentação que não é múltiplo de 2 espaços', () => {
    const yaml = 'on:\n workflow_dispatch:';
    const result = checkYamlSanity(yaml);
    expect(result.valid).toBe(false);
  });

  it('rejeita chaves/colchetes desbalanceados (coleções em fluxo)', () => {
    const yaml = 'jobs:\n  apply:\n    strategy:\n      matrix: [1, 2';
    const result = checkYamlSanity(yaml);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /desbalance/i.test(e))).toBe(true);
  });

  it('rejeita arquivo vazio', () => {
    const result = checkYamlSanity('');
    expect(result.valid).toBe(false);
  });

  it('aceita comentários e linhas em branco sem reclamar', () => {
    const yaml = ['# comentário', '', 'name: exemplo', ''].join('\n');
    expect(checkYamlSanity(yaml).valid).toBe(true);
  });
});
