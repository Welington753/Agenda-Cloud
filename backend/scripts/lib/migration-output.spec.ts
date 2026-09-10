import { describe, expect, it } from 'vitest';
import { countPendingMigrations } from './migration-output.js';

describe('countPendingMigrations', () => {
  it('conta linhas marcadas como pendentes ([ ]) na saída do migration:show', () => {
    const output = [
      '[X] InitialSchema1788782400000',
      '[ ] AllowUndefinedPlanPrice1788782450000',
      '[ ] InitialPlanCatalog1788782460000',
    ].join('\n');

    expect(countPendingMigrations(output)).toBe(2);
  });

  it('devolve 0 quando todas as migrations já foram aplicadas ([X] em todas)', () => {
    const output = [
      '[X] InitialSchema1788782400000',
      '[X] AllowUndefinedPlanPrice1788782450000',
      '[X] InitialPlanCatalog1788782460000',
    ].join('\n');

    expect(countPendingMigrations(output)).toBe(0);
  });

  it('devolve 0 para saída vazia', () => {
    expect(countPendingMigrations('')).toBe(0);
  });

  it('ignora linhas que não são marcador de migration', () => {
    const output = [
      'Some log line before the list',
      '[X] InitialSchema1788782400000',
      '[ ] AllowUndefinedPlanPrice1788782450000',
      '',
    ].join('\n');

    expect(countPendingMigrations(output)).toBe(1);
  });
});
