import { describe, expect, it } from 'vitest';
import {
  countPendingMigrations,
  EXPECTED_LOTE_6B2_MIGRATION_NAMES,
  parseMigrationShowOutput,
  validateMigrationShowStatus,
} from './migration-output.js';

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

describe('parseMigrationShowOutput', () => {
  it('extrai nomes aplicados ([X] id nome) e pendentes ([ ] nome), ignorando o resto', () => {
    const output = [
      '',
      '> backend@0.0.1 migration:show:compiled',
      '> typeorm migration:show -d dist-migrations/database/migrations-data-source.js',
      '',
      '[X] 1 InitialSchema1788782400000',
      '[ ] AllowUndefinedPlanPrice1788782450000',
      '[ ] InitialPlanCatalog1788782460000',
    ].join('\n');

    expect(parseMigrationShowOutput(output)).toEqual({
      appliedNames: ['InitialSchema1788782400000'],
      pendingNames: ['AllowUndefinedPlanPrice1788782450000', 'InitialPlanCatalog1788782460000'],
    });
  });

  it('tolera CRLF residual em cada linha', () => {
    const output = ['[X] 1 InitialSchema1788782400000\r', '[ ] AllowUndefinedPlanPrice1788782450000\r'].join('\n');

    expect(parseMigrationShowOutput(output)).toEqual({
      appliedNames: ['InitialSchema1788782400000'],
      pendingNames: ['AllowUndefinedPlanPrice1788782450000'],
    });
  });

  // Causa raiz comprovada da execução real #6: sob `CI=true` +
  // `GITHUB_ACTIONS=true` (sempre presentes no runner do GitHub Actions), a
  // detecção de cor do `ansis` (dependência do TypeORM, ver
  // node_modules/ansis/index.cjs) ativa cor mesmo com stdout sendo um pipe —
  // ao contrário do padrão usual "sem TTY = sem cor". `PlatformTools.log()`
  // (node_modules/typeorm/platform/PlatformTools.js) então envolve CADA
  // linha de `logSchemaBuild` em `\x1b[4m...\x1b[24m` (underline),
  // reproduzido byte a byte com `CI=true GITHUB_ACTIONS=true node
  // <script que chama AdvancedConsoleLogger.logSchemaBuild>`. A linha deixa
  // de começar literalmente com `[`, então nenhum padrão batia —
  // exatamente o `MIGRATION_SHOW_VALIDATION_FAILED: empty_or_unrecognized`
  // visto no log real. `parseMigrationShowOutput` precisa tolerar isso
  // mesmo que a correção primária (`NO_COLOR=1` no ambiente do subprocesso,
  // ver apply-lote6b2-production.ts) já deva neutralizar a cor na origem —
  // defesa em profundidade contra qualquer dependência futura que ignore
  // `NO_COLOR`.
  it('remove sequências ANSI (cor/underline injetadas sob CI=true) antes de reconhecer as linhas', () => {
    const output = ['\x1b[4m[X] 1 InitialSchema1788782400000\x1b[24m', '\x1b[4m[ ] AllowUndefinedPlanPrice1788782450000\x1b[24m'].join(
      '\n',
    );

    expect(parseMigrationShowOutput(output)).toEqual({
      appliedNames: ['InitialSchema1788782400000'],
      pendingNames: ['AllowUndefinedPlanPrice1788782450000'],
    });
  });
});

describe('validateMigrationShowStatus — fail-closed contra lista vazia/incompleta/duplicada/desconhecida', () => {
  it('aceita a lista completa e correta (1 aplicada + 2 pendentes deste lote)', () => {
    const status = {
      appliedNames: [EXPECTED_LOTE_6B2_MIGRATION_NAMES[0]],
      pendingNames: [EXPECTED_LOTE_6B2_MIGRATION_NAMES[1], EXPECTED_LOTE_6B2_MIGRATION_NAMES[2]],
    };

    expect(validateMigrationShowStatus(status)).toBeNull();
  });

  it('aceita a lista completa quando as três já estão aplicadas (conclusão real)', () => {
    const status = {
      appliedNames: [...EXPECTED_LOTE_6B2_MIGRATION_NAMES],
      pendingNames: [],
    };

    expect(validateMigrationShowStatus(status)).toBeNull();
  });

  it('rejeita saída vazia — nunca interpretada como "tudo aplicado"', () => {
    const status = { appliedNames: [], pendingNames: [] };

    expect(validateMigrationShowStatus(status)).toEqual({ category: 'empty_or_unrecognized' });
  });

  it('rejeita lista faltando uma migration do lote', () => {
    const status = {
      appliedNames: [EXPECTED_LOTE_6B2_MIGRATION_NAMES[0]],
      pendingNames: [EXPECTED_LOTE_6B2_MIGRATION_NAMES[1]],
    };

    expect(validateMigrationShowStatus(status)).toEqual({
      category: 'missing_names',
      names: [EXPECTED_LOTE_6B2_MIGRATION_NAMES[2]],
    });
  });

  it('rejeita nome não reconhecido (fora do gabarito deste lote)', () => {
    const status = {
      appliedNames: [EXPECTED_LOTE_6B2_MIGRATION_NAMES[0]],
      pendingNames: [EXPECTED_LOTE_6B2_MIGRATION_NAMES[1], EXPECTED_LOTE_6B2_MIGRATION_NAMES[2], 'AlgumaOutraMigration9999999999999'],
    };

    expect(validateMigrationShowStatus(status)).toEqual({
      category: 'unexpected_names',
      names: ['AlgumaOutraMigration9999999999999'],
    });
  });

  it('rejeita nome duplicado', () => {
    const status = {
      appliedNames: [EXPECTED_LOTE_6B2_MIGRATION_NAMES[0]],
      pendingNames: [EXPECTED_LOTE_6B2_MIGRATION_NAMES[1], EXPECTED_LOTE_6B2_MIGRATION_NAMES[1]],
    };

    expect(validateMigrationShowStatus(status)).toEqual({
      category: 'duplicate_names',
      names: [EXPECTED_LOTE_6B2_MIGRATION_NAMES[1]],
    });
  });
});
